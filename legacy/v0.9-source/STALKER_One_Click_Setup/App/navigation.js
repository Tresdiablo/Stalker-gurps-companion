/* S.T.A.L.K.E.R. GURPS Companion Build 4.5 — single authoritative UI navigation.
   This file loads AFTER app.js and companion.js. It must remain usable if
   a renderer exception occurs in either file. No game state is mutated here.
*/
(()=>{
 'use strict';
 const NAV={
   player:[['character','Inventory'],['sheet','Character Sheet'],['status','Status'],['combat','Actions & Combat'],['journal','Journal'],['shop','Trader Shop']],
   gm:[['dashboard','Dashboard'],['players','Players'],['npcs','NPCs & Mutants'],['encounters','Encounters'],['gmcombat','Combat Control'],['catalog','Loot & Items'],['zone','Zone'],['campaign','Campaign'],['gmsettings','Settings'],['workbench','Workbench'],['variants','Weapon Variants'],['pouches','Pouch Designer'],['traders','Traders'],['recovery','Combat Review & Backups']]
 };
 const nav=document.querySelector('nav.page-tabs');
 if(!nav)return;
 // Extend Build 4.5's original tab strip instead of replacing its navigation system.
 for(const role of ['player','gm'])for(const [page,title] of NAV[role]){
  if(nav.querySelector(`button[data-role="${role}"][data-page="${page}"]`))continue;
  const b=document.createElement('button');b.type='button';b.dataset.role=role;b.dataset.page=page;b.textContent=title;nav.append(b);
 }
 const allPages=[...document.querySelectorAll('.page[id$="Page"]')];
 const pageButtons=[...nav.querySelectorAll('button[data-page][data-role]')];
 const roleButtons={player:document.getElementById('playerMode'),gm:document.getElementById('gmMode')};
 const errorRecord=[];
 const pushError=(code,error)=>{
   const msg=String(error?.stack||error?.message||error);
   errorRecord.push({when:new Date().toISOString(),code,message:msg.slice(0,2400)});
   if(errorRecord.length>30)errorRecord.shift();
   console.error('STALKER navigation:',code,error);
 };
 const safeRun=(name,fn)=>{
   try{return fn()}catch(e){pushError(name,e);return undefined}
 };
 const roleFor=page=>{
   for(const role of ['player','gm'])if(NAV[role].some(([id])=>id===page))return role;
   return null;
 };
 const connectedPlayer=()=>safeRun('network state',()=>window.STALKER_NAV_CONNECTED_ROLE?.()==='player')===true;
 const mode=()=>document.body.dataset.mode==='gm'?'gm':'player';
 const firstLine=document.createElement('div');firstLine.className='nav-primary';
 const existingSwitch=nav.querySelector('.view-switch');
 const pickerGroup=document.createElement('div');pickerGroup.className='nav-picker';
 const label=document.createElement('label');label.className='nav-picker-label';label.htmlFor='pageNavigator';label.textContent='OPEN PAGE';
 const picker=document.createElement('select');picker.className='nav-picker-select';picker.id='pageNavigator';picker.setAttribute('aria-label','Choose application page');
 const hint=document.createElement('span');hint.className='nav-picker-hint';hint.id='navPickerHint';
 const smallStatus=document.createElement('span');smallStatus.className='nav-build-status';smallStatus.id='navBuildStatus';smallStatus.textContent='Unified Desktop · v0.9';
 pickerGroup.append(label,picker,hint);
 if(existingSwitch)firstLine.append(existingSwitch);
 firstLine.append(pickerGroup,smallStatus);
 // Frequent destinations are always visible; the full page list stays in one menu.
 const shortcuts=document.createElement('div');shortcuts.className='nav-shortcuts';
 const frequent={player:['character','sheet','combat'],gm:['dashboard','npcs','encounters','gmcombat','catalog']};
 const linkLine=document.createElement('div');linkLine.className='nav-links';linkLine.id='allPageLinks';linkLine.hidden=true;
 const more=document.createElement('button');more.type='button';more.className='nav-more';more.textContent='All pages';more.setAttribute('aria-expanded','false');more.setAttribute('aria-controls','allPageLinks');
 more.addEventListener('click',()=>{const open=linkLine.hidden;linkLine.hidden=!open;more.setAttribute('aria-expanded',String(open));more.textContent=open?'Hide pages':'All pages'});
 firstLine.insertBefore(more,smallStatus);
 for(const button of pageButtons)linkLine.append(button);
 nav.replaceChildren(firstLine,shortcuts,linkLine);
 function syncShortcuts(role,activePage){
   shortcuts.replaceChildren();
   for(const id of frequent[role]){
     const item=NAV[role].find(([key])=>key===id);if(!item)continue;
     const b=document.createElement('button');b.type='button';b.textContent=item[1];b.className='nav-shortcut';
     b.classList.toggle('active',id===activePage);b.setAttribute('aria-current',id===activePage?'page':'false');
     b.addEventListener('click',()=>route(id,role));shortcuts.append(b);
   }
 }
 // Keep the original action elements, their IDs, and attached listeners intact.
 const toolbar=document.querySelector('.profilebar');
 if(toolbar){
   const manage=document.createElement('details');manage.className='desktop-tools';
   const summary=document.createElement('summary');summary.textContent='Profile & saves';manage.append(summary);
   const actions=document.createElement('div');actions.className='desktop-tools-content';
   for(const id of ['profileNew','profileRename','profileDelete','manualBackup','restoreBackup','export','import','reset']){
     const button=document.getElementById(id);if(button)actions.append(button);
   }
   manage.append(actions);toolbar.append(manage);
   for(const separator of toolbar.querySelectorAll('.tool-separator'))separator.remove();
   document.addEventListener('pointerdown',event=>{if(manage.open&&!manage.contains(event.target))manage.open=false});
 }

 let selected=mode()==='gm'?'dashboard':'character';
 let locked=false;
 function sync(){
   const role=mode(),items=NAV[role];
   const prior=picker.value;
   const options=Array.from(picker.options).map(o=>o.value).join(',');
   if(options!==items.map(x=>x[0]).join(',')){
     picker.replaceChildren(...items.map(([id,title])=>{
       const o=document.createElement('option');o.value=id;o.textContent=title;return o;
     }));
   }
   const active=pageButtons.find(b=>b.classList.contains('active')&&b.dataset.role===role);
   const toSelect=(active&&active.dataset.page)|| (roleFor(selected)===role?selected:items[0][0]);
   if(items.some(([k])=>k===toSelect))picker.value=toSelect;
   hint.textContent=role==='gm'?'GM workspace':'Player workspace';
   syncShortcuts(role,picker.value);
   for(const b of pageButtons){
     b.setAttribute('aria-current',b.dataset.page===picker.value&&b.dataset.role===role?'page':'false');
     b.setAttribute('aria-hidden',b.dataset.role===role?'false':'true');
   }
   if(roleButtons.player)roleButtons.player.classList.toggle('selected',role==='player');
   if(roleButtons.gm)roleButtons.gm.classList.toggle('selected',role==='gm');
 }
 function fallbackShow(page,role){
   // Crucial: selecting a page is never dependent on a successful stats/GM render.
   const panelId=(page==='gmcombat'?'combat':page)+'Page';
   for(const p of allPages)p.hidden=p.id!==panelId;
   document.body.dataset.mode=role;
   for(const b of pageButtons){
     const active=b.dataset.page===page&&b.dataset.role===role;
     b.classList.toggle('active',active);
     b.setAttribute('aria-current',active?'page':'false');
   }
   selected=page;
   sync();
   if(!allPages.some(p=>p.id===panelId)){
     smallStatus.textContent='Missing page in installed files: '+panelId;
     smallStatus.dataset.warning='true';
     pushError('missing page',new Error(panelId));
   } else if(errorRecord.length){
     smallStatus.textContent='Unified Desktop · Navigation repaired ('+errorRecord.length+' diagnostic event'+(errorRecord.length===1?'':'s')+')';
     smallStatus.dataset.warning='true';
   }
 }
 function route(page,forcedRole){
   const role=forcedRole||roleFor(page);
   if(!role || !NAV[role].some(([id])=>id===page))return false;
   if(role==='gm'&&connectedPlayer()){
     smallStatus.textContent='GM pages unavailable in a connected player session.';
     smallStatus.dataset.warning='true';
     return false;
   }
   if(locked)return false;
   locked=true;
   try{
     if(mode()!==role){safeRun('setMode',()=>typeof window.setMode==='function'&&window.setMode(role,false));}
     document.body.dataset.mode=role;
     safeRun('showPage '+page,()=>typeof window.showPage==='function'&&window.showPage(page));
     fallbackShow(page,role);
     return true;
   }finally{locked=false}
 }
 // Capture handles buttons before any older, nested event handlers can interfere.
 nav.addEventListener('click',event=>{
   const b=event.target.closest('button');if(!b||!nav.contains(b))return;
   if(b.id==='playerMode'||b.id==='gmMode'){
     event.preventDefault();event.stopImmediatePropagation();
     route(b.id==='gmMode'?'dashboard':'character');return;
   }
   if(b.hasAttribute('data-page')&&b.hasAttribute('data-role')){
     event.preventDefault();event.stopImmediatePropagation();route(b.dataset.page,b.dataset.role);
   }
 },true);
 document.addEventListener('keydown',event=>{
   if(event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.key.toLowerCase()==='k'){event.preventDefault();picker.focus();return}
   if(event.key==='Escape'&&!linkLine.hidden){more.click()}
 });
 picker.addEventListener('change',event=>{
   event.stopImmediatePropagation();
   const requested=picker.value;
   if(!route(requested))sync();
 },true);
 // Internal game actions may call showPage without going through the nav strip.
 // Observe active/class/hidden changes instead of wrapping another showPage layer.
 let pending=false;
 const observer=new MutationObserver(()=>{
   if(pending||locked)return;
   pending=true;queueMicrotask(()=>{pending=false;if(!locked)sync()});
 });
 for(const b of pageButtons)observer.observe(b,{attributes:true,attributeFilter:['class']});
 observer.observe(document.body,{attributes:true,attributeFilter:['data-mode']});
 function diagnostics(){
   return {version:'4.5 + integrated beta 0.8',mode:mode(),selected:picker.value,pages:allPages.map(x=>({id:x.id,hidden:x.hidden})),
     buttons:pageButtons.map(x=>({page:x.dataset.page,role:x.dataset.role})),errors:[...errorRecord]};
 }
 window.STALKER_NAV_TEST={route,diagnostics,sync,pages:()=>pageButtons.map(x=>({id:x.dataset.page,role:x.dataset.role}))};
 window.addEventListener('error',e=>{if(e.error)pushError('runtime',e.error)});
 window.addEventListener('unhandledrejection',e=>pushError('async',e.reason));
 if(window.stalkerDesktop?.onNavigate)window.stalkerDesktop.onNavigate(({page,role})=>route(page,role));
 sync();
 // Initialization must display a valid page even if existing scripts broke.
 const active=pageButtons.find(x=>x.classList.contains('active')&&x.dataset.role===mode());
 const initial=(active?.dataset.page)||(mode()==='gm'?'dashboard':'character');
 fallbackShow(initial,mode());
})();
