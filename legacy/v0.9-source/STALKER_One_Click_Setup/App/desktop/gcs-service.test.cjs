'use strict';
const {test} = require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {GcsService,readCharacterFile,assertProfileId}=require('./gcs-service.cjs');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stalker-gcs-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'rookie.gcs');fs.writeFileSync(file,JSON.stringify({profile:{name:'Rookie'},attributes:{st:{value:11}},skills:[]}));
 return {dir,file};}
test('links per profile and retains .gcs source unchanged',t=>{const {dir,file}=fixture(t),before=fs.readFileSync(file);
 const s=new GcsService({userData:dir,resourcesPath:path.join(dir,'notbundled')});
 const payload=s.link('player-1',file);assert.equal(payload.name,'rookie.gcs');assert.equal(payload.hash.length,64);
 assert.equal(s.status('player-1').exists,true);assert.equal(s.status('player-2').linked,false);
 assert.deepEqual(fs.readFileSync(file),before);s.close();
 const reopened=new GcsService({userData:dir});assert.equal(reopened.read('player-1').hash,payload.hash);
 reopened.unlink('player-1');assert.equal(reopened.status('player-1').linked,false);reopened.close();});
test('rejects bad IDs, noncharacter documents and broken JSON',t=>{const {dir,file}=fixture(t);
 assert.throws(()=>assertProfileId('../escape'),/Invalid/);
 fs.writeFileSync(file,JSON.stringify({hello:'world'}));assert.throws(()=>readCharacterFile(file),/recognizable/);
 fs.writeFileSync(file,'{broken');assert.throws(()=>readCharacterFile(file),/valid UTF-8 JSON/);
 const s=new GcsService({userData:dir});assert.throws(()=>s.link('x',file));assert.equal(s.status('x').linked,false);s.close();});
test('uses bundled gcs.exe before scanning other paths',t=>{const {dir}=fixture(t);const resources=path.join(dir,'resources');
 fs.mkdirSync(path.join(resources,'gcs'),{recursive:true});fs.writeFileSync(path.join(resources,'gcs','gcs.exe'),'mock');
 const s=new GcsService({userData:dir,resourcesPath:resources,env:{}});
 assert.equal(s.status().available,true);assert.equal(s.status().bundled,true);s.close();});
test('watches a GCS file and sends profile-specific change notification',async t=>{
 const {dir,file}=fixture(t);
 let resolveChange;
 const changed=new Promise(resolve=>resolveChange=resolve);
 const s=new GcsService({userData:dir,onFileChange:resolveChange});
 t.after(()=>s.close());
 s.link('main',file);
 fs.writeFileSync(file,JSON.stringify({profile:{name:'Updated'},attributes:{st:{value:12}}}));
 const changedId=await Promise.race([changed,new Promise((_resolve,reject)=>setTimeout(()=>reject(Error('GCS file watch did not notify')),3500))]);
 assert.equal(changedId,'main');
 assert.equal(JSON.parse(s.read('main').content).profile.name,'Updated');
});

test('migrates prior beta GCS executable location without touching source',t=>{
 const {dir,file}=fixture(t);
 const exe=path.join(dir,'gcs.exe');fs.writeFileSync(exe,'mock');
 fs.writeFileSync(path.join(dir,'gcs-integration.json'),JSON.stringify({executable:exe}));
 const s=new GcsService({userData:dir,resourcesPath:path.join(dir,'notbundled'),env:{}});
 assert.equal(s.status().executable,exe);
 assert.equal(s.status().available,true);
 s.close();
});
