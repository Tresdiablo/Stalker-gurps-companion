import asyncio, json, pathlib, tempfile, os, subprocess, socket, time
from playwright.async_api import async_playwright
APP=pathlib.Path(__file__).resolve().parent.parent
async def run():
 server=subprocess.Popen(['python','-m','http.server','8877','--bind','127.0.0.1','--directory',str(APP)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 await asyncio.sleep(.4)
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-web-security'])
  page=await browser.new_page(viewport={'width':1450,'height':900})
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  await page.evaluate('''() => {const store={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>delete store[k],key:i=>Object.keys(store)[i]??null,get length(){return Object.keys(store).length}}});window.confirm=()=>true;window.prompt=(msg,defaultValue)=>defaultValue||'1';}''')
  html=(APP/'index.html').read_text()
  for f in ['app.css','companion.css','integrated.css']:
   html=html.replace(f'<link href="{f}" rel="stylesheet"/>','<style>'+(APP/f).read_text()+'</style>')
  for f in ['app.js','companion.js','navigation.js','integrated.js']:
   html=html.replace(f'<script src="{f}"></script>','<script>'+(APP/f).read_text()+'</script>')
  await page.set_content(html,wait_until='domcontentloaded',timeout=30000)
  await page.wait_for_timeout(300)
  diag=await page.evaluate('window.STALKER_NAV_TEST?.diagnostics()')
  print('INIT',diag and (diag['selected'],len(diag['pages']),len(diag['buttons'])), 'JSERR',errors[:5])
  assert diag and len(diag['pages'])>=20,diag
  for role in ['player','gm']:
   for view in ['character','sheet','status','combat','journal','equipment','shop'] if role=='player' else ['dashboard','players','npcs','encounters','gmcombat','catalog','zone','campaign','gmsettings','workbench','variants','pouches','armorlab','traders','recovery']:
    await page.evaluate('(arg)=>window.STALKER_NAV_TEST.route(arg[0],arg[1])',[view,role]);await page.wait_for_timeout(60)
    visible=await page.evaluate('''() => [...document.querySelectorAll('.page')].filter(p=>!p.hidden&&getComputedStyle(p).display!=='none').map(p=>p.id)''')
    assert visible==[("combat" if view=='gmcombat' else view)+'Page'],(view,visible)
  print('NAV ALL',len(diag['pages']))
  await page.evaluate("window.STALKER_NAV_TEST.route('workbench','gm')")
  await page.locator('[data-ext="createDefinition"]').click()
  await page.locator('#extName').fill('Audit Test Armor Plate')
  await page.locator('#extCategory').select_option('Armor Plate')
  await page.locator('#extDR').fill('20')
  await page.locator('#extDP').fill('30')
  await page.locator('#extValue').fill('2000')
  await page.locator('[data-ext="saveDefinition"]').click()
  print('PLATE DEF',await page.locator('#extName').input_value())
  await page.locator('#extCategory').select_option('Armor')
  await page.locator('#extName').fill('Audit Carrier')
  await page.locator('#extCarrier').select_option('yes')
  await page.locator('[data-ext="createDefinition"]').click()
  await page.locator('#extCategory').select_option('Armor')
  await page.locator('#extName').fill('Audit Carrier')
  await page.locator('#extCarrier').select_option('yes')
  await page.locator('[data-ext="saveDefinition"]').click()
  defs=await page.evaluate("() => ({plate:state.catalog.find(x=>x.name==='Audit Test Armor Plate'),carrier:state.catalog.find(x=>x.name==='Audit Carrier')})")
  assert defs['plate'] and defs['carrier']
  await page.evaluate('''d=>{window.STALKER_EXT.spawn(d.plate.id);window.STALKER_EXT.spawn(d.carrier.id)}''',defs)
  await page.evaluate("window.STALKER_NAV_TEST.route('equipment','player')")
  await page.wait_for_timeout(120)
  await page.locator('#extCarrierSelect').select_option(await page.evaluate("() => state.items.find(x=>x.name==='Audit Carrier').id"))
  await page.locator('#extPlatefront').select_option(await page.evaluate("() => state.items.find(x=>x.name==='Audit Test Armor Plate').id"))
  await page.locator('[data-ext="installPlate"][data-slot="front"]').click()
  res=await page.evaluate("() => {const carrier=state.items.find(x=>x.name==='Audit Carrier');const plate=state.items.find(x=>x.name==='Audit Test Armor Plate');return {slot:carrier.plateSlots.front,plate:plate.id,location:plate.location}}");assert res['slot']==res['plate'] and res['location']=='installedPlate',res
  print('PLATE SWAP',res)
  await page.evaluate("window.STALKER_NAV_TEST.route('armorlab','gm')")
  await page.locator('#extPlateDamagefront').fill('9')
  await page.locator('[data-ext="plateHit"][data-slot="front"]').click()
  after=await page.evaluate("() => state.items.find(x=>x.name==='Audit Test Armor Plate').plateDP")
  assert after==21,after
  print('PLATE DP',after)
  await page.evaluate("window.STALKER_NAV_TEST.route('traders','gm')")
  await page.locator('[data-ext="generateTrader"]').click()
  shops=await page.evaluate("() => window.STALKER_EXT.getGM().integrated.traders")
  assert shops
  print('SHOPS',len(shops))
  await page.evaluate("window.STALKER_NAV_TEST.route('recovery','gm')")
  await page.locator('[data-ext="snapshot"]').click()
  snap=await page.evaluate("() => window.STALKER_EXT.getGM().integrated.snapshots.length")
  assert snap>=1
  print('SNAPSHOT',snap)
  # Underlying item definitions must remain independent from physical instances.
  result=await page.evaluate("""() => {const t=state.catalog.find(x=>x.name==='Audit Carrier');const c=state.items.find(x=>x.templateId===t.id);const p=state.items.find(x=>x.name==='Audit Test Armor Plate');return [t.plateSlots.front||null,c.plateSlots.front,p.plateDP]}""")
  assert result[0] is None and result[1] and result[2]==21,result
  print('INSTANCE ISOLATION',result)
  # A sale must reject any carrier that still owns installed plates.
  trade=await page.evaluate("""() => {
     const gm=window.STALKER_EXT.getGM(),sh=gm.integrated.traders[0];sh.openTo=[activeProfile];
     const t=state.catalog.find(x=>x.name==='Audit Carrier');sh.stock.push({templateId:t.id,price:100,qty:5,initialQty:5});
     const before=state.items.filter(x=>x.name==='Audit Carrier').length;
     state.money=1000;
     let refused=false;try{window.STALKER_EXT.transaction(sh.id,t.id,1,'sell')}catch(e){refused=true}
     const after=state.items.filter(x=>x.name==='Audit Carrier').length;
     return {refused,before,after,stock:sh.stock.at(-1).qty};
  }""")
  assert trade['refused'] and trade['before']==trade['after'] and trade['stock']==5,trade
  print('SAFE CARRIER SALE',trade)
  # A finite-stock purchase is atomic, with money and inventory changes matching.
  purchase=await page.evaluate("""() => {
     const gm=window.STALKER_EXT.getGM(),sh=gm.integrated.traders[0];
     const t=state.catalog.find(x=>x.name==='Audit Test Armor Plate');
     if(!t)throw Error('No priced catalog item for purchase test');
     sh.stock.push({templateId:t.id,price:3,qty:7,initialQty:7});const before=state.items.filter(x=>x.templateId===t.id).reduce((a,x)=>a+(x.quantity||1),0);
     const spent=window.STALKER_EXT.transaction(sh.id,t.id,3,'buy');
     const after=state.items.filter(x=>x.templateId===t.id).reduce((a,x)=>a+(x.quantity||1),0);
     const left=sh.stock.find(x=>x.templateId===t.id).qty;
     return {spent,before,after,left,money:state.money,templateId:t.id};
  }""")
  assert purchase['spent']==9 and purchase['after']==purchase['before']+3 and purchase['money']==991 and purchase['left']==4,purchase
  print('ATOMIC TRADER PURCHASE',purchase)
  invalid=await page.evaluate("""() => {const sh=window.STALKER_EXT.getGM().integrated.traders[0];const t=sh.stock.find(x=>x.qty===4);const before=state.money;let fail=false;try{window.STALKER_EXT.transaction(sh.id,t.templateId,5,'buy')}catch(e){fail=true}return {fail,sameMoney:before===state.money}}""")
  assert invalid['fail'] and invalid['sameMoney'],invalid
  print('OVERSOLD STOCK BLOCKED',invalid)
  # Storage items stay bound to their physical container when carried/dropped.
  carried=await page.evaluate("""() => {
    const c=state.items.find(x=>x.name==='Audit Carrier');
    c.armorStorage=true;c.storageW=4;c.storageH=4;c.compartments=[{x:0,y:0,w:4,h:4}];
    // use the original shared container engine
    const worn={...c,id:'audit-carrier-bag',name:'Audit rig',category:'Vest',location:'slot',slot:'vest'};state.items.push(worn);state.slots.vest=worn.id;
    const t=state.catalog.find(x=>x.name==='Audit Test Armor Plate');const small={...t,category:'Misc',id:'audit-child',name:'Pocket rounds',w:1,h:1,location:'vestGrid',x:0,y:0,quantity:1};state.items.push(small);
    unequipToLoose(worn);
    const stowed=small.location==='contained'&&small.containerId===worn.id;
    worn.location='slot';worn.slot='vest';state.slots.vest=worn.id;
    restoreContainerContents(worn,'vest');
    const restored=small.location==='vestGrid';
    return {stowed,restored};
  }""")
  assert carried['stowed'] and carried['restored'],carried
  print('PORTABLE CONTENTS',carried)
  # Plate DR includes only intact installed plates, and facing stays separate.
  arm=await page.evaluate("""() => {const c=state.items.find(x=>x.name==='Audit Carrier');c.location='slot';c.slot='armor';state.slots.armor=c.id;const full=window.STALKER_EXT.armorFor(state,'Torso','front').dr;const back=window.STALKER_EXT.armorFor(state,'Torso','back').dr;const plate=state.items.find(x=>x.name==='Audit Test Armor Plate');plate.plateDP=0;const broken=window.STALKER_EXT.armorFor(state,'Torso','front').dr;return {full,back,broken}}""")
  assert arm['full']>arm['broken'] and arm['back']==arm['broken'],arm
  print('DIRECTIONAL PLATE DR',arm)
  # Explicit GM HP changes require manual Apply; calculated pending state alone is non-mutating.
  pending=await page.evaluate("""() => {const gm=window.STALKER_EXT.getGM();const record={id:'audit-manual-pending',at:new Date().toISOString(),kind:'player',actor:'Auditor',target:'Test target',injury:5,status:'Calculated',detail:'Test attack'};state.combatReview.unshift(record);const before=state.targetHP;window.STALKER_NAV_TEST.route('recovery','gm');window.STALKER_EXT.applyPending(record.id,'ignore',0);return {before,after:state.targetHP,status:record.status}}""")
  assert pending['before']==pending['after'] and pending['status']=='Ignored',pending
  print('MANUAL HP AUTHORITY',pending)
  # Physical weapon attachments modify statistics without altering their shared definition.
  optic=await page.evaluate("""() => {
    const wd={id:'audit-gun-def',name:'Test rifle',category:'Weapon',w:5,h:2,weight:4,value:1500,stackSize:1,mounts:['Picatinny'],gurps:{damage:'5d pi',acc:'4',rcl:'2',rof:'3'}};
    const od={id:'audit-optic-def',name:'Test sight',category:'Optic',w:1,h:1,weight:.5,value:200,stackSize:1,mountType:'Picatinny',modifiers:[{stat:'acc',op:'add',value:1}]};
    state.catalog.push(wd,od);const w={...wd,id:'audit-gun',templateId:wd.id,location:'loose'};const o={...od,id:'audit-optic',templateId:od.id,location:'loose'};state.items.push(w,o);
    window.STALKER_EXT.installAttachment(w.id,o.id,'optic');const enhanced=window.STALKER_EXT.weaponStat(w,'acc');
    let blocked=false;try{window.STALKER_EXT.installAttachment(w.id,o.id,'optic')}catch(e){blocked=true}
    window.STALKER_EXT.removeAttachment(w.id,'optic');
    return {enhanced,blocked,uninstalled:o.location==='loose',unmodified:state.catalog.find(x=>x.id===wd.id).gurps.acc==='4'};
  }""")
  assert optic['enhanced']==5 and optic['blocked'] and optic['uninstalled'] and optic['unmodified'],optic
  print('ATTACHMENTS & MODIFIERS',optic)
  # Generated shop from the zero-price legacy catalog must still have finite stock.
  generated=await page.evaluate("""() => {const t=window.STALKER_EXT.generateShop({category:'Weapons',origin:'Any',budget:10000000,size:15,rarity:5});return {items:t.stock.length,positive:t.stock.every(x=>x.price>0&&x.qty>0)}}""")
  assert generated['items']>0 and generated['positive'],generated
  print('LEGACY CATALOG TRADER',generated)
  # GM can accept injury and apply plate wear; nothing happens until the explicit Apply action.
  damage=await page.evaluate("""() => {
    const plate=state.items.find(x=>x.name==='Audit Test Armor Plate');plate.plateDP=21;
    const gm=window.STALKER_EXT.getGM();gm.integrated.rules.plateDPLoss='raw';
    const beforeHP=state.conditions.Health,beforeDP=plate.plateDP;
    const record={id:'audit-NPC-plate-hit',at:new Date().toISOString(),kind:'npc',actor:'Bandit',targetId:activeProfile,injury:3,armorRawDamage:8,armorPenetration:2,location:'Torso',status:'Calculated'};
    gm.pendingCombat=gm.pendingCombat||[];gm.pendingCombat.push(record);
    const beforeApply=state.conditions.Health;
    window.STALKER_EXT.applyPending(record.id,'apply',3);
    let twice=false;try{window.STALKER_EXT.applyPending(record.id,'apply',3)}catch(e){twice=true}
    return {beforeHP,beforeDP,beforeApply,afterHP:state.conditions.Health,afterDP:plate.plateDP,status:record.status,twice};
  }""")
  assert damage['beforeHP']==damage['beforeApply'] and damage['afterHP']==damage['beforeHP']-3 and damage['afterDP']==damage['beforeDP']-8 and damage['status']=='Applied' and damage['twice'],damage
  print('GM-APPROVED HP & PLATE WEAR',damage)
  drag=await page.evaluate("""() => {
    const i={id:'qa-drag-test',name:'Only Image During Drag',category:'Weapon',w:5,h:2,weight:1,location:'loose',image:'t1-sks.webp',rotated:false};state.items.push(i);
    const g=document.createElement('div');g.className='carry-ghost';document.body.append(g);
    carry={id:i.id,active:true,ghost:g,x:10,y:10,valid:false,target:null};carryPreview();
    const imageOnly=g.children.length===1&&g.querySelector('img')!==null&&g.textContent.trim()==='';
    i.rotated=true;carryPreview();const rotated=g.querySelector('img')?.classList.contains('rotated');
    carry=null;g.remove();return {imageOnly,rotated};
  }""")
  assert drag['imageOnly'] and drag['rotated'],drag
  print('TARKOV DRAG IMAGE ONLY',drag)
  print('BROWSER JS ERRORS',errors[:15]);assert not errors,errors
  await browser.close()
 server.terminate()
if __name__=='__main__':asyncio.run(run())
