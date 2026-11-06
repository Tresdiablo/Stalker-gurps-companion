/* S.T.A.L.K.E.R. GURPS Companion build 4: modular supplement to original 4e inventory.
   Offline GM operations work in one app. Networking is optional and GM-authoritative. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const el = (tag,cls,text) => { const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=String(text);return n;};
const row = (parent,...nodes)=>{const n=el('div','comp-row');n.append(...nodes);parent.append(n);return n;};
const btn = (label,click,css='') => {const b=el('button',css,label);b.type='button';b.addEventListener('click',click);return b;};
const val=(v,def='')=>v===null||v===undefined?def:v;
const num=(v,fallback=0)=>Number.isFinite(Number(v))?Number(v):fallback;
const id=()=> typeof crypto!=='undefined'&&crypto.randomUUID?crypto.randomUUID():'id'+Date.now()+Math.random().toString(36).slice(2);
const htmlSafe=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const GM_KEY='stalker-gurps-companion-gm-v4';
const emptyGM=()=>({version:4,npcs:[],encounters:[],activeEncounter:null,history:[],checkpoints:[],players:{},zoneNotes:'',campaign:{name:'S.T.A.L.K.E.R. Campaign',date:'',location:'',notes:''},connectedAt:null});
let gmData;
try{gmData={...emptyGM(),...JSON.parse(localStorage.getItem(GM_KEY)||'{}')};}catch{gmData=emptyGM();}
for(const key of ['npcs','encounters','history','checkpoints'])if(!Array.isArray(gmData[key]))gmData[key]=[];
if(!gmData.players||typeof gmData.players!=='object')gmData.players={};
if(!gmData.templateCategories||typeof gmData.templateCategories!=='object')gmData.templateCategories={Human:[],Mutant:[],Other:[]};
for(const type of ['Human','Mutant','Other'])if(!Array.isArray(gmData.templateCategories[type]))gmData.templateCategories[type]=[];
let viewMode=localStorage.getItem('stalker-companion-view')==='gm'?'gm':'player';
let selectedNpcId=null,editingNpcId=null,editingEncounterId=null,encounterDraft=[],activeTargetId=null;
let imageVariants={},heldImages=new Map(),lazyAssetLoads=new Set();
let network=null,networkRole=null,networkSyncPending=null,remotePublic=null,gmNetworkInitialized=false;
function gmSave(kind,details){
 if(kind){gmData.history.unshift({id:id(),when:new Date().toISOString(),kind,details:String(details||'')});gmData.history=gmData.history.slice(0,350)}
 try{localStorage.setItem(GM_KEY,JSON.stringify(gmData));scheduleNativeSave()}catch(e){notice('GM save full: export the campaign. '+e.message)}
 if(network&&network.readyState===1&&networkRole==='gm'){gmData.catalog=clone(state.catalog);network.send(JSON.stringify({type:'gmUpdate',data:gmData}));}
}
function encounter(){return gmData.encounters.find(x=>x.id===gmData.activeEncounter)||null}
function shortStatus(hp,max){return hp<=0?'Incapacitated':hp<=max/3?'Wounded':'Active'}
function toast(m){notice(m)}
const originalShowPage=showPage;
showPage=function(page){
 const gmCombat=page==='gmcombat';
 if(networkRole==='player'&&(gmCombat||['dashboard','players','npcs','encounters','zone','campaign','gmsettings','catalog'].includes(page)))return toast('GM tools are unavailable in a connected player session.');
 if(page==='ammo'){setMode('player');originalShowPage('character');$('ammoWorkbench').open=true;$('ammoWorkbench').scrollIntoView({block:'nearest',behavior:'smooth'});return}
 if(gmCombat||['dashboard','players','npcs','encounters','zone','campaign','gmsettings','catalog'].includes(page))setMode('gm',false);
 else if(['character','sheet','status','combat','journal'].includes(page))setMode('player',false);
 for(const node of document.querySelectorAll('.page'))node.hidden=node.id!==(gmCombat?'combat':page)+'Page';
 for(const b of document.querySelectorAll('[data-page]')){b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false')}
 if(page==='combat'||gmCombat){renderCombat();renderEncounterTargets();if(gmCombat)renderGMCombatants();}
 if(page==='character'){renderEncounterLoot();renderAmmo()}
 if(page==='sheet')renderSkills();
 if(page==='journal')renderJournal();
 if(viewMode==='gm')renderGM();
};
function updateRoleControls(){const gm=viewMode==='gm';
 for(const id of ['targetHP','targetMaxHP','targetDR','combatTargetHT','npcAttackSkill','npcAttackDamage','npcShots','npcRcl']){const e=$(id);if(e)e.readOnly=!gm}
 const npcPanel=$('npcAttackPanel');if(npcPanel)npcPanel.hidden=!gm;
 const advanced=$('advancedTargetPanel');if(advanced)advanced.classList.toggle('gm-review',!gm);
}
function setMode(mode,navigate=true){
 if(mode==='gm'&&networkRole==='player')return toast('GM tools are unavailable in a connected player session.');
 viewMode=mode==='gm'?'gm':'player';localStorage.setItem('stalker-companion-view',viewMode);
 document.body.dataset.mode=viewMode;updateRoleControls();
 $('playerMode').classList.toggle('selected',viewMode==='player');$('gmMode').classList.toggle('selected',viewMode==='gm');
 if(navigate)showPage(viewMode==='gm'?'dashboard':'character');
}
$('playerMode').addEventListener('click',()=>setMode('player'));
$('gmMode').addEventListener('click',()=>setMode('gm'));
setMode(viewMode,false);
// Existing ammo page is now a collapsible workbench on the Inventory page.
$('ammoWorkbench').addEventListener('toggle',()=>{if($('ammoWorkbench').open)renderAmmo()});

// Responsive image fitting. An image never stretches to change its aspect ratio.
// IndexedDB stores assets separately from per-character browser localStorage.
const ASSET_DB='stalker-companion-assets-v1';
let dbPromise=null;
function assetDb(){if(dbPromise)return dbPromise;dbPromise=new Promise((resolve,reject)=>{if(!window.indexedDB)return reject(Error('IndexedDB unavailable'));const r=indexedDB.open(ASSET_DB,1);r.onupgradeneeded=()=>{r.result.createObjectStore('images')};r.onerror=()=>reject(r.error);r.onsuccess=()=>resolve(r.result)});return dbPromise}
async function putAsset(blob){const db=await assetDb(),assetId=id();await new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(blob,assetId);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)});heldImages.set(assetId,URL.createObjectURL(blob));return 'asset:'+assetId}
async function getAsset(assetId){const db=await assetDb();return new Promise((resolve,reject)=>{const r=db.transaction('images','readonly').objectStore('images').get(assetId);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
function lazyAsset(uri){const key=uri.slice(6);if(heldImages.has(key))return heldImages.get(key);
 if(!lazyAssetLoads.has(key)){lazyAssetLoads.add(key);getAsset(key).then(blob=>{if(blob){heldImages.set(key,URL.createObjectURL(blob));for(const img of document.querySelectorAll('img[data-asset]'))if(img.dataset.asset===uri)img.src=heldImages.get(key);render();}}).catch(()=>{}).finally(()=>lazyAssetLoads.delete(key))}
 return '';
}
const originalImageSrc=imageSrc;
imageSrc=function(raw){if(!raw)return '';const uri=String(raw);
 if(uri.startsWith('asset:'))return lazyAsset(uri);
 if(uri.startsWith('stalker-asset://'))return uri;
 return originalImageSrc(raw);
};
function visibleImage(item){if(!item)return '';
 const integrated=window.STALKER_EXT?.variantImage?.(item);if(integrated)return integrated;
 if(item.category!=='Weapon')return item.image||'';
 const mag=weaponMagazine(item);
 const kind=mag?(mag.magAppearance||'standard'):'none';
 return item.appearanceVariants?.[kind]||item.appearanceVariants?.standard||item.image||'';
}
// The original application calls visibleImage() in inventory rendering (patched app.js).
window.visibleImage=visibleImage;
async function prepareImage(file,w=4,h=2,bgMode='transparent'){
 if(!file||!file.type.startsWith('image/'))throw Error('Choose a PNG, JPEG, or WebP image.');
 if(file.size>18*1024*1024)throw Error('Image exceeds 18 MB. Optimize it first.');
 const image=await createImageBitmap(file);const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
 const c=canvas.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);
 const data=c.getImageData(0,0,canvas.width,canvas.height),p=data.data;
 const eraseWhite=bgMode==='remove-white';let minX=image.width,minY=image.height,maxX=-1,maxY=-1;
 for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
  const k=(y*image.width+x)*4;let a=p[k+3];
  if(eraseWhite&&p[k]>245&&p[k+1]>245&&p[k+2]>245){a=0;p[k+3]=0}
  if(a>24){if(x<minX)minX=x;if(y<minY)minY=y;if(x>maxX)maxX=x;if(y>maxY)maxY=y}
 }
 if(maxX<minX||maxY<minY){minX=0;minY=0;maxX=image.width-1;maxY=image.height-1}
 if(eraseWhite)c.putImageData(data,0,0);
 const out=document.createElement('canvas');out.width=Math.min(1920,Math.max(128,num(w,4)*128));out.height=Math.min(1920,Math.max(128,num(h,2)*128));
 const ctx=out.getContext('2d');const cw=maxX-minX+1,ch=maxY-minY+1;
 const scale=Math.min(out.width*.96/cw,out.height*.96/ch),drawW=cw*scale,drawH=ch*scale;
 ctx.clearRect(0,0,out.width,out.height);ctx.drawImage(canvas,minX,minY,cw,ch,(out.width-drawW)/2,(out.height-drawH)/2,drawW,drawH);
 image.close?.();const blob=await new Promise(resolve=>out.toBlob(resolve,'image/webp',.88));
 if(window.stalkerDesktop?.saveImage)return await window.stalkerDesktop.saveImage(await blob.arrayBuffer());
 return putAsset(blob);
}
async function chooseAndStoreImage(file){const f=$('itemForm');return prepareImage(file,num(f.elements.w.value,2),num(f.elements.h.value,1),$('imageBackgroundMode').value)}
// Replace old picker listener that embeds base64 in localStorage.
const previousPicker=$('imagePicker'),picker=previousPicker.cloneNode(true);previousPicker.replaceWith(picker);
picker.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;
 try{selectedImageData=await chooseAndStoreImage(file);const editor=$('itemForm');editor.elements.image.value=selectedImageData;const prev=$('imagePreview');prev.src=imageSrc(selectedImageData);prev.hidden=false;toast('Imported and fitted item image.')}catch(err){alert('Image import failed: '+err.message)}
 e.target.value='';});
const variantFile=$('variantFile');
variantFile.addEventListener('change',async e=>{const file=e.target.files?.[0];if(!file)return;try{
 const kind=$('variantKind').value;imageVariants[kind]=await chooseAndStoreImage(file);$('appearanceVariants').value=JSON.stringify(imageVariants);renderVariantSummary();toast('Saved '+kind+' appearance.');
 }catch(err){alert(err.message)}e.target.value='';});
$('clearVariant').onclick=()=>{delete imageVariants[$('variantKind').value];$('appearanceVariants').value=JSON.stringify(imageVariants);renderVariantSummary()};
function renderVariantSummary(){$('variantSummary').textContent=Object.keys(imageVariants).length?'Configured: '+Object.keys(imageVariants).join(', '):'No variants — default image will be used.'}
const priorEditor=openItemEditor;
openItemEditor=function(tid=null){priorEditor(tid);const t=tid?template(tid):null;imageVariants={...(t?.appearanceVariants||{})};$('appearanceVariants').value=JSON.stringify(imageVariants);$('itemForm').elements.magAppearance.value=t?.magAppearance||'standard';renderVariantSummary();$('itemDialog').classList.add('large-item-editor');};
const priorBehavior=updateItemBehavior;
updateItemBehavior=function(){priorBehavior();const cat=$('itemForm').elements.category.value;document.querySelectorAll('.image-variants').forEach(n=>n.hidden=cat!=='Weapon');document.querySelectorAll('.mag-appearance-field').forEach(n=>n.hidden=cat!=='Magazine')};
// Embedded older images remain valid; new images are IDB assets or desktop files.

// Compact item hover cards, no additional click needed.
const tooltip=$('itemHoverTooltip');let hoveredId=null,hoverTimer=null;
function tooltipFor(i){const parts=[];
 if(i.category==='Weapon'){const m=weaponMagazine(i);parts.push(`Ammo: ${m?num(m.loadedRounds):num(i.loadedRounds)}${m?'/'+magCapacity(m):''} · Chamber: ${num(i.chambered)}`);parts.push(`${itemCaliber(i)||'Caliber unknown'} · ${i.gurps?.damage||'Damage not specified'}`)}
 if(i.category==='Magazine')parts.push(`Rounds ${num(i.loadedRounds)} / ${magCapacity(i)}`,`Ammo: ${i.loadedAmmoType||itemCaliber(i)||'Empty'}`);
 if(i.category==='Ammo')parts.push(`Quantity: ${itemQuantity(i)}`,itemCaliber(i));
 if(isConsumable(i))parts.push(`Uses: ${num(i.uses)}`,i.hpHeal?`Healing: ${i.hpHeal} HP / use`:null);
 if(i.durabilityMax>0)parts.push(`Condition: ${num(i.condition,i.durabilityMax)} / ${i.durabilityMax}`);
 if(i.gurps?.dr)parts.push(`Armor DR: ${i.gurps.dr}`);
 if(hasStorage(i))parts.push(`Container: ${i.storageW}×${i.storageH} cells`);
 parts.push(`Size: ${i.w}×${i.h} · ${i.weight||0} kg`);
 return `<strong>${htmlSafe(i.name)}</strong><small>${htmlSafe(i.category)} · Tier ${normalizeTier(i.tier)}</small>${parts.filter(Boolean).map(t=>`<div>${htmlSafe(t)}</div>`).join('')}`;
}
function tooltipPosition(e){const ww=Math.min(290,tooltip.offsetWidth||240),hh=tooltip.offsetHeight||160;tooltip.style.left=Math.min(innerWidth-ww-8,e.clientX+16)+'px';tooltip.style.top=Math.max(6,Math.min(innerHeight-hh-8,e.clientY+14))+'px';}
document.addEventListener('pointerover',e=>{const cell=e.target.closest('[data-item-id]');const item=byId(cell?.dataset.itemId);
 if(!item||carry){hoveredId=null;tooltip.hidden=true;clearTimeout(hoverTimer);return}
 if(item.id!==hoveredId){hoveredId=item.id;tooltip.hidden=true;clearTimeout(hoverTimer);hoverTimer=setTimeout(()=>{if(!carry&&hoveredId===item.id){tooltip.innerHTML=tooltipFor(item);tooltip.hidden=false;tooltipPosition(e)}},250)}
},true);
document.addEventListener('pointermove',e=>{if(!tooltip.hidden)tooltipPosition(e)},true);
document.addEventListener('pointerdown',()=>{tooltip.hidden=true;hoveredId=null},true);
document.addEventListener('pointerout',e=>{if(e.target.closest('[data-item-id]')&&!e.relatedTarget?.closest?.('[data-item-id]')){tooltip.hidden=true;hoveredId=null}},true);
// Context menu enhancement: original menu receives keyboard and mouse support.
const oldContext=openItemContext;
openItemContext=function(e,itemId){oldContext(e,itemId);const i=byId(itemId);if(!i)return;const menu=$('itemContextMenu');
 const action=(label,fn)=>{const b=btn(label,()=>{menu.hidden=true;fn()});menu.append(b)};
 if(i.category==='Weapon'){action('Reload / Manage Ammo',()=>{setMode('player');showPage('ammo')});action('Unload / Eject magazine',()=>ejectMagazine(i.id));}
 if(i.category==='Magazine'){action('Load rounds',()=>loadMagazine(i.id));action('Unload rounds',()=>unloadMagazine(i.id))}
 if(isConsumable(i))action('Use item',()=>{selected=i.id;useSelectedItem()});
 if(i.location==='loose')action('Auto-fit in carried storage',()=>{const fit=placeAutomatically(i);if(fit){save();render();toast('Moved to '+fit)}else toast('No available storage')});
 if(i.category==='Weapon'||i.category==='Armor')action('Inspect GURPS properties',()=>{selected=i.id;renderSelectedItem();setMode('player');showPage('character')});
 action((state.favorites||[]).includes(i.templateId)?'Remove from Favorites':'Pin to Favorites',()=>{const f=new Set(state.favorites||[]);if(f.has(i.templateId))f.delete(i.templateId);else f.add(i.templateId);state.favorites=[...f].slice(0,8);save();renderQuickFavorites();toast('Favorites updated')});
};
// Search catalogue without modifying the existing ordered category renderer.
const oldCatalogRender=renderCatalog;
renderCatalog=function(){oldCatalogRender();filterCatalogue();};
function filterCatalogue(){const q=$('catalogSearch').value.toLowerCase().trim();const root=$('catalog');
 if(!q){root.querySelectorAll('[data-filter-hidden]').forEach(x=>{x.hidden=false;delete x.dataset.filterHidden});return}
 for(const details of root.querySelectorAll('details')){let match=0;for(const row of details.querySelectorAll('[data-template-id], .catalog-item, .catalog-row')){
 const txt=row.textContent.toLowerCase();row.hidden=!txt.includes(q);if(!row.hidden)match++;
 }details.open=true;if(!match)details.hidden=!details.textContent.toLowerCase().includes(q);else details.hidden=false}
}
$('catalogSearch').addEventListener('input',filterCatalogue);
// Session journal and quick actions
function renderJournal(){if(document.activeElement!==$('playerJournal'))$('playerJournal').value=state.playerJournal||'';const root=$('journalRecent');root.replaceChildren();
 for(const x of [...(state.rollLog||[]),...(state.log||[]).map(x=>typeof x==='string'?{label:'Activity',detail:x}:x)].slice(0,80)){const p=el('p','journal-line',`${x.at||''} ${x.label||''}: ${x.detail||x.message||''}`);root.append(p)}
 if(!root.children.length)root.textContent='No session activity recorded.';}
$('savePlayerJournal').onclick=()=>{state.playerJournal=$('playerJournal').value;save();toast('Journal saved')};
$('exportSessionSummary').onclick=()=>{const out=[`S.T.A.L.K.E.R. GURPS — ${state.identity.Name||'Character'} Session Summary`,new Date().toLocaleString(),'','CURRENT STATUS',`HP ${state.conditions.Health}/${state.stats.HP} · FP ${state.conditions.Fatigue}/${state.stats.FP}`,`Location: ${gmData.campaign.location||'Unknown'}`,'','ROLLS & EVENTS',...(state.rollLog||[]).map(x=>`${x.at} ${x.label}: ${x.detail}`),'','NOTES',state.playerJournal||''];download('stalker-session-summary.txt',out.join('\n'))};
const oldRender=render;
render=function(){oldRender();renderEncounterTargets();renderEncounterLoot();if($('journalPage').hidden===false)renderJournal();if(viewMode==='gm')renderGM();};
// Quick bar stays on Inventory, no need to navigate away for common actions.
const right=document.querySelector('#characterPage .right');const quick=el('section','panel quickbar');quick.innerHTML='<h2>QUICK ACTIONS</h2><div class="toolbar quickbar-actions"></div>';
right.insertBefore(quick,right.firstChild);
quick.querySelector('.quickbar-actions').append(btn('Attack',()=>showPage('combat')),btn('Reload',()=>showPage('ammo')),btn('Use Selected',()=>{if(byId(selected))useSelectedItem();else toast('Select a medical or consumable item')}),btn('Auto Pack',()=>autoPackLoot()));
const quickFavorites=el('div','toolbar quick-favorites');quick.append(quickFavorites);
const carryAlert=el('div','carry-alert');quick.append(carryAlert);
function renderQuickFavorites(){quickFavorites.replaceChildren();const favorites=state.favorites||[];
 if(favorites.length)quickFavorites.append(el('span','muted','FAVORITES'));
 for(const tid of favorites){const t=template(tid);if(!t)continue;quickFavorites.append(btn(t.name,()=>{const i=state.items.find(x=>x.templateId===tid);if(!i)return toast('No '+t.name+' in your inventory.');selected=i.id;setMode('player');showPage('character');render();toast('Selected '+i.name)}))}
 const e=encumbrance();carryAlert.textContent=`Carrying ${e.carried.toFixed(1)} kg · ${e.name} encumbrance${e.overLimit?' — OVER LIMIT':''} · Dodge penalty ${e.dodgePenalty}`;
 carryAlert.classList.toggle('over-limit',e.overLimit);
}
const beforeRenderQuick=render;
render=function(){beforeRenderQuick();renderQuickFavorites()};
renderQuickFavorites();
document.addEventListener('keydown',e=>{const editable=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);if(editable||e.ctrlKey||e.altKey||e.metaKey)return;
 if(e.key.toLowerCase()==='i'&&!carry)showPage('character');if(e.key.toLowerCase()==='c'&&!carry)showPage('combat');if(e.key.toLowerCase()==='l'&&!carry&&viewMode==='gm')showPage('encounters');
});
// ---- Game Master: reusable NPC templates, encounters and persistent loot ----
function npcTemplate(n){return {id:n.id||id(),name:String(n.name||'Unnamed NPC'),type:n.type||'Human',templateCategory:n.templateCategory||'',faction:n.faction||'',stats:{HP:num(n.stats?.HP??n.HP,10),ST:num(n.stats?.ST??n.ST,10),DX:num(n.stats?.DX??n.DX,10),IQ:num(n.stats?.IQ??n.IQ,10),HT:num(n.stats?.HT??n.HT,10),Dodge:num(n.stats?.Dodge??n.Dodge,8)},dr:num(n.dr,0),dt:num(n.dt,0),skill:num(n.skill,11),damage:n.damage||'2d pi',shots:num(n.shots,1),token:n.token||'',notes:n.notes||'',loadout:Array.isArray(n.loadout)?n.loadout:[],equippedWeapon:n.equippedWeapon||'',gcs:n.gcs||null};}
function npcById(npcId){return gmData.npcs.find(x=>x.id===npcId)}
function makeActor(templateNpc){return {id:id(),templateId:templateNpc.id,name:templateNpc.name,type:templateNpc.type,faction:templateNpc.faction,hp:templateNpc.stats.HP,maxHP:templateNpc.stats.HP,fp:templateNpc.stats.HT,maxFP:templateNpc.stats.HT,dr:templateNpc.dr,dt:templateNpc.dt||0,ht:templateNpc.stats.HT,dodge:templateNpc.stats.Dodge,skill:templateNpc.skill,damage:npcWeaponStats(templateNpc).damage,shots:npcWeaponStats(templateNpc).shots,token:templateNpc.token,visible:true,dead:false,conditions:[],wounds:[],equippedWeapon:templateNpc.equippedWeapon||'',loot:(templateNpc.loadout||[]).map(x=>({id:id(),templateId:x.templateId,quantity:x.quantity||1}))};}
let npcGearDraft=[];
function renderNpcGearDraft(){const root=$('npcGearDraft');root.replaceChildren();if(!npcGearDraft.length)root.append(el('p','hint','No additional equipment yet.'));
 for(let index=0;index<npcGearDraft.length;index++){const g=npcGearDraft[index],t=template(g.templateId),line=el('div','npc-gear-entry');line.append(el('span',null,(t?.name||'Unknown item')+' ×'+g.quantity),btn('Remove',()=>{npcGearDraft.splice(index,1);renderNpcGearDraft()}));root.append(line)}}
function equippedNpcWeapon(n){return template(n?.equippedWeapon)||template((n?.loadout||[]).find(g=>template(g.templateId)?.category==='Weapon')?.templateId)}
function npcWeaponStats(n){const w=equippedNpcWeapon(n);return {damage:w?.gurps?.damage||w?.damage||'1d-2 cr',shots:Math.max(1,Math.min(100,num(w?.gurps?.rof||w?.rof,1))),weapon:w}}
function updateNpcWeaponPreview(){const w=template($('npcEquippedWeapon').value),s=npcWeaponStats({equippedWeapon:w?.id});$('npcWeaponPreview').textContent=w?`${w.name} · Damage ${s.damage} · RoF ${s.shots} · ${w.gurps?.caliber||'Caliber unspecified'}`:'Unarmed. No weapon damage or RoF field is needed.'}
function npcCategoriesFor(type){return gmData.templateCategories[type]||[];}
function fillNPCFormCategories(type,selected=''){
 const picker=$('npcTemplateCategory');picker.replaceChildren(new Option('Uncategorized',''));
 for(const category of npcCategoriesFor(type))picker.append(new Option(category,category));
 picker.value=npcCategoriesFor(type).includes(selected)?selected:'';
}
function renderNPCCategoryFilter(){
 const filter=$('npcTemplateCategoryFilter'),previous=filter.value,type=$('npcTemplateTypeFilter').value;
 filter.replaceChildren(new Option('All categories','all'),new Option('Uncategorized',''));
 for(const category of [...new Set((type==='all'?Object.values(gmData.templateCategories).flat():npcCategoriesFor(type)))].sort())filter.append(new Option(category,category));
 filter.value=[...filter.options].some(option=>option.value===previous)?previous:'all';
}
$('npcTemplateTypeFilter').onchange=()=>{renderNPCCategoryFilter();renderGMNPCs()};
$('npcTemplateCategoryFilter').onchange=()=>renderGMNPCs();
$('npcForm').elements.namedItem('type').addEventListener('change',e=>fillNPCFormCategories(e.target.value));
$('npcAddCategory').onclick=()=>{const type=$('npcTemplateTypeFilter').value==='all'?'Human':$('npcTemplateTypeFilter').value;
 const raw=prompt('New '+(type==='Mutant'?'mutant':'NPC')+' template category:');if(raw===null)return;
 const category=raw.trim().slice(0,60);if(!category)return toast('Enter a category name');
 if(npcCategoriesFor(type).some(c=>c.toLowerCase()===category.toLowerCase()))return toast('Category already exists');
 npcCategoriesFor(type).push(category);gmSave('NPC category created',type+' / '+category);renderNPCCategoryFilter();$('npcTemplateCategoryFilter').value=category;renderGMNPCs();};
$('npcRenameCategory').onclick=()=>{const type=$('npcTemplateTypeFilter').value,old=$('npcTemplateCategoryFilter').value;
 if(type==='all'||!old)return toast('Select NPCs or Mutants and a category to rename.');
 const raw=prompt('Rename '+old+' to:',old);if(raw===null)return;const next=raw.trim().slice(0,60);
 if(!next||npcCategoriesFor(type).some(c=>c!==old&&c.toLowerCase()===next.toLowerCase()))return toast('Invalid or duplicate category');
 const list=npcCategoriesFor(type),idx=list.indexOf(old);if(idx<0)return toast('Category missing');list[idx]=next;
 for(const npc of gmData.npcs)if(npc.type===type&&npc.templateCategory===old)npc.templateCategory=next;
 gmSave('NPC category renamed',type+' / '+old+' → '+next);renderNPCCategoryFilter();$('npcTemplateCategoryFilter').value=next;renderGMNPCs();};
$('npcRemoveCategory').onclick=()=>{const type=$('npcTemplateTypeFilter').value,category=$('npcTemplateCategoryFilter').value;
 if(type==='all'||!category)return toast('Select a specific type and category to delete.');
 if(!confirm('Delete category "'+category+'"? Its templates will become Uncategorized; no NPCs will be deleted.'))return;
 gmData.templateCategories[type]=npcCategoriesFor(type).filter(c=>c!==category);
 for(const npc of gmData.npcs)if(npc.type===type&&npc.templateCategory===category)npc.templateCategory='';
 gmSave('NPC category deleted',type+' / '+category);renderNPCCategoryFilter();renderGMNPCs();};
function showNPCDialog(record){const f=$('npcForm');f.reset();const npc=record||npcTemplate({name:'',id:''});editingNpcId=record?.id||null;
 f.elements.namedItem('id').value=record?.id||'';f.elements.namedItem('name').value=record?.name||'';f.elements.namedItem('type').value=npc.type;
 f.elements.namedItem('faction').value=npc.faction;fillNPCFormCategories(npc.type,npc.templateCategory);for(const name of ['HP','ST','DX','IQ','HT','Dodge'])f.elements.namedItem(name).value=npc.stats[name];
 for(const name of ['dr','dt','skill','token','notes'])f.elements.namedItem(name).value=npc[name]??'';
 const weapons=state.catalog.filter(x=>x.category==='Weapon').sort((a,b)=>a.name.localeCompare(b.name));const picker=$('npcEquippedWeapon');picker.replaceChildren(new Option('Unarmed',''));for(const t of weapons)picker.append(new Option(t.name,t.id));picker.value=npc.equippedWeapon||'';
 const gear=$('npcGearTemplate');gear.replaceChildren(new Option('Choose gear from catalogue...',''));for(const t of [...state.catalog].sort((a,b)=>a.name.localeCompare(b.name)))gear.append(new Option(`${t.name} (${t.category})`,t.id));
 npcGearDraft=clone(npc.loadout||[]);renderNpcGearDraft();updateNpcWeaponPreview();
 $('npcDialogTitle').textContent=record?'Edit NPC Template':'Create NPC / Mutant';$('npcDialog').showModal();}
$('npcEquippedWeapon').addEventListener('change',updateNpcWeaponPreview);
$('npcGearAdd').onclick=()=>{const id=$('npcGearTemplate').value,quantity=Math.floor(num($('npcGearQuantity').value,1));if(!template(id)||quantity<1||quantity>10000)return toast('Select equipment and a valid quantity.');const existing=npcGearDraft.find(x=>x.templateId===id);if(existing)existing.quantity+=quantity;else npcGearDraft.push({templateId:id,quantity});renderNpcGearDraft();};
$('npcCreate').onclick=()=>showNPCDialog();
$('npcForm').onsubmit=e=>{e.preventDefault();const f=e.target,named=k=>f.elements.namedItem(k),raw={id:named('id').value||id(),name:named('name').value.trim(),type:named('type').value,templateCategory:named('templateCategory').value,faction:named('faction').value,dr:num(named('dr').value),dt:num(named('dt').value),skill:num(named('skill').value),equippedWeapon:named('equippedWeapon').value,token:named('token').value,notes:named('notes').value,loadout:clone(npcGearDraft),stats:{}};
 for(const name of ['HP','ST','DX','IQ','HT','Dodge'])raw.stats[name]=num(named(name).value,10);
 if(!raw.name)return toast('NPC needs a name');if(raw.equippedWeapon&&!raw.loadout.some(g=>g.templateId===raw.equippedWeapon))raw.loadout.unshift({templateId:raw.equippedWeapon,quantity:1});const npc=npcTemplate(raw),old=npcById(npc.id);const combat=npcWeaponStats(npc);npc.damage=combat.damage;npc.shots=combat.shots;
 if(old){npc.gcs=old.gcs;Object.assign(old,npc);}else gmData.npcs.push(npc);
 gmSave('NPC saved',npc.name);$('npcDialog').close();renderGM();};
for(const close of document.querySelectorAll('.close-dialog'))close.onclick=()=>$((close.dataset.close)).close();
function statFromGcs(obj,name,defaultValue){
 const attr=obj.attributes||{};
 const entries=Array.isArray(attr)?attr:Object.entries(attr).map(([id,v])=>({id,...(typeof v==='object'?v:{value:v})}));
 const match=entries.find(x=>String(x.id||x.name||'').toUpperCase()===name.toUpperCase());
 const raw=match?.calc?.value??match?.calc?.current??match?.value??match?.score??match?.base;
 return Number.isFinite(Number(raw))?Number(raw):defaultValue;
}
$('npcImport').onclick=()=>$('npcFileInput').click();
$('npcFileInput').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{
 const obj=JSON.parse(await file.text());const name=obj.profile?.name||obj.name||file.name.replace(/\.(gcs|json)$/i,'');
 const n=npcTemplate({name,stats:{HP:statFromGcs(obj,'HP',10),ST:statFromGcs(obj,'ST',10),DX:statFromGcs(obj,'DX',10),IQ:statFromGcs(obj,'IQ',10),HT:statFromGcs(obj,'HT',10),Dodge:statFromGcs(obj,'DODGE',8)},gcs:obj});
 gmData.npcs.push(n);gmSave('GCS NPC imported',name);renderGM();toast('Imported NPC: '+name);
 }catch(err){alert('GCS NPC import failed: '+err.message)}e.target.value=''};
$('npcSearch').oninput=()=>renderGMNPCs();
function randomNPCLoadout(npcId){const n=npcById(npcId);if(!n)return;const options=state.catalog.filter(t=>['Weapon','Magazine','Medical','Ammo','Armor','Helmet'].includes(t.category)&&normalizeTier(t.tier)<=2);
 if(!options.length){toast('Catalogue is empty.');return}
 const grouped={Weapon:[],Magazine:[],Medical:[],Ammo:[],Armor:[]};for(const t of options)if(grouped[t.category])grouped[t.category].push(t);
 const chosen=[];for(const cat of ['Weapon','Magazine','Medical','Ammo','Armor'])if(grouped[cat].length){const t=grouped[cat][Math.floor(Math.random()*grouped[cat].length)];chosen.push({templateId:t.id,quantity:cat==='Ammo'?Math.min(stackLimit(t),30):1})}
 n.loadout=chosen;gmSave('Random NPC loadout',n.name);renderGMNPCs();}
function renderGMNPCs(){const root=$('gmNpcList');if(!root)return;root.replaceChildren();const search=$('npcSearch').value.trim().toLowerCase();
 const typeFilter=$('npcTemplateTypeFilter').value,categoryFilter=$('npcTemplateCategoryFilter').value;
 const list=gmData.npcs.filter(n=>[n.name,n.type,n.faction,n.templateCategory].join(' ').toLowerCase().includes(search)&&(typeFilter==='all'||n.type===typeFilter)&&(categoryFilter==='all'||(n.templateCategory||'')===categoryFilter));
 for(const n of list){const card=el('article','gm-card');const title=el('h3',null,n.name);card.append(title,el('div','muted',`${n.type} · ${n.templateCategory||'Uncategorized'} · ${n.faction||'Unaligned'} · HP ${n.stats.HP} · DR ${n.dr} · Dodge ${n.stats.Dodge}`));
 const equipped=equippedNpcWeapon(n);card.append(el('div','muted',equipped?`Equipped: ${equipped.name} · ${npcWeaponStats(n).damage} · RoF ${npcWeaponStats(n).shots}`:'Equipped: Unarmed'));const tool=el('div','toolbar');tool.append(btn('Edit',()=>showNPCDialog(n)),btn('Duplicate',()=>{const copy=npcTemplate({...clone(n),id:id(),name:n.name+' Copy'});gmData.npcs.push(copy);gmSave('NPC duplicated',copy.name);renderGM()}),btn('Generate Loadout',()=>randomNPCLoadout(n.id)),btn('Assign Gear',()=>assignNpcGear(n.id)),btn('Hex PNG',()=>generateNPCToken(n)),btn('Delete',()=>{if(!confirm('Remove NPC template '+n.name+'? Encounter copies remain.'))return;gmData.npcs=gmData.npcs.filter(x=>x.id!==n.id);gmSave('NPC template deleted',n.name);renderGM()}));
 card.append(tool);if(n.loadout?.length)card.append(el('small','muted','Template gear: '+n.loadout.map(x=>(template(x.templateId)?.name||'Unknown')+' ×'+x.quantity).join(', ')));
 root.append(card)}if(!list.length)root.append(el('p','hint','No NPC templates yet. Create one or import a GCS character.'));
}
function chooseTemplateForGear(){const matches=state.catalog.filter(x=>['Weapon','Ammo','Magazine','Armor','Helmet','Medical','Backpack','Misc','Vest'].includes(x.category));
 const name=prompt('Type an item name or part of it:\n'+matches.slice(0,20).map(x=>x.name).join(', '),'');
 if(name===null)return null;const filtered=matches.filter(x=>x.name.toLowerCase().includes(name.trim().toLowerCase()));
 if(filtered.length!==1){alert(filtered.length?'Multiple matches. Be more specific:\n'+filtered.slice(0,15).map(x=>x.name).join('\n'):'Item not found.');return null}
 return filtered[0];}
function assignNpcGear(npcId){const n=npcById(npcId);if(!n)return;const t=chooseTemplateForGear();if(!t)return;const qty=Number(prompt('Quantity for '+t.name+'?', '1'));if(!Number.isInteger(qty)||qty<1||qty>10000)return toast('Invalid quantity');n.loadout.push({templateId:t.id,quantity:qty});gmSave('NPC loadout',n.name+' received '+qty+' '+t.name);renderGMNPCs();}


async function generateNPCToken(npc){
 const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='image/png,image/jpeg,image/webp';
 fileInput.onchange=async()=>{const file=fileInput.files?.[0];if(!file)return;try{
 const image=await createImageBitmap(file),cv=document.createElement('canvas');cv.width=cv.height=512;const c=cv.getContext('2d');
 const coords=Array.from({length:6},(_,i)=>{const t=(-90+i*60)*Math.PI/180;return [256+235*Math.cos(t),256+235*Math.sin(t)]});
 c.beginPath();coords.forEach(([x,y],j)=>j?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.save();c.clip();
 const scale=Math.max(512/image.width,512/image.height),w=image.width*scale,h=image.height*scale;
 c.drawImage(image,(512-w)/2,(512-h)/2,w,h);c.restore();c.lineWidth=22;c.strokeStyle='#0b1117';c.stroke();c.lineWidth=5;c.strokeStyle='#d0a869';c.stroke();
 c.fillStyle='rgba(8,14,20,.82)';c.fillRect(153,405,206,45);c.fillStyle='#e8f0f6';c.font='bold 18px Segoe UI';c.textAlign='center';c.fillText(npc.name.slice(0,22),256,433);
 cv.toBlob(blob=>{const href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=npc.name.replace(/[^a-z0-9_-]+/gi,'_')+'_hex.png';a.click();setTimeout(()=>URL.revokeObjectURL(href),5000)},'image/png');image.close?.();
 }catch(err){alert('Token creation failed: '+err.message)}};
 fileInput.click();
}

// Encounter templates are copied to individually tracked NPC actors when assigned.
function showEncounterEditor(record){editingEncounterId=record?.id||null;const f=$('encounterForm');f.reset();f.elements.id.value=record?.id||'';f.elements.namedItem('name').value=record?.name||'';f.elements.namedItem('location').value=record?.location||'';f.elements.notes.value=record?.notes||'';
 encounterDraft=record?clone(record.roster||[]):[];
 const sel=$('encounterNpcTemplate');sel.replaceChildren(new Option('Choose a template...',''));
 for(const n of gmData.npcs)sel.append(new Option(`${n.name} · HP ${n.stats.HP}`,n.id));
 renderEncounterDraft();$('encounterDialogTitle').textContent=record?'Edit Encounter':'Create Encounter';$('encounterDialog').showModal();}
$('encounterCreate').onclick=()=>showEncounterEditor();
$('encounterAddNPC').onclick=()=>{const npc=npcById($('encounterNpcTemplate').value),qty=num($('encounterNpcQuantity').value,1);if(!npc)return toast('Select an NPC template');if(qty<1||qty>30)return toast('Quantity must be 1–30');for(let j=0;j<qty;j++)encounterDraft.push(makeActor(npc));renderEncounterDraft()};
function renderEncounterDraft(){$('encounterRosterDraft').textContent=encounterDraft.length?encounterDraft.map(n=>n.name).join(' · '):'No NPCs assigned.'}
$('encounterForm').onsubmit=e=>{e.preventDefault();const f=e.target,old=gmData.encounters.find(x=>x.id===f.elements.id.value);
 const record={id:old?.id||id(),name:f.elements.namedItem('name').value.trim(),location:f.elements.namedItem('location').value,notes:f.elements.notes.value,roster:clone(encounterDraft),stashes:old?.stashes||[],createdAt:old?.createdAt||new Date().toISOString(),active:old?.active||false};
 if(!record.name)return toast('Enter encounter name');if(old)Object.assign(old,record);else gmData.encounters.push(record);
 gmSave('Encounter saved',record.name);$('encounterDialog').close();renderGM();};
function createStashDialog(encounterId){const f=$('stashForm');f.reset();f.elements.encounterId.value=encounterId;const sel=$('stashTemplate');sel.replaceChildren();
 for(const t of [...state.catalog].sort((a,b)=>normalizeTier(a.tier)-normalizeTier(b.tier)||a.name.localeCompare(b.name)))sel.append(new Option(`T${normalizeTier(t.tier)} · ${t.name}`,t.id));
 $('stashDialog').showModal();}
$('stashForm').onsubmit=e=>{e.preventDefault();const f=e.target,enc=gmData.encounters.find(x=>x.id===f.elements.encounterId.value),t=template(f.elements.templateId.value),quantity=num(f.elements.quantity.value,1);
 if(!enc||!t||!Number.isInteger(quantity)||quantity<1||quantity>10000)return toast('Invalid stash item');
 enc.stashes.push({id:id(),name:f.elements.namedItem('name').value.trim(),revealed:!f.elements.hidden.checked,items:[{id:id(),templateId:t.id,quantity}],createdAt:new Date().toISOString()});
 gmSave('Stash created',`${f.elements.namedItem('name').value} in ${enc.name}`);$('stashDialog').close();renderGM();renderEncounterLoot();};
function addToStash(encId,stashId){const enc=gmData.encounters.find(x=>x.id===encId),stash=enc?.stashes.find(x=>x.id===stashId),t=chooseTemplateForGear();if(!stash||!t)return;
 const quantity=num(prompt('Quantity?',1),0);if(!Number.isInteger(quantity)||quantity<1||quantity>10000)return;
 stash.items.push({id:id(),templateId:t.id,quantity});gmSave('Stash replenished',`${stash.name}: ${t.name} ×${quantity}`);renderGM();renderEncounterLoot();}
function makeCheckpoint(reason){const snapshot={gm:clone(gmData),player:clone(state)};delete snapshot.gm.checkpoints;
 gmData.checkpoints.push({id:id(),when:new Date().toISOString(),reason,data:snapshot});gmData.checkpoints=gmData.checkpoints.slice(-6);gmSave('Checkpoint',reason);return gmData.checkpoints.at(-1)}
function restoreCheckpoint(){const choices=gmData.checkpoints;if(!choices.length)return toast('No checkpoints. Create one first.');const last=choices.at(-1);if(!confirm(`Restore checkpoint from ${new Date(last.when).toLocaleString()}? Current encounter and player character changes will be replaced.`))return;
 const preserved=gmData.checkpoints;gmData=clone(last.data.gm);gmData.checkpoints=preserved;state=clone(last.data.player);save();gmSave('Checkpoint restored',last.reason);renderCharacter();render();}
$('encounterCheckpoint').onclick=()=>{makeCheckpoint('Manual encounter snapshot');toast('Checkpoint saved')};$('encounterRollback').onclick=restoreCheckpoint;
function revealNPC(encId,actorId){const enc=gmData.encounters.find(x=>x.id===encId),actor=enc?.roster.find(x=>x.id===actorId);if(!actor)return;actor.visible=!actor.visible;gmSave('NPC visibility',actor.name+' visible: '+actor.visible);renderGM();renderEncounterTargets();}
function activateEncounter(encId){gmData.activeEncounter=gmData.activeEncounter===encId?null:encId;activeTargetId=null;window.__selectedNpcAttacker=null;gmSave('Active encounter',gmData.encounters.find(x=>x.id===encId)?.name||'No encounter');renderGM();renderEncounterTargets();renderEncounterLoot();}
function spawnStash(encId,name){createStashDialog(encId);}
function renderGMEncounters(){const root=$('gmEncounters');root.replaceChildren();for(const enc of gmData.encounters){const active=gmData.activeEncounter===enc.id;const block=el('section','panel encounter-card');block.append(el('h2',null,`${enc.name}${active?' · ACTIVE':''}`),el('p','muted',`${enc.location||'Unspecified location'} · ${enc.roster.length} NPCs · ${enc.stashes.length} stashes`));
 const details=el('div','encounter-quick-edit');const encounterName=el('input'),encounterLocation=el('input');encounterName.value=enc.name;encounterName.placeholder='Encounter name';encounterName.setAttribute('aria-label','Encounter name');encounterLocation.value=enc.location||'';encounterLocation.placeholder='Location';encounterLocation.setAttribute('aria-label','Encounter location');details.append(encounterName,encounterLocation,btn('Save Name / Location',()=>{const nextName=encounterName.value.trim();if(!nextName)return toast('Encounter name cannot be blank');enc.name=nextName.slice(0,100);enc.location=encounterLocation.value.trim();gmSave('Encounter details updated',enc.name+' · '+enc.location);renderGM();toast('Encounter details saved')}));block.append(details);
 const controls=el('div','toolbar');controls.append(btn(active?'End Encounter':'Activate Encounter',()=>activateEncounter(enc.id)),btn('Edit',()=>showEncounterEditor(enc)),btn('+ Stash',()=>spawnStash(enc.id)),btn('Delete',()=>{if(!confirm('Delete encounter '+enc.name+'?'))return;if(active)gmData.activeEncounter=null;gmData.encounters=gmData.encounters.filter(e=>e.id!==enc.id);gmSave('Encounter deleted',enc.name);renderGM()}));block.append(controls);
 const actors=el('div','gm-actor-list');for(const actor of enc.roster){const r=el('div','gm-actor');r.dataset.actorId=actor.id;r.append(el('span','',`${actor.name} · HP ${actor.hp}/${actor.maxHP} · ${shortStatus(actor.hp,actor.maxHP)}${actor.dead?' · DEAD':''}`));const actions=el('div','toolbar');
 actions.append(btn('Target NPC',()=>{if(!active){activateEncounter(enc.id)}if(!actor.visible){actor.visible=true;gmSave('NPC revealed for targeting',actor.name)}selectActor(actor.id);setMode('player',false);showPage('combat');}),btn('NPC Attacks Player',()=>{if(!active)activateEncounter(enc.id);if(!actor.visible)actor.visible=true;renderGMCombatants();$('gmAttackingNpc').value=actor.id;setMode('gm',false);showPage('gmcombat');toast('Choose a player target and click Use selected NPC and player.')}),btn('Copy NPC ID',()=>{if(navigator.clipboard?.writeText)navigator.clipboard.writeText(actor.id).then(()=>toast('Copied '+actor.id)).catch(()=>prompt('NPC encounter ID',actor.id));else prompt('NPC encounter ID',actor.id)}),btn(actor.visible?'Hide':'Reveal',()=>revealNPC(enc.id,actor.id)),btn('HP ±',()=>{const amount=num(prompt('HP change (negative for damage, positive for healing)',0),0);actor.hp=Math.min(actor.maxHP,actor.hp+amount);actor.dead=actor.hp<=-5*actor.maxHP;gmSave('NPC HP override',actor.name+': '+amount);renderGM();renderEncounterTargets();renderEncounterLoot()}),btn('Add Loot',()=>{const t=chooseTemplateForGear();if(!t)return;actor.loot.push({id:id(),templateId:t.id,quantity:1});gmSave('NPC loot added',actor.name+': '+t.name);renderGM();renderEncounterLoot()}));
 r.append(actions);actors.append(r)}block.append(actors);
 for(const stash of enc.stashes){const r=el('div','gm-actor');r.append(el('span','',`Stash: ${stash.name} · ${stash.items.length} item entries · ${stash.revealed?'Revealed':'Hidden'}`));const actions=el('div','toolbar');actions.append(btn(stash.revealed?'Hide':'Reveal',()=>{stash.revealed=!stash.revealed;gmSave('Stash visibility',stash.name);renderGM();renderEncounterLoot()}),btn('Add Item',()=>addToStash(enc.id,stash.id)));r.append(actions);block.append(r)}
 root.append(block)}if(!root.children.length)root.append(el('p','hint','No prepared encounters. Create one using NPC templates.'));
}
function visibleTargets(){const enc=encounter();return enc?enc.roster.filter(x=>x.visible):[]}
function findActor(actorId){return encounter()?.roster.find(x=>x.id===actorId)}
function selectActor(actorId){const n=findActor(actorId);if(!n)return;
 activeTargetId=actorId;state.targetHP=n.hp;state.targetMaxHP=n.maxHP;
 $('targetHP').value=String(n.hp);$('targetMaxHP').value=String(n.maxHP);$('targetDR').value=String(n.dr);$('targetDT').value=String(n.dt||0);
 $('combatTargetHT').value=String(n.ht);
 const c=advCombat();c.target={...c.target,wounds:clone(n.wounds),stunned:(n.conditions||[]).includes('Stunned'),dead:n.dead||n.hp<=-5*n.maxHP};
 $('targetDodge').value=String(n.dodge);
 save();renderEncounterTargets();advRenderTarget();toast('Target selected: '+n.name);
}
function renderEncounterTargets(){const root=$('encounterTargets');if(!root)return;root.replaceChildren();const list=visibleTargets();
 for(const n of list){const b=btn(`${n.name}\nHP ${n.hp}/${n.maxHP} · DR ${n.dr}`,()=>selectActor(n.id),'npc-target');if(n.id===activeTargetId)b.classList.add('selected');if(n.hp<=-5*n.maxHP)b.disabled=true;root.append(b)}
 if(!list.length)root.append(el('span','hint','No NPC targets visible. The GM can activate an encounter and reveal NPCs.'));$('selectedEncounterTarget').textContent=activeTargetId&&findActor(activeTargetId)?'Selected target: '+findActor(activeTargetId).name:'Select an NPC target above before attacking.';
}
function actorAsLootStash(actor){return {id:actor.id,name:actor.name+' (corpse)',items:actor.loot,revealed:true,actor:true};}
function visibleStashes(){const enc=encounter();if(!enc)return [];const stashes=enc.stashes.filter(x=>x.revealed);
 for(const actor of enc.roster)if(actor.visible&&(actor.dead||actor.hp<=0))stashes.push(actorAsLootStash(actor));return stashes;
}
function lootOne(stashId,itemId){const enc=encounter(),stash=visibleStashes().find(x=>x.id===stashId),entry=stash?.items.find(x=>x.id===itemId);
 if(!enc||!stash||!entry)return toast('Loot no longer available.');if(network&&networkRole==='player'){const t=template(entry.templateId);network.send(JSON.stringify({type:'takeLoot',stashId,itemId,quantity:Math.min(entry.quantity,stackLimit(t||{}))}));return}
 const t=template(entry.templateId);if(!t)return toast('This loot item is not in the local catalogue.');
 const quantity=Math.min(stackLimit(t),entry.quantity),copyItem={...clone(t),id:id(),templateId:t.id,quantity,location:'loose',rotated:false,x:0,y:0};
 state.items.push(copyItem);placeAutomatically(copyItem);entry.quantity-=quantity;if(entry.quantity<=0)stash.items.splice(stash.items.indexOf(entry),1);
 gmSave('Loot taken',`${t.name} ×${quantity} from ${stash.name}`);save();render();toast('Collected '+quantity+' × '+t.name);
}
function lootAll(stashId){const stash=visibleStashes().find(x=>x.id===stashId);if(!stash)return;let moved=0;
 for(const entry of [...stash.items]){const t=template(entry.templateId);if(!t)continue;
 if(network&&networkRole==='player')return toast('Select individual stacks when connected; server validates each transfer.');
 while(entry.quantity>0){const qty=Math.min(stackLimit(t),entry.quantity),newItem={...clone(t),id:id(),templateId:t.id,quantity:qty,location:'loose',rotated:false,x:0,y:0};
  // Do not pull items into Loose Loot unless they actually fit in carried storage.
  state.items.push(newItem);if(!placeAutomatically(newItem)){state.items.pop();break}entry.quantity-=qty;moved+=qty}
 if(entry.quantity===0)stash.items.splice(stash.items.indexOf(entry),1);
 }
 if(moved){gmSave('Loot all',`${moved} units from ${stash.name}`);save();render()}toast(moved?`Transferred ${moved} items. Remaining loot stays in stash.`:'No available storage; stash unchanged.');
}
function renderEncounterLoot(){const root=$('encounterLoot');if(!root)return;root.replaceChildren();for(const stash of visibleStashes()){
 const card=el('div','encounter-stash');const h=el('div','stash-head');h.append(el('strong',null,stash.name),btn('Loot All (fit only)',()=>lootAll(stash.id)));card.append(h);
 for(const entry of stash.items){const itemTemplate=template(entry.templateId);const line=el('div','stash-entry');line.append(el('span',null,(itemTemplate?.name||'Unknown item')+' ×'+entry.quantity),btn('Take Stack',()=>lootOne(stash.id,entry.id)));card.append(line)}
 if(!stash.items.length)card.append(el('p','hint','Empty'));root.append(card)}
 if(!root.children.length)root.append(el('p','hint','No revealed loot. Stashes and NPC belongings become available when the GM reveals them.'));
}
// Bind combat resolution to the selected persistent NPC rather than anonymous target only.
const originalAdvancedAttack=advAttack;
advAttack=function(){
 const actor=activeTargetId?findActor(activeTargetId):null;
 const previous=state.combatReview?.[0]?.id;
 if(actor){
  if(actor.dead)return toast('Cannot attack dead NPC.');
  const c=advCombat();
  if(viewMode==='gm'&&c.actor!=='Player'){c.actor='Player';c.actedThisTurn=false;}
  if(!c.actedThisTurn)makeCheckpoint('Before attack on '+actor.name);
  $('targetHP').value=String(actor.hp);$('targetMaxHP').value=String(actor.maxHP);
  $('combatTargetHT').value=String(actor.ht);$('targetDR').value=String(actor.dr);$('targetDT').value=String(actor.dt||0);
  $('targetDodge').value=String(actor.dodge);
 }
 originalAdvancedAttack();
 if(actor){
  const entry=state.combatReview?.[0];
  if(entry&&entry.id!==previous&&entry.status==='Calculated'&&entry.kind==='player'){
   entry.targetId=actor.id;entry.target=actor.name;entry.targetName=actor.name;
   save();gmSave('Pending player attack',actor.name+' · '+entry.injury+' calculated injury. HP unchanged.');
  }
  // No NPC HP or wounds are changed until GM explicitly applies the pending result.
  renderEncounterTargets();
 }
};
function renderGMPlayers(){const root=$('gmPlayerList');root.replaceChildren();const all=[];
 for(const profile of profileRecords){let d=null;try{d=profile.id===activeProfile?state:JSON.parse(localStorage.getItem(profileStorageKey(profile.id))||'null')}catch{}if(d)all.push({id:profile.id,name:profile.name,data:d,local:true})}
 for(const [uid,rec] of Object.entries(gmData.players))all.push({id:uid,name:rec.name||uid,data:rec.character||null,local:false});
 for(const p of all){const card=el('article','gm-card');const hp=p.data?.conditions?.Health??'?',max=p.data?.stats?.HP??'?';card.append(el('h3',null,p.name),el('p','muted',`HP ${hp}/${max} · Items ${p.data?.items?.length||0} · ${p.local?'Local profile':'Connected player'}`));
 const tools=el('div','toolbar');if(p.local)tools.append(btn('Open Character',()=>{selectProfile(p.id);setMode('player');showPage('character')}));
 tools.append(btn('Adjust HP',()=>{const amount=prompt('HP change, signed (+heal, -damage):',0);if(amount===null)return;const delta=Number(amount);if(!Number.isFinite(delta)||!p.data)return toast('Invalid change');p.data.conditions.Health=Math.min(num(p.data.stats.HP,10),num(p.data.conditions.Health,10)+delta);
 if(p.local){if(p.id===activeProfile){save();renderCharacter();renderStatus()}else localStorage.setItem(profileStorageKey(p.id),JSON.stringify(p.data))}
 else {gmData.players[p.id].character=p.data;gmSave('GM player HP',p.name+' '+delta);if(network?.readyState===1&&networkRole==='gm')network.send(JSON.stringify({type:'gmCharacterUpdate',playerId:p.id,character:p.data}))}renderGMPlayers() }));
 card.append(tools);root.append(card)}if(!all.length)root.append(el('p','hint','No player profiles recorded.'));
}
function renderDashboard(){const root=$('gmDashboard');root.replaceChildren();const enc=encounter(),summary=[['Active encounter',enc?.name||'None'],['Player profiles',profileRecords.length+Object.keys(gmData.players).length],['NPC templates',gmData.npcs.length],['Prepared encounters',gmData.encounters.length],['Visible encounter targets',visibleTargets().length],['Revealed loot containers',visibleStashes().length]];
 for(const [name,value] of summary){const card=el('div','gm-card dash-stat');card.append(el('small','muted',name),el('strong',null,value));root.append(card)}
 const logCard=el('section','gm-card full-span');logCard.append(el('h3',null,'Recent GM Events'));for(const entry of gmData.history.slice(0,20))logCard.append(el('p','muted',`${new Date(entry.when).toLocaleString()} · ${entry.kind}: ${entry.details}`));root.append(logCard);
}
function renderGMHistory(){const root=$('gmHistory');root.replaceChildren();for(const event of gmData.history.slice(0,35))root.append(el('div','gm-history-line',`${new Date(event.when).toLocaleTimeString()} · ${event.kind} — ${event.details}`));if(!gmData.history.length)root.textContent='No GM activity recorded yet.'}
function renderGM(){renderGMNPCs();renderGMEncounters();renderGMPlayers();renderDashboard();renderGMHistory();renderGMCombatants();}
// ---- Campaign, environmental status, backups and persistent GM history ----
function refreshCampaignFields(){const c=gmData.campaign||{};for(const key of ['name','date','location','notes']){const field=$('campaign'+key.charAt(0).toUpperCase()+key.slice(1));if(field&&document.activeElement!==field)field.value=c[key]||''}if(document.activeElement!==$('zoneNotes'))$('zoneNotes').value=gmData.zoneNotes||''}
$('saveCampaign').onclick=()=>{gmData.campaign={name:$('campaignName').value,date:$('campaignDate').value,location:$('campaignLocation').value,notes:$('campaignNotes').value};gmSave('Campaign saved',gmData.campaign.name);toast('Campaign saved')};
$('saveZoneNotes').onclick=()=>{gmData.zoneNotes=$('zoneNotes').value;gmSave('Zone notes saved');toast('Zone notes saved')};
$('applyZone').onclick=()=>{const radiation=num($('zoneRadiation').value),damage=Math.max(0,num($('zoneDamage').value));const flag=$('zoneCondition').value.trim();state.conditions.Radiation=Math.max(0,num(state.conditions.Radiation)+radiation);state.conditions.Health=num(state.conditions.Health,num(state.stats.HP,10))-damage;
 if(flag){state.statusFlags=state.statusFlags||{};state.statusFlags[flag]=true}save();renderCharacter();renderStatus();gmSave('Environmental effect',`Radiation ${radiation}, HP -${damage}, flag ${flag||'none'}`);toast('Environmental effects applied')};
$('exportCampaign').onclick=()=>download('stalker-gm-campaign.json',JSON.stringify(gmData,null,2));
$('importCampaign').onclick=()=>$('gmCampaignFile').click();
$('gmCampaignFile').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{const obj=JSON.parse(await file.text());if(!Array.isArray(obj.npcs)||!Array.isArray(obj.encounters))throw Error('Not a GM campaign save');if(!confirm('Replace the current GM campaign with the imported one?'))return;
 gmData={...emptyGM(),...obj};gmSave('GM campaign imported',file.name);refreshCampaignFields();renderGM();renderEncounterTargets();renderEncounterLoot();toast('Imported GM campaign');
 }catch(err){alert('Import failed: '+err.message)}e.target.value='';};
$('imageLibraryInfo').onclick=()=>showInfo('IMAGE LIBRARY','Use PNG, JPEG or WebP from any folder. New files are cropped to content and scaled without stretching. In the browser they are stored separately in IndexedDB; in desktop mode they are copied into the app data directory. Existing images in images/ remain supported. Large item libraries should use the desktop version.');

// GM targeting uses the active encounter NPC's equipped weapon and a real local character profile.
function renderGMCombatants(){const a=$('gmAttackingNpc'),p=$('gmTargetPlayer');if(!a||!p)return;
 const ai=a.value,pi=p.value;a.replaceChildren(new Option('Select encounter NPC',''));for(const npc of visibleTargets())a.append(new Option(`${npc.name} · HP ${npc.hp}/${npc.maxHP}`,npc.id));if([...a.options].some(x=>x.value===ai))a.value=ai;
 p.replaceChildren(new Option('Select player character',''));for(const pr of profileRecords)p.append(new Option(pr.name,pr.id));if(!profileRecords.some(pr=>pr.id===activeProfile))p.append(new Option('Current character',activeProfile));if([...p.options].some(x=>x.value===pi&&pi))p.value=pi;else p.value=activeProfile;}
$('gmLoadCombatants').onclick=()=>{const actor=findActor($('gmAttackingNpc').value),playerId=$('gmTargetPlayer').value;
 if(!actor)return toast('Select an NPC from an active encounter first.');if(!playerId)return toast('Select a player character.');
 if(playerId!==activeProfile)selectProfile(playerId);
 const s=npcWeaponStats(actor);$('npcAttackSkill').value=actor.skill||12;$('npcAttackDamage').value=s.weapon?s.damage:actor.damage||s.damage;
 $('npcShots').value=s.weapon?s.shots:actor.shots||1;
 window.__selectedNpcAttacker=actor.id;window.__selectedPlayerTarget=playerId;
 setMode('gm',false);showPage('gmcombat');toast(`${actor.name} targeting ${profileRecords.find(x=>x.id===playerId)?.name||'player'}.`);};
// Avoid out-of-context NPC attack rolls: GM explicitly loads the combatants first.
// Build 4.3 GM resolver validates NPC and player directly; legacy preflight removed.

const oldRenderEncounterTargets=renderEncounterTargets;
renderEncounterTargets=function(){oldRenderEncounterTargets();if(viewMode==='gm')renderGMCombatants()};
// Use the equipped weapon's current catalogue statistics when an NPC actor attacks.
function npcActorForAttack(){return window.__selectedNpcAttacker?findActor(window.__selectedNpcAttacker):null}
function syncNpcAttackStats(){const a=npcActorForAttack();if(!a)return;const w=npcWeaponStats(a);if(w.weapon){$('npcAttackDamage').value=w.damage;$('npcShots').value=w.shots;}else{$('npcAttackDamage').value=a.damage||w.damage;$('npcShots').value=a.shots||1;} }
$('gmAttackingNpc').addEventListener('change',()=>{const n=findActor($('gmAttackingNpc').value);if(n){const s=npcWeaponStats(n);$('npcAttackSkill').value=n.skill;$('npcAttackDamage').value=s.damage;$('npcShots').value=s.shots;}});
// Character actions use native HTML dialogs rather than window.prompt/confirm (unsupported in some desktop hosts).
const profileDialog=$('profileDialog'),nameInput=$('profileNameInput');let profileDialogAction='new';
$('profileNew').addEventListener('click',e=>{e.stopImmediatePropagation();profileDialogAction='new';$('profileDialogTitle').textContent='Create Character';$('profileDialogDescription').textContent='Creates a new, separate character profile.';nameInput.value='New Stalker';profileDialog.showModal();nameInput.focus();nameInput.select()},true);
$('profileRename').addEventListener('click',e=>{e.stopImmediatePropagation();profileDialogAction='rename';$('profileDialogTitle').textContent='Rename Character';$('profileDialogDescription').textContent='The character and their saves will be retained.';nameInput.value=profileRecords.find(x=>x.id===activeProfile)?.name||'';profileDialog.showModal();nameInput.focus();nameInput.select()},true);
$('profileDialogCancel').onclick=()=>profileDialog.close();
$('profileDialogForm').onsubmit=e=>{e.preventDefault();const name=nameInput.value.trim().slice(0,70);if(!name)return;profileDialog.close();
 if(profileDialogAction==='new'){save();const newId=id();profileRecords.push({id:newId,name});activeProfile=newId;saveProfileIndex();localStorage.removeItem(KEY);load();state.identity.Name=name;save();startUndoHistory();selected=null;renderCharacter();render();renderProfiles();toast('Created '+name)}
 else{const p=profileRecords.find(x=>x.id===activeProfile);if(p){p.name=name;state.identity.Name=name;saveProfileIndex();save();renderCharacter();renderProfiles();toast('Renamed to '+name)}}};
$('profileDelete').addEventListener('click',e=>{e.stopImmediatePropagation();const p=profileRecords.find(x=>x.id===activeProfile);$('profileDeleteDescription').textContent=profileRecords.length===1?`Reset ${p?.name||'this character'} to a new blank character? At least one active profile is required.`:`Delete ${p?.name||'this character'}?`; $('profileDeleteDialog').showModal()},true);
$('profileDeleteCancel').onclick=()=>$('profileDeleteDialog').close();
$('profileDeleteConfirm').onclick=()=>{const deleted=activeProfile;localStorage.removeItem(profileStorageKey(deleted));localStorage.removeItem(profileBackupsKey(deleted));profileRecords=profileRecords.filter(x=>x.id!==deleted);if(!profileRecords.length)profileRecords=[{id:'main',name:'New Character'}];activeProfile=profileRecords[0].id;saveProfileIndex();const raw=localStorage.getItem(profileStorageKey(activeProfile));if(raw)localStorage.setItem(KEY,raw);else localStorage.removeItem(KEY);load();selected=null;startUndoHistory();renderCharacter();render();renderProfiles();$('profileDeleteDialog').close();toast('Character deleted')};
// Right-click loading is kept adjacent to the actual physical magazine.
function loadWeaponViaContext(weaponId){const w=byId(weaponId);if(!w)return;
 const mag=weaponMagazine(w);if(mag){loadMagazine(mag.id);return;}
 if(w.integralFeed){toast('This firearm uses a fixed magazine: select its built-in magazine under Ammunition & Magazines.');$('ammoWorkbench').open=true;renderAmmo();return;}
 insertMagazine(w.id);
}
const lastItemContext=openItemContext;
openItemContext=function(e,itemId){lastItemContext(e,itemId);const item=byId(itemId),menu=$('itemContextMenu');if(!item)return;
 if(item.category==='Weapon')menu.append(btn('Load magazine / ammo',()=>{menu.hidden=true;loadWeaponViaContext(item.id)}));
 if(item.category==='Magazine')menu.append(btn('Load mag',()=>{menu.hidden=true;loadMagazine(item.id)}));
};

// Ammo inventory is physical and stays linked to real weapon/magazine instances.
// Fix short bursts without permitting a player to fire more rounds than exist.
const originalAdvModifiers=advModifiers;
advModifiers=function(weapon){const r=originalAdvModifiers(weapon);if(weapon){const available=roundsInWeapon(weapon);r.shots=Math.max(0,Math.min(r.shots,available));}return r};
// Keep advanced action cards readable and log simple snapshots for GM correction.
const resultBox=$('combatResult'),card=el('div','combat-result-card');resultBox.insertAdjacentElement('afterend',card);
const resultObserver=new MutationObserver(()=>{const text=(resultBox.textContent||'').trim();if(text){const lines=text.split(/\n/);card.replaceChildren();card.append(el('strong',null,lines[0]||'Combat result'));for(const line of lines.slice(1,8))card.append(el('p',null,line));}});
resultObserver.observe(resultBox,{childList:true,characterData:true,subtree:true});

// TTS token integration: a token with a matching NPC identifier can select a live target.
window.stalkerTTSSelectNPC=actorId=>{if(!findActor(actorId))return false;selectActor(actorId);setMode('player');showPage('combat');return true};

// ---- Optional GM-hosted LAN/Radmin VPN multiplayer ----
const status=s=>{$('networkStatus').textContent=s};
const desktop=!!window.stalkerDesktop;
$('desktopStatus').textContent=desktop?'Windows desktop shell detected. Assets, server hosting and campaign files are available through the app.':'Browser preview: offline features work, but hosting requires the Electron desktop shell.';
const oldSave=save;
save=function(...args){oldSave(...args);scheduleNativeSave();if(network?.readyState===1&&networkRole==='player'){
 clearTimeout(networkSyncPending);networkSyncPending=setTimeout(()=>{if(network?.readyState===1)network.send(JSON.stringify({type:'characterUpdate',character:state}))},180)
 }};
function networkPublicEncounter(x){const out=x?.encounter;if(!out)return null;return {id:out.id,name:out.name,location:out.location,roster:out.roster||[],stashes:out.stashes||[]};}
function connectNetwork(host,port,role,password,playerId,hostSecret=''){
 if(network){try{network.close()}catch{}}
 const ip=String(host||'').trim();gmNetworkInitialized=false;if(!/^[\w.:-]+$/.test(ip))return status('Invalid host address.');
 let ws;try{ws=new WebSocket(`ws://${ip}:${port}`)}catch(e){return status('Connection failed: '+e.message)}network=ws;networkRole=role;status('Connecting to '+ip+':'+port+'…');
 ws.onopen=()=>ws.send(JSON.stringify({type:'hello',role,playerId,password,hostSecret,name:state.identity.Name||playerId}));
 ws.onerror=()=>status('Connection error. Check Radmin VPN, IP, and Windows Firewall.');
 ws.onclose=()=>{network=null;networkRole=null;status('Disconnected')};
 ws.onmessage=e=>{let msg;try{msg=JSON.parse(e.data)}catch{return}
  if(msg.type==='error'){status('Server: '+msg.message);return}
  if(msg.type==='welcome'){status(`Connected as ${role.toUpperCase()} · Session ${msg.sessionName||'S.T.A.L.K.E.R.'}`);
   if(role!=='gm'){if(!msg.hasSavedCharacter)ws.send(JSON.stringify({type:'characterUpdate',character:state}));else status('Connected. Restoring your saved character from the host.')}return}
  if(msg.type==='publicUpdate'&&role==='player'){remotePublic=msg;
   if(Array.isArray(msg.catalog))for(const t of msg.catalog){if(!state.catalog.some(x=>x.id===t.id))state.catalog.push(t)}const encounterView=networkPublicEncounter(msg);
   gmData.encounters=encounterView?[encounterView]:[];gmData.activeEncounter=encounterView?.id||null;
   if(uxRemoteTargetStats){const actor=findActor(uxRemoteTargetStats.id);if(actor)Object.assign(actor,{dr:uxRemoteTargetStats.dr,ht:uxRemoteTargetStats.ht,dodge:uxRemoteTargetStats.dodge})}renderEncounterTargets();uxAssignedTargetText();renderEncounterLoot();return}
  if(msg.type==='targetAssignment'&&role==='player'){uxReceiveAssignment(msg);return}
  if(msg.type==='selfCharacter'&&role==='player'&&msg.character){state=msg.character;oldSave();renderCharacter();render();toast('Character synchronized from GM server');return}
  if(msg.type==='gmSnapshot'&&role==='gm'&&msg.campaign){
   const incoming=msg.campaign;
   if(!gmNetworkInitialized){
    gmNetworkInitialized=true;
    const serverHasData=Boolean(incoming.npcs?.length||incoming.encounters?.length||incoming.history?.length||incoming.activeEncounter);
    const localHasData=Boolean(gmData.npcs.length||gmData.encounters.length||gmData.history.length||gmData.activeEncounter);
    if(!serverHasData&&localHasData){gmData.catalog=clone(state.catalog);ws.send(JSON.stringify({type:'gmUpdate',data:gmData}));status('Connected. Local GM campaign initialized the new server.');return;}
    if(serverHasData&&localHasData&&JSON.stringify(incoming.encounters)!==JSON.stringify(gmData.encounters)){
     if(!confirm('Saved server campaign differs from the local campaign. OK loads the server campaign; Cancel uploads the local campaign. Keep an exported backup of both.')){
      gmData.catalog=clone(state.catalog);ws.send(JSON.stringify({type:'gmUpdate',data:gmData}));status('Connected. Local GM campaign uploaded.');return;
     }
    }
   }
   gmData={...emptyGM(),...incoming};localStorage.setItem(GM_KEY,JSON.stringify(gmData));renderGM();renderEncounterLoot();renderEncounterTargets();return}
  if(msg.type==='playerSnapshot'&&role==='gm'){gmData.players[msg.playerId]={name:msg.name,character:msg.character};localStorage.setItem(GM_KEY,JSON.stringify(gmData));renderGMPlayers();renderDashboard();return}
  if(msg.type==='ttsTarget'){if(msg.actorId)window.stalkerTTSSelectNPC(msg.actorId);return}
  if(msg.type==='lootFailed')toast('Loot transfer refused: '+msg.reason);
 };
}
$('networkStart').onclick=async()=>{if(!desktop)return status('Host Session requires the desktop build.');try{
 const port=num($('networkPort').value,7788),password=$('networkPassword').value;if(password.length<8)return status('Use a session password with at least 8 characters.');
 const result=await window.stalkerDesktop.startServer({port,password,campaignName:gmData.campaign.name});
 if(result.error)return status('Host failed: '+result.error);
 $('networkHost').value='127.0.0.1';connectNetwork('127.0.0.1',port,'gm',password,'gm',result.hostSecret);
 }catch(e){status('Host error: '+e.message)}};
$('networkJoin').onclick=()=>{const host=$('networkHost').value,port=num($('networkPort').value,7788),password=$('networkPassword').value,playerId=$('networkPlayerId').value.trim()||state.identity.Name||id().slice(0,8);
 if(!password)return status('Session password required.');connectNetwork(host,port,'player',password,playerId);setMode('player')};
$('networkLeave').onclick=async()=>{try{network?.close();if(networkRole==='gm'&&desktop)await window.stalkerDesktop.stopServer()}catch{}network=null;networkRole=null;status('Offline')};


// Desktop storage: localStorage remains a fast working cache, disk JSON is the durable source.
let nativeSaveTimer=null;
function nativeStorageMap(){const keys={};for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key&&key.startsWith('stalker-'))keys[key]=localStorage.getItem(key)}return {version:4,keys}}
function scheduleNativeSave(){if(!window.stalkerDesktop?.writeSavedData)return;clearTimeout(nativeSaveTimer);
 nativeSaveTimer=setTimeout(async()=>{try{await window.stalkerDesktop.writeSavedData(nativeStorageMap())}catch(err){toast('Disk save error: '+err.message)}},700)}
async function restoreNativeSave(){if(!window.stalkerDesktop?.readSavedData)return;try{
 const doc=await window.stalkerDesktop.readSavedData();if(!doc?.keys){scheduleNativeSave();return}
 for(const [key,value] of Object.entries(doc.keys))if(key.startsWith('stalker-')&&typeof value==='string')localStorage.setItem(key,value);
 setupProfileIndex();load();startUndoHistory();renderCharacter();render();
 try{gmData={...emptyGM(),...JSON.parse(localStorage.getItem(GM_KEY)||'{}')} }catch{}
 for(const k of ['npcs','encounters','history','checkpoints'])if(!Array.isArray(gmData[k]))gmData[k]=[];
 refreshCampaignFields();renderGM();renderEncounterTargets();renderEncounterLoot();toast('Restored desktop campaign data.');
 }catch(err){toast('Desktop save restore failed: '+err.message)} }

// --- Build 4.3: contextual inventory, NPC control and usability ---
// All physical ammo updates use the same saved item instances as combat.
function uxStatus(message,ok=true){
 toast(message);const area=$('uxFeedback');if(!area)return;
 area.textContent=message;area.dataset.kind=ok?'ok':'error';area.hidden=false;
 clearTimeout(uxStatus.timer);uxStatus.timer=setTimeout(()=>area.hidden=true,4000);
}
const uxOldRenderSlots=renderSlots,uxOldRenderStorage=renderStorage,uxOldRenderLoose=renderLoose;
function uxDecorateQuantities(root){
 if(!root)return;
 for(const tile of root.querySelectorAll('[data-item-id]')){
  const item=byId(tile.dataset.itemId);if(!item)continue;
  let badge=tile.querySelector(':scope > .ux-ammo-badge');
  if(item.category!=='Ammo') {badge?.remove();continue}
  if(!badge){badge=document.createElement('span');badge.className='ux-ammo-badge';badge.setAttribute('aria-label','Ammunition quantity');tile.append(badge)}
  const n=itemQuantity(item);badge.textContent=n>9999?'9999+':String(n);badge.title=`${n} rounds of ${item.name}`;
 }
}
renderSlots=function(...args){const ret=uxOldRenderSlots(...args);for(const root of ['gear','pockets','hands','weapons'])uxDecorateQuantities($(root));return ret};
renderStorage=function(slot){const ret=uxOldRenderStorage(slot);uxDecorateQuantities($(slot==='vest'?'vestStorage':'backpackStorage'));return ret};
renderLoose=function(...args){const ret=uxOldRenderLoose(...args);uxDecorateQuantities($('looseItems'));return ret};
function uxMenuAt(e){const menu=$('itemContextMenu');menu.style.left='0px';menu.style.top='0px';menu.hidden=false;
 const w=Math.max(230,menu.offsetWidth||230),h=menu.offsetHeight||200;
 menu.style.left=Math.max(8,Math.min(e.clientX||0,innerWidth-w-8))+'px';menu.style.top=Math.max(8,Math.min(e.clientY||0,innerHeight-h-8))+'px';
}
function uxMenuStart(title,subtitle=''){
 const menu=$('itemContextMenu');menu.replaceChildren();menu.classList.add('ux-context');
 const header=el('div','ux-menu-head');header.append(el('strong',null,title));if(subtitle)header.append(el('small',null,subtitle));menu.append(header);
 return menu;
}
function uxMenuItem(menu,label,callback,{destructive=false,disabled=false}={}){
 const b=btn(label,()=>{const root=$('itemContextMenu');if(root)root.hidden=true;callback()},destructive?'ux-danger':'');b.disabled=disabled;menu.append(b);return b;
}
function uxMenuDivider(menu){menu.append(el('div','ux-menu-rule'))}
function uxItemExists(i){return !!i&&state.items.some(x=>x.id===i.id)}
function uxAllAmmoFor(m){return state.items.filter(a=>a.category==='Ammo'&&a.location!=='loaded'&&itemQuantity(a)>0&&ammoFitsMagazine(a,m)&&(!m.loadedRounds||!m.loadedAmmoType||m.loadedAmmoType===a.name)&&(!m.weaponId||magAmmoFitsWeapon({...m,loadedRounds:1,loadedAmmoType:a.name},byId(m.weaponId))));}
function uxMagLoad(m,ammoName){
 if(!m||!uxItemExists(m))return uxStatus('Magazine is no longer available.',false);
 const cap=magCapacity(m),room=cap-Math.max(0,Math.floor(Number(m.loadedRounds)||0));
 if(!cap)return uxStatus('Set the magazine capacity in the item editor.',false);
 if(room<=0)return uxStatus(`${m.name} is already full.`,false);
 const supplies=uxAllAmmoFor(m).filter(a=>a.name===ammoName).sort((a,b)=>Number(b.location!=='loose')-Number(a.location!=='loose'));
 if(!supplies.length)return uxStatus('No compatible '+ammoName+' rounds are available.',false);
 let remaining=room,used=0;
 for(const a of [...supplies]){
  const count=Math.min(remaining,itemQuantity(a));if(count<=0)continue;
  m.loadedAmmoType=a.name;m.loadedAmmoTemplateId=a.templateId||'';m.loadedAmmoWeight=Math.max(0,Number(a.weight)||0);
  m.loadedRounds=(Number(m.loadedRounds)||0)+count;
  a.quantity=itemQuantity(a)-count;remaining-=count;used+=count;
  if(a.quantity<=0){if(a.location==='slot')delete state.slots[a.slot];state.items=state.items.filter(x=>x.id!==a.id);if(selected===a.id)selected=m.id}
  if(!remaining)break;
 }
 if(used){save();render();log(`Loaded ${used} ${ammoName} into ${m.name}.`);uxStatus(`${m.name}: ${m.loadedRounds}/${cap} rounds.`)}
 return used;
}
function uxInsertMagazine(w,m){
 if(!uxItemExists(w)||!uxItemExists(m))return uxStatus('Weapon or magazine is missing.',false);
 if(w.category!=='Weapon'||m.category!=='Magazine'||w.integralFeed||weaponMagazine(w)||m.location==='loaded'||!magazineFitsWeapon(m,w)||!magAmmoFitsWeapon(m,w))return uxStatus('Magazine is incompatible, already installed, or the weapon is occupied.',false);
 if(m.location==='slot')delete state.slots[m.slot];
 m.location='loaded';delete m.slot;delete m.x;delete m.y;m.weaponId=w.id;w.magazineId=m.id;delete w.loadedRounds;
 save();render();log(`Inserted ${m.name} into ${w.name}.`);uxStatus(`${w.name}: ${m.loadedRounds||0}/${magCapacity(m)} rounds.`);
}
function uxEject(w){const mag=weaponMagazine(w);if(!mag)return uxStatus('There is no magazine to remove.',false);if(mag.integralMagazine)return uxStatus('This weapon has a fixed magazine. Unload its rounds instead.',false);ejectMagazine(w.id);}
function uxEquip(i,slot){if(!canEquip(i,slot))return uxStatus(`${i.name} cannot be equipped in ${slot}.`,false);selected=i.id;slotClick(slot);uxStatus(`Equipped ${i.name}.`)}
function uxSlotsFor(i){return Object.keys(SLOT_TYPES).filter(s=>canEquip(i,s)&&(!state.slots[s]||state.slots[s]===i.id))}
function uxMenuLoadChoices(menu,m){
 const matches=uxAllAmmoFor(m),types=[...new Set(matches.map(a=>a.name))];
 if(!types.length){uxMenuItem(menu,'No compatible ammunition available',()=>{}, {disabled:true});return}
 for(const name of types){const quantity=matches.filter(a=>a.name===name).reduce((s,a)=>s+itemQuantity(a),0);
  uxMenuItem(menu,`Load ${name} · ${quantity} available`,()=>uxMagLoad(m,name));
 }
}
function uxMenuForWeapon(menu,i){
 const mag=weaponMagazine(i),integral=!!i.integralFeed||!!mag?.integralMagazine;
 const suitable=uxSlotsFor(i);
 if(i.location==='slot')uxMenuItem(menu,'Unequip to Loose Loot',()=>quickTransfer(i.id));
 else for(const slot of suitable.slice(0,3))uxMenuItem(menu,`Equip · ${({'primary1':'Back 1','primary2':'Back 2','secondary':'Pistol','hands':'Hands'})[slot]||slot}`,()=>uxEquip(i,slot));
 uxMenuDivider(menu);
 if(mag){uxMenuItem(menu,`Loaded: ${Number(mag.loadedRounds)||0}/${magCapacity(mag)} · ${mag.name}`,()=>uxStatus(`${i.name}: ${Number(mag.loadedRounds)||0} rounds loaded`));
  if(!integral)uxMenuItem(menu,'Remove magazine',()=>uxEject(i));
  if((magCapacity(mag)||0)>Number(mag.loadedRounds||0))uxMenuLoadChoices(menu,mag);
  if(Number(mag.loadedRounds)>0)uxMenuItem(menu,'Unload ammunition',()=>unloadMagazine(mag.id));
 }else if(integral){uxMenuItem(menu,'Fixed feed is unavailable',()=>{}, {disabled:true});}
 else{
  const magazines=state.items.filter(x=>x.category==='Magazine'&&x.location!=='loaded'&&magazineFitsWeapon(x,i)&&magAmmoFitsWeapon(x,i));
  if(!magazines.length)uxMenuItem(menu,'No compatible magazines available',()=>{}, {disabled:true});
  for(const m of magazines.slice(0,12))uxMenuItem(menu,`Insert ${m.name} · ${Number(m.loadedRounds)||0}/${magCapacity(m)}`,()=>uxInsertMagazine(i,m));
 }
 uxMenuItem(menu,'Inspect weapon statistics',()=>{selected=i.id;renderSelectedItem();showPage('character')});
}
function uxMenuForMagazine(menu,i){
 uxMenuItem(menu,`Capacity: ${Number(i.loadedRounds)||0} / ${magCapacity(i)}`,()=>uxStatus(`${i.name}: ${Number(i.loadedRounds)||0}/${magCapacity(i)} rounds.`));
 if(Number(i.loadedRounds||0)<magCapacity(i))uxMenuLoadChoices(menu,i);
 if(Number(i.loadedRounds)>0)uxMenuItem(menu,'Unload ammunition',()=>unloadMagazine(i.id));
 if(i.location==='loaded'){const weapon=byId(i.weaponId);if(weapon&&!i.integralMagazine)uxMenuItem(menu,'Remove from '+weapon.name,()=>uxEject(weapon))}
 else{
  const weapons=state.items.filter(w=>w.category==='Weapon'&&!w.integralFeed&&!weaponMagazine(w)&&magazineFitsWeapon(i,w)&&magAmmoFitsWeapon(i,w));
  for(const w of weapons.slice(0,8))uxMenuItem(menu,'Insert into '+w.name,()=>uxInsertMagazine(w,i));
 }
}
function uxUnifiedContext(e,itemId){
 e.preventDefault();e.stopPropagation();const i=byId(itemId);if(!i)return;
 $('itemHoverTooltip').hidden=true;hoveredId=null;selected=i.id;renderSelectedItem();
 const menu=uxMenuStart(i.name,`${i.category} · ${i.location==='loose'?'Loose Loot':i.location==='loaded'?'Installed':i.location==='slot'?'Equipped':'Storage'}`);
 if(i.category==='Weapon')uxMenuForWeapon(menu,i);
 else if(i.category==='Magazine')uxMenuForMagazine(menu,i);
 else{
  const possible=uxSlotsFor(i);if(i.location==='slot')uxMenuItem(menu,'Unequip to Loose Loot',()=>quickTransfer(i.id));
  else for(const s of possible.slice(0,5))uxMenuItem(menu,(i.category==='Ammo'?'Move to · ':'Equip · ')+s.replace(/primary/g,'Back '),()=>uxEquip(i,s));
  if(isConsumable(i)&&Number(i.uses)>0)uxMenuItem(menu,`Use · ${i.uses} remaining`,()=>{selected=i.id;useSelectedItem()});
 }
 uxMenuDivider(menu);
 if(i.category==='Ammo'){
  uxMenuItem(menu,`Quantity: ${itemQuantity(i)} rounds`,()=>uxStatus(`${i.name}: ${itemQuantity(i)} rounds.`));
  const mags=state.items.filter(m=>m.category==='Magazine'&&magCapacity(m)>Number(m.loadedRounds||0)&&ammoFitsMagazine(i,m)&&(!m.loadedRounds||!m.loadedAmmoType||m.loadedAmmoType===i.name)&&(!m.weaponId||magAmmoFitsWeapon({...m,loadedRounds:1,loadedAmmoType:i.name},byId(m.weaponId))));
  for(const m of mags.slice(0,10))uxMenuItem(menu,`Load into ${m.name} · ${Number(m.loadedRounds)||0}/${magCapacity(m)}`,()=>uxMagLoad(m,i.name));
 }
 if(itemQuantity(i)>1&&stackLimit(i)>1)uxMenuItem(menu,'Split stack…',()=>openSplitStack(i.id));
 if(stackLimit(i)>1&&state.items.some(x=>mergeCompatible(i,x)))uxMenuItem(menu,'Combine matching stacks',()=>{selected=i.id;mergeSelected()});
 if(i.location==='loose')uxMenuItem(menu,'Quick transfer into storage',()=>quickTransfer(i.id));
 else if(i.location!=='loaded'&&i.location!=='slot'&&canReturnToLoot(i))uxMenuItem(menu,'Move to Loose Loot',()=>quickTransfer(i.id));
 if(i.location!=='loaded'&&i.location!=='slot'&&i.w!==i.h)uxMenuItem(menu,'Rotate 90°',()=>{selected=i.id;rotate()});
 if(i.durabilityMax>0)uxMenuItem(menu,`Condition ${Number(i.condition??i.durabilityMax)}/${i.durabilityMax}`,()=>adjustCondition(i.id));
 window.STALKER_EXT?.injectContext?.(menu,i,uxMenuItem);
 uxMenuItem(menu,'Inspect item',()=>{selected=i.id;renderSelectedItem();uxStatus(`${i.name} selected.`)});
 uxMenuAt(e);
}
openItemContext=uxUnifiedContext;

// Preserve the existing controls but collapse infrequently needed actions rather
// than repeating them in the always-visible inventory toolbar.
function uxStreamline(){
 const tools=document.querySelector('.loot-tools');if(tools&&!tools.dataset.uxStreamlined){tools.dataset.uxStreamlined='1';
  const advanced=el('details','ux-overflow'),summary=el('summary',null,'Other inventory actions');advanced.append(summary);
  for(const ident of ['quickMove','mergeStack','rotate','toLoose','remove']){const b=$(ident);if(b)advanced.append(b)}tools.append(advanced);
 }
 const workbench=$('ammoWorkbench');if(workbench){workbench.open=false;workbench.classList.add('ux-legacy-workbench');}
 const actions=document.querySelector('#characterPage .actions');if(actions&&!actions.dataset.uxStreamlined){actions.dataset.uxStreamlined='1';const extra=el('details','ux-overflow');extra.append(el('summary',null,'Additional actions'));
  for(const action of ['reload','use','stats']){const b=actions.querySelector(`[data-action="${action}"]`);if(b)extra.append(b)}
  const configure=$('configureActions');if(configure)extra.append(configure);actions.append(extra);
 }
}
// Compact right-click GM controls. Existing click handlers are reused, not duplicated.
function uxContextForControls(anchor,controls,e){
 e.preventDefault();e.stopPropagation();const menu=uxMenuStart(anchor.dataset.uxTitle||'GM actions','Game Master only');
 for(const button of controls.querySelectorAll('button')){
  if(button.disabled)continue;
  uxMenuItem(menu,button.textContent,()=>button.click(),{destructive:/delete/i.test(button.textContent)});
 }
 uxMenuAt(e);
}
function uxCompactGMControls(){
 if(viewMode!=='gm')return;
 for(const rootId of ['gmNpcList','gmEncounters','gmPlayerList']){
  const root=$(rootId);if(!root)continue;
  const children=rootId==='gmEncounters'?root.querySelectorAll('.gm-actor,.encounter-card'):rootId==='gmNpcList'?root.querySelectorAll('.gm-card'):root.querySelectorAll('.gm-card');
  for(const card of children){if(card.dataset.uxContext==='1')continue;
   const toolbar=card.querySelector(':scope > .toolbar');if(!toolbar||!toolbar.querySelector('button'))continue;
   const controls=toolbar;controls.classList.add('ux-collapsed-tools');
   card.dataset.uxContext='1';card.dataset.uxTitle=card.querySelector('h3,h2,span')?.textContent?.slice(0,60)||'NPC actions';
   const small=btn('⋯',()=>{}, 'ux-more-btn');small.onclick=e=>uxContextForControls(card,controls,e);
   small.title='GM actions · right-click also works';card.insertBefore(small,controls);
   card.addEventListener('contextmenu',e=>{if(e.target.closest('input,textarea,select'))return;uxContextForControls(card,controls,e)});
  }
 }
}
const uxOldRenderGM=renderGM;renderGM=function(...args){const ret=uxOldRenderGM(...args);uxCompactGMControls();return ret};
const uxOldRenderGMEncounters=renderGMEncounters;renderGMEncounters=function(...args){const ret=uxOldRenderGMEncounters(...args);uxCompactGMControls();return ret};
const uxOldRenderGMNPCs=renderGMNPCs;renderGMNPCs=function(...args){const ret=uxOldRenderGMNPCs(...args);uxCompactGMControls();return ret};
const uxOldRenderGMPlayers=renderGMPlayers;renderGMPlayers=function(...args){const ret=uxOldRenderGMPlayers(...args);uxCompactGMControls();return ret};

// Player-visible encounter information is read-only. Only GM controls selection,
// target HP, attacks by an NPC, visibility and loadouts.
const uxOriginalTargets=renderEncounterTargets;
renderEncounterTargets=function(...args){
 if(viewMode==='gm'){const ret=uxOriginalTargets(...args);return ret}
 const root=$('encounterTargets');root.replaceChildren();const active=encounter();
 if(active)root.append(el('span','hint',`${active.name} · ${active.roster.filter(a=>a.visible).length} visible NPCs. GM manages targets and NPC turns.`));
 $('selectedEncounterTarget').textContent='NPC targeting and actions are managed by the GM.';
};
const uxOriginalSelectActor=selectActor;
selectActor=function(actorId){if(viewMode!=='gm')return uxStatus('Only the GM can select or control NPC targets.',false);return uxOriginalSelectActor(actorId)};
window.stalkerTTSSelectNPC=actorId=>{if(viewMode!=='gm')setMode('gm',false);if(!findActor(actorId))return false;selectActor(actorId);showPage('gmcombat');return true;};
// Previously "Target NPC" moved the GM into the PLAYER tab. Keep all target
// resolution and target selection inside the GM Combat workspace instead.
function uxFixGMTargetButtons(){
 const root=$('gmEncounters');if(!root)return;
 for(const row of root.querySelectorAll('.gm-actor')){
  const button=[...row.querySelectorAll('button')].find(x=>x.textContent.trim()==='Target NPC');if(!button||button.dataset.uxFixed)return;
  button.dataset.uxFixed='1';button.addEventListener('click',e=>{
   e.preventDefault();e.stopImmediatePropagation();
   const actor=encounter()?.roster.find(a=>a.id===row.dataset.actorId);
   if(!actor)return uxStatus('Activate this encounter before selecting a target.',false);
   if(!actor.visible){actor.visible=true;gmSave('NPC revealed',actor.name)}
   selectActor(actor.id);setMode('gm',false);showPage('gmcombat');uxStatus(`GM target: ${actor.name}`);
  },true);
 }
}
const uxPrevCompact=uxCompactGMControls;
uxCompactGMControls=function(){uxFixGMTargetButtons();uxPrevCompact()};
uxStreamline();
const uxFeed=el('div','ux-toast');uxFeed.id='uxFeedback';uxFeed.hidden=true;document.body.append(uxFeed);
render();renderGM();
window.STALKER_UX_TEST={uxMagLoad,uxInsertMagazine,uxAllAmmoFor,uxUnifiedContext,uxEquip,uxDecorateQuantities};
// GM-owned NPC turns: a single NPC attack resolution mutates the target character
// and is delivered to the authoritative host for a connected player.
function uxAllPlayerChoices(){
 const out=[];
 for(const profile of profileRecords)out.push({id:profile.id,label:profile.name,kind:'local'});
 for(const [playerId,p] of Object.entries(gmData.players||{}))if(p?.character&&!out.some(x=>x.id===playerId))out.push({id:playerId,label:(p.name||playerId)+' · connected',kind:'remote'});
 return out;
}
const uxOldRenderGMCombatants=renderGMCombatants;
renderGMCombatants=function(){
 uxOldRenderGMCombatants();
 const picker=$('gmTargetPlayer'),prior=picker.value;
 for(const player of uxAllPlayerChoices())if(![...picker.options].some(o=>o.value===player.id))picker.append(new Option(player.label,player.id));
 if([...picker.options].some(o=>o.value===prior))picker.value=prior;
 $('gmLoadCombatants').hidden=false;
};
function uxPlayerRecord(profileId){
 if(profileRecords.some(p=>p.id===profileId)){
  if(profileId===activeProfile)return {data:state,local:true};
  try{const raw=localStorage.getItem(profileStorageKey(profileId));return raw?{data:JSON.parse(raw),local:true}:null}catch{return null}
 }
 const player=gmData.players[profileId];return player?.character?{data:player.character,local:false}:null;
}
function uxSaveCombatPlayer(profileId,record){
 if(record.local){
  if(profileId===activeProfile){save();renderCharacter();renderStatus();renderInjuries()}
  else localStorage.setItem(profileStorageKey(profileId),JSON.stringify(record.data));
 }else{
  gmData.players[profileId].character=record.data;
  if(network?.readyState===1&&networkRole==='gm')network.send(JSON.stringify({type:'gmCharacterUpdate',playerId,character:record.data}));
 }
}
function uxArmoredDR(character,location){
 if(window.STALKER_EXT?.armorFor)return window.STALKER_EXT.armorFor(character,location,'front').dr;
 const slots=character.slots||{},items=character.items||[];
 const part=location==='Skull'?'head':location==='Face'?'face':['Torso','Vitals'].includes(location)?'torso':'limb';
 let dr=0;
 for(const slot of ['armor','vest','helmet','mask']){
  const gear=items.find(i=>i.id===slots[slot]);if(!gear)continue;
  if((part==='head'&&slot==='helmet')||(part==='face'&&slot==='mask')||(part==='torso'&&['armor','vest'].includes(slot)))dr+=Math.max(0,Number(gear.gurps?.dr)||0);
 }
 return dr;
}
function uxRollInjury(damage,dr,location,dt=0){
 const roll=rollExpression(damage),type=String(roll.type||'cr').match(/pi\+\+|pi\+|pi-|pi|cut|imp|burn|cr|tox|fat/i)?.[0]?.toLowerCase()||'cr';
 const armorDivisor=Number(String(damage).match(/\((0\.5|1|2|3|5|10)\)/)?.[1]||1);
 const effDR=Math.floor(dr/armorDivisor)+(location==='Skull'?2:0),penetration=Math.max(0,roll.total-effDR);
 let mult={'pi-':.5,'pi':1,'pi+':1.5,'pi++':2,cut:1.5,imp:2,burn:1,cr:1,tox:1,fat:1}[type]||1;
 if(location==='Vitals'&&['pi-','pi','pi+','pi++','imp'].includes(type))mult=3;
 if(location==='Skull'&&penetration)mult=4;
 const useDT=gmData.integrated?.rules?.dtEnabled!==false;
 return {roll,effDR,penetration,type,dt:useDT?dt:0,injury:penetration>0&&(!useDT||penetration>dt)?Math.max(1,Math.floor(penetration*mult)):0};
}
function uxNPCRoundAmmo(actor){
 const original=npcById(actor.templateId),weapon=npcWeaponStats(original||actor).weapon;
 const capacity=parseInt(String(weapon?.gurps?.shots||weapon?.gurps?.capacity||'0'),10);
 if(!Number.isFinite(actor.ammoRemaining))actor.ammoRemaining=capacity>0?capacity:0;
 return Math.max(0,Math.floor(actor.ammoRemaining));
}
function uxGMResolveNPC(){
 if(viewMode!=='gm')return uxStatus('NPC attacks require GM mode.',false);
 const actor=findActor($('gmAttackingNpc').value),targetPicker=$('gmTargetPlayer');
 let playerId=targetPicker.value||activeProfile;
 if(![...targetPicker.options].some(o=>o.value===playerId))targetPicker.append(new Option(profileRecords.find(x=>x.id===playerId)?.name||'Current character',playerId));
 targetPicker.value=playerId;
 const record=uxPlayerRecord(playerId);
 if(!actor||!actor.visible||actor.dead||actor.hp<=-5*actor.maxHP)return uxStatus('Select a living NPC from the active encounter.',false);
 if(!record)return uxStatus('Select a valid local or connected player.',false);
 const round=Math.max(1,num(gmData.npcCombatRound,1));
 if(actor.lastAttackRound===round)return uxStatus(`${actor.name} already attacked in round ${round}.`,false);
 if((actor.conditions||[]).some(c=>/stunned|unconscious|dead/i.test(c)))return uxStatus(`${actor.name} cannot attack while incapacitated.`,false);
 const n=npcById(actor.templateId)||actor,weapon=npcWeaponStats(n),rcl=Math.max(1,Number(weapon.weapon?.gurps?.rcl)||2);
 const available=weapon.weapon?uxNPCRoundAmmo(actor):1;
 if(weapon.weapon&&!available)return uxStatus(`${actor.name}'s weapon is empty. Reload it before attacking.`,false);
 const requested=Math.max(1,Math.min(100,Math.floor(num($('npcShots').value,weapon.shots)))),shots=Math.min(requested,weapon.shots,weapon.weapon?available:1);
 const skill=Math.max(3,Math.min(30,num($('npcAttackSkill').value,actor.skill||11))),loc=$('npcHitLocation').value,modifier=num($('npcAttackModifier').value,0);
 const effective=skill+modifier+rapidFireBonus(shots)+(HIT_LOCATION_PENALTIES[loc]||0),attack=roll3d6(effective,actor.name+' attacks '+playerId);
 const beforeDefense=attack.success?Math.min(shots,1+Math.floor(Math.max(0,attack.margin)/rcl)):0;
 const character=record.data,maxHP=Math.max(1,num(character.stats?.HP,10));
 const defenseMode=$('playerDefense').value,defenseValue=defenseMode==='dodge'?num(character.stats?.Dodge,8):num($('playerManualDefense').value,9);
 const defenseRoll=(beforeDefense&&defenseMode!=='none'&&!attack.criticalSuccess)?roll3d6(Math.max(3,defenseValue),playerId+' '+defenseMode):null;
 const avoided=defenseRoll?.success?Math.min(beforeDefense,1+Math.floor(Math.max(0,defenseRoll.margin)/rcl)):0;
 const hits=beforeDefense-avoided;
 const raw=weapon.weapon?weapon.damage:($('npcAttackDamage').value||actor.damage||'1d-2 cr');
 try{rollExpressionCheck(raw)}catch(e){return uxStatus('NPC weapon damage is invalid: '+e.message,false)}
 let injury=0,armorRawDamage=0,armorPenetration=0;const lines=[`${actor.name} attacks ${playerId} · Round ${round} · ${loc}`,`Attack: ${attack.total} vs ${effective} · ${shots} shot(s), ${beforeDefense} potential hit(s).`,`Defense: ${defenseRoll?defenseRoll.total+' vs '+defenseValue:'none'} · ${avoided} prevented · ${hits} confirmed.`];
 const protection=window.STALKER_EXT?.armorFor?.(character,loc)||{dr:uxArmoredDR(character,loc),dt:0};
 const dr=protection.dr,dt=protection.dt;
 for(let h=0;h<hits;h++){
  const damage=uxRollInjury(raw,dr,loc,dt);injury+=damage.injury;armorRawDamage+=damage.roll.total;armorPenetration+=damage.penetration;
  lines.push(`Hit ${h+1}: ${damage.roll.total} ${damage.type}, DR ${damage.effDR}, DT ${damage.dt} (optional threshold), ${damage.injury} HP injury.`);
  // GM reviews calculated injury; never write player wounds from an attack roll.
 }
 // Store the un-applied calculation separately from the player's HP and wounds.
 gmData.pendingCombat=gmData.pendingCombat||[];
 const pending={id:id(),at:new Date().toISOString(),kind:'npc',actor:actor.name,targetId:playerId,targetName:record.data.identity?.Name||playerId,injury,armorRawDamage,armorPenetration,location:loc,shots,round,status:'Calculated',detail:lines.join('\n')};
 gmData.pendingCombat.unshift(pending);gmData.pendingCombat=gmData.pendingCombat.slice(0,300);
 actor.lastAttackRound=round;if(weapon.weapon)actor.ammoRemaining=Math.max(0,available-shots);
 gmSave('NPC attack',`${actor.name} attacked ${playerId}, fired ${shots}, calculated ${injury} HP (round ${round}); not applied.`);
 lines.push(`Calculated injury: ${injury} HP. No player HP was changed. ${weapon.weapon?'NPC ammo left: '+actor.ammoRemaining+'.':''}`);
 $('combatResult').textContent=lines.join('\n');$('gmNpcResult').textContent=lines.join('\n');renderGM();renderGMCombatants();uxStatus(`${actor.name}: ${shots} shot(s), ${injury} calculated injury to ${playerId}; GM review pending.`);
}
// Prepare combatants directly from the encounter without requiring a hidden setup step.
function selectGMCombatant(actorId,playerId=activeProfile){
 const actor=findActor(actorId);if(!actor)return uxStatus('Activate an encounter and choose an NPC.',false);
 renderGMCombatants();$('gmAttackingNpc').value=actor.id;
 const chosen=[...$('gmTargetPlayer').options].some(x=>x.value===playerId)?playerId:activeProfile;
 $('gmTargetPlayer').value=chosen;
 const source=npcById(actor.templateId)||actor,weapon=npcWeaponStats(source);
 $('npcAttackSkill').value=String(actor.skill||11);$('npcAttackDamage').value=weapon.damage;
 $('npcShots').value=String(weapon.weapon?Math.max(1,Math.min(weapon.shots,uxNPCRoundAmmo(actor))):1);
 $('npcRcl').value=String(weapon.weapon?.gurps?.rcl||2);
 window.__selectedNpcAttacker=actor.id;window.__selectedPlayerTarget=chosen;
 return true;
}
const gmNPCActionObserver=new MutationObserver(()=>{
 const root=$('gmEncounters');if(!root||viewMode!=='gm')return;
 for(const row of root.querySelectorAll('.gm-actor')){
  const button=[...row.querySelectorAll('button')].find(b=>b.textContent.trim()==='NPC Attacks Player');
  if(!button||button.dataset.npcAttackFixed)return;
  button.dataset.npcAttackFixed='1';button.addEventListener('click',e=>{
   e.preventDefault();e.stopImmediatePropagation();
   const actorId=row.dataset.actorId;
   if(!encounter()?.roster.some(n=>n.id===actorId))return uxStatus('Activate the encounter first.',false);
   setMode('gm',false);showPage('gmcombat');selectGMCombatant(actorId);
   uxStatus('NPC and target prepared. Click Resolve NPC Attack to calculate injury; GM review applies HP.');
  },true);
 }
});
gmNPCActionObserver.observe($('gmEncounters'),{childList:true,subtree:true});
// GM can make the selected player attack the selected encounter NPC without
// manually advancing a parallel target turn state.
const gmTargetSelector=$('encounterTargets');
if(gmTargetSelector){
 // The legacy combat weapon selector lives in a collapsed player-only section.
 // Provide visible attack inputs in Combat Control instead of making the GM
 // manipulate hidden DOM fields or encounter turn state to perform an attack.
 const attackPanel=el('div','panel gm-attack-workspace');attackPanel.id='gmAttackWorkspace';
 const heading=el('h3','', 'ATTACK SELECTED NPC');
 const row=el('div','form-strip');
 const weaponLabel=el('label','', 'Weapon');const weaponChoice=document.createElement('select');weaponChoice.id='gmAttackWeapon';weaponLabel.append(weaponChoice);
 const skillLabel=el('label','', 'Skill');const skillInput=document.createElement('input');skillInput.id='gmAttackSkill';skillInput.type='number';skillInput.min='3';skillInput.max='30';skillInput.value='12';skillLabel.append(skillInput);
 const rangeLabel=el('label','', 'Distance (yards)');const rangeInput=document.createElement('input');rangeInput.id='gmAttackRange';rangeInput.type='number';rangeInput.min='0';rangeInput.value='25';rangeLabel.append(rangeInput);
 const shotsLabel=el('label','', 'Shots');const shotsInput=document.createElement('input');shotsInput.id='gmAttackShots';shotsInput.type='number';shotsInput.min='1';shotsInput.max='100';shotsInput.value='1';shotsLabel.append(shotsInput);
 const attackStatus=el('div','hint');attackStatus.id='gmAttackStatus';attackStatus.textContent='Select an encounter target. Injury is calculated but never applied automatically.';
 function refreshAttackWeapons(){
  const prior=weaponChoice.value;
  weaponChoice.replaceChildren(new Option('Unarmed / manual damage',''));
  for(const weapon of state.items.filter(i=>i.category==='Weapon'))weaponChoice.append(new Option(`${weapon.name} · ${roundsInWeapon(weapon)} round(s)`,weapon.id));
  weaponChoice.value=[...weaponChoice.options].some(o=>o.value===prior)?prior:'';
 }
 weaponChoice.addEventListener('focus',refreshAttackWeapons);
 weaponChoice.addEventListener('change',()=>{const w=byId(weaponChoice.value);if(w){const level=weaponSkillLevel(w);if(level)skillInput.value=String(level);shotsInput.value=String(Math.max(1,Math.min(weaponRof(w),roundsInWeapon(w))))}});
 const attackButton=btn('Roll attack against selected NPC',()=>{
  if(viewMode!=='gm')return uxStatus('Only the GM can use this combat control.',false);
  const actor=activeTargetId?findActor(activeTargetId):null;
  if(!actor)return uxStatus('Select an NPC from the active encounter first.',false);
  const source=byId(weaponChoice.value);
  if(weaponChoice.value&&!source)return uxStatus('The selected weapon is no longer in the inventory.',false);
  const c=advCombat();c.actor='Player';c.actedThisTurn=false;
  const setValue=(id,value)=>{const element=$(id);if(element)element.value=String(value)};
  setValue('combatWeapon',weaponChoice.value);
  setValue('combatSkill',skillInput.value);
  setValue('combatRange',rangeInput.value);
  setValue('combatShots',shotsInput.value);
  setValue('targetHP',actor.hp);setValue('targetMaxHP',actor.maxHP);setValue('targetDR',actor.dr||0);setValue('targetDT',actor.dt||0);
  // Preserve the chosen advanced maneuver; do not force Attack over GM selection.
  const first=state.combatReview?.[0]?.id;
  advAttack();
  const made=state.combatReview?.[0];
  if(!made||made.id===first){attackStatus.textContent='Attack not calculated. '+($('notice')?.textContent||'Check weapon readiness and ammunition.');return}
  attackStatus.textContent=`${actor.name}: ${made.status} · ${made.injury||0} calculated injury. Use the review below to apply or ignore.`;
  uxStatus(`Attack on ${actor.name} calculated. Apply or ignore injury in Combat Control.`);
 },'primary-action');attackButton.id='gmRollAgainstNpc';
 row.append(weaponLabel,skillLabel,rangeLabel,shotsLabel,attackButton);
 attackPanel.append(heading,row,attackStatus);gmTargetSelector.insertAdjacentElement('afterend',attackPanel);
 refreshAttackWeapons();
}
// Replace the old NPC attack handler on this button; never resolve twice.
$('performNpcAttack').addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();uxGMResolveNPC()},true);
// NPC ammo is edited in place as a simple GM action. A full NPC inventory can
// replace the numeric field later without changing player item mechanics.
function uxGMReloadActor(actor){
 const n=npcById(actor.templateId)||actor,w=npcWeaponStats(n).weapon;
 if(!w)return uxStatus('No weapon equipped on this NPC.',false);
 const cap=Math.max(0,parseInt(String(w.gurps?.shots||w.gurps?.capacity||''),10)||0);
 if(!cap)return uxStatus('Set this weapon’s magazine capacity in the catalogue.',false);
 const current=uxNPCRoundAmmo(actor),needed=Math.max(0,cap-current);
 if(!needed)return uxStatus(`${actor.name}'s magazine is already full.`,false);
 const supplies=(actor.loot||[]).filter(entry=>{const t=template(entry.templateId);return t?.category==='Ammo'&&sameCaliber(t,w)&&Number(entry.quantity)>0});
 if(!supplies.length)return uxStatus(`${actor.name} needs matching ammunition in their loadout to reload.`,false);
 let remaining=needed,loaded=0;
 for(const entry of supplies){const amount=Math.min(remaining,Math.floor(Number(entry.quantity)||0));if(amount<1)continue;entry.quantity-=amount;remaining-=amount;loaded+=amount;
  const ammo=template(entry.templateId);actor.loadedAmmoType=ammo?.name||actor.loadedAmmoType;
  if(entry.quantity<=0)actor.loot.splice(actor.loot.indexOf(entry),1);
  if(!remaining)break;
 }
 if(!loaded)return uxStatus('No compatible rounds available.',false);
 actor.ammoRemaining=current+loaded;
 gmSave('NPC reload',`${actor.name} loaded ${loaded} rounds; ${actor.ammoRemaining}/${cap} now in weapon.`);
 renderGM();uxStatus(`${actor.name} reloaded ${loaded} rounds: ${actor.ammoRemaining}/${cap}.`);
}
$('npcReloadHelp').textContent='Reload selected NPC';
$('npcReloadHelp').onclick=()=>{const actor=findActor($('gmAttackingNpc').value);if(!actor)return uxStatus('Select an NPC first.',false);uxGMReloadActor(actor)};
// Stop the older Reload Rules dialog listener as well.
$('npcReloadHelp').addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const actor=findActor($('gmAttackingNpc').value);if(!actor)return uxStatus('Select an NPC first.',false);uxGMReloadActor(actor)},true);
// Changing either dropdown immediately prepares the attack; no second "load
// combatants" button or page transition is needed.
$('gmAttackingNpc').addEventListener('change',()=>{const actor=findActor($('gmAttackingNpc').value);if(!actor)return;
 const npc=npcById(actor.templateId)||actor,weapon=npcWeaponStats(npc);$('npcAttackDamage').value=weapon.damage;$('npcShots').value=String(weapon.weapon?Math.min(weapon.shots,uxNPCRoundAmmo(actor)):1);$('npcAttackSkill').value=String(actor.skill||11);
});
// Keep GM side targeting in a single workspace. Selecting a target never moves
// the GM into Player view.
// A player can attack only the NPC the GM has explicitly assigned. The player
// receives the selected target's combat stats, not the private NPC library.
let uxRemoteTargetStats=null;
function uxAssignedTargetText(){
 const actor=activeTargetId&&findActor(activeTargetId);const e=$('assignedTargetInfo');if(!e)return;
 e.textContent=actor?`Assigned target: ${actor.name}. The GM controls NPC selection and turns.`:'No NPC assigned. Ask the GM to select an encounter target.';
}
function uxReceiveAssignment(msg){
 uxRemoteTargetStats=msg.actorId&&msg.stats?{id:msg.actorId,...msg.stats}:null;
 activeTargetId=msg.actorId||null;
 const actor=activeTargetId?findActor(activeTargetId):null;
 if(actor&&uxRemoteTargetStats){Object.assign(actor,uxRemoteTargetStats);uxOriginalSelectActor(actor.id)}
 uxAssignedTargetText();renderEncounterTargets();
 if(msg.actorId)uxStatus(`GM assigned target: ${msg.name||actor?.name||'NPC'}.`);
}
function uxAssignTarget(actorId,playerId){
 if(viewMode!=='gm')return uxStatus('Only the GM can assign NPC targets.',false);
 const actor=findActor(actorId);if(!actor||!actor.visible||actor.dead)return uxStatus('Target must be a living visible NPC in the active encounter.',false);
 if(!uxAllPlayerChoices().some(p=>p.id===playerId))return uxStatus('Player not found.',false);
 gmData.targetAssignments=gmData.targetAssignments||{};gmData.targetAssignments[playerId]=actorId;
 if(playerId===activeProfile)activeTargetId=actorId;
 gmSave('Target assigned',`${actor.name} assigned to ${playerId}`);
 if(network?.readyState===1&&networkRole==='gm')network.send(JSON.stringify({type:'assignTarget',playerId,actorId}));
 uxStatus(`Assigned ${actor.name} to ${playerId}.`);
}
// Add GM target-assignment choices directly to each NPC's context menu.
const uxPreviousContextGM=uxContextForControls;
uxContextForControls=function(anchor,controls,e){
 uxPreviousContextGM(anchor,controls,e);
 const actorId=anchor.dataset.actorId,actor=actorId&&encounter()?.roster.find(a=>a.id===actorId);
 if(!actor)return;
 const menu=$('itemContextMenu');uxMenuDivider(menu);
 for(const p of uxAllPlayerChoices().slice(0,18))uxMenuItem(menu,`Assign as target → ${p.label}`,()=>uxAssignTarget(actorId,p.id));
 uxMenuItem(menu,'NPC ammunition: '+uxNPCRoundAmmo(actor),()=>uxStatus(`${actor.name}: ${uxNPCRoundAmmo(actor)} rounds remain.`));
 uxMenuItem(menu,'Reload NPC weapon',()=>uxGMReloadActor(actor));
 uxMenuItem(menu,'Inspect NPC & equipment',()=>{const gear=(actor.loot||[]).map(x=>`${template(x.templateId)?.name||'Unknown'} ×${x.quantity}`).join(', ');uxStatus(`${actor.name} · HP ${actor.hp}/${actor.maxHP} · ${npcWeaponStats(actor).weapon?.name||'Unarmed'} · ${uxNPCRoundAmmo(actor)} rounds · Gear: ${gear||'none'}`)});
 const sub=el('details','ux-menu-nested');sub.append(el('summary',null,'Change NPC weapon'));
 for(const w of state.catalog.filter(t=>t.category==='Weapon').sort((a,b)=>a.name.localeCompare(b.name)).slice(0,90))
  uxMenuItem(sub,w.name,()=>{actor.equippedWeapon=w.id;actor.damage=w.gurps?.damage||actor.damage;actor.shots=weaponRof(w);actor.ammoRemaining=Math.max(0,parseInt(String(w.gurps?.shots||w.gurps?.capacity||''),10)||0);if(!actor.loot.some(x=>x.templateId===w.id))actor.loot.push({id:id(),templateId:w.id,quantity:1});gmSave('NPC equipped weapon',`${actor.name}: ${w.name}`);renderGM();uxStatus(`${actor.name} equipped ${w.name}`)});
 menu.append(sub);
 uxMenuAt(e);
};
// The player keeps a compact, read-only assignment line. No NPC controls are shown.
const uxTargetStatus=el('div','ux-assigned-target');uxTargetStatus.id='assignedTargetInfo';
 $('combatPage').querySelector('.section-heading').insertAdjacentElement('afterend',uxTargetStatus);
uxAssignedTargetText();
window.STALKER_UX_TEST.assignTarget=uxAssignTarget;

const uxOriginalShowPage=showPage;
showPage=function(page){if(page==='gmcombat'&&viewMode!=='gm')setMode('gm',false);const result=uxOriginalShowPage(page);uxAssignedTargetText();if(viewMode==='gm'&&page==='gmcombat')renderGMCombatants();return result;};
window.STALKER_GM_COMBAT_TEST={resolve:uxGMResolveNPC,reload:uxGMReloadActor,getPlayer:uxPlayerRecord};

// Keep the combat screen focused on the current role. All original controls stay
// in the document, but advanced tools are discoverable rather than permanently open.
function uxCombatLayout(){
 if($('uxPlayerAttackDetails'))return;
 const page=$('combatPage'),attack=page.querySelector('section.combat-panel'),npc=$('npcAttackPanel'),heading=page.querySelector('.section-heading');
 const attackWrap=el('details','ux-major-section');attackWrap.id='uxPlayerAttackDetails';
 attackWrap.append(el('summary',null,'Player attack & damage'));attackWrap.append(attack);
 heading.insertAdjacentElement('afterend',npc);
 npc.insertAdjacentElement('afterend',attackWrap);
 const tactical=$('combatManeuver')?.closest('section');if(tactical){
  const more=el('details','ux-major-section');more.id='uxTacticalDetails';more.append(el('summary',null,'Round & tactical modifiers'));more.append(tactical);
  attackWrap.insertAdjacentElement('afterend',more);
 }
 const effects=$('advancedTargetPanel');if(effects){
  const more=el('details','ux-major-section');more.id='uxInjuryDetails';more.append(el('summary',null,'GM target injuries & conditions'));more.append(effects);
  $('uxTacticalDetails')?.insertAdjacentElement('afterend',more);
 }
 const history=$('rollHistory')?.closest('section');if(history){const more=el('details','ux-major-section');more.id='uxDiceHistoryDetails';more.append(el('summary',null,'Dice history'));more.append(history);history.parentElement!==more&&page.append(more)}
 const quick=$('rollCustomDice')?.closest('section');if(quick){quick.classList.add('ux-compact-quick-dice')}
 const gmPanel=$('npcAttackPanel'),round=el('div','ux-gm-round');
 const label=el('strong',null,'Encounter round 1');label.id='uxGMRoundLabel';
 const advance=btn('Next encounter round',()=>{if(!encounter())return uxStatus('Activate an encounter first.',false);
  gmData.npcCombatRound=Math.max(1,num(gmData.npcCombatRound,1))+1;
  gmSave('Encounter round',`Round ${gmData.npcCombatRound}`);uxUpdateGMRound();uxStatus(`Round ${gmData.npcCombatRound} started.`)
 });round.append(label,advance);
 gmPanel.prepend(round);
 const npcResult=el('div','combat-result-card ux-npc-result');npcResult.id='gmNpcResult';npcResult.textContent='Select an NPC and a player, then resolve an attack.';gmPanel.append(npcResult);
 uxUpdateGMRound();uxRoleLayout();
}
function uxUpdateGMRound(){const label=$('uxGMRoundLabel');if(label)label.textContent=`Encounter round ${Math.max(1,num(gmData.npcCombatRound,1))}`;}
function uxRoleLayout(){const isGM=viewMode==='gm';
 for(const [key,openGM,openPlayer] of [['uxPlayerAttackDetails',false,true],['uxTacticalDetails',false,false],['uxInjuryDetails',false,false],['uxDiceHistoryDetails',false,false]]){
  const d=$(key);if(d)d.open=isGM?openGM:openPlayer;
 }
 uxUpdateGMRound();
}
function uxProfileLayout(){
 const bar=$('profileNew')?.parentElement;if(!bar||bar.dataset.uxGrouped)return;
 bar.dataset.uxGrouped='1';const more=el('details','ux-profile-more');more.append(el('summary',null,'Character tools'));
 for(const name of ['profileRename','profileDelete','undoMove','redoMove','manualBackup','restoreBackup','export','import','reset']){
  const node=$(name);if(node)more.append(node)
 }
 bar.append(more);
}
const uxOldSetMode=setMode;
setMode=function(mode,navigate=true){const result=uxOldSetMode(mode,navigate);uxRoleLayout();return result};
const uxOldShowPage3=showPage;
showPage=function(page){const result=uxOldShowPage3(page);uxRoleLayout();return result};
uxCombatLayout();uxProfileLayout();


 // Navigation is now managed by the isolated, resilient navigation.js controller.
 // Internal page transitions continue using showPage(), and the controller
 // observes those transitions to keep visual navigation in sync.
 window.STALKER_NAV_CONNECTED_ROLE=()=>networkRole;

// --- End 4.3 UX layer ---

// Finalize DOM and populate new sections after original code has initialized.
refreshCampaignFields();renderGM();renderEncounterTargets();renderEncounterLoot();renderVariantSummary();renderJournal();
showPage(viewMode==='gm'?'dashboard':'character');
restoreNativeSave();
window.STALKER_INTEGRATION_BRIDGE={
  getGM:()=>gmData,saveGM:gmSave,renderGM:renderGM,
  getRole:()=>viewMode,storeImage:putAsset,visibleImage:visibleImage,
  npcById:npcById,findActor:findActor,profileRecords:()=>profileRecords,
  playerRecord:uxPlayerRecord,savePlayer:uxSaveCombatPlayer
};
window.STALKER_COMPANION_TEST={
 getGM:()=>clone(gmData),getCharacter:()=>clone(state),
 createNPC:obj=>{const n=npcTemplate(obj);gmData.npcs.push(n);gmSave('NPC test',n.name);renderGM();return n.id},
 createEncounter:(name,npcIds)=>{const e={id:id(),name,roster:npcIds.map(npcId=>makeActor(npcById(npcId))),stashes:[],location:'Test Location',notes:''};gmData.encounters.push(e);gmSave('Encounter test',name);renderGM();return e.id},
 activateEncounter,selectActor,lootOne,lootAll,makeCheckpoint,restoreCheckpoint,
 storeImage:putAsset,prepareImage,visibleImage,
 setView:setMode
};
})();
