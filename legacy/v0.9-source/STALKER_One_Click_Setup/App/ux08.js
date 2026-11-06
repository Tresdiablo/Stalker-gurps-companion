/* Beta 0.8 usability layer for the ORIGINAL Build 4.5 application.
 * Preserves all original object IDs and handlers. These controls arrange and
 * invoke existing game actions; they do not create duplicate game state.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const gm=()=>window.STALKER_INTEGRATION_BRIDGE?.getGM?.();
const inGM=()=>document.body.dataset.mode==='gm';
const el=(name,cls,text)=>{const e=document.createElement(name);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e};
const action=(name,callback,cls='')=>{const b=el('button',cls,name);b.type='button';b.addEventListener('click',callback);return b};
const msg=(text)=>{if(typeof notice==='function')notice(text);else console.info(text)};
const findItem=key=>typeof state==='object'&&state?.items?.find(i=>i.id===key);
const nav=(page,role)=>{if(!window.STALKER_NAV_TEST?.route(page,role))msg('Unable to open '+page)};
const drive=(control,value)=>{if(!control)return;control.value=value;control.dispatchEvent(new Event('change',{bubbles:true}))};
let lastFolder={type:'all',category:'all'};

// 1. Item inspection and all routine equipment actions stay inside Inventory.
function initInventory(){
 const page=$('characterPage');if(!page||$('ux08GearPanel'))return;
 const details=page.querySelector('#selectedItemDetails');const host=details?.closest('section.panel')||page.querySelector('.loot-panel');if(!host)return;
 const panel=el('section','ux08-inventory-gear');panel.id='ux08GearPanel';
 const heading=el('div','ux08-panel-head');heading.append(el('h3',null,'EQUIPMENT INSPECTION'));
 const hint=el('small','muted','Drag an attachment onto a compatible weapon. Right-click the weapon to remove it.');
 panel.append(heading,hint);const content=el('div','ux08-gear-content');content.id='ux08GearContent';panel.append(content);
 host.append(panel);
 const loot=page.querySelector('.loot-panel');if(loot&&!$('ux08InventoryHint')){const p=el('p','ux08-inventory-hint','Single-click: inspect · Double-click: quick transfer · Right-click: item actions · Shift-click: select a group · Drag attachment onto a weapon to install.');p.id='ux08InventoryHint';loot.insertBefore(p,loot.querySelector('.loot-tools'));}
 // The existing inventory selection pane and ammunition workbench already supply these actions.
 // Avoid rendering a second set of Inspect / Ammo controls.
 for(const [id,description] of [['sortChest','Sort the chest rig storage'],['sortBackpack','Sort backpack storage']]){const b=$(id);if(b)b.title=description+' (also available by right-clicking empty storage)'}
 setupInventoryContext();drawEquipment();
}
function drawEquipment(){const target=$('ux08GearContent');if(!target||!target.isConnected)return;
 const i=typeof selected!=='undefined'?findItem(selected):null;target.replaceChildren();
 if(!i){target.append(el('p','hint','Select a weapon, armor, magazine, or other item in Inventory to inspect its current configuration.'));return}
 const title=el('strong',null,`${i.name} · ${i.category}`);target.append(title);
 const details=el('div','ux08-stat-line');details.append(el('span',null,`Size: ${i.w||1}×${i.h||1}`),el('span',null,`Weight: ${i.weight??0} kg`));
 if(i.durabilityMax>0)details.append(el('span',null,`Condition: ${i.condition??i.durabilityMax}/${i.durabilityMax}`));
 if(i.category==='Weapon'){
  const partIds=[['Optic',i.opticId],['Magazine',i.magazineId],['Suppressor',i.suppressorId],['Upgrade kit',i.kitId]];
  const row=el('div','ux08-stat-line');for(const [label,id] of partIds)row.append(el('span','ux08-tag',`${label}: ${findItem(id)?.name||'None'}`));target.append(row);
  const stats=el('div','ux08-stat-line');for(const [label,key] of [['Accuracy','acc'],['Recoil','rcl'],['Bulk','bulk']]){
   const base=Number(i.gurps?.[key]??i[key]??0),calc=window.STALKER_EXT?.calculateStat?.(base,key,window.STALKER_EXT?.modifierSources?.(i)||[]);
   const node=el('span','ux08-tag',`${label}: ${calc?.value??base}`);if(calc?.parts?.length){const better=['rcl','bulk'].includes(key)?calc.value<base:calc.value>base;node.classList.add(better?'ux08-bonus':'ux08-penalty');node.title=`Base ${base}; `+calc.parts.map(p=>`${p.source}: ${p.op} ${p.value}`).join('; ')}stats.append(node)
  }target.append(stats);
  const footer=el('div','ux08-gear-tools');footer.append(action('View ammunition',()=>{const work=$('ammoWorkbench');if(work){work.classList.remove('ux-legacy-workbench');work.style.display='block';work.open=true;work.scrollIntoView({block:'nearest'})}}));target.append(footer);
  target.append(el('p','hint','To install optics, magazines, suppressors or upgrade kits, drag their inventory icons onto this weapon. Uninstallation is available only from the weapon’s right-click menu.'));
 }else if(i.category==='Magazine'){
  target.append(el('p','hint',`Loaded rounds: ${i.loadedRounds||0}/${i.gurps?.capacity||i.capacity||0} · ${i.loadedAmmoType||'Empty'}`));
 }else if(['Armor','Helmet','Vest','Clothing'].includes(i.category)){
  target.append(el('p','hint',`DR: ${i.gurps?.dr??i.dr??0} · DT: ${i.dt??0} · No separate armor plates`));
 }
}
function setupInventoryContext(){const menu=$('itemContextMenu');if(!menu)return;
 function open(event,heading,choices){event.preventDefault();event.stopPropagation();menu.replaceChildren();
  const title=el('div','ux08-menu-title',heading);menu.append(title);
  for(const [name,fn] of choices){const b=action(name,()=>{menu.hidden=true;fn()});menu.append(b)}
  menu.style.left=Math.max(5,Math.min(event.clientX,innerWidth-250))+'px';menu.style.top=Math.max(5,Math.min(event.clientY,innerHeight-220))+'px';menu.hidden=false;
 }
 for(const [selector,kind] of [['#characterPage .storage-panel','storage'],['#characterPage .loot-panel','loot']]){
  const nodes=document.querySelectorAll(selector);
  nodes.forEach(node=>node.addEventListener('contextmenu',event=>{
   if(event.target.closest('[data-item-id],input,select,button,details'))return;
   if(kind==='storage'){
    const chest=node.querySelector('#vestStorage')||node.querySelector('#sortChest');
    const button=$(chest?'sortChest':'sortBackpack');
    open(event,'Storage actions',[[button?.textContent||'Sort storage',()=>button?.click()],['Auto-pack loose items',()=>$('#autoPack')?.click()]]);
   }else open(event,'Inventory actions',[
     ['Auto-pack loose items',()=>$('#autoPack')?.click()],['Move selected to Loot',()=>window.STALKER_EXT?.selectedCount?.()>1?window.STALKER_EXT.transferGroupToLoot():$('#toLoose')?.click()],
     ['Rotate selected',()=>$('#rotate')?.click()],['Merge matching stacks',()=>$('#mergeStack')?.click()]
   ]);
  }));
 }
}
// Preserve selected item inspection after normal inventory re-renders.
if(typeof render==='function'){
 const oldRender=render;render=function(...args){const result=oldRender.apply(this,args);drawEquipment();return result};
}

// 2. A single GM combat workspace: direction, active actors, the roll and review.
let combatMode='npcToPlayer';
const advancedReturnPoints=[];
function initCombat(){const page=$('combatPage');if(!page||$('ux08UnifiedCombat'))return;
 const root=el('section','ux08-combat-unified');root.id='ux08UnifiedCombat';
 const title=el('div','ux08-panel-head');title.append(el('h2',null,'COMBAT CONTROL'),el('small','muted','Select combatants, roll, then decide whether injury is applied.'));
 const toggle=el('div','ux08-combat-toggle');
 const npcBtn=action('NPC attacks player',()=>setCombatMode('npcToPlayer'),'ux08-mode-btn');npcBtn.id='ux08NpcMode';
 const playerBtn=action('Player attacks NPC',()=>setCombatMode('playerToNpc'),'ux08-mode-btn');playerBtn.id='ux08PlayerMode';toggle.append(npcBtn,playerBtn);
 const npcPane=el('div','ux08-combat-pane');npcPane.id='ux08NpcPane';
 const playerPane=el('div','ux08-combat-pane');playerPane.id='ux08PlayerPane';
 const advancedPlayer=el('details','ux08-advanced ux08-gm-player-advanced');advancedPlayer.id='ux08GMPlayerAdvanced';advancedPlayer.append(el('summary',null,'Advanced GURPS maneuver, cover, hit location and defense settings'));
 const review=el('div','ux08-combat-review');review.id='ux08CombatReview';
 root.append(title,toggle,npcPane,playerPane,review);
 page.prepend(root);
 for(const id of ['npcAttackPanel']){const original=$(id);if(original)npcPane.append(original)}
 const encounterTargets=$('encounterTargetPanel'),playerAttack=$('gmAttackWorkspace');
 if(encounterTargets)playerPane.append(encounterTargets);
 if(playerAttack)playerPane.append(playerAttack);
 playerPane.append(advancedPlayer);
 for(const ident of ['uxTacticalDetails','uxInjuryDetails','uxPlayerAttackDetails']){
  const node=$(ident);if(!node)continue;const marker=document.createComment('Original combat panel position: '+ident);node.before(marker);advancedReturnPoints.push({node,marker});
 }
 // Collapse unusual attack modifiers while keeping actor/weapon, target and roll visible.
 const npc=$('npcAttackPanel');if(npc){
  const fields=npc.querySelector('.advanced-inputs');
  if(fields&&!$('ux08NPCAdvanced')){
   const more=el('details','ux08-advanced');more.id='ux08NPCAdvanced';more.append(el('summary',null,'Advanced attack modifiers, defenses, hit locations and armor'));
   for(const control of ['npcRcl','npcHitLocation','playerDefense','playerManualDefense','playerDROverride','npcAttackModifier']){
    const node=$(control)?.closest('label');if(node)more.append(node);
   }
   npc.insertBefore(more,fields.nextSibling);
  }
  npc.querySelector('h2')?.replaceChildren(document.createTextNode('NPC → PLAYER ATTACK'));
 }
 // Keep exactly one attack at a time, with review directly underneath.
 review.append(el('h3',null,'COMBAT REVIEW · MANUAL HP APPLICATION'));
 const desc=el('p','hint','Successful attacks calculate injury but never automatically change HP. Use Apply, Resolve without HP, or Ignore.');review.append(desc);
 const rows=el('div','ux08-combat-review-list');rows.id='ux08ReviewRows';review.append(rows);
 review.append(action('Open full combat log and backups',()=>nav('recovery','gm')));
 setCombatMode(combatMode);
}
function setCombatMode(mode){combatMode=mode==='playerToNpc'?'playerToNpc':'npcToPlayer';
 if($('ux08NpcPane'))$('ux08NpcPane').hidden=combatMode!=='npcToPlayer';
 if($('ux08PlayerPane'))$('ux08PlayerPane').hidden=combatMode!=='playerToNpc';
 for(const [id,expected] of [['ux08NpcMode','npcToPlayer'],['ux08PlayerMode','playerToNpc']]){
  const b=$(id);if(b){b.classList.toggle('ux08-selected',combatMode===expected);b.setAttribute('aria-pressed',String(combatMode===expected))}
 }
 renderCombatReview();
}
function allCombatEntries(){const source=[...(gm()?.pendingCombat||[]),...(typeof state==='object'?state.combatReview||[]:[])];return [...new Map(source.filter(x=>x&&x.id).map(x=>[x.id,x])).values()].sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')))}
function renderCombatReview(){const root=$('ux08ReviewRows');if(!root)return;root.replaceChildren();
 const records=allCombatEntries().slice(0,20);if(!records.length){root.append(el('p','hint','No combat calculations yet. Choose an attacker and defender above.'));return}
 for(const r of records){const line=el('div','ux08-review-row'),summary=el('div','ux08-review-main');
  summary.append(el('strong',null,`${r.actor||'Attacker'} → ${r.targetName||r.target||r.targetId||'Target'}`));
  summary.append(el('small','muted',`${r.status||'Calculated'} · ${Math.max(0,Number(r.injury)||0)} calculated injury · ${r.location||'Torso'}`));
  if(r.detail){const detail=el('details','ux08-review-detail');detail.append(el('summary',null,'Calculation breakdown'),el('pre',null,String(r.detail)));summary.append(detail)}
  line.append(summary);
  if(r.status==='Calculated'){
   const tools=el('div','ux08-review-buttons'),qty=el('input');qty.type='number';qty.value=String(Math.max(0,Number(r.injury)||0));qty.min='0';qty.max='100000';qty.setAttribute('aria-label','HP injury to apply');tools.append(qty);
   for(const [name,mode] of [['Apply injury','apply'],['Resolve','resolve'],['Ignore','ignore']])tools.append(action(name,()=>{
    const amount=Number(qty.value);if(mode==='apply'&&(!Number.isSafeInteger(amount)||amount<0||amount>100000))return msg('Enter a valid injury amount.');
    try{window.STALKER_EXT?.applyPending?.(r.id,mode,mode==='apply'?amount:0);renderCombatReview();if(typeof renderGM==='function')renderGM()}
    catch(e){console.error('GM combat review',e);msg('Could not resolve attack: '+e.message)}
   },mode==='apply'?'primary-action':''));
   line.append(tools);
  }root.append(line)
 }
}
function syncCombat(){if(!$('ux08UnifiedCombat'))return;
 const active=inGM()&&!$('combatPage')?.hidden;
 $('ux08UnifiedCombat').hidden=!active;
 const holding=$('ux08GMPlayerAdvanced');
 for(const entry of advancedReturnPoints){if(active){if(holding&&entry.node.parentElement!==holding)holding.append(entry.node)}else if(entry.marker.parentNode&&entry.node.previousSibling!==entry.marker){entry.marker.after(entry.node)}}
 // The legacy player and dice panels still retain all their original controls.
 // The GM uses only the compact consolidated workspace.
 for(const child of $('combatPage')?.children||[]){if(child.id==='ux08UnifiedCombat')continue;
  child.classList.toggle('ux08-gm-secondary-hidden',active);
 }
 if(active){setCombatMode(combatMode);renderCombatReview()}
}

// 3. NPC/mutant category folders. Reuses the original persistent category model.
function initFolders(){const page=$('npcsPage'),root=$('gmNpcList');if(!page||!root||$('ux08FolderTree'))return;
 const toolbar=page.querySelector('section.panel');if(!toolbar)return;
 const header=el('div','ux08-npc-heading');header.append(el('strong',null,'TEMPLATE LIBRARY'),el('small','muted','Right-click any template for its actions.'));
 const layout=el('div','ux08-library');layout.id='ux08Library';const sidebar=el('aside','ux08-library-sidebar');
 const tree=el('div','ux08-folder-tree');tree.id='ux08FolderTree';sidebar.append(header,tree);
 const folderBar=el('div','ux08-folder-toolbar');folderBar.id='ux08FolderToolbar';
 for(const id of ['npcAddCategory','npcRenameCategory','npcRemoveCategory']){const b=$(id);if(b){b.textContent=id==='npcAddCategory'?'+ Folder':id==='npcRenameCategory'?'Rename folder':'Delete folder';folderBar.append(b)}}
 sidebar.append(folderBar);
 const content=el('section','ux08-library-list');const caption=el('div','ux08-library-caption');caption.id='ux08FolderCaption';content.append(caption,root);
 toolbar.insertAdjacentElement('afterend',layout);layout.append(sidebar,content);
 const filters=page.querySelector('section.panel .inline-fields');if(filters){const hidden=el('details','ux08-advanced ux08-folder-filters');hidden.append(el('summary',null,'Advanced library filters'));hidden.append(filters);toolbar.append(hidden)}
 const observer=new MutationObserver(()=>{if(!page.hidden)renderFolders()});observer.observe(root,{childList:true});
 $('npcCreate')?.addEventListener('click',()=>{const type=$('npcTemplateTypeFilter')?.value;const cat=$('npcTemplateCategoryFilter')?.value;
  const form=$('npcForm');if(!form||!form.elements)return;if(type&&type!=='all'){
   const select=form.elements.namedItem('type');drive(select,type);
   const category=form.elements.namedItem('templateCategory');if(category&&cat&&cat!=='all')category.value=cat;
  }
 });
 for(const id of ['npcTemplateTypeFilter','npcTemplateCategoryFilter','npcAddCategory','npcRenameCategory','npcRemoveCategory'])$(id)?.addEventListener('change',renderFolders);
 // Original create, rename, delete handlers change GM state synchronously.
 for(const id of ['npcAddCategory','npcRenameCategory','npcRemoveCategory'])$(id)?.addEventListener('click',()=>queueMicrotask(renderFolders));
 renderFolders();
}
function renderFolders(){const tree=$('ux08FolderTree'),g=gm();if(!tree||!g)return;
 tree.replaceChildren();const types=[['Human','NPCs'],['Mutant','Mutants'],['Other','Other']];
 const currentType=$('npcTemplateTypeFilter')?.value||'all',currentCategory=$('npcTemplateCategoryFilter')?.value||'all';lastFolder={type:currentType,category:currentCategory};
 const total=g.npcs?.length||0;
 const folder=(name,type,category,count,level=0)=>{
  const b=action(name,()=>chooseFolder(type,category),'ux08-folder');b.dataset.folderType=type;b.dataset.folderCategory=category;b.style.paddingLeft=(12+level*15)+'px';
  b.classList.toggle('ux08-folder-active',currentType===type&&currentCategory===category);
  b.append(el('small','ux08-folder-count',String(count)));return b;
 };
 tree.append(folder('All templates','all','all',total));
 for(const [type,label] of types){const records=(g.npcs||[]).filter(x=>x.type===type);const branch=el('div','ux08-branch');branch.append(folder(label,type,'all',records.length));
  const names=g.templateCategories?.[type]||[];for(const category of names){branch.append(folder('▸ '+category,type,category,records.filter(x=>x.templateCategory===category).length,1))}
  const uncategorized=records.filter(x=>!x.templateCategory).length;branch.append(folder('▸ Uncategorized',type,'',uncategorized,1));tree.append(branch)
 }
 const caption=$('ux08FolderCaption');if(caption){const label=currentType==='all'?'All templates':(types.find(x=>x[0]===currentType)?.[1]||currentType);
  caption.textContent=`${label} · ${currentCategory==='all'?'All folders':currentCategory||'Uncategorized'} · Right-click a template or use ⋯ for actions`;
 }
}
function chooseFolder(type,category){const t=$('npcTemplateTypeFilter'),c=$('npcTemplateCategoryFilter');if(!t||!c)return;
 drive(t,type);drive(c,category);lastFolder={type,category};renderFolders();
}

// 4. Settings hidden until needed, without disabling fields or validation.
function advancedGroups(){const npc=$('npcForm');if(npc&&!$('ux08NPCEditorAdvanced')){
 const advanced=el('details','ux08-advanced ux08-dialog-advanced');advanced.id='ux08NPCEditorAdvanced';advanced.classList.add('full');
 advanced.append(el('summary',null,'Advanced NPC statistics, armor, and equipment'));
 for(const name of ['ST','DX','IQ','HT','Dodge','dr','dt','skill','token']){
  const input=npc.elements.namedItem(name);const label=input?.closest('label');if(label)advanced.append(label)
 }
 for(const id of ['npcGearTemplate','npcGearQuantity','npcGearAdd','npcGearDraft']){
  const field=$(id);const ancestor=field?.closest('label,.form-strip,.npc-gear-list')||field;
  if(ancestor&&ancestor.parentElement===npc)advanced.append(ancestor)
 }
 const menu=npc.querySelector('menu');npc.insertBefore(advanced,menu);
 }
 const f=$('itemForm'),dlg=$('itemDialog');if(f&&!$('ux08ItemEditorAdvanced')){
  const group=el('details','ux08-advanced ux08-item-editor-advanced');group.id='ux08ItemEditorAdvanced';group.classList.add('full');group.append(el('summary',null,'Advanced GURPS stats, storage grids and visual variants'));
  for(const sel of ['.gurps-fields','.image-variants','.storage-field','#storageLockNote','.source-image-file']){
   for(const node of [...f.querySelectorAll(sel)]){if(node.closest('#ux08ItemEditorAdvanced'))continue;
    if(node.closest('.gurps-fields,.image-variants')&&node.matches('label,input,textarea'))continue;
    if(node.parentElement===f||node.matches('fieldset'))group.append(node)
   }
  }
  const menu=f.querySelector('menu');f.insertBefore(group,menu);
  if(dlg)dlg.addEventListener('close',()=>{group.open=false});
 }
 // A large GM catalogue form remains available but its specialist fields start collapsed.
 const work=$('extWorkbench');if(work){
  const observer=new MutationObserver(()=>{const section=work.querySelector('section.panel:nth-child(2)');if(!section||section.querySelector('#ux08WorkbenchAdvanced'))return;
   const grid=section.querySelector('.ext-grid'),mods=section.querySelector('#extMods');if(!grid||!mods)return;
   const advanced=el('details','ux08-advanced');advanced.id='ux08WorkbenchAdvanced';advanced.append(el('summary',null,'Advanced compatibility, DR/DT, weapon statistics and modifiers'));
   // Move only controls from Mount/Model restrictions onward; preserve basic name, category, dimensions and value.
   for(const id of ['extModels','extProp','extMount','extMounts','extKitMounts','extConflicts','extAdapters','extDR','extDT','extKitRem','extDamage','extAcc','extRcl','extRoF','extCaliber','extCapacity']){
    const label=$(id)?.closest('label');if(label)advanced.append(label)
   }
   const modsLabel=mods.previousElementSibling,notes=modsLabel?.previousElementSibling;
   if(notes?.tagName==='H3'&&notes.textContent.includes('MODIFIERS'))advanced.append(notes);
   if(modsLabel?.tagName==='P')advanced.append(modsLabel);
   advanced.append(mods);grid.insertAdjacentElement('afterend',advanced);
  });observer.observe(work,{childList:true,subtree:false});
 }
}

// Single shared context control already exists for items and GM NPC cards.
// Keep buttons for frequent actions; secondary inventory actions are accessible
// by right-clicking blank areas of the inventory panels.
function syncAll(){syncCombat();drawEquipment();if(inGM()&&!$('npcsPage')?.hidden)renderFolders()}
function init(){initInventory();initCombat();initFolders();advancedGroups();
 const watcher=new MutationObserver(syncAll);
 watcher.observe(document.body,{attributes:true,attributeFilter:['data-mode']});
 for(const id of ['combatPage','npcsPage','characterPage'])if($(id))watcher.observe($(id),{attributes:true,attributeFilter:['hidden']});
 document.addEventListener('click',e=>{
  if(e.target.closest('#gmRollAgainstNpc,#performNpcAttack,#ux08ReviewRows'))setTimeout(renderCombatReview,30);
  if(e.target.closest('#npcTemplateTypeFilter,#npcTemplateCategoryFilter'))queueMicrotask(renderFolders);
 },true);
 syncAll();window.STALKER_UX08={version:'0.8',setCombatMode,renderFolders,drawEquipment,renderCombatReview,chooseFolder};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
