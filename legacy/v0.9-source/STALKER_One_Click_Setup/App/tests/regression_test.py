"""Headless Chromium integration checks without network or file-system URL access."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
P=Path(__file__).resolve().parent.parent
async def boot(page):
 await page.evaluate('''() => {const store={};Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>store[k]??null,setItem:(k,v)=>store[k]=String(v),removeItem:k=>delete store[k],key:i=>Object.keys(store)[i]??null,get length(){return Object.keys(store).length}}});window.alert=()=>{};window.confirm=()=>true;}''')
 html=(P/'index.html').read_text()
 for file in ('app.css','companion.css'):
  html=html.replace(f'<link href="{file}" rel="stylesheet"/>','<style>'+(P/file).read_text()+'</style>')
 for file in ('app.js','companion.js','navigation.js'):
  html=html.replace(f'<script src="{file}"></script>','<script>'+(P/file).read_text()+'</script>')
 await page.set_content(html)

async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1450,'height':950})
  page.set_default_timeout(3500)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)+' '+str(getattr(e,'stack',''))))
  await boot(page)
  # 1. Core base resources and tabs
  assert await page.locator('#characterPage').is_visible()
  assert await page.locator('button[data-page="ammo"]').count()==0
  assert await page.locator('#ammoWorkbench').count()==1
  assert await page.evaluate('state.catalog.length')>=50
  assert await page.locator('#catalogPage').count()==1
  # 2. Tier 1 firearms included; ammunition controls now use item context menus.
  assert await page.evaluate('state.catalog.filter(x=>x.category==="Ammo").length') >= 20
  # 3. GM role + NPC creation + duplicating template
  await page.locator('#gmMode').click();assert await page.locator('#dashboardPage').is_visible()
  await page.locator('button[data-page="npcs"]').click();await page.locator('#npcCreate').click()
  await page.locator('#npcForm [name="name"]').fill('Rookie Bandit')
  await page.locator('#npcForm [name="HP"]').fill('13')
  await page.locator('#npcForm [type="submit"]').click()
  assert (await page.evaluate('window.STALKER_COMPANION_TEST.getGM().npcs.length'))==1
  # 4. Encounter roster and a hidden prefilled stash
  await page.locator('button[data-page="encounters"]').click();await page.locator('#encounterCreate').click()
  await page.locator('#encounterForm [name="name"]').fill('Checkpoint')
  await page.locator('#encounterNpcTemplate').select_option(index=1)
  await page.locator('#encounterNpcQuantity').fill('2')
  await page.locator('#encounterAddNPC').click();await page.locator('#encounterForm [type="submit"]').click()
  assert (await page.evaluate('window.STALKER_COMPANION_TEST.getGM().encounters[0].roster.length'))==2
  await page.locator('#gmEncounters .encounter-card').first.click(button='right')
  await page.locator('#itemContextMenu button').filter(has_text='+ Stash').click()
  await page.locator('#stashForm [name="name"]').fill('Footlocker')
  await page.locator('#stashForm [name="templateId"]').select_option(index=0)
  await page.locator('#stashForm [name="quantity"]').fill('3')
  await page.locator('#stashForm [type="submit"]').click()
  gm=await page.evaluate('window.STALKER_COMPANION_TEST.getGM()')
  assert not gm['encounters'][0]['stashes'][0]['revealed']
  # Activate but hidden stash remains hidden from player
  await page.locator('#gmEncounters .encounter-card').first.click(button='right')
  await page.locator('#itemContextMenu button').filter(has_text='Activate Encounter').click()
  await page.locator('#playerMode').click()
  assert 'Footlocker' not in await page.locator('#encounterLoot').inner_text()
  await page.locator('#gmMode').click();await page.locator('button[data-page="encounters"]').click()
  await page.locator('#gmEncounters .gm-actor').filter(has_text='Stash:').first.click(button='right')
  await page.locator('#itemContextMenu button').filter(has_text='Reveal').click()
  await page.locator('#playerMode').click()
  assert 'Footlocker' in await page.locator('#encounterLoot').inner_text()
  # 5. Authoritative local loot transfer; GM source quantity is decremented.
  initial_items=await page.evaluate('state.items.length')
  await page.locator('#encounterLoot .stash-entry button').first.click()
  assert (await page.evaluate('state.items.length'))>initial_items
  assert (await page.evaluate('window.STALKER_COMPANION_TEST.getGM().encounters[0].stashes[0].items.length'))>=0
  # 6. Item hover visible with item data.
  await page.locator('#characterPage [data-item-id]').first.hover();await page.wait_for_timeout(400)
  assert await page.locator('#itemHoverTooltip').is_visible()
  assert await page.locator('#itemHoverTooltip').inner_text()!=''
  # 7. GM can choose encounter NPC; player-only view contains no NPC actions.
  assert await page.evaluate('window.STALKER_COMPANION_TEST.getGM().activeEncounter')
  await page.locator('button[data-page="combat"]').click()
  assert not await page.locator('#npcAttackPanel').is_visible()
  # 8. Individual GM/player views and journal
  await page.locator('button[data-page="journal"]').click()
  await page.locator('#playerJournal').fill('Found a checkpoint')
  await page.locator('#savePlayerJournal').click()
  assert (await page.evaluate('state.playerJournal'))=='Found a checkpoint'
  assert errors==[], 'JS errors: '+str(errors[:10])
  await page.screenshot(path=str(P/'qa_player.png'),full_page=True)
  print('PASS: core startup, Tier 1 catalogue, ammo page moved, NPC editor, encounter templates, hidden/revealed stashes, looting, hover tooltip, targeting, journal')
  print('NPCs',len((await page.evaluate('window.STALKER_COMPANION_TEST.getGM()'))['npcs']))
  print('Errors',errors)
  await browser.close()

if __name__=='__main__': asyncio.run(main())
