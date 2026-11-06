import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
from regression_test import boot,P

async def main():
 async with async_playwright() as pw:
  browser=await pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=await browser.new_page(viewport={'width':1400,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  await boot(page)
  assert not await page.locator('#npcAttackPanel').is_visible(), 'NPC panel visible to player'
  await page.locator('#gmMode').click()
  await page.locator('button[data-page="gmcombat"]').click()
  assert await page.locator('#combatPage').is_visible(), 'GM combat not visible'
  assert await page.locator('#npcAttackPanel').is_visible(), 'GM NPC panel not visible'
  await page.locator('#playerMode').click();await page.locator('button[data-page="combat"]').click()
  assert not await page.locator('#npcAttackPanel').is_visible(), 'NPC controls leaked'
  # GURPS RoF is capped by available bullets; a six-round trigger pull can only expend four.
  result=await page.evaluate('''() => {
    const t=state.catalog.find(x=>x.name==='SKS')||state.catalog.find(x=>x.category==='Weapon'&&x.integralFeed);
    if(!t)throw Error('No fixed-feed weapon');
    const w={...structuredClone(t),id:'qa-weapon',templateId:t.id,loadedRounds:4,location:'loose',gurps:{...t.gurps,rof:10}};
    state.items.push(w);renderCombat();
    document.getElementById('combatWeapon').value=w.id;
    document.getElementById('combatShots').value='6';
    const r=advModifiers(w);
    return {weapon:w.name,actual:r.shots,requested:r.shotsRequested,rounds:roundsInWeapon(w)};
  }''')
  assert result['actual']==4 and result['requested']==6,result
  # Image-variant lookups fall back to the base image if an appropriate magazine is missing.
  image=await page.evaluate('''() => {
     const w={category:'Weapon',image:'base.png',appearanceVariants:{standard:'standard.png',drum:'drum.png'}};
     return visibleImage(w);
  }''')
  assert image in ('standard.png','base.png'),image
  # Inspect every navigation page for runtime failures.
  for role in ['gm','player']:
   await page.locator('#gmMode' if role=='gm' else '#playerMode').click()
   for b in await page.locator(f'button[data-role="{role}"][data-page]').all():
    target=await b.get_attribute('data-page');await b.click()
    visible=await page.locator('#'+('combat' if target=='gmcombat' else target)+'Page').is_visible()
    assert visible,(role,target)
  assert not errors,errors
  print('PASS: GM/player role controls, GM combat, six-shot cap, image fallback, every tab, JS errors=0')
  print('Shot cap proof:',result)
  await browser.close()

if __name__=='__main__':asyncio.run(main())
