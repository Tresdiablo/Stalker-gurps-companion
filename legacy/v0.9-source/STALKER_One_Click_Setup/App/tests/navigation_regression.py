import asyncio,sys
from pathlib import Path
from playwright.async_api import async_playwright
APP=Path(__file__).resolve().parent.parent
async def check(seed=None,viewport=(980,700)):
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  p=await browser.new_page(viewport={'width':viewport[0],'height':viewport[1]})
  errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
  s=(APP/'index.html').read_text()
  for f in ['app.css','companion.css']:s=s.replace(f'<link href="{f}" rel="stylesheet"/>','<style>'+(APP/f).read_text()+'</style>')
  for f in ['app.js','companion.js','navigation.js']:s=s.replace(f'<script src="{f}"></script>','<script>'+(APP/f).read_text()+'</script>')
  await p.evaluate('''() => {const store={};window.__TEST_STORE=store;Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>delete store[k],key:i=>Object.keys(store)[i]??null,get length(){return Object.keys(store).length}}});window.confirm=()=>true;window.alert=()=>{};}''')
  if seed:await p.evaluate('(s)=>{for(const [k,v] of Object.entries(s)) localStorage.setItem(k,v)}',seed)
  await p.set_content(s,timeout=15000);await p.wait_for_timeout(200)
  init=await p.evaluate('window.STALKER_NAV_TEST?.diagnostics()');print('INIT',bool(init),init and (init['version'],init['selected'],len(init['pages'])),'ERR',errors[:3]);assert init and len(init['pages'])==19
  results=[]
  for role,ids in [('player',['character','sheet','status','combat','journal']),('gm',['dashboard','players','npcs','encounters','gmcombat','catalog','zone','campaign','gmsettings'])]:
   await p.locator('#'+('playerMode' if role=='player' else 'gmMode')).click(force=True)
   for id in ids:
    await p.locator('#pageNavigator').select_option(id)
    await p.wait_for_timeout(20)
    x=await p.evaluate('''() => ({mode:document.body.dataset.mode,sel:document.getElementById('pageNavigator').value,visible:[...document.querySelectorAll('.page')].filter(n=>!n.hidden&&getComputedStyle(n).display!=='none').map(n=>n.id),navErr:window.STALKER_NAV_TEST.diagnostics().errors})''')
    expected=('combat' if id=='gmcombat' else id)+'Page'
    ok=x['mode']==role and x['sel']==id and x['visible']==[expected]
    results.append((id,ok,x['visible'],len(x['navErr'])))
    if not ok: print('FAIL',role,id,x)
   # check buttons directly too
   await p.locator(f'button[data-page="{ids[-2]}"]').click(force=True)
   x=await p.evaluate('window.STALKER_NAV_TEST.diagnostics()');assert x['selected']==ids[-2], x
  print('RESULT',len(results),'/',sum(int(x[1]) for x in results), 'ERRORS',errors[-3:]);assert all(x[1] for x in results)
  # security: connected player cannot navigate GM, cannot use role switch
  await p.evaluate("window.STALKER_NAV_CONNECTED_ROLE=()=> 'player'")
  await p.locator('#playerMode').click(force=True)
  await p.locator('#gmMode').click(force=True)
  assert (await p.evaluate('document.body.dataset.mode'))=='player'
  assert not await p.evaluate("window.STALKER_NAV_TEST.route('npcs','gm')")
  print('CONNECTED security',True)

  await p.evaluate("window.STALKER_NAV_CONNECTED_ROLE=()=>null; window.showPage=()=>{throw Error('Simulated legacy rendering crash')}; window.setMode=()=>{throw Error('Simulated role crash')}; void 0")
  await p.locator('#pageNavigator').select_option('sheet')
  rescued=await p.evaluate("() => ({page:[...document.querySelectorAll('.page')].filter(x=>!x.hidden).map(x=>x.id),errors:window.STALKER_NAV_TEST.diagnostics().errors.length})")
  assert rescued['page']==['sheetPage'] and rescued['errors']>=1,rescued
  print('ERROR RECOVERY',rescued)
  await browser.close();return errors
async def main():
 await check()
 print('--- persisted state ---')
 seed={'stalker-companion-view':'gm','stalker-gurps-companion-gm-v4':'{"version":4,"npcs":[],"encounters":[],"history":[],"checkpoints":[],"players":{},"activeEncounter":null}'}
 await check(seed,viewport=(650,800))
asyncio.run(main())
