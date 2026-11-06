'use strict';
/* A small authoritative GM-hosted session server for a trusted LAN / Radmin VPN group.
   The session password travels over WebSocket; only use over a private, encrypted VPN.
   Do not expose this development server directly to the public Internet. */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {WebSocketServer,WebSocket}=require('ws');
const MAX_FRAME=2*1024*1024;
const SID=()=>crypto.randomUUID();
const safe=(x,def)=>typeof x==='string'?x.slice(0,def):'';
const asNum=(x,defaultValue=0)=>Number.isFinite(Number(x))?Number(x):defaultValue;
function defaultCampaign(){return {version:4,npcs:[],encounters:[],activeEncounter:null,targetAssignments:{},history:[],checkpoints:[],players:{},campaign:{name:'S.T.A.L.K.E.R. Campaign',date:'',location:'',notes:''},catalog:[]}}
function validPlayer(p){return p&&typeof p==='object'&&!Array.isArray(p)&&Array.isArray(p.items)&&Array.isArray(p.catalog)&&p.slots&&typeof p.slots==='object'&&p.conditions&&p.stats}
function validCampaign(g){return g&&typeof g==='object'&&!Array.isArray(g)&&Array.isArray(g.npcs)&&Array.isArray(g.encounters)&&g.campaign&&typeof g.campaign==='object'}
function publicEncounter(data){const original=(data.encounters||[]).find(x=>x.id===data.activeEncounter);if(!original)return null;
 const roster=original.roster.filter(x=>x.visible).map(a=>({id:a.id,name:a.name,hp:a.hp,maxHP:a.maxHP,dead:a.dead,visible:true,loot:a.hp<=0?a.loot:[]}));
 const stashes=original.stashes.filter(x=>x.revealed).map(s=>({id:s.id,name:s.name,revealed:true,items:s.items}));
 return {id:original.id,name:original.name,location:original.location,roster,stashes};
}
function publicCampaignSnapshot(data){const enc=publicEncounter(data);const neededIds=new Set();
 for(const stash of enc?.stashes||[])for(const item of stash.items||[])neededIds.add(item.templateId);
 for(const actor of enc?.roster||[])for(const item of actor.loot||[])neededIds.add(item.templateId);
 const catalog=(data.catalog||[]).filter(t=>neededIds.has(t.id));
 return {type:'publicUpdate',encounter:enc,catalog};
}
function atomicWrite(file,data){const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,JSON.stringify(data));fs.renameSync(tmp,file)}
function eqString(a,b){const aa=Buffer.from(String(a)),bb=Buffer.from(String(b));return aa.length===bb.length&&crypto.timingSafeEqual(aa,bb)}
function safeSend(socket,data){if(socket.readyState===WebSocket.OPEN){try{socket.send(JSON.stringify(data))}catch{}}}
async function startServer({port,password,campaignName,dataDir}){
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid host port');
 if(typeof password!=='string'||password.length<8)throw Error('Session password must be at least eight characters.');
 const hostSecret=crypto.randomBytes(24).toString('hex');
 fs.mkdirSync(dataDir,{recursive:true});const file=path.join(dataDir,'server-campaign.json'),backupDir=path.join(dataDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
 let persisted={campaign:defaultCampaign(),profiles:{}};
 try{const raw=JSON.parse(fs.readFileSync(file,'utf8'));if(validCampaign(raw.campaign))persisted=raw}catch{}
 if(!persisted.profiles||typeof persisted.profiles!=='object')persisted.profiles={};
 if(!persisted.campaign.catalog)persisted.campaign.catalog=[];
 if(campaignName&&!persisted.campaign.campaign?.name)persisted.campaign.campaign.name=safe(campaignName,100);
 const clients=new Map();const fails=new Map();const processedAttacks=new Map();let saveTimer=null,lastBackup=0;
 function persist(){if(saveTimer)clearTimeout(saveTimer);saveTimer=null;atomicWrite(file,persisted);
  if(Date.now()-lastBackup>15*60*1000){const filename='checkpoint-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';fs.copyFileSync(file,path.join(backupDir,filename));lastBackup=Date.now();const old=fs.readdirSync(backupDir).filter(x=>x.endsWith('.json')).sort();for(const x of old.slice(0,-20))fs.unlinkSync(path.join(backupDir,x))}
 }
 function requestSave(){if(saveTimer)clearTimeout(saveTimer);saveTimer=setTimeout(persist,450)}
 function broadcastPublic(){const data=publicCampaignSnapshot(persisted.campaign);for(const [client,record] of clients)if(record.role==='player')safeSend(client,data)}
 function broadcastGM(){for(const [client,record] of clients)if(record.role==='gm')safeSend(client,{type:'gmSnapshot',campaign:persisted.campaign})}
 function notifyGMPlayer(playerId){const rec=persisted.profiles[playerId];for(const [client,session] of clients)if(session.role==='gm')safeSend(client,{type:'playerSnapshot',playerId,name:rec?.name||playerId,character:rec?.character})}
 function targetAssignmentFor(playerId){const active=persisted.campaign.encounters.find(x=>x.id===persisted.campaign.activeEncounter),actorId=persisted.campaign.targetAssignments?.[playerId];const actor=active?.roster.find(x=>x.id===actorId&&x.visible&&!x.dead);return {type:'targetAssignment',actorId:actor?.id||null,name:actor?.name||'',stats:actor?{dr:actor.dr,ht:actor.ht,dodge:actor.dodge,hp:actor.hp,maxHP:actor.maxHP}:null}}
 function sendTargetAssignment(playerId){const packet=targetAssignmentFor(playerId);for(const [socket,session] of clients)if(session.role==='player'&&session.playerId===playerId)safeSend(socket,packet)}
 function authoritativeLoot(client,record,msg){const active=persisted.campaign.encounters.find(x=>x.id===persisted.campaign.activeEncounter);if(!active)return safeSend(client,{type:'lootFailed',reason:'No active encounter'});
  const stash=active.stashes.find(x=>x.id===msg.stashId&&x.revealed);
  const actor=active.roster.find(x=>x.id===msg.stashId&&x.visible&&x.hp<=0);
  const source=stash?.items||actor?.loot;if(!source)return safeSend(client,{type:'lootFailed',reason:'Loot container is not available'});
  const line=source.find(x=>x.id===msg.itemId);if(!line||line.quantity<1)return safeSend(client,{type:'lootFailed',reason:'This item is no longer available'});
  const profile=persisted.profiles[record.playerId];if(!profile||!validPlayer(profile.character))return safeSend(client,{type:'lootFailed',reason:'Character not registered'});
  const t=(persisted.campaign.catalog||[]).find(x=>x.id===line.templateId)||(profile.character.catalog||[]).find(x=>x.id===line.templateId);
  if(!t)return safeSend(client,{type:'lootFailed',reason:'Missing catalogue template'});
  const stackLimit=Math.max(1,Math.min(10000,Math.floor(asNum(t.stackSize,1))));
  const requested=Math.floor(asNum(msg.quantity,stackLimit));if(requested<1)return safeSend(client,{type:'lootFailed',reason:'Invalid quantity'});
  const qty=Math.min(requested,line.quantity,stackLimit);
  const instance={...structuredClone(t),id:SID(),templateId:t.id,quantity:qty,location:'loose',x:0,y:0,rotated:false};
  profile.character.items.push(instance);line.quantity-=qty;if(line.quantity<1)source.splice(source.indexOf(line),1);
  requestSave();safeSend(client,{type:'selfCharacter',character:profile.character});broadcastPublic();broadcastGM();
 }
 const httpServer=http.createServer((request,response)=>{
  const remote=request.socket.remoteAddress||'',loopback=remote==='127.0.0.1'||remote==='::1'||remote==='::ffff:127.0.0.1';
  if(request.method==='GET'&&request.url==='/health'){response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});return response.end(JSON.stringify({status:'online',version:4}))}
  if(request.method==='POST'&&request.url==='/tts/select'){
   if(!loopback){response.writeHead(403);return response.end('Local host only')}
   let body='';request.on('data',chunk=>{body+=chunk;if(body.length>4096)request.destroy()});request.on('end',()=>{
    let actorId='';try{actorId=JSON.parse(body).actorId||''}catch{actorId=new URLSearchParams(body).get('actorId')||''}
    const active=persisted.campaign.encounters.find(x=>x.id===persisted.campaign.activeEncounter);
    const actor=active?.roster.find(x=>x.id===actorId&&x.visible);
    if(!actor){response.writeHead(404);return response.end('No visible actor with that ID')}
    for(const [socket,rec] of clients)if(rec.role==='gm')safeSend(socket,{type:'ttsTarget',actorId});
    response.writeHead(200,{'content-type':'text/plain'});response.end('Selected '+actor.name);
   });return;
  }
  response.writeHead(404,{'content-type':'text/plain'});response.end('Not found');
 });
 const wss=new WebSocketServer({noServer:true,maxPayload:MAX_FRAME,perMessageDeflate:false});
 httpServer.on('upgrade',(request,socket,head)=>{if(request.url!=='/'){socket.destroy();return}wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request))});
 wss.on('connection',(client,request)=>{
  let authorized=false;let record=null;const ip=request.socket.remoteAddress||'';
  const deadline=setTimeout(()=>{if(!authorized)client.close(1008,'Authentication required')},7500);
  client.on('message',raw=>{
   let msg;try{msg=JSON.parse(raw.toString())}catch{return safeSend(client,{type:'error',message:'Invalid JSON'})}
   if(!msg||typeof msg!=='object')return;
   if(!authorized){
    if(msg.type!=='hello')return client.close(1008,'Authentication required');
    const attempt=fails.get(ip)||{count:0,until:0};if(attempt.count>=6&&attempt.until>Date.now())return client.close(1008,'Too many attempts');
    if(!eqString(msg.password,password)){fails.set(ip,{count:attempt.count+1,until:Date.now()+60_000});return client.close(1008,'Wrong session password')}
    const role=msg.role==='gm'&&eqString(msg.hostSecret,hostSecret)?'gm':'player';const playerId=role==='player'?safe(msg.playerId,60):'gm';
    if(role==='player'&&!/^[a-zA-Z0-9 _-]{1,60}$/.test(playerId))return client.close(1008,'Invalid player ID');
    record={role,playerId,name:safe(msg.name,80)||playerId};authorized=true;clearTimeout(deadline);clients.set(client,record);
    if(role==='player'&&!persisted.profiles[playerId])persisted.profiles[playerId]={name:record.name,character:null};
    safeSend(client,{type:'welcome',sessionName:persisted.campaign.campaign?.name||'S.T.A.L.K.E.R.',role,hasSavedCharacter:Boolean(role==='player'&&validPlayer(persisted.profiles[playerId]?.character))});
    if(role==='gm'){safeSend(client,{type:'gmSnapshot',campaign:persisted.campaign});for(const id of Object.keys(persisted.profiles))notifyGMPlayer(id)}
    else{safeSend(client,publicCampaignSnapshot(persisted.campaign));sendTargetAssignment(playerId);if(persisted.profiles[playerId].character)safeSend(client,{type:'selfCharacter',character:persisted.profiles[playerId].character})}
    return;
   }
   if(record.role==='gm'){
    if(msg.type==='assignTarget'){
      const playerId=safe(msg.playerId,60),actorId=safe(msg.actorId,80);
      const active=persisted.campaign.encounters.find(x=>x.id===persisted.campaign.activeEncounter);
      if(!persisted.profiles[playerId]||!active?.roster.some(a=>a.id===actorId&&a.visible&&!a.dead))return safeSend(client,{type:'error',message:'Target assignment refused: invalid player or NPC'});
      persisted.campaign.targetAssignments=persisted.campaign.targetAssignments||{};
      persisted.campaign.targetAssignments[playerId]=actorId;requestSave();sendTargetAssignment(playerId);broadcastGM();return;
    }
    if(msg.type==='gmCharacterUpdate'&&typeof msg.playerId==='string'&&validPlayer(msg.character)){
      const player=String(msg.playerId).slice(0,60),profile=persisted.profiles[player];
      if(!profile)return safeSend(client,{type:'error',message:'Player not found'});
      const copy=structuredClone(msg.character);
      if(copy.items.length>2500||copy.catalog.length>1500)return safeSend(client,{type:'error',message:'Character too large'});
      profile.character=copy;requestSave();notifyGMPlayer(player);
      for(const [peer,info] of clients)if(info.role==='player'&&info.playerId===player)safeSend(peer,{type:'selfCharacter',character:copy});
    }
    if(msg.type==='gmUpdate'&&validCampaign(msg.data)){
      const updated=structuredClone(msg.data);if(JSON.stringify(updated).length>MAX_FRAME)return safeSend(client,{type:'error',message:'GM campaign too large'});
      delete updated.players; // player records are server-owned, kept separate
      persisted.campaign={...defaultCampaign(),...updated};requestSave();broadcastPublic();
    }
   }else{
    if(msg.type==='characterUpdate'&&validPlayer(msg.character)){
      const copy=structuredClone(msg.character);
      // Avoid unbounded arrays or malformed quantities. Players cannot submit GM campaign state.
      if(copy.items.length>2500||copy.catalog.length>1500||copy.items.some(i=>!i||!Number.isInteger(asNum(i.quantity,1))||asNum(i.quantity,1)<1||asNum(i.quantity,1)>10000))return safeSend(client,{type:'error',message:'Invalid inventory data'});
      persisted.profiles[record.playerId]={name:record.name,character:copy};requestSave();notifyGMPlayer(record.playerId);
    }
    if(msg.type==='attackReport'){
      const active=persisted.campaign.encounters.find(x=>x.id===persisted.campaign.activeEncounter);
      const actor=active?.roster.find(a=>a.id===msg.actorId&&a.visible&&!a.dead);
      const damage=msg.damage,attackId=msg.attackId;
      if(!actor||!Number.isSafeInteger(damage)||damage<0||damage>200||typeof attackId!=='string'||!/^[-a-z0-9]{8,80}$/i.test(attackId)){
        safeSend(client,{type:'error',message:'Invalid NPC attack result'});return;
      }
      if(persisted.campaign.targetAssignments?.[record.playerId]!==actor.id)return safeSend(client,{type:'error',message:'NPC target has not been assigned by the GM'});
      const key=record.playerId+':'+attackId;
      if(processedAttacks.has(key))return;
      processedAttacks.set(key,Date.now());
      if(processedAttacks.size>2000){const oldest=[...processedAttacks.keys()].slice(0,1000);for(const k of oldest)processedAttacks.delete(k)}
      actor.hp=Math.max(-5*Math.max(1,asNum(actor.maxHP,10)),asNum(actor.hp,10)-damage);
      actor.dead=actor.hp<=-5*Math.max(1,asNum(actor.maxHP,10));
      persisted.campaign.history=persisted.campaign.history||[];
      persisted.campaign.history.unshift({id:SID(),when:new Date().toISOString(),kind:'Remote player attack',details:record.playerId+' damaged '+actor.name+' for '+damage+' HP'});
      persisted.campaign.history=persisted.campaign.history.slice(0,350);
      requestSave();broadcastPublic();broadcastGM();
    }
    if(msg.type==='takeLoot')authoritativeLoot(client,record,msg);
   }
  });
  client.on('close',()=>{clearTimeout(deadline);clients.delete(client)});
 });
 await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(port,'0.0.0.0',resolve)});
 return {hostSecret,port,close:async()=>{for(const socket of wss.clients)socket.close();await new Promise(resolve=>wss.close(resolve));await new Promise(resolve=>httpServer.close(resolve));persist()},snapshot:()=>structuredClone(persisted),address:()=>httpServer.address()};
}
module.exports={startServer,publicEncounter,publicCampaignSnapshot,defaultCampaign,validPlayer,validCampaign};
