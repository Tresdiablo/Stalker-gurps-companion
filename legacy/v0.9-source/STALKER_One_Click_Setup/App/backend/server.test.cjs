'use strict';
/* Dependency-free logic test: mock WebSocket transport. Does not prove live network behavior. */
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {mkdtempSync,rmSync}=require('node:fs');
const os=require('node:os'),path=require('node:path'),http=require('node:http'),Module=require('node:module');
const originalLoad=Module._load;let transport;
class MockSocket extends EventEmitter {
 constructor(){super();this.readyState=1;this.out=[]}
 send(raw){this.out.push(JSON.parse(raw))}
 sendEvent(msg){this.emit('message',Buffer.from(JSON.stringify(msg)))}
 messages(type){return this.out.filter(m=>m.type===type)}
 close(){this.readyState=3;this.emit('close')}
}
class MockWebSocketServer extends EventEmitter {
 constructor(){super();this.clients=new Set();transport=this}
 close(cb){cb?.()}
}
Module._load=function(request,parent,isMain){if(request==='ws')return {WebSocketServer:MockWebSocketServer,WebSocket:{OPEN:1}};return originalLoad.call(this,request,parent,isMain)};
const {startServer,publicCampaignSnapshot}=require('./server.cjs');Module._load=originalLoad;
const auth=(role,password,hostSecret,playerId='Player One')=>{const client=new MockSocket();transport.clients.add(client);transport.emit('connection',client,{socket:{remoteAddress:'127.0.0.1'}});client.sendEvent({type:'hello',role,password,hostSecret,playerId,name:playerId});return client};
const profile=()=>({items:[],catalog:[],slots:{},conditions:{Health:10},stats:{HP:10},identity:{Name:'Test Player'}});
function campaign(){return {version:4,npcs:[],history:[],catalog:[{id:'item-good',name:'7.62 FMJ',stackSize:50,category:'Ammo',w:1,h:1},{id:'item-secret',name:'Hidden Artifact',stackSize:1,category:'Artifact',w:1,h:1}],activeEncounter:'enc1',campaign:{name:'Test Campaign'},encounters:[{id:'enc1',name:'Checkpoint',location:'Test Zone',roster:[{id:'a1',name:'Bandit',visible:true,hp:10,maxHP:10,dr:1,ht:10,dodge:8,dead:false,loot:[{id:'loot-a',templateId:'item-good',quantity:4}]},{id:'a2',name:'Hidden Sniper',visible:false,hp:10,maxHP:10,dr:1,ht:10,dodge:8,dead:false,loot:[]}],stashes:[{id:'stash-public',name:'Revealed Crate',revealed:true,items:[{id:'loot1',templateId:'item-good',quantity:20}]},{id:'stash-secret',name:'Hidden Case',revealed:false,items:[{id:'loot2',templateId:'item-secret',quantity:1}]}]}]}}

test('GM host, player privacy, authoritative loot, attack reports, idempotency, player saves',async()=>{
 const folder=mkdtempSync(path.join(os.tmpdir(),'stalker-companion-server-'));
 const server=await startServer({port:17783,password:'test-private-pass',dataDir:folder,campaignName:'Integration QA'});
 try{
  const gm=auth('gm','test-private-pass',server.hostSecret);
  assert.equal(gm.messages('welcome').length,1);
  gm.sendEvent({type:'gmUpdate',data:campaign()});
  const player=auth('player','test-private-pass',undefined,'Player One');
  assert.equal(player.messages('welcome')[0].hasSavedCharacter,false);
  assert.equal(player.messages('publicUpdate').at(-1).encounter.roster.length,1);
  assert.equal(player.messages('publicUpdate').at(-1).encounter.roster[0].dr,undefined,'player snapshot must not leak private NPC armor');
  assert.equal(player.messages('publicUpdate').at(-1).encounter.stashes.length,1);
  assert.equal(player.messages('publicUpdate').at(-1).catalog.length,1); // no hidden artifact in client data
  player.sendEvent({type:'characterUpdate',character:profile()});
  assert.equal(gm.messages('playerSnapshot').at(-1).playerId,'Player One');
  player.sendEvent({type:'takeLoot',stashId:'stash-secret',itemId:'loot2',quantity:1});
  assert.equal(player.messages('lootFailed').at(-1).reason,'Loot container is not available');
  player.sendEvent({type:'takeLoot',stashId:'stash-public',itemId:'loot1',quantity:8});
  assert.equal(player.messages('selfCharacter').at(-1).character.items[0].quantity,8);
  assert.equal(player.messages('publicUpdate').at(-1).encounter.stashes[0].items[0].quantity,12);
  player.sendEvent({type:'attackReport',actorId:'a1',damage:3,attackId:'attack-not-assigned'});
  assert.equal(player.messages('error').at(-1).message,'NPC target has not been assigned by the GM');
  gm.sendEvent({type:'assignTarget',playerId:'Player One',actorId:'a1'});
  assert.equal(player.messages('targetAssignment').at(-1).actorId,'a1');
  assert.equal(player.messages('targetAssignment').at(-1).stats.dr,1);
  player.sendEvent({type:'attackReport',actorId:'a1',damage:3,attackId:'attack-00001'});
  assert.equal(player.messages('publicUpdate').at(-1).encounter.roster[0].hp,7);
  player.sendEvent({type:'attackReport',actorId:'a1',damage:3,attackId:'attack-00001'});
  assert.equal(player.messages('publicUpdate').at(-1).encounter.roster[0].hp,7,'duplicate attack must not apply twice');
  player.sendEvent({type:'attackReport',actorId:'a2',damage:3,attackId:'attack-00002'});
  assert.equal(player.messages('error').at(-1).message,'Invalid NPC attack result');
  const newChar=profile();newChar.conditions.Health=5;
  gm.sendEvent({type:'gmCharacterUpdate',playerId:'Player One',character:newChar});
  assert.equal(player.messages('selfCharacter').at(-1).character.conditions.Health,5);
  const reconnect=auth('player','test-private-pass',undefined,'Player One');
  assert.equal(reconnect.messages('welcome')[0].hasSavedCharacter,true);
  assert.equal(reconnect.messages('selfCharacter').at(-1).character.conditions.Health,5);
  const snap=server.snapshot();
  assert.equal(snap.campaign.encounters[0].stashes[0].items[0].quantity,12);
  assert.equal(snap.campaign.encounters[0].roster[0].hp,7);
  assert.equal(snap.profiles['Player One'].character.conditions.Health,5);
  assert.equal(publicCampaignSnapshot(snap.campaign).encounter.roster.length,1);
  const bridge=await new Promise((resolve,reject)=>{const post=http.request({hostname:'127.0.0.1',port:17783,path:'/tts/select',method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'}},resp=>{let body='';resp.on('data',chunk=>body+=chunk);resp.on('end',()=>resolve({code:resp.statusCode,body}))});post.on('error',reject);post.end('actorId=a1')});
  assert.equal(bridge.code,200);
  assert.equal(gm.messages('ttsTarget').at(-1).actorId,'a1');
  const hidden=await new Promise((resolve,reject)=>{const post=http.request({hostname:'127.0.0.1',port:17783,path:'/tts/select',method:'POST'},resp=>{resp.resume();resp.on('end',()=>resolve(resp.statusCode))});post.on('error',reject);post.end('actorId=a2')});
  assert.equal(hidden,404);
 }finally{await server.close();rmSync(folder,{recursive:true,force:true})}
});
