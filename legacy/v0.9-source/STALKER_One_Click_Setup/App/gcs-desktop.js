/* STALKER + full native GCS desktop workspace.
 * GCS owns .gcs source files, STALKER owns campaign inventory/HP/FP.
 * This layer reuses app.js's existing importGcs function; no parallel rule engine.
 */
(()=>{
 'use strict';
 const bridge=window.stalkerDesktop;
 const sheet=document.getElementById('sheetPage');
 if(!bridge||!sheet)return; // Browser-only mode retains its ordinary file importer.

 const legacyImport=document.getElementById('gcsImport')?.closest('.panel');
 if(legacyImport)legacyImport.hidden=true; // No duplicate importer UI in desktop mode.
 const panel=document.createElement('section');
 panel.className='panel gcs-native-panel';
 panel.innerHTML=`<h2>GCS CHARACTER WORKSPACE</h2>
  <p class="page-help">The complete GURPS Character Sheet editor and its libraries open as a native desktop window. Link a character once; saving it in GCS refreshes STALKER automatically.</p>
  <div class="gcs-native-actions">
   <button id="gcsOpenLinked" class="primary-action" type="button">Edit linked character in GCS</button>
   <button id="gcsLinkFile" type="button">Link / change character</button>
   <button id="gcsSyncNow" type="button">Sync now</button>
   <button id="gcsOpenFull" type="button">GCS libraries &amp; editor</button>
  </div>
  <div class="gcs-connection"><div id="gcsConnectionSummary" role="status" aria-live="polite">Checking GCS…</div>
    <div id="gcsConnectionDetails" class="hint"></div>
    <button id="gcsFindExe" type="button" hidden>Locate gcs.exe</button>
    <button id="gcsUnlinkFile" type="button" hidden>Unlink character</button>
  </div>`;
 sheet.insertBefore(panel,sheet.querySelector('.panel'));
 const $=id=>panel.querySelector('#'+id);
 const summary=$('gcsConnectionSummary'), details=$('gcsConnectionDetails');
 const showMessage=(message,isError=false)=>{
  summary.textContent=message; summary.dataset.error=String(isError);
 };
 let currentProfile=null;
 let importInFlight=false;
 const profileId=()=>typeof activeProfile==='string'?activeProfile:'main';

 async function updateStatus(){
  const requestedProfile=profileId();
  currentProfile=requestedProfile;
  try {
   const status=await bridge.gcsStatus(requestedProfile);
   if(profileId()!==requestedProfile)return;
   $('gcsFindExe').hidden=status.available;
   $('gcsUnlinkFile').hidden=!status.linked;
   $('gcsOpenLinked').disabled=!status.available||!status.linked||!status.exists;
   $('gcsSyncNow').disabled=!status.linked||!status.exists;
   if(!status.available){showMessage('Full GCS is not installed in this build.');}
   else if(!status.linked){showMessage('GCS ready. Link a .gcs character to this profile.');}
   else if(!status.exists){showMessage('Linked character file is missing. Relink it.',true);}
   else{showMessage('Character linked · automatic synchronization enabled');}
   details.textContent=status.file
    ? 'Character: '+status.file+' · Imported stats and skills are GCS-owned; equipment, wounds and campaign notes stay in STALKER.'
    : 'No character linked. Use the full GCS editor to create a character, save it, then link the .gcs file here.';
  } catch(e){showMessage('GCS status error: '+e.message,true);}
 }

 async function synchronize(force=false){
  if(importInFlight)return;
  const id=profileId();
  importInFlight=true;
  try {
   const payload=await bridge.gcsRead(id);
   if(profileId()!==id)return; // Avoid applying file changes to a switched profile.
   if(!force && state.gcs?.sourceHash===payload.hash)return;
   // GCS contains authoritative BASE character data, not the current STALKER wounds.
   const alreadyHasSheet=!!state.gcs?.data;
   const previousHealth=state.conditions?.Health;
   const previousFatigue=state.conditions?.Fatigue;
   if(typeof profileSnapshots==='function')profileSnapshots(true);
   const file=new File([payload.content],payload.name,{type:'application/json'});
   await importGcs(file); // One importer, shared by manual and linked character workflows.
   if(profileId()!==id)throw Error('Active character changed during import. Review your profile.');
   if(alreadyHasSheet){
    // Preserve campaign wounds and fatigue rather than resetting to full on save in GCS.
    if(Number.isFinite(Number(previousHealth)))state.conditions.Health=Number(previousHealth);
    if(Number.isFinite(Number(previousFatigue)))state.conditions.Fatigue=Number(previousFatigue);
   }
   state.gcs.sourcePath=payload.path;
   state.gcs.sourceHash=payload.hash;
   state.gcs.lastSyncedAt=new Date().toISOString();
   save(); renderCharacter(); render();
   showMessage('GCS synchronized: '+payload.name+' · '+new Date().toLocaleTimeString());
  }catch(e){showMessage('Sync failed: '+e.message,true);console.error('GCS sync:',e);}
  finally{importInFlight=false;}
 }
 async function link(){
  try {
   const id=profileId();
   const r=await bridge.gcsLink(id);
   if(r?.cancelled||!r)return;
   if(profileId()!==id)return;
   await synchronize(true);
   await updateStatus();
  }catch(e){showMessage('Cannot link GCS character: '+e.message,true);}
 }
 async function openLinked(){
  try{const r=await bridge.gcsOpenLinked(profileId());if(r?.error)showMessage(r.error,true);}
  catch(e){showMessage('Cannot open GCS: '+e.message,true);}
 }
 async function openFull(){
  try{const r=await bridge.gcsOpen();if(r?.error)showMessage(r.error,true);}
  catch(e){showMessage('Cannot open GCS: '+e.message,true);}
 }
 $('gcsLinkFile').addEventListener('click',link);
 $('gcsSyncNow').addEventListener('click',()=>synchronize(true));
 $('gcsOpenLinked').addEventListener('click',openLinked);
 $('gcsOpenFull').addEventListener('click',openFull);
 $('gcsFindExe').addEventListener('click',async()=>{
  try{await bridge.gcsConfigure();await updateStatus()}catch(e){showMessage(e.message,true)}
 });
 $('gcsUnlinkFile').addEventListener('click',async()=>{
  if(!confirm('Unlink this GCS file from the active STALKER character? Existing imported stats will be retained.'))return;
  try{await bridge.gcsUnlink(profileId());await updateStatus()}
  catch(e){showMessage(e.message,true)}
 });
 bridge.onGcsFileChanged?.(async({profileId:changedId})=>{
  if(changedId===profileId()){
   // GCS saves atomically; defer reading until the write is complete.
   await new Promise(resolve=>setTimeout(resolve,400));
   await synchronize(false);
  }
 });
 bridge.onGcsLinkRequest?.(link);
 // app.js replaces profile selector options when a profile is created/selected.
 const selector=document.getElementById('profileSelect');
 selector?.addEventListener('change',()=>queueMicrotask(async()=>{
  await updateStatus(); await synchronize(false).catch(()=>{});
 }));
 if(selector){const observer=new MutationObserver(()=>{
  if(currentProfile!==profileId())updateStatus();
 });observer.observe(selector,{childList:true});}
 updateStatus().then(async()=>{
  try {if((await bridge.gcsStatus(profileId())).linked)await synchronize(false)}
  catch(e){showMessage('GCS link check failed: '+e.message,true)}
 });
})();
