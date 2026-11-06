'use strict';
const {app,BrowserWindow,ipcMain,dialog,protocol,net,session,Menu} = require('electron');
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const {GcsService}=require('./gcs-service.cjs');
const {startServer}=require('../backend/server.cjs');
let currentServer=null,mainWindow=null;
protocol.registerSchemesAsPrivileged([{scheme:'stalker-asset',privileges:{secure:true,standard:true,supportFetchAPI:true,stream:true}}]);
function assetDir(){const dir=path.join(app.getPath('userData'),'item-assets');fs.mkdirSync(dir,{recursive:true});return dir}
function imageBuffer(raw){const buf=Buffer.from(raw);if(buf.length<1||buf.length>20*1024*1024)throw Error('Image must be 1 B–20 MB');return buf}
function imageType(buf){if(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return '.png';
 if(buf.subarray(0,3).equals(Buffer.from([255,216,255])))return '.jpg';
 if(buf.toString('ascii',0,4)==='RIFF'&&buf.toString('ascii',8,12)==='WEBP')return '.webp';
 throw Error('Only PNG, JPEG, and WebP assets are supported');}
function saveAsset(bytes){const buf=imageBuffer(bytes),extension=imageType(buf),name=crypto.createHash('sha256').update(buf).digest('hex')+extension;
 const fp=path.join(assetDir(),name);if(!fs.existsSync(fp))fs.writeFileSync(fp,buf,{flag:'wx'});
 return `stalker-asset://files/${name}`;}
// One packaged Windows suite: the complete native GCS is an owned workspace.
// Its files are read-only to STALKER; the GM's campaign state stays in STALKER.
let gcsService;
async function selectGcsExecutable(){
 const result=await dialog.showOpenDialog(mainWindow,{title:'Locate GURPS Character Sheet (gcs.exe)',properties:['openFile'],filters:[{name:'GCS for Windows',extensions:['exe']}]});
 if(result.canceled)return {cancelled:true};
 return gcsService.setExecutable(result.filePaths[0]);
}
async function linkGcsCharacter(profileId){
 const result=await dialog.showOpenDialog(mainWindow,{title:'Link a GCS character to this STALKER profile',properties:['openFile'],filters:[{name:'GCS character',extensions:['gcs']}]});
 if(result.canceled)return {cancelled:true};
 return gcsService.link(profileId,result.filePaths[0]);
}
app.whenReady().then(()=>{
 protocol.handle('stalker-asset',async request=>{
  let uri;try{uri=new URL(request.url)}catch{return new Response('Invalid asset URL',{status:400})}
  const name=decodeURIComponent(uri.pathname).replace(/^\//,'');
  if(uri.hostname!=='files'||!/^[a-f0-9]{64}\.(png|jpg|webp)$/.test(name))return new Response('Invalid asset',{status:400});
  const file=path.join(assetDir(),name);if(!fs.existsSync(file))return new Response('Asset not found',{status:404});
  return net.fetch(pathToFileURL(file).toString());
 });
 session.defaultSession.setPermissionRequestHandler((_contents,_permission,cb)=>cb(false));
 ipcMain.handle('assets:save',(_event,bytes)=>{try{return saveAsset(bytes)}catch(e){throw Error(e.message)}});
 ipcMain.handle('assets:choose',async()=>{const result=await dialog.showOpenDialog(mainWindow,{properties:['openFile'],filters:[{name:'Images',extensions:['png','jpg','jpeg','webp']}]});
  if(result.canceled)return null;return saveAsset(fs.readFileSync(result.filePaths[0]))});
 ipcMain.handle('app:version',()=>app.getVersion());
 gcsService=new GcsService({
  userData:app.getPath('userData'),resourcesPath:process.resourcesPath,
  appPath:app.getAppPath(),
  onFileChange: profileId=>mainWindow?.webContents?.send('gcs:file-changed',{profileId}),
  notifyLaunchError: error=>dialog.showErrorBox('Unable to open GCS',String(error.message||error))
 });
 ipcMain.handle('gcs:status',(_event,profileId)=>gcsService.status(profileId));
 ipcMain.handle('gcs:configure',()=>selectGcsExecutable());
 ipcMain.handle('gcs:open',()=>gcsService.launch());
 ipcMain.handle('gcs:link',(_event,profileId)=>linkGcsCharacter(profileId));
 ipcMain.handle('gcs:unlink',(_event,profileId)=>gcsService.unlink(profileId));
 ipcMain.handle('gcs:read',(_event,profileId)=>gcsService.read(profileId));
 ipcMain.handle('gcs:open-linked',(_event,profileId)=>gcsService.launch(profileId));
 function localDataFile(){const dir=path.join(app.getPath('userData'),'character-data');fs.mkdirSync(dir,{recursive:true});return path.join(dir,'profiles.json')}
 ipcMain.handle('data:read',()=>{try{return JSON.parse(fs.readFileSync(localDataFile(),'utf8'))}catch{return null}});
 ipcMain.handle('data:write',(_event,doc)=>{
  if(!doc||typeof doc!=='object'||!doc.keys||typeof doc.keys!=='object')throw Error('Invalid save data');
  for(const [key,value] of Object.entries(doc.keys)){if(!/^stalker-[a-z0-9-]+/.test(key)||typeof value!=='string'||value.length>8*1024*1024)throw Error('Invalid saved key')}
  const raw=JSON.stringify(doc);if(raw.length>12*1024*1024)throw Error('Character save exceeds 12 MB');
  const file=localDataFile(),tmp=file+'.tmp';fs.writeFileSync(tmp,raw);fs.renameSync(tmp,file);return true;
 });
 ipcMain.handle('server:start',async(_event,{port,password,campaignName}={})=>{
  if(currentServer)return {error:'Server is already running.'};
  if(!Number.isInteger(Number(port))||port<1024||port>65535)return {error:'Port must be 1024–65535'};
  if(typeof password!=='string'||password.length<8)return {error:'Session password must contain 8 or more characters'};
  try{currentServer=await startServer({port:Number(port),password,campaignName,dataDir:path.join(app.getPath('userData'),'campaign')});return {port:Number(port),hostSecret:currentServer.hostSecret};}
  catch(err){currentServer=null;return {error:err.message}};
 });
 ipcMain.handle('server:stop',async()=>{if(currentServer){await currentServer.close();currentServer=null;}return true});
 mainWindow=new BrowserWindow({width:1500,height:960,minWidth:920,minHeight:600,title:'S.T.A.L.K.E.R. GURPS — Unified Desktop Workspace',backgroundColor:'#0e1720',webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
 // Native navigation provides a fallback if the in-page controls stop responding.
 const playerPages=[['Inventory','character'],['Character Sheet','sheet'],['Status','status'],['Actions & Combat','combat'],['Journal','journal'],['Trader Shop','shop']];
 const gmPages=[['Dashboard','dashboard'],['Players','players'],['NPCs & Mutants','npcs'],['Encounters','encounters'],['Combat Control','gmcombat'],['Loot & Items','catalog'],['Zone','zone'],['Campaign','campaign'],['Settings','gmsettings'],['Workbench','workbench'],['Weapon Variants','variants'],['Pouch Designer','pouches'],['Traders','traders'],['Combat Review & Backups','recovery']];
 const navigationItem=(label,page,role)=>({label,click:()=>mainWindow?.webContents?.send('app:navigate',{page,role})});
 const menu=Menu.buildFromTemplate([
  {label:'File',submenu:[{role:'quit'}]},
  {label:'Pages',submenu:[
   {label:'Player',submenu:playerPages.map(([label,page])=>navigationItem(label,page,'player'))},
   {label:'Game Master',submenu:gmPages.map(([label,page])=>navigationItem(label,page,'gm'))}
  ]},
  {label:'GCS',submenu:[
   {label:'Open full GCS application',click:()=>gcsService.launch()},
   {label:'Open linked character workspace',click:()=>mainWindow?.webContents.send('app:navigate',{page:'sheet',role:'player'})},
   {label:'Link / change character file',click:()=>{mainWindow?.webContents.send('app:navigate',{page:'sheet',role:'player'});mainWindow?.webContents.send('gcs:request-link')}},
   {label:'Locate gcs.exe manually…',click:()=>selectGcsExecutable().catch(err=>dialog.showErrorBox('GCS configuration',err.message))}
  ]},
  {label:'View',submenu:[{role:'reload'},{role:'forceReload'},{role:'toggleDevTools'}]},
  {label:'Help',submenu:[{label:'Unified desktop workspace · GCS source: github.com/richardwilkes/gcs',enabled:false}]}
 ]);
 Menu.setApplicationMenu(menu);
 mainWindow.loadFile(path.join(__dirname,'..','index.html')).catch(e=>dialog.showErrorBox('Companion failed to load',e.message));
 mainWindow.webContents.on('did-finish-load',async()=>{
  try{const info=await mainWindow.webContents.executeJavaScript('window.STALKER_NAV_TEST?.diagnostics()');
   if(!info||info.pages?.length<13){dialog.showErrorBox('Companion incomplete',
    'The installed app did not load all pages. Reinstall Build 4.5 from the complete extracted ZIP.');}
  }catch(e){dialog.showErrorBox('Companion navigation error','Unable to inspect pages: '+e.message)}
 });
 mainWindow.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 mainWindow.webContents.on('will-navigate',(event,target)=>{if(!target.startsWith('file://'))event.preventDefault()});
 });
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit()});
app.on('before-quit',()=>{gcsService?.close();if(currentServer)currentServer.close().catch(()=>{})});
