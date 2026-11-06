/* Build 4.5 Integration Pack, beta 0.6.
 * Extends the original state/catalog/character/GM controller. Does not replace the UI.
 * Campaign data remains in the original Build 4.5 storage keys.
 */
(()=>{
'use strict';
const $=x=>document.getElementById(x);
const esc=x=>String(x??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const id=()=>crypto?.randomUUID?.()||'ext-'+Date.now()+'-'+Math.random().toString(36).slice(2);
const cp=x=>JSON.parse(JSON.stringify(x));
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const bridge=()=>window.STALKER_INTEGRATION_BRIDGE;
const G=()=>bridge()?.getGM();
const isGM=()=>document.body.dataset.mode==='gm';
const item=id=>state.items.find(x=>x.id===id);
const def=id=>state.catalog.find(x=>x.id===id);
const categories=['Weapon','Magazine','Ammo','Optic','Suppressor','Upgrade Kit','Armor','Helmet','Vest','Mask','Clothing','Tactical Equipment','Backpack','Medical','Crafting Material','Artifact','Misc'];
const interfaces=['Picatinny','Weaver','AK dovetail','Direct-thread','QD muzzle','Proprietary','Custom'];
const safeArray=x=>Array.isArray(x)?x:[];
const tokens=x=>String(x||'').split(',').map(s=>s.trim()).filter(Boolean);
const text=(sel)=>$(sel)?.value??'';
const opts=(arr,chosen)=>arr.map(x=>{const [value,title]=Array.isArray(x)?x:[x,x];return `<option value="${esc(value)}" ${String(value)===String(chosen)?'selected':''}>${esc(title)}</option>`}).join('');
const select=(list,chosen,empty='Select item')=>`<option value="">${esc(empty)}</option>`+opts(list,chosen);
const tiny=(label,value)=>`<span class="ext-tag">${esc(label)}: ${esc(value)}</span>`;
const label=(title,id,value='',extra='')=>`<label>${esc(title)}<input id="${id}" value="${esc(value)}" ${extra}></label>`;
const numeric=(title,id,value=0,min=0,max=100000)=>`<label>${esc(title)}<input type="number" min="${min}" max="${max}" step="any" id="${id}" value="${esc(value)}"></label>`;
const note=(msg,ok=true)=>{try{notice(msg)}catch{};const el=$('extFeedback');if(el){el.textContent=msg;el.dataset.ok=String(ok)}};
function initState(){
 if(!state.ext||typeof state.ext!=='object')state.ext={};
 if(!Array.isArray(state.combatReview))state.combatReview=[];
 if(!Number.isFinite(Number(state.money)))state.money=0;
 if(!state.ext.combatStates)state.ext.combatStates={};
 if(!state.ext.favorites)state.ext.favorites=[];
 if(!state.ext.localLoot)state.ext.localLoot=[];
 if(!G())return;
 const gm=G();if(!gm.integrated||typeof gm.integrated!=='object')gm.integrated={};
 const v=gm.integrated;
 if(!v.variants)v.variants={};if(!Array.isArray(v.traders))v.traders=[];
 if(!Array.isArray(v.transactions))v.transactions=[];
 if(!Array.isArray(v.snapshots))v.snapshots=[];
 if(!Array.isArray(v.sharedLoot))v.sharedLoot=[];
 if(!v.rules)v.rules={dtEnabled:true,criticalTables:'GM',playerHP:'manual'};if(!('dtEnabled' in v.rules))v.rules.dtEnabled=true;
}
function migrateLegacyPlates(){
 if(state.ext?.noPlateMigrationV07)return;
 let migrated=0;
 for(const i of state.items){
  if(i.category==='Armor Plate'||i.location==='installedPlate'||i.plateCarrierId){
   i.category='Misc';i.location='loose';delete i.plateCarrierId;delete i.platePosition;delete i.x;delete i.y;delete i.slot;
   i.description=[i.description,'Retired armor plate from an earlier beta; no protection effect.'].filter(Boolean).join(' ');
   migrated++;
  }
  delete i.plateSlots;delete i.plateCarrier;delete i.plateSizes;
 }
 for(const t of state.catalog){if(t.category==='Armor Plate')t.category='Misc';delete t.plateSlots;delete t.plateCarrier;delete t.plateSizes;}
 state.ext.noPlateMigrationV07=true;
 if(migrated)save();
}
function savePlayer(msg){initState();save();if(msg)note(msg)}
function saveGM(msg){initState();bridge()?.saveGM('Integrated Beta',msg||'Campaign data updated');if(msg)note(msg)}
function commit(msg,gm=false){gm?saveGM(msg):savePlayer(msg);refresh()}
function guard(fn){try{return fn()}catch(e){console.error('Integration error:',e);note(e.message||String(e),false)}}
function assertGM(){if(!isGM())throw Error('GM tools are not available in Player mode.');}
function stateSnapshot(){return {player:cp(state),gm:cp(G()||{}),at:new Date().toISOString()};}
function resetFromSnapshot(s){if(!s?.player?.items||!s?.player?.catalog||!s?.gm?.npcs)throw Error('Invalid campaign snapshot.');state=cp(s.player);const gm=G();Object.keys(gm).forEach(k=>delete gm[k]);Object.assign(gm,cp(s.gm));savePlayer();saveGM('Campaign restored')}
function takeSnapshot(reason='Manual checkpoint'){
 assertGM();initState();const list=G().integrated.snapshots;const one=stateSnapshot();delete one.gm.integrated.snapshots;
 list.unshift({id:id(),reason,at:one.at,payload:JSON.stringify(one)});list.splice(10);saveGM(`Snapshot: ${reason}`);return list[0];
}
function restoreSnapshot(which){assertGM();const target=G().integrated.snapshots.find(x=>x.id===which);if(!target)throw Error('Snapshot not found');
 const snap=JSON.parse(target.payload);takeSnapshot('Automatic safety checkpoint before restore');const checkpoints=cp(G().integrated.snapshots);
 resetFromSnapshot(snap);initState();G().integrated.snapshots=checkpoints;saveGM('Restored snapshot '+target.reason);render();refresh();}
function spawn(templateId,quantity=1,owner='loose'){
 assertGM();const t=def(templateId),qty=Math.floor(n(quantity));if(!t)throw Error('Unknown catalog entry');
 if(!Number.isInteger(qty)||qty<1||qty>5000)throw Error('Quantity must be 1–5000');
 const max=Math.max(1,Math.floor(n(t.stackSize,1)));const made=[];
 for(let left=qty;left>0;left-=max){const inst={...cp(t),id:id(),templateId:t.id,quantity:Math.min(left,max),location:owner,rotated:false};
  state.items.push(inst);if(inst.category==='Weapon'&&inst.integralFeed)try{createInternalFeedForWeapon(inst)}catch{};
  made.push(inst)}return made;
}
function wholeCategory(t){return ['Armor','Vest','Helmet','Mask','Backpack','Clothing','Tactical Equipment'].includes(t.category)}
function serial(i){return (i?.name||i?.id||'').slice(0,60)}
function installableCompatible(w,a,slot){
 if(!w||w.category!=='Weapon'||!a||!['Optic','Suppressor'].includes(a.category))return {ok:false,why:'Choose a weapon and an optic or suppressor'};
 if(slot==='optic'&&a.category!=='Optic'||slot==='suppressor'&&a.category!=='Suppressor')return {ok:false,why:'Wrong attachment type'};
 const ids=safeArray(a.proprietaryWeapons);if(ids.length&&!ids.includes(w.templateId)&&!ids.includes(w.id))return {ok:false,why:'Proprietary weapon restriction'};
 const models=safeArray(a.compatibleWeapons);if(models.length&&!models.includes(w.templateId)&&!models.includes(w.id))return {ok:false,why:'Weapon model restriction'};
 const mount=a.mountType||'Picatinny';const wMounts=safeArray(w.mounts).length?w.mounts:(slot==='optic'?['Picatinny']:['Direct-thread']);
 const kit=item(w.kitId);const kitMounts=safeArray(kit?.kitMounts);const available=[...wMounts,...kitMounts];
 if(mount==='Proprietary')return {ok:ids.length>0&&ids.includes(w.templateId),why:ids.includes(w.templateId)?'':'Proprietary mounting requires an explicit weapon model'};
 if(!available.includes(mount))return {ok:false,why:`Requires ${mount} mount or compatible upgrade kit`};
 if(a.adapterKitIds?.length&&!a.adapterKitIds.includes(kit?.templateId))return {ok:false,why:'Required adapter kit not installed'};
 return {ok:true,why:''};
}
function installAttachment(weaponId,attachmentId,slot){
 const w=item(weaponId),a=item(attachmentId);if(!w||!a)throw Error('Item no longer exists');
 const result=installableCompatible(w,a,slot);if(!result.ok)throw Error(result.why);
 if(a.location==='installed'||a.location==='loaded')throw Error('Attachment already in use');
 if(w[slot+'Id'])throw Error('Remove existing '+slot+' first');
 if(a.location==='slot'&&state.slots[a.slot]===a.id)delete state.slots[a.slot];
 w[slot+'Id']=a.id;a.location='installed';a.weaponId=w.id;delete a.x;delete a.y;delete a.slot;
 commit(`${a.name} installed on ${w.name}`);
}
function removeAttachment(weaponId,slot){const w=item(weaponId),a=item(w?.[slot+'Id']);if(!w||!a)throw Error('No installed '+slot);
 delete w[slot+'Id'];a.location='loose';delete a.weaponId;commit(`${a.name} removed from ${w.name}`)}
function installKit(weaponId,kitId){
 const w=item(weaponId),k=item(kitId);if(!w||!k||w.category!=='Weapon'||k.category!=='Upgrade Kit')throw Error('Select weapon and upgrade kit');
 if(w.kitId)throw Error('Remove existing kit first');
 if(k.location==='installed')throw Error('Kit is already installed');
 if(safeArray(k.compatibleWeapons).length&&!k.compatibleWeapons.includes(w.templateId))throw Error('Upgrade kit is incompatible with this model');
 if(safeArray(k.conflicts).some(x=>x===w.templateId))throw Error('Upgrade kit conflicts with weapon');
 const copy={...w,kitId:k.id};for(const slot of ['optic','suppressor']){
  const installed=item(w[slot+'Id']);if(installed&&!installableCompatible(copy,installed,slot).ok)throw Error(`Existing ${slot} would become incompatible`);
 }
 w.kitId=k.id;k.location='installed';k.weaponId=w.id;delete k.x;delete k.y;commit(`Installed kit ${k.name} on ${w.name}`)
}
function removeKit(weaponId){const w=item(weaponId),k=item(w?.kitId);if(!w||!k)throw Error('No installed kit');if(k.kitRemovable===false)throw Error('GM configured this kit as non-removable');
 const copy={...w,kitId:null};for(const slot of ['optic','suppressor']){const a=item(w[slot+'Id']);if(a&&!installableCompatible(copy,a,slot).ok)throw Error('Remove incompatible '+slot+' first')}
 delete w.kitId;k.location='loose';delete k.weaponId;commit(`Removed kit ${k.name}`)}
function modifierEntries(t){return safeArray(t?.modifiers).filter(m=>m&&m.stat&&Number.isFinite(Number(m.value)))}
function activeGear(){return state.items.filter(i=>i.location==='slot'&&i.slot&&state.slots[i.slot]===i.id)}
function modifierSources(w){
 const a=activeGear().filter(x=>x.category!=='Weapon');
 if(w){a.push(w);for(const key of ['opticId','suppressorId','kitId']){const att=item(w[key]);if(att)a.push(att)}}return [...new Map(a.map(x=>[x.id,x])).values()];
}
function calculateStat(base,stat,sources){const parts=[];let value=n(base);const ads=[],muls=[],replacements=[];
 for(const src of sources)for(const mod of modifierEntries(src))if(mod.stat.toLowerCase()===stat.toLowerCase()){
  
  const one={source:src.name||'Equipment',op:mod.op||'add',value:n(mod.value)};
  parts.push(one);if(one.op==='multiply')muls.push(one.value);else if(one.op==='replace')replacements.push(one.value);else ads.push(one.value);
 }
 if(replacements.length)value=replacements.at(-1);value+=ads.reduce((x,y)=>x+y,0);for(const m of muls)value*=m;
 return {base:n(base),value:Number(value.toFixed(3)),parts};
}
function weaponStat(w,stat){const base=n(w?.gurps?.[stat]??w?.[stat]);return calculateStat(base,stat,modifierSources(w)).value}
function weaponDamage(w){const raw=String(w?.gurps?.damage||'');const bonus=calculateStat(0,'damage',modifierSources(w)).value;if(!bonus||!/^\s*\d+d(?:[+-]\d+)?\s*/i.test(raw))return raw;
 return raw.replace(/^(\s*\d+d)([+-]\d+)?/i,(_,d,b)=>d+((n(b)+bonus)>=0?'+':'')+(n(b)+bonus))}
function decorateCharacterStats(){
 const statArea=$('stats');if(!statArea)return;
 for(const row of statArea.querySelectorAll('label.stat')){
  const baseName=[...row.childNodes].find(x=>x.nodeType===Node.TEXT_NODE)?.textContent?.trim();
  if(!baseName||!(baseName in state.stats))continue;
  row.querySelector('.ext-effective-badge')?.remove();row.classList.remove('ext-beneficial-value','ext-harmful-value');
  const result=calculateStat(state.stats[baseName],baseName,modifierSources());if(!result.parts.length)continue;
  const more=document.createElement('small');more.className='ext-effective-badge';more.textContent='Effective '+result.value;
  more.title='Base '+result.base+'; '+result.parts.map(x=>x.source+': '+x.op+' '+x.value).join('; ');
  const good=['Bulk','Rcl','Recoil','Weight','Encumbrance'].includes(baseName)?result.value<result.base:result.value>result.base;
  row.classList.add(good?'ext-beneficial-value':'ext-harmful-value');row.append(more);
 }
}
function variantImage(w){if(!w||w.category!=='Weapon')return '';
 const v=G()?.integrated?.variants?.[w.templateId];if(!v?.length)return '';
 const kit=item(w.kitId),mag=weaponMagazine(w),op=item(w.opticId),sup=item(w.suppressorId);
 const props={kit:kit?.templateId||'',mag:mag?.magAppearance||'none',optic:op?.templateId||'',suppressor:sup?.templateId||''};
 const ranked=v.map(x=>{
  const tags=x.tags||{};let score=0,specificity=0,conflict=false;
  for(const key of Object.keys(props)){if(tags[key]){specificity++;if(tags[key]===props[key])score+=100;else conflict=true}}
  return {x,score:score+specificity,conflict}}).filter(x=>!x.conflict).sort((a,b)=>b.score-a.score);
 const match=ranked[0]?.x||v.find(x=>!Object.values(x.tags||{}).some(Boolean));
 return match?.src||'';
}
// Legacy, single-piece armor protection. No armor plates or directional DP.
// DR remains the vanilla GURPS armor value. Optional campaign DT is a separate threshold.
function armorFor(character,location='Torso'){
 const ids=character?.slots||{},items=character?.items||[];
 const covering=location==='Skull'?['helmet']:location==='Face'?['mask']:['Torso','Vitals'].includes(location)?['armor','vest']:[];
 let dr=0,dt=0;const sources=[];
 for(const slot of covering){const gear=items.find(i=>i.id===ids[slot]);if(!gear)continue;
  dr+=Math.max(0,n(gear.gurps?.dr));dt+=Math.max(0,n(gear.dt));sources.push(gear.name);
 }
 return {dr,dt,sources,carrier:null,plate:null};
}
function pouchAllows(i,x,y,slot){const c=compartmentsFor(slot).find(z=>x>=z.x&&y>=z.y&&x+dimensions(i).w<=z.x+z.w&&y+dimensions(i).h<=z.y+z.h);
 if(!c)return false;if(safeArray(c.allowed).length&&!c.allowed.includes(i.category))return false;
 if(safeArray(c.prohibited).includes(i.category))return false;
 if(Number.isFinite(Number(c.maxWeight))&&n(c.maxWeight)>0&&n(i.weight)*itemQuantity(i)>n(c.maxWeight))return false;
 return true;
}
function setPouches(templateId,layout){assertGM();const t=def(templateId);if(!t||!hasStorage(t))throw Error('Choose a storage vest, armor or backpack');
 const W=Math.floor(n(t.storageW,4)),H=Math.floor(n(t.storageH,2)),seen=new Set();
 if(!layout.length)throw Error('Create at least one compartment');
 for(const box of layout){for(const k of ['x','y','w','h'])if(!Number.isInteger(box[k]))throw Error('Pouch measurements must be integers');
  if(box.x<0||box.y<0||box.w<1||box.h<1||box.x+box.w>W||box.y+box.h>H)throw Error('Pouch is outside grid');
  for(let y=box.y;y<box.y+box.h;y++)for(let x=box.x;x<box.x+box.w;x++){const key=x+','+y;if(seen.has(key))throw Error('Pouches cannot overlap');seen.add(key)}}
 // Existing occupied containers must still fit; rollback on failure.
 const old=cp(t.compartments||[]),copies=state.items.filter(x=>x.templateId===t.id);
 t.compartments=cp(layout);for(const c of copies)c.compartments=cp(layout);
 for(const equipped of copies.filter(x=>x.location==='slot')){const slot=equipped.slot==='armor'?'vest':equipped.slot;
  if(!['vest','backpack'].includes(slot))continue;
  for(const stored of state.items.filter(x=>x.location===storageLocation(slot))){if(!pouchAllows(stored,n(stored.x),n(stored.y),slot)){t.compartments=old;for(const c of copies)c.compartments=cp(old);throw Error('Existing item would no longer fit the new pouch layout')}}
 }
 commit('Updated '+t.name+' layout with '+layout.length+' pouches');
}
function getMoney(){return Math.max(0,n(state.money))}
function shopById(shopId){return safeArray(G()?.integrated?.traders).find(x=>x.id===shopId)}
// Build 4.5 ships tier-one items at value=0. Nonzero GM prices always win.
// These are explicitly provisional campaign prices, not imported real-world prices.
function estimatedPrice(t){const override=Number(t?.value);if(Number.isFinite(override)&&override>0)return Math.round(override);
 const baselines={Weapon:6500,Magazine:500,Ammo:45,Optic:2500,Suppressor:4000,'Upgrade Kit':4000,Armor:5000,Helmet:2200,Vest:1900,Mask:550,Clothing:700,'Tactical Equipment':1400,Backpack:1600,Medical:500,'Crafting Material':180,Artifact:15000,Misc:300};
 return Math.max(1,Math.round((baselines[t?.category]||300)*Math.max(0.5,n(t?.tier,1))));
}
function shopEligible(t,origin,type){const c=t.category;
 const kind={Medic:['Medical'],Technician:['Crafting Material','Misc','Tactical Equipment'],General:categories,Weapons:['Weapon','Magazine','Ammo','Optic','Suppressor','Upgrade Kit'],Armor:['Armor','Helmet','Vest'],Clothing:['Clothing','Mask'],Equipment:['Backpack','Tactical Equipment','Misc']}[type]||categories;
 if(!kind.includes(c))return false;
 const tag=t.origin||'Universal';return origin==='Any'||tag===origin||tag==='Universal';
}
function generateShop({category='General',origin='Any',budget=50000,size=20,rarity=5}={}){assertGM();initState();
 const eligible=state.catalog.filter(t=>shopEligible(t,origin,category)&&n(t.tier,1)<=rarity);
 const candidates=eligible.sort(()=>Math.random()-.5),stock=[];let remaining=Math.max(0,Math.floor(n(budget)));const cap=Math.max(0,Math.floor(n(size,20)));
 for(const t of candidates.slice(0,cap)){const price=estimatedPrice(t),qty=Math.min(Math.max(1,Math.floor(Math.random()*5)+1),Math.floor(remaining/price));if(!qty)continue;
  stock.push({templateId:t.id,qty,initialQty:qty,price,manual:false});remaining-=price*qty;}
 const sh={id:id(),name:`${origin} ${category} Trader`,category,origin,stock,priceBuy:1,priceSell:0.5,openTo:[],created:new Date().toISOString()};G().integrated.traders.push(sh);saveGM('Generated '+sh.name);return sh;
}
function transaction(shopId,templateId,quantity,kind){
 const shop=shopById(shopId);if(!shop)throw Error('Trader unavailable');
 const line=shop.stock.find(x=>x.templateId===templateId),t=def(templateId),qty=Math.floor(n(quantity));
 if(!t||!Number.isSafeInteger(qty)||qty<1||qty>5000)throw Error('Invalid item or quantity');
 if(!isGM()&&!shop.openTo?.includes(activeProfile))throw Error('This trader is not open for the active character');
 const cost=kind==='buy'?Math.ceil(n(line?.price,0)*n(shop.priceBuy,1)*qty):Math.floor(n(line?.price||estimatedPrice(t))*n(shop.priceSell,.5)*qty);
 if(cost<0||!Number.isSafeInteger(cost))throw Error('Invalid transaction amount');
 if(kind==='buy'){
  if(!line||line.qty<qty)throw Error('Insufficient trader stock');if(getMoney()<cost)throw Error('Insufficient funds');
  const count=Math.ceil(qty/Math.max(1,Math.floor(n(t.stackSize,1))));if(count>1000)throw Error('Too many separate inventory items');
  spawnAsPlayer(t.id,qty);state.money-=cost;line.qty-=qty;
 }else{
  let remaining=qty;const inventory=state.items.filter(x=>x.templateId===t.id&&!['installed','loaded','slot'].includes(x.location)&&!x.containerId&&!x.weaponId&&!x.opticId&&!x.suppressorId&&!x.kitId&&!state.items.some(child=>child.containerId===x.id||child.weaponId===x.id));
  const available=inventory.reduce((a,x)=>a+itemQuantity(x),0);if(available<qty)throw Error('Not enough available items');
  for(const x of inventory){if(!remaining)break;const used=Math.min(itemQuantity(x),remaining);remaining-=used;x.quantity=itemQuantity(x)-used;if(!x.quantity)state.items.splice(state.items.indexOf(x),1)}
  if(!line)shop.stock.push({templateId:t.id,price:estimatedPrice(t),qty,initialQty:qty,manual:true});else line.qty+=qty;
  state.money=getMoney()+cost;
 }
 initState();G().integrated.transactions.unshift({id:id(),at:new Date().toISOString(),shop:shop.name,kind,templateId,qty,cost,character:state.identity?.Name||'Player'});
 G().integrated.transactions.splice(250);savePlayer();saveGM(`${kind} ${qty} ${t.name}`);refresh();return cost;
}
function spawnAsPlayer(tid,qty){const t=def(tid);if(!t)throw Error('Missing definition');const lim=Math.max(1,Math.floor(n(t.stackSize,1)));
 for(let remain=qty;remain>0;remain-=lim){const i={...cp(t),id:id(),templateId:tid,quantity:Math.min(lim,remain),location:'loose',rotated:false};state.items.push(i)}}
function applyPending(pendingId,action,amount){assertGM();const record=G()?.pendingCombat?.find(x=>x.id===pendingId)||state.combatReview.find(x=>x.id===pendingId);if(!record)throw Error('Combat result missing');
 if(record.status!=='Calculated')throw Error('Combat result already resolved');const value=Math.max(0,Math.floor(n(amount,record.injury||0)));if(value>100000)throw Error('Damage too high');
 if(action==='ignore')record.status='Ignored';else if(action==='resolve')record.status='Resolved';else if(action==='apply'){
  if(record.kind==='npc'){
   const target=bridge()?.playerRecord?.(record.targetId);if(!target)throw Error('Player record not available');
   const c=target.data;c.conditions=c.conditions||{};c.conditions.Health=n(c.conditions.Health,n(c.stats?.HP,10))-value;
   c.wounds=c.wounds||[];c.wounds.unshift({id:id(),location:record.location||'Torso',hpLoss:value,note:'GM applied pending attack',at:new Date().toISOString()});
   bridge()?.savePlayer?.(record.targetId,target);
  }else{
   const actor=record.targetId?bridge()?.findActor?.(record.targetId):null;
   if(actor){actor.hp=n(actor.hp,actor.maxHP||10)-value;actor.wounds=actor.wounds||[];actor.wounds.unshift({id:id(),location:record.location||'Torso',hpLoss:value,note:'GM applied calculated injury',at:new Date().toISOString()});actor.dead=actor.hp<=-5*Math.max(1,n(actor.maxHP,10));bridge()?.saveGM?.('Manual NPC HP change',`${actor.name}: -${value} HP`);}
   const hp=$('targetHP');if(hp){const old=actor?n(actor.hp):n(hp.value,10)-value;hp.value=String(old);state.targetHP=old}
  }record.status='Applied';record.applied=value;
 }else throw Error('Unknown resolution');
 record.resolvedAt=new Date().toISOString();savePlayer();saveGM('Resolved combat result '+pendingId);refresh();}

// Drop a physical optic, suppressor, upgrade kit, or magazine directly onto a weapon icon.
// Right-clicking the weapon is the only removal workflow for removable attachments.
function attachmentTarget(source,weapon){
 if(!source||!weapon||weapon.category!=='Weapon'||source.id===weapon.id)return null;
 if(source.category==='Magazine')return {slot:'magazine',ok:!weapon.integralFeed&&!weaponMagazine(weapon)&&magazineFitsWeapon(source,weapon)&&magAmmoFitsWeapon(source,weapon)&&source.location!=='loaded'};
 if(source.category==='Upgrade Kit')return {slot:'kit',ok:!weapon.kitId&&!['installed','loaded'].includes(source.location)&&(!safeArray(source.compatibleWeapons).length||source.compatibleWeapons.includes(weapon.templateId))};
 if(source.category==='Optic'||source.category==='Suppressor'){
  const slot=source.category==='Optic'?'optic':'suppressor';
  return {slot,ok:!weapon[slot+'Id']&&source.location!=='installed'&&installableCompatible(weapon,source,slot).ok};
 }
 return null;
}
const oldUpdateCarry=updateCarry;
updateCarry=function(x,y){
 oldUpdateCarry(x,y);
 if(!carry?.active)return;
 const hit=document.elementFromPoint(x,y)?.closest('[data-item-id]');
 const w=item(hit?.dataset.itemId),src=item(carry.id),target=attachmentTarget(src,w);
 if(!target)return;
 carry.target={type:'installAttachment',weaponId:w.id,slot:target.slot};carry.valid=target.ok;
 carry.ghost?.classList.toggle('invalid',!target.ok);
 hit.classList.toggle('drop-valid',target.ok);hit.classList.toggle('drop-invalid',!target.ok);
};
const oldFinishCarry=finishCarry;
finishCarry=function(){
 if(carry?.active&&carry.target?.type==='installAttachment'){
  const c=carry;carry=null;draggingId=null;c.ghost?.remove();
  document.querySelectorAll('.drop-valid,.drop-invalid').forEach(e=>e.classList.remove('drop-valid','drop-invalid'));
  if(!c.valid){note('The attachment is incompatible or its slot is occupied.',false);render();return;}
  guard(()=>{
   const a=item(c.id),w=item(c.target.weaponId);
   if(!a||!w)throw Error('Weapon or attachment no longer exists');
   if(c.target.slot==='magazine'){
    if(!attachmentTarget(a,w)?.ok)throw Error('Magazine does not fit or weapon already has one');
    if(a.location==='slot'&&state.slots[a.slot]===a.id)delete state.slots[a.slot];
    a.location='loaded';delete a.slot;delete a.x;delete a.y;a.weaponId=w.id;w.magazineId=a.id;savePlayer('Inserted '+a.name+' into '+w.name);render();
   }else if(c.target.slot==='kit')installKit(w.id,a.id);
   else installAttachment(w.id,a.id,c.target.slot);
  });
  return;
 }
 return oldFinishCarry();
};
const multiSelected=new Set();
function isSelected(x){return multiSelected.has(x)}
function toggleSelection(x){if(!item(x))return;if(multiSelected.has(x))multiSelected.delete(x);else multiSelected.add(x);note(multiSelected.size+' item(s) selected. Drag one to move the group, or use the group transfer button.');render()}
function selectedCount(){return multiSelected.size}
function finishGroupDrag(c){
 if(multiSelected.size<=1||!multiSelected.has(c.id))return false;
 const selectedItems=[...multiSelected].map(item).filter(Boolean);if(!selectedItems.length)return false;
 if(c.target?.type!=='grid'&&c.target?.type!=='loot'){note('Group transfers support storage grids and Loose Loot, not equipment slots.',false);render();return true}
 if(selectedItems.some(i=>['installed','loaded'].includes(i.location))){note('Remove installed items before a group transfer.',false);render();return true}
 const old=selectedItems.map(i=>({id:i.id,location:i.location,x:i.x,y:i.y,slot:i.slot}));
 try{
  if(c.target.type==='loot'){
   for(const i of selectedItems)if(!canReturnToLoot(i))throw Error('Empty equipped containers before moving them.');
   for(const i of selectedItems)unequipToLoose(i);
  }else{
   const leader=item(c.id),slot=c.target.slot,prevX=n(leader.x),prevY=n(leader.y);const allSame=selectedItems.every(i=>i.location===leader.location);
   const positions=selectedItems.map((i,k)=>({i,x:c.target.x+(allSame?n(i.x)-prevX:k),y:c.target.y+(allSame?n(i.y)-prevY:0)}));
   for(const p of positions)if(p.i.location==='slot'&&p.i.slot&&(p.i.slot==='vest'||p.i.slot==='backpack')&&state.items.some(x=>x.location===storageLocation(p.i.slot)))throw Error('Empty equipped container first');
   for(const p of positions){if(p.i.location==='slot'&&state.slots[p.i.slot]===p.i.id)delete state.slots[p.i.slot];p.i.location='groupMoving';delete p.i.slot}
   for(const p of positions){
    if(!canPlace(p.i,p.x,p.y,slot))throw Error('Destination cannot fit the selected group');
    // CanPlace sees prior placements in this group; guard collision with all intended footprints also.
    for(const other of positions)if(other!==p){const d=dimensions(p.i),o=dimensions(other.i);if(p.x<other.x+o.w&&p.x+d.w>other.x&&p.y<other.y+o.h&&p.y+d.h>other.y)throw Error('Selected items would overlap')}
   }
   for(const p of positions){p.i.location=storageLocation(slot);p.i.x=p.x;p.i.y=p.y}
  }
  multiSelected.clear();save();render();note('Moved '+selectedItems.length+' items as one group.');return true;
 }catch(err){for(const o of old){const i=item(o.id);if(i){i.location=o.location;i.x=o.x;i.y=o.y;i.slot=o.slot;if(o.location==='slot')state.slots[o.slot]=i.id}}note('Group transfer cancelled: '+err.message,false);render();return true}
}
function transferGroupToLoot(){const all=[...multiSelected].map(item).filter(Boolean);if(!all.length)return note('Shift-click some inventory items first.');if(all.some(i=>!canReturnToLoot(i)||['loaded','installed'].includes(i.location)))return note('Remove installed items or empty equipped containers first.',false);
 for(const i of all)unequipToLoose(i);multiSelected.clear();save();render();note('Moved '+all.length+' selected items into Loose Loot.');}
function injectContext(menu,i,add){if(!add||!menu)return;
 if(i.category==='Weapon'){
  for(const [slot,name] of [['optic','optic'],['suppressor','suppressor'],['kit','upgrade kit']]){
   if(i[slot+'Id'])add(menu,'Uninstall '+name,()=>guard(()=>slot==='kit'?removeKit(i.id):removeAttachment(i.id,slot)));
  }
 }
 if(['Optic','Suppressor','Upgrade Kit'].includes(i.category)&&i.weaponId&&i.location==='installed'){
  const slot=i.category==='Optic'?'optic':i.category==='Suppressor'?'suppressor':'kit';
  add(menu,'Uninstall from weapon',()=>guard(()=>slot==='kit'?removeKit(i.weaponId):removeAttachment(i.weaponId,slot)));
 }
 if(isGM()&&hasStorage(i))add(menu,'Edit container compartments',()=>window.STALKER_NAV_TEST?.route('pouches','gm'));
}
window.STALKER_EXT={injectContext,isSelected,toggleSelection,selectedCount,finishGroupDrag,transferGroupToLoot,spawn,installAttachment,removeAttachment,installKit,removeKit,armorFor,dtEnabled:()=>G()?.integrated?.rules?.dtEnabled!==false,modifierSources,calculateStat,weaponStat,weaponDamage,variantImage,pouchAllows,setPouches,generateShop,transaction,applyPending,takeSnapshot,restoreSnapshot,refresh:()=>refresh(),getGM:G};
// View state is not persisted and never changes catalog ownership.
let selectedContainer='',selectedDef='',selectedWeapon='',selectedCarrier='',selectedVariantWeapon='',selectedPouchTemplate='',pouchDraft=[],activeTrader='',filter='',variantDraft=[];
function matchDef(t,term){return !term||[t.name,t.category,t.description,t.gurps?.caliber,t.origin].join(' ').toLowerCase().includes(term.toLowerCase())}
function defOptions(kind,chosen){return select(state.catalog.filter(t=>!kind||kind.includes(t.category)).map(t=>[t.id,t.name+' — '+t.category]),chosen)}
function invOptions(kind,chosen,empty='Select...'){return select(state.items.filter(t=>!kind||kind.includes(t.category)).map(t=>[t.id,t.name+' · '+t.location]),chosen,empty)}
function renderWorkbench(){const root=$('extWorkbench');if(!root||root.closest('.page').hidden)return;
 initState();const t=def(selectedDef)||null;const relevant=state.catalog.filter(x=>matchDef(x,filter));
 root.innerHTML=`<div class="ext-columns"><section class="panel"><div class="ext-line"><input id="extSearch" type="search" placeholder="Find any equipment or ammunition" value="${esc(filter)}"><button data-ext="createDefinition">+ Definition</button></div>
 <div class="ext-list">${relevant.slice(0,350).map(x=>`<button class="ext-row ${t?.id===x.id?'ext-active':''}" data-ext="selectDef" data-id="${esc(x.id)}"><strong>${esc(x.name)}</strong><small>${esc(x.category)} · ${esc(x.gurps?.caliber||x.origin||'')} · ${esc(x.w)}×${esc(x.h)}</small></button>`).join('')||'<p>No matching definitions.</p>'}</div></section>
 <section class="panel"><h2>${t?'EDIT MASTER DEFINITION':'CREATE DEFINITION'}</h2><p class="hint">The original Build 4.5 item editor remains available. These fields add compatibility, upgrades, simple DR/DT, and modifiers without duplicating item definitions.</p>
 <div class="ext-grid">${label('Name','extName',t?.name,'required maxlength="100"')}
 <label>Category<select id="extCategory">${opts(categories,t?.category||'Weapon')}</select></label>
 ${numeric('Width (tiles)','extW',t?.w||2,1,32)}${numeric('Height (tiles)','extH',t?.h||1,1,32)}
 ${numeric('Weight (kg)','extWeight',t?.weight||0,0,1000)}${numeric('Value (₽)','extValue',t?.value||0,0,100000000)}
 ${numeric('Stack limit','extStack',t?.stackSize||1,1,100000)}
 <label>Origin<select id="extOrigin">${opts(['Universal','Eastern','Western'],t?.origin||'Universal')}</select></label>
 ${label('Subtype / weapon family','extSub',t?.subcategory||'')}
 ${label('Compatible weapon IDs (comma separated)','extModels',safeArray(t?.compatibleWeapons).join(', '))}
 ${label('Proprietary models (IDs)','extProp',safeArray(t?.proprietaryWeapons).join(', '))}
 <label>Mount interface<select id="extMount">${opts(['',...interfaces],t?.mountType||'')}</select></label>
 ${label('Weapon mounting interfaces','extMounts',safeArray(t?.mounts).join(', '))}
 ${label('Interfaces supplied by upgrade kit','extKitMounts',safeArray(t?.kitMounts).join(', '))}
 ${label('Conflicting weapon IDs','extConflicts',safeArray(t?.conflicts).join(', '))}
 ${label('Required adapter kit IDs','extAdapters',safeArray(t?.adapterKitIds).join(', '))}
 ${numeric('DR','extDR',t?.gurps?.dr||0,0,10000)}${numeric('DT (house rule)','extDT',t?.dt||0,0,10000)}
 <label>Upgrade kit removable<select id="extKitRem">${opts([['yes','Yes'],['no','GM locked']],t?.kitRemovable===false?'no':'yes')}</select></label>
 ${label('GURPS damage expression','extDamage',t?.gurps?.damage||'')}${numeric('Accuracy','extAcc',t?.gurps?.acc||0,-20,30)}
 ${numeric('Recoil (Rcl)','extRcl',t?.gurps?.rcl||2,1,100)}${numeric('Rate of Fire','extRoF',t?.gurps?.rof||1,1,1000)}
 ${label('Caliber','extCaliber',t?.gurps?.caliber||'')}${numeric('Magazine capacity','extCapacity',t?.gurps?.capacity||0,0,10000)}
 </div>
 <label>Equipment description<textarea id="extDescription" rows="3">${esc(t?.description||'')}</textarea></label>
 <h3>STAT MODIFIERS</h3><p class="hint">Each line: stat, operation (add / multiply / replace), amount, optional condition. Example: acc,add,1</p>
 <textarea id="extMods" rows="4">${esc(modifierEntries(t).map(m=>[m.stat,m.op,m.value,m.condition||''].join(',')).join('\n'))}</textarea>
 <div class="ext-line"><button class="primary-action" data-ext="saveDefinition">Save definition</button><button data-ext="spawnWorkbench" ${!t?'disabled':''}>Spawn item(s)</button><input type="number" id="extSpawnQty" value="1" min="1" max="5000" style="width:90px"><button data-ext="deleteDefinition" ${!t?'disabled':''}>Delete definition</button></div>
 ${t?`<div class="ext-line"><button data-ext="openOriginalEditor">Open original Build 4.5 editor</button></div>`:''}
 ${t&&t.category==='Weapon'?`<h3>Compatible equipment</h3><div class="ext-item-chips">${state.catalog.filter(x=>['Optic','Suppressor','Magazine','Ammo'].includes(x.category)&&(x.category==='Magazine'?magazineFitsWeapon(x,t):x.category==='Ammo'?!!t.gurps?.caliber&&sameCaliber(x,t):installableCompatible(t,x,x.category==='Optic'?'optic':'suppressor').ok)).slice(0,80).map(x=>`<button data-ext="quickSpawn" data-id="${esc(x.id)}">+ ${esc(x.name)}</button>`).join('')||'No compatible definitions configured.'}</div>`:''}
 </section></div>`;
}
function parseModifiers(raw){const result=[];for(const line of raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean)){
 const [stat,op,val,condition]=line.split(',').map(x=>x.trim());if(!stat||!['add','multiply','replace'].includes(op)||!Number.isFinite(Number(val)))throw Error('Invalid modifier: '+line);
 result.push({stat,op,value:Number(val),condition:condition||''});}return result;}
function saveDefinition(){assertGM();const name=text('extName').trim(),category=text('extCategory');if(!name||name.length>100)throw Error('Enter a valid item name');
 const w=Math.floor(n(text('extW'))),h=Math.floor(n(text('extH')));if(w<1||h<1||w>32||h>32)throw Error('Item dimensions must be 1–32');
 const t=def(selectedDef)||{id:id(),gurps:{},storageW:4,storageH:2,compartments:[],tier:1,behavior:'equipment',image:'',uses:null};
 const isNew=!def(selectedDef);const fields={name,category,w,h,weight:n(text('extWeight')),value:n(text('extValue')),stackSize:Math.floor(n(text('extStack'),1)),origin:text('extOrigin'),subcategory:text('extSub'),compatibleWeapons:tokens(text('extModels')),proprietaryWeapons:tokens(text('extProp')),mountType:text('extMount'),mounts:tokens(text('extMounts')),kitMounts:tokens(text('extKitMounts')),conflicts:tokens(text('extConflicts')),adapterKitIds:tokens(text('extAdapters')),dt:n(text('extDT')),kitRemovable:text('extKitRem')==='yes',description:text('extDescription'),modifiers:parseModifiers(text('extMods'))};
 if(fields.stackSize<1||fields.value<0||fields.weight<0||fields.dt<0)throw Error('Weights, values, and stack sizes must be valid');
 Object.assign(t,fields);t.gurps={...t.gurps,damage:text('extDamage').trim(),acc:text('extAcc'),rcl:text('extRcl'),rof:text('extRoF'),caliber:text('extCaliber'),capacity:text('extCapacity'),dr:text('extDR')};
 if(isNew)state.catalog.push(t);else for(const x of state.items.filter(x=>x.templateId===t.id)){
  // Preserve per-instance fields such as ammo, installed attachments, positions, and ownership.
  const mutable=['name','weight','value','description','origin','modifiers','mounts','mountType','kitMounts','dt'];
  for(const field of mutable)x[field]=cp(t[field]??null);x.gurps={...(x.gurps||{}),...t.gurps};}
 selectedDef=t.id;savePlayer();saveGM('Updated catalog '+t.name);refresh();note('Saved '+t.name);}
function containedItems(c){if(!c)return[];
 const slot=c.location==='slot'?(c.slot==='armor'?'vest':c.slot):null;
 const active=slot==='vest'&&chestContainer()?.id===c.id||slot==='backpack'&&state.slots.backpack===c.id;
 return state.items.filter(x=>x.containerId===c.id||active&&x.location===storageLocation(slot));
}
function containerOverview(){const carriers=state.items.filter(x=>hasStorage(x));const c=item(selectedContainer)||carriers[0];if(c)selectedContainer=c.id;
 return `<section class="panel"><h2>PORTABLE CONTAINERS</h2><p class="hint">Stored contents remain linked to their parent when the container is unequipped or dropped. Re-equip to use the original tile-grid storage layout.</p><label>Container<select id="extPortableContainer">${select(carriers.map(x=>[x.id,x.name+' · '+x.location]),c?.id,'Select container')}</select></label>
 ${c?`<div class="ext-list">${containedItems(c).map(x=>`<div class="ext-row"><span>${esc(x.name)} · ${esc(x.w)}×${esc(x.h)} · ${esc(x.x??0)},${esc(x.y??0)}</span><button data-ext="extractContents" data-id="${esc(x.id)}">Take out</button></div>`).join('')||'<p>Container is empty.</p>'}</div>`:''}</section>`;
}
function renderEquipment(){const root=$('extEquipment');if(!root||root.closest('.page').hidden)return;initState();
 const weapons=state.items.filter(x=>x.category==='Weapon'&&x.location!=='loaded');const w=item(selectedWeapon)||weapons[0]||null;if(w)selectedWeapon=w.id;
 
 const attachments=state.items.filter(x=>['Optic','Suppressor','Upgrade Kit'].includes(x.category)&&!['installed'].includes(x.location));
 root.innerHTML=`<section class="panel"><h2>WEAPON CONFIGURATION</h2><label>Weapon<select id="extWeaponSelect">${select(weapons.map(x=>[x.id,x.name]),w?.id)}</select></label>
 ${w?`<div class="ext-inspection"><h3>${esc(w.name)}</h3>${w.image?`<img class="ext-weapon-preview" id="extCurrentWeaponImage" alt="Weapon" src="${esc(imageSrc(variantImage(w)||w.image))}">`:''}
 <div class="ext-line">${tiny('Optic',item(w.opticId)?.name||'None')}${tiny('Magazine',item(w.magazineId)?.name||'None')}${tiny('Suppressor',item(w.suppressorId)?.name||'None')}${tiny('Kit',item(w.kitId)?.name||'None')}</div>
 <div class="ext-line">${tiny('Acc',weaponStat(w,'acc'))}${tiny('Rcl',weaponStat(w,'rcl'))}${tiny('Weight (kg)',calculateStat(n(w.weight),'weight',modifierSources(w)).value)}</div>
 <p class="hint" title="Base weapon, kit, and physical attachments all contribute to the displayed statistics">${esc(weaponDamage(w)||'No GURPS damage entered')} · ${esc(w.gurps?.caliber||'Unspecified caliber')}</p>
 ${['optic','suppressor','kit'].map(slot=>{const existing=item(w[slot+'Id']);const allowed=attachments.filter(a=>slot==='kit'?a.category==='Upgrade Kit':installableCompatible(w,a,slot).ok);return `<div class="ext-row ext-attach-row"><strong>${esc(slot.toUpperCase())}</strong><span>${esc(existing?.name||'Empty')}</span>${existing?`<button data-ext="removeAttachment" data-slot="${slot}">Remove</button>`:`<select id="extInstall${slot}">${select(allowed.map(x=>[x.id,x.name]),'','Select '+slot)}</select><button data-ext="installAttachment" data-slot="${slot}">Install</button>`}</div>`}).join('')}
 <div class="ext-row"><strong>PHYSICAL MAGAZINE</strong><span>${esc(item(w.magazineId)?.name||'None')}</span><button data-ext="openAmmo">Open ammunition controls</button></div>
 <h3>Calculated modifier breakdown</h3><div class="ext-stat-grid">${['acc','rcl','bulk','damage','weight'].map(stat=>{const calc=calculateStat(stat==='weight'?n(w.weight):n(w.gurps?.[stat]),stat,modifierSources(w)),positive=calc.value>calc.base;if(!calc.parts.length)return `<div>${esc(stat)}: ${esc(calc.value)}</div>`;const beneficial=['rcl','bulk','weight'].includes(stat)?!positive:positive;return `<div class="ext-stat ${beneficial?'benefit':'penalty'}" title="${esc('Base '+calc.base+'; '+calc.parts.map(x=>`${x.source}: ${x.op} ${x.value}`).join('; '))}">${esc(stat)}: ${esc(calc.value)} ⓘ</div>`}).join('')}</div>
 </div>`:'<p>No weapons in your inventory. Ask the GM to spawn a weapon into Loot.</p>'}</section>
 `;
 root.insertAdjacentHTML('beforeend',containerOverview());
}
function renderVariants(){const root=$('extVariants');if(!root||root.closest('.page').hidden)return;initState();const weapons=state.catalog.filter(x=>x.category==='Weapon');const defn=def(selectedVariantWeapon)||weapons[0];if(defn)selectedVariantWeapon=defn.id;
 const variants=safeArray(G()?.integrated?.variants?.[selectedVariantWeapon]);
 root.innerHTML=`<section class="panel"><h2>MULTI-IMAGE CONFIGURATION LIBRARY</h2><div class="ext-line"><label>Base weapon<select id="extVariantWeapon">${select(weapons.map(x=>[x.id,x.name]),selectedVariantWeapon)}</select></label><label>Import images first, tag later<input id="extVariantFiles" type="file" multiple accept="image/png,image/jpeg,image/webp"></label></div><p class="hint">Tag values use the exact item IDs of kits/optics/suppressors; magazine tag is an appearance type (standard, extended, drum, none). Empty tag means a generic fallback.</p>
 <div class="ext-variants">${variants.map((v,i)=>`<div class="ext-variant"><img alt="Weapon artwork" src="${esc(imageSrc(v.src))}"><div class="ext-variant-fields">${label('Label','extVL'+i,v.label||'')}
 <label>Kit<select id="extVK${i}">${select(state.catalog.filter(x=>x.category==='Upgrade Kit').map(x=>[x.id,x.name]),v.tags?.kit||'','Any kit')}</select></label>
 <label>Magazine appearance<select id="extVM${i}">${opts([['','Any'],['none','No magazine'],['standard','Standard'],['extended','Extended'],['drum','Drum']],v.tags?.mag||'')}</select></label>
 <label>Optic<select id="extVO${i}">${select(state.catalog.filter(x=>x.category==='Optic').map(x=>[x.id,x.name]),v.tags?.optic||'','Any optic')}</select></label>
 <label>Suppressor<select id="extVS${i}">${select(state.catalog.filter(x=>x.category==='Suppressor').map(x=>[x.id,x.name]),v.tags?.suppressor||'','Any suppressor')}</select></label>
 <button data-ext="saveVariant" data-index="${i}">Save tags</button><button data-ext="removeVariant" data-index="${i}">Remove</button></div></div>`).join('')||'<p>No imported variants yet.</p>'}</div></section>`;
}
let draftFor='';
function renderPouches(){const root=$('extPouches');if(!root||root.closest('.page').hidden)return;const storage=state.catalog.filter(x=>hasStorage(x));const t=def(selectedPouchTemplate)||storage[0];if(t&&draftFor!==t.id){selectedPouchTemplate=t.id;pouchDraft=cp(t.compartments?.length?t.compartments:[{x:0,y:0,w:n(t.storageW,4),h:n(t.storageH,2)}]);draftFor=t.id}
 if(!t){root.innerHTML='<section class="panel">Create a vest or backpack definition first.</section>';return}
 const W=Math.max(1,Math.floor(n(t.storageW,4))),H=Math.max(1,Math.floor(n(t.storageH,2)));
 root.innerHTML=`<section class="panel"><h2>VISUAL POUCH EDITOR</h2><label>Parent container<select id="extPouchTemplate">${select(storage.map(x=>[x.id,x.name]),t.id)}</select></label><div class="ext-line">${numeric('Grid width','extPouchW',W,1,40)}${numeric('Grid height','extPouchH',H,1,40)}<button data-ext="resizePouchGrid">Resize grid</button><button data-ext="newPouch">+ Add pouch</button><button data-ext="savePouches" class="primary-action">Save layout</button></div>
 <p class="hint">Drag a pouch by its heading to reposition it. Use the controls below each pouch to change its size, storage restrictions and weight limit. Compartments cannot overlap.</p>
 <div class="ext-canvas-scroll"><div class="ext-pouch-canvas" style="--ext-w:${W};--ext-h:${H};width:${W*52}px;height:${H*52}px">${Array.from({length:W*H},(_,i)=>`<div class="ext-cell" style="left:${i%W*52}px;top:${Math.floor(i/W)*52}px"></div>`).join('')}${pouchDraft.map((p,i)=>`<div class="ext-pouch" data-index="${i}" style="left:${p.x*52}px;top:${p.y*52}px;width:${p.w*52}px;height:${p.h*52}px"><div class="ext-grab" data-drag="${i}">POUCH ${i+1} ⠿</div><small>${p.w}×${p.h}</small></div>`).join('')}</div></div>
 <div class="ext-pouch-editors">${pouchDraft.map((p,i)=>`<div class="ext-pouch-edit"><strong>Pouch ${i+1}</strong><div class="ext-line">${numeric('X','extPX'+i,p.x,0,40)}${numeric('Y','extPY'+i,p.y,0,40)}${numeric('W','extPW'+i,p.w,1,40)}${numeric('H','extPH'+i,p.h,1,40)}</div>
 ${label('Allowed categories (comma-separated; blank = any)','extPA'+i,safeArray(p.allowed).join(', '))}${label('Prohibited categories','extPP'+i,safeArray(p.prohibited).join(', '))}${numeric('Max item weight (kg; 0 = none)','extPM'+i,p.maxWeight||0,0,1000)}<div class="ext-line"><button data-ext="updatePouch" data-index="${i}">Update pouch</button><button data-ext="deletePouch" data-index="${i}">Remove pouch</button></div></div>`).join('')}</div></section>`;
}
function renderTraders(){const root=$('extTraders');if(!root||root.closest('.page').hidden)return;initState();const shops=G().integrated.traders;const sh=shopById(activeTrader)||shops[0];if(sh)activeTrader=sh.id;
 root.innerHTML=`<section class="panel"><h2>GENERATE TRADER</h2><div class="ext-grid"><label>Type<select id="extShopType">${opts(['Medic','Technician','General','Weapons','Armor','Clothing','Equipment'],'Weapons')}</select></label><label>Equipment origin<select id="extShopOrigin">${opts(['Any','Eastern','Western'],'Eastern')}</select></label>${numeric('Generation budget (₽)','extShopBudget',50000)}${numeric('Distinct item types','extShopSize',18,1,100)}${numeric('Maximum tier / rarity','extShopRarity',3,1,5)}</div><button class="primary-action" data-ext="generateTrader">Generate shop from master catalog</button>
 <p class="hint">Catalog entries without prices use provisional category/tier prices for initial generation. Set exact campaign prices in the master item editor or the trader stock list.</p><h2>MANAGE SHOP</h2><label>Trader<select id="extTraderSelect">${select(shops.map(x=>[x.id,x.name]),sh?.id,'Select trader')}</select></label>
 ${sh?`<div class="ext-grid">${label('Shop name','extTraderName',sh.name)}${numeric('Purchase price multiplier','extBuyMult',sh.priceBuy,0,100)}${numeric('Sale price multiplier','extSellMult',sh.priceSell,0,100)}</div>
 <div class="ext-line"><button data-ext="saveTrader">Save trader settings</button><button data-ext="restockTrader">Restore initial stock</button><button data-ext="regenerateTrader">Generate new stock</button><button data-ext="clearTrader">Clear stock</button></div>
 <h3>Make shop available to local characters</h3><div class="ext-line"><label>Character<select id="extShopPlayer">${select(profileRecords.map(p=>[p.id,p.name]),activeProfile)}</select></label><button data-ext="openTrader">Open shop</button><button data-ext="closeTrader">Close shop</button></div>
 <h3>Add inventory / edit finite stock</h3><div class="ext-line"><label>Definition<select id="extStockDef">${defOptions(null,'')}</select></label>${numeric('Quantity','extStockQty',5,1,100000)}${numeric('Unit price','extStockPrice',1000,0,100000000)}<button data-ext="addTraderStock">Add / update stock</button></div>
 <div class="ext-table"><div class="ext-head"><span>Item</span><span>Stock</span><span>Price</span><span>Actions</span></div>${sh.stock.map(line=>{const t=def(line.templateId);return `<div class="ext-table-row"><span>${esc(t?.name||'[Missing definition]')}</span><span>${line.qty}</span><span>${n(line.price).toLocaleString()} ₽</span><span><button data-ext="editStock" data-id="${esc(line.templateId)}">Edit</button><button data-ext="removeStock" data-id="${esc(line.templateId)}">Remove</button></span></div>`}).join('')}</div>`:'<p>No shops created yet.</p>'}</section>`;
}
function renderShop(){const root=$('extShop');if(!root||root.closest('.page').hidden)return;initState();const shops=G()?.integrated?.traders?.filter(x=>x.openTo?.includes(activeProfile))||[];
 root.innerHTML=`<section class="panel"><h2>TRADING POST</h2><div class="ext-line">${tiny('Character balance',getMoney().toLocaleString()+' ₽')}<label>Available trader<select id="extOpenShop">${select(shops.map(x=>[x.id,x.name]),shops.some(x=>x.id===activeTrader)?activeTrader:shops[0]?.id,'No open shops')}</select></label></div>
 ${shops.length?(()=>{const sh=shopById(shops.some(x=>x.id===activeTrader)?activeTrader:shops[0].id);return `<div class="ext-table"><div class="ext-head"><span>Item</span><span>Stock</span><span>Price</span><span>Transaction</span></div>${sh.stock.filter(x=>x.qty>0).map(line=>{const t=def(line.templateId);return `<div class="ext-table-row"><span>${esc(t?.name||'Unknown')}</span><span>${line.qty}</span><span>${Math.ceil(n(line.price)*n(sh.priceBuy,1)).toLocaleString()} ₽</span><span><button data-ext="buy" data-id="${esc(line.templateId)}" data-shop="${esc(sh.id)}">Buy</button><button data-ext="sell" data-id="${esc(line.templateId)}" data-shop="${esc(sh.id)}">Sell</button></span></div>`}).join('')}</div><h3>Sell items from personal inventory</h3><div class="ext-sell-grid">${state.items.filter(i=>['loose','vestGrid','backpackGrid'].includes(i.location)&&!i.containerId&&!i.weaponId&&!i.opticId&&!i.suppressorId&&!i.kitId&&!state.items.some(child=>child.containerId===i.id||child.weaponId===i.id)).slice(0,100).map(i=>`<div class="ext-row"><span>${esc(i.name)} · ${itemQuantity(i)} available · ${Math.floor(n(sh.stock.find(x=>x.templateId===i.templateId)?.price||estimatedPrice(i))*n(sh.priceSell,.5)).toLocaleString()} ₽ each</span><button data-ext="sell" data-id="${esc(i.templateId)}" data-shop="${esc(sh.id)}">Sell</button></div>`).join('')||'<p>No saleable items.</p>'}</div><p class="hint">Sales take items from inventory only. Equipped weapons and loaded magazines cannot be sold until removed.</p>`})():`<p class="hint">No trader has been opened for this character by the GM. Open one on the GM Traders page.</p>`}
 </section>`;
}
function renderRecovery(){const root=$('extRecovery');if(!root||root.closest('.page').hidden)return;initState();const gm=G(),v=gm.integrated;
 const combat=[...safeArray(gm.pendingCombat),...safeArray(state.combatReview)].sort((a,b)=>String(b.at||'').localeCompare(a.at||''));
 root.innerHTML=`<section class="panel"><h2>COMBAT CALCULATIONS — GM FINAL AUTHORITY</h2><p class="hint">Attack calculations do not automatically reduce NPC or Player HP. Apply, adjust, resolve without HP change, or ignore each result here.</p>
 <div class="ext-review">${combat.slice(0,80).map(r=>`<div class="ext-review-row"><div><strong>${esc(r.actor)} → ${esc(r.targetName||r.target||r.targetId||'Target')}</strong><small>${esc(r.at||'')} · ${esc(r.status)} · ${esc(r.location||'Torso')}</small><details><summary>Calculation details</summary><pre>${esc(r.detail||'No breakdown recorded')}</pre></details></div><div>${tiny('Calculated injury',n(r.injury))}${r.status==='Calculated'?`<input type="number" min="0" max="100000" id="extPending${esc(r.id)}" value="${n(r.injury)}" aria-label="Applied injury"><button data-ext="applyPending" data-id="${esc(r.id)}">Apply</button><button data-ext="resolvePending" data-id="${esc(r.id)}">Resolve without HP</button><button data-ext="ignorePending" data-id="${esc(r.id)}">Ignore</button>`:''}</div></div>`).join('')||'<p>No calculated attacks recorded.</p>'}</div></section>
 <section class="panel"><h2>LOCAL CAMPAIGN SNAPSHOTS &amp; RECOVERY</h2><div class="ext-line"><button class="primary-action" data-ext="snapshot">Create checkpoint</button><button data-ext="exportCampaign">Export complete JSON (excluding binary artwork)</button><label class="ext-file-label">Import local JSON<input id="extImportCampaign" type="file" accept=".json,application/json"></label></div>
 <p class="hint">A restore creates a safety checkpoint first. Image metadata and asset references are exported; imported asset binaries stored outside the JSON must be retained separately.</p>
 ${v.snapshots.map(x=>`<div class="ext-row"><span>${esc(new Date(x.at).toLocaleString())} · ${esc(x.reason)}</span><button data-ext="restoreSnapshot" data-id="${esc(x.id)}">Restore</button></div>`).join('')||'<p>No checkpoints.</p>'}</section>
 <section class="panel"><h2>CAMPAIGN RULES &amp; CHARACTER FUNDS</h2>
 <div class="ext-line">${numeric('Selected character funds (₽)','extGMFunds',getMoney(),0,1000000000)}<button data-ext="setFunds">Set character funds</button></div>
 <div class="ext-grid"><label>DT house rule<select id="extGMDT">${opts([['on','Enable DT'],['off','Ignore DT']],v.rules?.dtEnabled?'on':'off')}</select></label>
</div>
 <button data-ext="saveRules">Save house rules</button>
 <p class="hint">DR uses standard GURPS armor protection. DT, when enabled, is a campaign threshold: penetrating damage at or below the DT is stopped entirely; higher penetration is resolved normally. No removable armor plates.</p></section>
 <section class="panel"><h2>TRADER TRANSACTION LOG</h2><div class="ext-list">${v.transactions.slice(0,60).map(x=>`<div class="ext-row">${esc(x.at)} · ${esc(x.character)} · ${esc(x.kind)} ${esc(x.qty)} × ${esc(def(x.templateId)?.name||'?')} · ${esc(x.cost)} ₽</div>`).join('')||'<p>No transactions.</p>'}</div></section>
 <section class="panel"><h2>NPC BATCH GENERATION &amp; LOOT DISTRIBUTION</h2><div class="ext-line">${numeric('NPC count','extNPCCount',3,1,30)}<label>Faction<input id="extNPCFaction" value="Bandits"></label><button data-ext="batchNPC">Generate NPC templates</button></div>
 <div class="ext-line"><label>Item<select id="extLootDef">${defOptions(null,'')}</select></label>${numeric('Quantity','extLootQty',1,1,5000)}<label>Player<select id="extLootPlayer">${select(profileRecords.map(p=>[p.id,p.name]),activeProfile)}</select></label><button data-ext="grantLoot">Spawn to player's Loot</button></div></section>`;
}
function refresh(){
 for(const fn of [renderWorkbench,renderEquipment,renderVariants,renderPouches,renderTraders,renderShop,renderRecovery]){try{fn()}catch(e){console.error('Rendering extension:',fn.name,e)}}
}
function recordModifySource(e){const id=e.target?.id;if(id==='extSearch'){filter=e.target.value;renderWorkbench();const el=$('extSearch');el?.focus();try{el?.setSelectionRange(filter.length,filter.length)}catch{}}
 if(id==='extWeaponSelect'){selectedWeapon=e.target.value;renderEquipment()}
 if(id==='extCarrierSelect'){selectedCarrier=e.target.value;renderEquipment()}
 if(id==='extPortableContainer'){selectedContainer=e.target.value;renderEquipment()}
 if(id==='extVariantWeapon'){selectedVariantWeapon=e.target.value;renderVariants()}
 if(id==='extPouchTemplate'){selectedPouchTemplate=e.target.value;draftFor='';renderPouches()}
 if(id==='extTraderSelect'){activeTrader=e.target.value;renderTraders()}
 if(id==='extOpenShop'){activeTrader=e.target.value;renderShop()}
 if(id==='extStockDef'){const t=def(e.target.value);if(t)$('extStockPrice').value=estimatedPrice(t)}
}
const pouchDrag={};
function startPouchDrag(e){const grab=e.target.closest('[data-drag]');if(!grab)return;const index=Number(grab.dataset.drag);if(!pouchDraft[index])return;
 const initial={x:pouchDraft[index].x,y:pouchDraft[index].y,mouseX:e.clientX,mouseY:e.clientY};const block=grab.closest('.ext-pouch');
 grab.setPointerCapture?.(e.pointerId);const move=ev=>{const x=Math.max(0,Math.round(initial.x+(ev.clientX-initial.mouseX)/52)),y=Math.max(0,Math.round(initial.y+(ev.clientY-initial.mouseY)/52));block.style.left=x*52+'px';block.style.top=y*52+'px'};
 const end=ev=>{grab.removeEventListener('pointermove',move);grab.removeEventListener('pointerup',end);grab.removeEventListener('pointercancel',end);
  const p=pouchDraft[index];p.x=Math.max(0,Math.round(initial.x+(ev.clientX-initial.mouseX)/52));p.y=Math.max(0,Math.round(initial.y+(ev.clientY-initial.mouseY)/52));renderPouches()};
 grab.addEventListener('pointermove',move);grab.addEventListener('pointerup',end,{once:true});grab.addEventListener('pointercancel',end,{once:true});
}
function actionClick(e){const button=e.target.closest('[data-ext]');if(!button)return;const type=button.dataset.ext,key=button.dataset.id,slot=button.dataset.slot,index=Number(button.dataset.index);
 e.preventDefault();guard(()=>{
 switch(type){
 case 'selectDef':selectedDef=key;return renderWorkbench();
 case 'createDefinition':selectedDef='';return renderWorkbench();
 case 'saveDefinition':return saveDefinition();
 case 'deleteDefinition':assertGM();if(state.items.some(x=>x.templateId===selectedDef))throw Error('Cannot delete a definition with existing physical items');if(!confirm('Delete this definition?'))return;state.catalog=state.catalog.filter(x=>x.id!==selectedDef);selectedDef='';return commit('Deleted equipment definition');
 case 'openOriginalEditor':assertGM();return openItemEditor(selectedDef);
 case 'spawnWorkbench':{assertGM();const qty=Math.floor(n(text('extSpawnQty'),1));spawn(selectedDef,qty);return commit('Spawned '+qty+' '+def(selectedDef)?.name)}
 case 'quickSpawn':spawn(key,1);return commit('Quick spawn '+def(key)?.name);
 case 'installAttachment':{const aid=text('extInstall'+slot);if(!aid)throw Error('Select an item');return slot==='kit'?installKit(selectedWeapon,aid):installAttachment(selectedWeapon,aid,slot)}
 case 'removeAttachment':return slot==='kit'?removeKit(selectedWeapon):removeAttachment(selectedWeapon,slot);
 case 'openAmmo':return window.STALKER_NAV_TEST.route('character','player')&&showPage('ammo');
 case 'extractContents':{const c=item(selectedContainer),x=item(key);if(!c||!x||!containedItems(c).some(child=>child.id===x.id))throw Error('Item is no longer in this container');x.location='loose';delete x.containerId;delete x.x;delete x.y;return commit('Removed '+x.name+' from '+c.name)}
 case 'saveVariant':{assertGM();const v=G().integrated.variants[selectedVariantWeapon][index];if(!v)throw Error('Variant not found');
  const tags={kit:text('extVK'+index),mag:text('extVM'+index),optic:text('extVO'+index),suppressor:text('extVS'+index)};
  const other=G().integrated.variants[selectedVariantWeapon].filter(x=>x!==v);if(other.some(x=>JSON.stringify(x.tags||{})===JSON.stringify(tags)))throw Error('Duplicate variant tag configuration');
  v.tags=tags;v.label=text('extVL'+index);return commit('Updated image metadata',true)}
 case 'removeVariant':assertGM();if(!confirm('Remove this variant from the weapon library?'))return;G().integrated.variants[selectedVariantWeapon].splice(index,1);return commit('Removed weapon variant',true);
 case 'newPouch':pouchDraft.push({x:0,y:0,w:1,h:2,allowed:[],prohibited:[],maxWeight:0});return renderPouches();
 case 'updatePouch':{const p=pouchDraft[index];if(!p)return;for(const [key,field] of [['x','extPX'],['y','extPY'],['w','extPW'],['h','extPH']])p[key]=Math.floor(n(text(field+index)));p.allowed=tokens(text('extPA'+index));p.prohibited=tokens(text('extPP'+index));p.maxWeight=n(text('extPM'+index));return renderPouches()}
 case 'deletePouch':pouchDraft.splice(index,1);return renderPouches();
 case 'resizePouchGrid':{assertGM();const t=def(selectedPouchTemplate);const W=Math.floor(n(text('extPouchW'))),H=Math.floor(n(text('extPouchH')));if(!t||W<1||H<1||W>40||H>40)throw Error('Invalid grid');
  if(state.items.some(x=>x.templateId===t.id&&x.location==='slot'&&state.items.some(o=>o.location===storageLocation(x.slot==='armor'?'vest':x.slot))))throw Error('Empty this equipped container before resizing');
  t.storageW=W;t.storageH=H;for(const x of state.items.filter(x=>x.templateId===t.id)){x.storageW=W;x.storageH=H}return commit('Resized storage grid')}
 case 'savePouches':return setPouches(selectedPouchTemplate,pouchDraft);
 case 'generateTrader':{const s=generateShop({category:text('extShopType'),origin:text('extShopOrigin'),budget:text('extShopBudget'),size:text('extShopSize'),rarity:text('extShopRarity')});activeTrader=s.id;return refresh()}
 case 'saveTrader':{assertGM();const s=shopById(activeTrader);if(!s)throw Error('No trader');const buy=n(text('extBuyMult')),sell=n(text('extSellMult'));
  if(buy<0||sell<0||buy>100||sell>100)throw Error('Invalid price multipliers');s.name=text('extTraderName').trim().slice(0,100)||s.name;s.priceBuy=buy;s.priceSell=sell;return commit('Updated trader',true)}
 case 'clearTrader':{assertGM();const s=shopById(activeTrader);if(!s)throw Error('No trader');if(!confirm('Remove all trader stock?'))return;s.stock=[];return commit('Cleared trader',true)}
 case 'restockTrader':{assertGM();const s=shopById(activeTrader);if(!s)throw Error('No trader');for(const x of s.stock)x.qty=x.initialQty;return commit('Restocked '+s.name,true)}
 case 'regenerateTrader':{assertGM();const s=shopById(activeTrader);if(!s)throw Error('No trader');const other=generateShop({category:s.category,origin:s.origin,budget:50000,size:20,rarity:5});s.stock=other.stock;G().integrated.traders=G().integrated.traders.filter(x=>x.id!==other.id);return commit('Regenerated '+s.name,true)}
 case 'addTraderStock':{assertGM();const sh=shopById(activeTrader),t=def(text('extStockDef')),qty=Math.floor(n(text('extStockQty'))),price=n(text('extStockPrice'));if(!sh||!t||qty<1||qty>100000||price<0||!Number.isFinite(price))throw Error('Invalid stock data');
  const existing=sh.stock.find(x=>x.templateId===t.id);if(existing){existing.qty+=qty;existing.initialQty+=qty;existing.price=price}else sh.stock.push({templateId:t.id,qty,initialQty:qty,price,manual:true});return commit('Trader added '+t.name,true)}
 case 'removeStock':{assertGM();const sh=shopById(activeTrader);sh.stock=sh.stock.filter(x=>x.templateId!==key);return commit('Removed trader stock',true)}
 case 'editStock':{assertGM();const line=shopById(activeTrader)?.stock.find(x=>x.templateId===key);if(!line)throw Error('Stock missing');const qty=prompt('Stock quantity',String(line.qty)),price=prompt('Unit price',String(line.price));if(qty===null||price===null)return;const q=Number(qty),p=Number(price);if(!Number.isSafeInteger(q)||q<0||!Number.isFinite(p)||p<0)throw Error('Invalid stock values');line.qty=q;line.price=p;return commit('Edited stock',true)}
 case 'openTrader':{assertGM();const sh=shopById(activeTrader),pid=text('extShopPlayer');if(!sh||!pid)throw Error('Select trader and player');sh.openTo=sh.openTo||[];if(!sh.openTo.includes(pid))sh.openTo.push(pid);return commit('Opened trader for '+pid,true)}
 case 'closeTrader':{assertGM();const sh=shopById(activeTrader),pid=text('extShopPlayer');if(!sh)throw Error('Trader missing');sh.openTo=sh.openTo.filter(x=>x!==pid);return commit('Closed trader for '+pid,true)}
 case 'buy':case 'sell':{const quantity=Number(prompt('Quantity', '1'));if(!Number.isSafeInteger(quantity)||quantity<1||quantity>5000)throw Error('Invalid quantity');const sum=transaction(button.dataset.shop,key,quantity,type);return note(`${type==='buy'?'Purchased':'Sold'} ${quantity} item(s) for ${sum.toLocaleString()} ₽`)}
 case 'snapshot':takeSnapshot('Manual checkpoint');return refresh();
 case 'restoreSnapshot':{if(!confirm('Restore this checkpoint? A safety checkpoint will be created first.'))return;return restoreSnapshot(key)}
 case 'exportCampaign':return exportCampaign();
 case 'applyPending':return applyPending(key,'apply',text('extPending'+key));
 case 'resolvePending':return applyPending(key,'resolve',0);
 case 'ignorePending':return applyPending(key,'ignore',0);
 case 'setFunds':{assertGM();const funds=Number(text('extGMFunds'));if(!Number.isSafeInteger(funds)||funds<0||funds>1000000000)throw Error('Enter valid nonnegative funds');state.money=funds;return commit('Set money to '+funds)}
 case 'saveRules':{assertGM();const rules=G().integrated.rules;rules.dtEnabled=text('extGMDT')==='on';return commit('Updated campaign rules',true)}
 case 'batchNPC':{assertGM();const count=Math.floor(n(text('extNPCCount'))),faction=text('extNPCFaction').trim();if(count<1||count>30)throw Error('NPC count 1–30');
  const gm=G(),npcWeapons=state.catalog.filter(x=>x.category==='Weapon');
  for(let k=0;k<count;k++){const w=npcWeapons[Math.floor(Math.random()*npcWeapons.length)];gm.npcs.push({id:id(),name:`${faction||'Zone'} ${gm.npcs.length+1}`,type:'Human',faction,stats:{HP:10,ST:10,DX:11,IQ:10,HT:10,Dodge:8},skill:10+Math.floor(Math.random()*4),dr:0,damage:w?.gurps?.damage||'2d pi',shots:n(w?.gurps?.rof,1),loadout:w?[{templateId:w.id,quantity:1}]:[],equippedWeapon:w?.id||'',notes:'Batch-generated template'});}
  saveGM('Generated '+count+' NPC templates');bridge().renderGM();return refresh()}
 case 'grantLoot':{assertGM();const tid=text('extLootDef'),pid=text('extLootPlayer'),qty=Math.floor(n(text('extLootQty'))),t=def(tid);if(!t||!pid||qty<1||qty>5000)throw Error('Invalid loot assignment');
  const rec=bridge()?.playerRecord(pid);if(!rec)throw Error('Unknown player');const lim=Math.max(1,Math.floor(n(t.stackSize,1)));
  for(let remain=qty;remain>0;remain-=lim)rec.data.items.push({...cp(t),id:id(),templateId:t.id,quantity:Math.min(lim,remain),location:'loose',rotated:false});
  bridge()?.savePlayer(pid,rec);saveGM('Distributed loot to '+pid);refresh();return note('Loot available for '+pid)}
 }
 });}
async function importVariants(files){assertGM();initState();const v=G().integrated.variants[selectedVariantWeapon]||(G().integrated.variants[selectedVariantWeapon]=[]);
 for(const file of files){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8*1024*1024){note('Skipped unsupported or oversized image '+file.name,false);continue}
  try{const src=await bridge().storeImage(file);v.push({id:id(),src,label:file.name.replace(/\.[^.]+$/,''),tags:{kit:'',mag:'',optic:'',suppressor:''}})}catch(e){note('Image import failed: '+e.message,false);}}
 saveGM('Imported weapon images');refresh();}
function exportCampaign(){assertGM();const doc=stateSnapshot();doc.schema='stalker-build-4-5-integrated-0-6';const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='stalker-campaign-integrated-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function importCampaign(file){assertGM();let doc;try{doc=JSON.parse(await file.text())}catch{throw Error('Not valid JSON')}
 if(!doc||!doc.player||!doc.gm||!Array.isArray(doc.player.items)||!Array.isArray(doc.player.catalog)||!Array.isArray(doc.gm.npcs))throw Error('Not an integrated campaign backup');
 if(!confirm('Import will replace current campaign data. A safety checkpoint will be created first.'))return;takeSnapshot('Before import');resetFromSnapshot(doc);refresh();}
function installListeners(){
 document.addEventListener('click',actionClick);
 document.addEventListener('input',e=>{if(e.target?.id==='extSearch')recordModifySource(e)});
 document.addEventListener('change',e=>{
  recordModifySource(e);if(e.target?.id==='extVariantFiles'&&e.target.files?.length)guard(()=>importVariants([...e.target.files]));
  if(e.target?.id==='extImportCampaign'&&e.target.files?.length)guard(()=>importCampaign(e.target.files[0]));
 });
 document.addEventListener('pointerdown',startPouchDrag);
 const observer=new MutationObserver(mutations=>{if(mutations.some(m=>m.target.classList?.contains('page')))queueMicrotask(refresh)});
 document.querySelectorAll('.page').forEach(page=>observer.observe(page,{attributes:true,attributeFilter:['hidden']}));
 window.addEventListener('error',ev=>{if(!ev.error)return;console.error('Integrated Build:',ev.error)});
}
// Reuse the original character form: inputs always edit BASE values while badges
// display effective values from equipped gear. No persistent stat inflation.
const legacyRenderCharacter=renderCharacter;
renderCharacter=function(...args){const value=legacyRenderCharacter.apply(this,args);decorateCharacterStats();return value};
const legacyRenderAll=render;
render=function(...args){const value=legacyRenderAll.apply(this,args);decorateCharacterStats();return value};
initState();migrateLegacyPlates();installListeners();decorateCharacterStats();
 const tools=document.querySelector('.loot-tools');if(tools){const move=document.createElement('button');move.type='button';move.textContent='Move selected group to Loot';move.title='Shift-click to select multiple items';move.addEventListener('click',transferGroupToLoot);tools.append(move)}
 document.addEventListener('click',e=>{if(multiSelected.size&&!(e.target.closest('[data-item-id]')||e.target.closest('.loot-tools')||e.target.closest('.storage-grid')||e.target.closest('.slot')))multiSelected.clear()});
 refresh();
})();
