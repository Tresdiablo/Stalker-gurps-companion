import asyncio, pathlib, subprocess
from playwright.async_api import async_playwright
APP=pathlib.Path(__file__).resolve().parent.parent
async def run():
    server=subprocess.Popen(['python','-m','http.server','8886','--bind','127.0.0.1','--directory',str(APP)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        async with async_playwright() as pw:
            browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
            page=await browser.new_page(viewport={'width':1440,'height':960})
            dialogs=[];errors=[]
            page.on('pageerror',lambda e: errors.append(str(e)))
            async def dialog(d):
                dialogs.append(d.message)
                await d.accept('Bloodsuckers' if d.type=='prompt' else None)
            page.on('dialog',dialog)
            await page.evaluate("""() => {const store={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]??null,setItem:(k,v)=>{store[k]=String(v)},removeItem:k=>delete store[k],key:i=>Object.keys(store)[i]??null,get length(){return Object.keys(store).length}}})}""")
            html=(APP/'index.html').read_text()
            for file in ['app.css','companion.css','integrated.css']:
                html=html.replace(f'<link href="{file}" rel="stylesheet"/>','<style>'+(APP/file).read_text()+'</style>')
            for file in ['app.js','companion.js','navigation.js','integrated.js']:
                html=html.replace(f'<script src="{file}"></script>','<script>'+(APP/file).read_text()+'</script>')
            await page.set_content(html,wait_until='domcontentloaded')
            await page.wait_for_timeout(500)
            info=await page.evaluate("() => ({nav:STALKER_NAV_TEST.pages(),mode:document.body.dataset.mode,ext:!!STALKER_EXT,gm:!!STALKER_COMPANION_TEST})")
            assert info['ext'] and info['gm'],info
            assert not any(i['id'] in ('equipment','armorlab') for i in info['nav']),info['nav']
            print('PASS: startup without separate weapon or plate tabs',len(info['nav']))
            routes=await page.evaluate('''() => {const rows=STALKER_NAV_TEST.pages();return rows.map(p=>({id:p.id,role:p.role,ok:STALKER_NAV_TEST.route(p.id,p.role),visible:[...document.querySelectorAll('.page[id$="Page"]')].filter(x=>!x.hidden).map(x=>x.id)}))}''')
            assert all(x['ok'] and x['visible']==[('combat' if x['id']=='gmcombat' else x['id'])+'Page'] for x in routes),routes
            print('PASS: every GM and Player page reachable',len(routes))
            await page.evaluate("STALKER_NAV_TEST.route('npcs','gm')")
            await page.locator('#npcTemplateTypeFilter').select_option('Mutant')
            await page.locator('#npcAddCategory').click()
            assert 'Bloodsuckers' in await page.locator('#npcTemplateCategoryFilter').inner_text(),await page.locator('#npcTemplateCategoryFilter').inner_text()
            await page.locator('#npcCreate').click()
            await page.locator('#npcForm [name=name]').fill('Alpha Bloodsucker')
            await page.locator('#npcForm [name=type]').select_option('Mutant')
            await page.locator('#npcForm [name=templateCategory]').select_option('Bloodsuckers')
            await page.locator('#npcForm button[type=submit]').click()
            await page.wait_for_timeout(100)
            data=await page.evaluate("() => STALKER_COMPANION_TEST.getGM().npcs.find(n=>n.name==='Alpha Bloodsucker')")
            assert data and data['type']=='Mutant' and data['templateCategory']=='Bloodsuckers',data
            await page.locator('#npcTemplateCategoryFilter').select_option('Bloodsuckers')
            assert await page.locator('#gmNpcList').get_by_text('Alpha Bloodsucker').count()>=1
            print('PASS: mutant template category creation/save/filter')
            await page.evaluate("window.prompt=()=>'Nocturnal'")
            await page.locator('#npcRenameCategory').click()
            renamed=await page.evaluate("() => STALKER_COMPANION_TEST.getGM().npcs.find(n=>n.name==='Alpha Bloodsucker').templateCategory")
            assert renamed=='Nocturnal',renamed
            await page.evaluate('window.confirm=()=>true')
            await page.locator('#npcRemoveCategory').click()
            deleted=await page.evaluate("() => ({npc:STALKER_COMPANION_TEST.getGM().npcs.find(n=>n.name==='Alpha Bloodsucker'),cat:STALKER_COMPANION_TEST.getGM().templateCategories.Mutant})")
            assert deleted['npc']['templateCategory']=='' and 'Nocturnal' not in deleted['cat'],deleted
            print('PASS: category rename/delete preserves NPC templates')
            dt=await page.evaluate('''() => {
               const armor=STALKER_EXT.armorFor({slots:{armor:'armor-1'},items:[{id:'armor-1',name:'Basic vest',category:'Armor',gurps:{dr:8},dt:5}]},'Torso');
               const targetDT=document.getElementById('targetDT');targetDT.value='100';
               const g=STALKER_EXT.getGM();const prior=g.integrated.rules.dtEnabled;
               g.integrated.rules.dtEnabled=true;const threshold=advDamageRoll('1d cr',0,'Torso',null);
               g.integrated.rules.dtEnabled=false;const plain=advDamageRoll('1d cr',0,'Torso',null);
               g.integrated.rules.dtEnabled=prior;
               return {armor,threshold,plain};
            }''')
            assert dt['armor']['dr']==8 and dt['armor']['dt']==5 and not dt['armor']['plate'],dt
            assert dt['threshold']['injury']==0 and dt['plain']['injury']>0,dt
            print('PASS: legacy armor DR/DT and optional DT threshold without plates')
            await page.evaluate("STALKER_NAV_TEST.route('workbench','gm')")
            await page.locator('[data-ext=createDefinition]').click()
            await page.locator('#extName').fill('Beta 0.7 Picatinny Sight')
            await page.locator('#extCategory').select_option('Optic')
            await page.locator('#extMount').select_option('Picatinny')
            await page.locator('[data-ext=saveDefinition]').click()
            ids=await page.evaluate('''() => {
               const weapon=state.catalog.find(x=>x.category==='Weapon'&&!x.integralFeed);
               const optic=state.catalog.find(x=>x.name==='Beta 0.7 Picatinny Sight');
               if(!weapon||!optic)throw Error('Catalog missing weapons or optic');
               const w=STALKER_EXT.spawn(weapon.id)[0],a=STALKER_EXT.spawn(optic.id)[0];
               save();render();return {w:w.id,a:a.id};
            }''')
            await page.evaluate("STALKER_NAV_TEST.route('character','player')")
            await page.wait_for_timeout(150)
            w=page.locator('[data-item-id="'+ids['w']+'"]:visible').first
            a=page.locator('[data-item-id="'+ids['a']+'"]:visible').first
            assert await w.count() and await a.count(),ids
            boxw=await w.bounding_box();boxa=await a.bounding_box();assert boxw and boxa,(boxw,boxa)
            await page.mouse.move(boxa['x']+boxa['width']/2,boxa['y']+boxa['height']/2)
            await page.mouse.down()
            await page.mouse.move(boxw['x']+boxw['width']/2,boxw['y']+boxw['height']/2,steps=12)
            await page.mouse.up()
            await page.wait_for_timeout(150)
            installed=await page.evaluate('(ids)=>({w:state.items.find(i=>i.id===ids.w),a:state.items.find(i=>i.id===ids.a)})',ids)
            assert installed['w']['opticId']==ids['a'] and installed['a']['location']=='installed',installed
            print('PASS: physical pointer drag-to-install onto weapon')
            await page.locator('[data-item-id="'+ids['w']+'"]:visible').first.click(button='right')
            await page.wait_for_timeout(60)
            menu=page.locator('#itemContextMenu')
            assert await menu.get_by_text('Uninstall optic').count(),await menu.inner_text()
            await menu.get_by_text('Uninstall optic').click()
            uninstalled=await page.evaluate('(ids)=>({w:state.items.find(i=>i.id===ids.w),a:state.items.find(i=>i.id===ids.a)})',ids)
            assert 'opticId' not in uninstalled['w'] and uninstalled['a']['location']=='loose',uninstalled
            print('PASS: weapon right-click uninstall')
            # Verify selected actor remains linked to a new attack and GM HP review changes HP only after approval.
            encId=await page.evaluate('''() => {
              const npc=STALKER_COMPANION_TEST.getGM().npcs.find(n=>n.name==='Alpha Bloodsucker');
              return STALKER_COMPANION_TEST.createEncounter('Test Combat',[npc.id]);
            }''')
            await page.evaluate('(x)=>STALKER_COMPANION_TEST.activateEncounter(x)',encId)
            await page.evaluate("STALKER_NAV_TEST.route('gmcombat','gm')")
            npc=await page.evaluate('''() => {const g=STALKER_COMPANION_TEST.getGM();return g.encounters.find(x=>x.id===g.activeEncounter).roster[0]}''')
            await page.evaluate('(x)=>STALKER_COMPANION_TEST.selectActor(x)',npc['id'])
            actorBefore=await page.evaluate('''(x)=>STALKER_COMPANION_TEST.getGM().encounters.find(e=>e.active||e.id===STALKER_COMPANION_TEST.getGM().activeEncounter).roster.find(a=>a.id===x).hp''',npc['id'])
            await page.locator('#gmRollAgainstNpc').click()
            await page.wait_for_timeout(100)
            attack=await page.evaluate('''() => ({r:state.combatReview?.[0],hp:window.STALKER_COMPANION_TEST.getGM().encounters.find(e=>e.id===window.STALKER_COMPANION_TEST.getGM().activeEncounter).roster[0].hp})''')
            if not attack.get('r'):
                print('COMBAT DEBUG',await page.evaluate('''() => ({result:document.getElementById('combatResult').textContent,actor:state.advancedCombat?.actor,acted:state.advancedCombat?.actedThisTurn,maneuver:document.getElementById('combatManeuver').value,weapon:document.getElementById('combatWeapon').value,skill:document.getElementById('combatSkill').value,review:state.combatReview,errors:STALKER_NAV_TEST.diagnostics().errors})'''))
            assert attack['r']['targetId']==npc['id'] and attack['hp']==actorBefore,attack
            await page.evaluate('(x)=>STALKER_EXT.applyPending(x,"apply",3)',attack['r']['id'])
            after=await page.evaluate('''() => STALKER_COMPANION_TEST.getGM().encounters.find(e=>e.id===STALKER_COMPANION_TEST.getGM().activeEncounter).roster[0].hp''')
            assert after==actorBefore-3,(after,actorBefore)
            print('PASS: NPC targeting, combat logging and GM manual HP application')
            # NPC to player attack should create a pending calculation, not change HP.
            await page.evaluate("STALKER_NAV_TEST.route('gmcombat','gm')")
            await page.locator('#gmAttackingNpc').select_option(npc['id'])
            before=await page.evaluate('''() => state.conditions.Health''')
            await page.locator('#performNpcAttack').click()
            await page.wait_for_timeout(110)
            pending=await page.evaluate('''() => ({r:STALKER_COMPANION_TEST.getGM().pendingCombat?.[0],hp:state.conditions.Health})''')
            if not pending.get('r'):print('NPC DEBUG',await page.evaluate('''() => ({result:document.getElementById('combatResult').textContent,npc:document.getElementById('gmAttackingNpc').value,player:document.getElementById('gmTargetPlayer').value,feed:document.getElementById('uxFeedback')?.textContent,round:STALKER_COMPANION_TEST.getGM().npcCombatRound,active:STALKER_COMPANION_TEST.getGM().activeEncounter,errors:STALKER_NAV_TEST.diagnostics().errors})'''))
            assert pending['r'] and pending['r']['status']=='Calculated' and pending['hp']==before,pending
            print('PASS: GM NPC attack calculated without changing player HP')
            assert not errors,errors
            print('PASS: no uncaught browser errors')
            await browser.close()
    finally:
        server.terminate()
if __name__=='__main__':asyncio.run(run())
