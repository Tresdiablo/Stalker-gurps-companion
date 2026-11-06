"""Headless Chromium contract test for the desktop renderer using a mocked Electron preload.
This does NOT claim to test native Windows GCS or an NSIS installer.
"""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

APP=Path(__file__).resolve().parent.parent
INIT=r'''(() => {
 const mock={linked:false,path:'C:\\gcs\\rookie.gcs',content:JSON.stringify({profile:{name:'Stalker One'},attributes:{st:{calc:{value:11}},dx:{calc:{value:12}},iq:{calc:{value:11}},ht:{calc:{value:12}},hp:{calc:{value:11}},fp:{calc:{value:12}}},skills:[{name:'Guns (Rifle)',level:14}],traits:[]}),hash:'originalhash',callback:null};
 window.__gcsMock=mock;
 window.stalkerDesktop={
   gcsStatus:async()=>({available:true,bundled:true,linked:mock.linked,file:mock.linked?mock.path:null,exists:mock.linked,executable:'C:\\GCS\\gcs.exe'}),
   gcsLink:async()=>{mock.linked=true;return {name:'rookie.gcs',path:mock.path,content:mock.content,hash:mock.hash}},
   gcsUnlink:async()=>{mock.linked=false;return {linked:false}},
   gcsRead:async()=>({name:'rookie.gcs',path:mock.path,content:mock.content,hash:mock.hash}),
   gcsOpenLinked:async()=>({launched:true}),gcsOpen:async()=>({launched:true}),
   gcsConfigure:async()=>({path:'gcs.exe'}),
   onGcsFileChanged:fn=>{mock.callback=fn},onGcsLinkRequest:fn=>{mock.linkRequest=fn},
   onNavigate:()=>{},chooseImage:async()=>{},saveImage:async()=>{},appVersion:async()=>('0.9.0')
 };
 window.confirm=()=>true;window.alert=()=>{};
})();'''

async def run():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1440,'height':900})
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.goto('about:blank')
  await page.evaluate(INIT)
  await page.evaluate("() => {const store={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>delete store[k],key:i=>Object.keys(store)[i]??null,get length(){return Object.keys(store).length}}});}")
  html=(APP/'index.html').read_text()
  for f in ['app.css','companion.css','integrated.css','ux08.css','desktop-clean.css']:
   html=html.replace(f'<link href="{f}" rel="stylesheet"/>','<style>'+(APP/f).read_text()+'</style>')
  for f in ['app.js','companion.js','navigation.js','integrated.js','ux08.js','gcs-desktop.js']:
   html=html.replace(f'<script src="{f}"></script>','<script>'+(APP/f).read_text().replace('</script','<\\/script')+'</script>')
  await page.set_content(html)
  await page.wait_for_timeout(400)
  assert await page.locator('#gcsLinkFile').count()==1
  assert await page.locator('#gcsImport').count()==1
  assert await page.locator('#gcsImport').evaluate('(el)=>el.closest(".panel").hidden')
  assert await page.locator('#gcsImport').evaluate('(el)=>getComputedStyle(el.closest(".panel")).display')=='none'
  await page.locator('#pageNavigator').select_option('sheet')
  await page.locator('#gcsLinkFile').click(force=True)
  await page.wait_for_timeout(120)
  sheet=await page.evaluate('({name:state.identity.Name,hash:state.gcs?.sourceHash,st:state.stats.ST,linked:__gcsMock.linked})')
  assert sheet=={'name':'Stalker One','hash':'originalhash','st':11,'linked':True},sheet
  await page.evaluate('state.conditions.Health=7;save();__gcsMock.hash="updatedhash"; __gcsMock.content=JSON.stringify({...JSON.parse(__gcsMock.content),skills:[{name:"Guns (Rifle)",level:15}]})')
  await page.evaluate('__gcsMock.callback({profileId:"main"})')
  await page.wait_for_timeout(650)
  details=await page.evaluate('({health:state.conditions.Health,hash:state.gcs?.sourceHash,skill:state.gcs?.data?.skills?.[0]?.level})')
  assert details=={'health':7,'hash':'updatedhash','skill':15},details
  if os.environ.get('STALKER_PREVIEW_PATH'):
   await page.screenshot(path=os.environ['STALKER_PREVIEW_PATH'],full_page=False)
  await page.locator('#gcsUnlinkFile').click(force=True)
  assert not await page.evaluate('__gcsMock.linked')
  assert await page.evaluate('state.gcs?.data?.profile?.name')=='Stalker One'
  print('DESKTOP RENDERER GCS CONTRACT TEST PASSED:',sheet,details,'errors:',errors[:3])
  await browser.close()

if __name__=='__main__':asyncio.run(run())
