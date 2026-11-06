from pathlib import Path
p=Path(__file__).with_name('server.cjs');s=p.read_text()
s=s.replace("const clients=new Map();const fails=new Map();let saveTimer=null,lastBackup=0;", "const clients=new Map();const fails=new Map();const processedAttacks=new Map();let saveTimer=null,lastBackup=0;")
s=s.replace("    if(msg.type==='gmUpdate'&&validCampaign(msg.data)){", """    if(msg.type==='gmCharacterUpdate'&&typeof msg.playerId==='string'&&validPlayer(msg.character)){
      const player=String(msg.playerId).slice(0,60),profile=persisted.profiles[player];
      if(!profile)return safeSend(client,{type:'error',message:'Player not found'});
      const copy=structuredClone(msg.character);
      if(copy.items.length>2500||copy.catalog.length>1500)return safeSend(client,{type:'error',message:'Character too large'});
      profile.character=copy;requestSave();notifyGMPlayer(player);
      for(const [peer,info] of clients)if(info.role==='player'&&info.playerId===player)safeSend(peer,{type:'selfCharacter',character:copy});
    }
    if(msg.type==='gmUpdate'&&validCampaign(msg.data)){""",1)
s=s.replace("    if(msg.type==='takeLoot')authoritativeLoot(client,record,msg);", """    if(msg.type==='attackReport'){
      const active=persisted.campaign.encounters.find(x=>x.id===persisted.campaign.activeEncounter);
      const actor=active?.roster.find(a=>a.id===msg.actorId&&a.visible&&!a.dead);
      const damage=msg.damage,attackId=msg.attackId;
      if(!actor||!Number.isSafeInteger(damage)||damage<0||damage>200||typeof attackId!=='string'||!/^[-a-z0-9]{8,80}$/i.test(attackId)){
        safeSend(client,{type:'error',message:'Invalid NPC attack result'});return;
      }
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
    if(msg.type==='takeLoot')authoritativeLoot(client,record,msg);""",1)
p.write_text(s)
