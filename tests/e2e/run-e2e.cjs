'use strict';
/**
 * End-to-end demonstration of the three required workflows through the real UI:
 *   1. player attacks Bandit 1 with an assault rifle; GM resolves defense and applies damage; undo
 *   2. Bandit 1 attacks the player; player defends; GM notifies; player applies the injury
 *   3. player rolls Lockpicking from the character sheet; GM sees it immediately
 * Uses the in-process host with a throwaway campaign directory and two browser windows.
 * Run: node tests/e2e/run-e2e.cjs   (screenshots in test-results/e2e/)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { Host } = require('../../src/server/host');

const OUT = path.join(__dirname, '..', '..', 'test-results', 'e2e');
fs.mkdirSync(OUT, { recursive: true });
const gm = { role: 'gm' };

(async () => {
  const host = new Host({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sgc-e2e-')), port: 0, log: { error: console.error } });
  await host.start();
  const d = (a, p) => host.dispatch(a, p, gm);
  // --- campaign setup (what the GM would do in the Character/NPC managers)
  d('def.loadStarter', {}); // new campaigns start with an empty catalog
  const pid = d('player.save', { name: 'Ivan (player)' }).result.id;
  const pc = d('char.create', { name: 'Stalker Ivan', kind: 'pc', ownerId: pid }).result.id;
  d('char.manualBuild', { id: pc, build: { st: 11, dx: 12, iq: 11, ht: 11, hp: 11, fp: 11, basicSpeed: 5.75, basicMove: 5, dodge: 8, skills: [{ name: 'Guns', spec: 'Rifle', level: 14 }, { name: 'Lockpicking', spec: '', level: 12 }] } });
  const akm = d('item.spawn', { defId: 't1-weapon-vpo-136-vepr-km', target: { p: 'char:' + pc, slot: 'primary' } }).result.ids[0];
  d('item.spawn', { defId: 'sample-chest-rig', target: { p: 'char:' + pc, slot: 'rig' } });
  const mag = d('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + pc, loadFull: true, ammoId: 't1-ammo-7-62-39mm-fmj' }).result.ids[0];
  d('item.insertMag', { weaponId: akm, magId: mag });
  d('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + pc, loadFull: true });
  d('item.spawn', { defId: 'att-pso1', to: 'char:' + pc });
  d('item.spawn', { defId: 'att-pbs1', to: 'char:' + pc });
  const enc = d('enc.create', { name: 'Ambush at the farm', participants: [pc] }).result.id;
  const gen = d('npc.generate', { templateId: 'tpl-bandit', count: 6, rank: 2, encounterId: enc }).result.ids;
  const bandit = gen[0];
  for (const id of gen) d('npc.reveal', { id, reveal: true });
  d('enc.start', { id: enc });
  d('enc.distance', { id: enc, a: pc, b: bandit, yards: 20 });
  const s = () => host.current.state;

  const browser = await chromium.launch();
  const gmCtx = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
  const plCtx = await browser.newContext({ viewport: { width: 1600, height: 950 } });
  const G = await gmCtx.newPage(), P = await plCtx.newPage();
  const errors = [];
  for (const [n, pg] of [['GM', G], ['Player', P]]) { pg.on('pageerror', e => errors.push(`${n}: ${e.message}`)); pg.on('console', m => m.type() === 'error' && errors.push(`${n} console: ${m.text()}`)); }
  await G.goto(host.url()); await G.waitForSelector('.start');
  await G.screenshot({ path: path.join(OUT, '0a-gm-start-screen.png') });
  await G.click('button:has-text("Enter campaign")'); await G.waitForSelector('.nav');
  await P.goto(host.playerLink(pid)); await P.waitForSelector('.start');
  await P.screenshot({ path: path.join(OUT, '0b-player-start-screen.png') });
  await P.click('.start .list-item:has-text("Stalker Ivan")'); await P.waitForSelector('.nav');
  const shot = (pg, name) => pg.screenshot({ path: path.join(OUT, name + '.png') });

  // ---------------- Scenario 1: player attacks Bandit 1
  await P.click('.nav button:has-text("Combat")');
  await P.selectOption('.panel:has(h2:has-text("Attack")) select >> nth=1', bandit);
  let ev = null;
  for (let attempt = 0; attempt < 15 && !ev; attempt++) {
    const before = Object.keys(s().events).length;
    await P.click('button:has-text("Roll attack")');
    await waitFor(() => Object.keys(s().events).length > before);
    const last = Object.values(s().events).sort((a, b) => b.seq - a.seq)[0];
    assert.equal(last.attack.baseSkill, 14, 'weapon skill retrieved from the character');
    assert.ok(['awaiting-defense', 'closed', 'resolved'].includes(last.stage), `unexpected stage ${last.stage}`);
    if (last.stage === 'awaiting-defense') ev = last;
    else if (last.stage === 'resolved') { d('combat.ignore', { eventId: last.id }); } // critical hit: skips defense; keep the demo on the normal path
  }
  assert.ok(ev, 'an attack succeeded within 15 tries');
  assert.equal(s().characters[bandit].session.hp, s().characters[bandit].build.hp, 'success is not a hit; HP unchanged');
  await G.click('.nav button:has-text("GM Dashboard")');
  await G.waitForSelector(`.event.awaiting-defense:has-text("Stalker Ivan attacks Bandit 1")`);
  await shot(G, '1a-gm-receives-attack');
  // GM resolves the NPC defense (declines: target surprised) so damage is rolled
  await G.click('.panel:has(h2:has-text("Pending")) button:has-text("No defense")');
  await waitFor(() => s().events[ev.id].stage === 'resolved');
  const proposal = s().events[ev.id].proposal.hp;
  assert.ok(proposal < 0, 'injury proposed');
  assert.equal(s().characters[bandit].session.hp, s().characters[bandit].build.hp, 'HP still unchanged before GM decision');
  await G.waitForSelector('button:has-text("Apply calculated")');
  await shot(G, '1b-gm-proposed-injury');
  const hp0 = s().characters[bandit].session.hp;
  await G.click('.panel:has(h2:has-text("Pending")) button:has-text("Apply calculated")');
  await waitFor(() => s().characters[bandit].session.hp === hp0 + proposal);
  assert.ok(s().log.some(l => /GM applied/.test(l.summary)), 'combat log entry');
  await G.click('.nav button:has-text("NPC Manager")');
  await G.click(`.list-item:has-text("Bandit 1")`);
  await G.waitForSelector(`.bar span:has-text("${hp0 + proposal} / ")`);
  await shot(G, '1c-npc-manager-updated-hp');
  await G.click('.nav button:has-text("GM Dashboard")');
  await G.click(`.event.applied:has-text("Bandit 1") .head`);
  await G.click('button:has-text("Undo")');
  await waitFor(() => s().characters[bandit].session.hp === hp0);
  await G.click('.panel:has(h2:has-text("Pending")) button:has-text("Apply calculated")');
  await waitFor(() => s().characters[bandit].session.hp === hp0 + proposal);
  console.log('Scenario 1 OK: proposed', proposal, 'HP; applied, undone and re-applied');

  // ---------------- Scenario 2: Bandit 1 attacks the player
  const bandit2 = gen[1];
  const bAk = d('item.spawn', { defId: 'builtin-akm-76239', target: { p: 'char:' + bandit2, slot: 'secondary' } }).result.ids[0];
  const bMag = d('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + bandit2, loadFull: true }).result.ids[0];
  d('item.insertMag', { weaponId: bAk, magId: bMag });
  d('enc.distance', { id: enc, a: pc, b: bandit2, yards: 10 });
  await G.click(`.combatant:has-text("${s().characters[bandit2].name}")`);
  await G.click('.tabs button:has-text("Act")');
  await G.selectOption('.gm-dash .panel:last-child .form select >> nth=0', 'item:' + bAk);
  await G.selectOption('.gm-dash .panel:last-child .form select >> nth=1', pc);
  let ev2 = null;
  for (let attempt = 0; attempt < 20 && !ev2; attempt++) {
    const before = Object.keys(s().events).length;
    await G.click('.gm-dash button:has-text("Roll attack")');
    await waitFor(() => Object.keys(s().events).length > before);
    const last = Object.values(s().events).sort((a, b) => b.seq - a.seq)[0];
    if (last.stage === 'awaiting-defense') ev2 = last;
    else if (last.stage === 'resolved') d('combat.ignore', { eventId: last.id });
  }
  assert.ok(ev2, 'NPC attack succeeded');
  await P.waitForSelector('.panel:has(h2:has-text("Needs your attention")) button:has-text("No defense")');
  await shot(P, '2a-player-incoming-attack');
  await P.click('.panel:has(h2:has-text("Needs your attention")) button:has-text("No defense")');
  await waitFor(() => s().events[ev2.id].stage === 'resolved');
  const inj = -s().events[ev2.id].proposal.hp;
  const pcHp = s().characters[pc].session.hp;
  await G.click('.panel:has(h2:has-text("Pending")) button:has-text("Notify player")');
  await P.waitForSelector('button:has-text("to my character")');
  await shot(P, '2b-player-notified');
  assert.equal(s().characters[pc].session.hp, pcHp, 'player HP not changed automatically');
  await P.click('button:has-text("to my character")');
  await waitFor(() => s().characters[pc].session.hp === pcHp - inj);
  await P.click('.nav button:has-text("Character / GCS")');
  await P.waitForSelector(`.bar span:has-text("${pcHp - inj} / 11")`);
  await G.waitForSelector(`.combatant:has-text("Stalker Ivan") .bar span:has-text("${pcHp - inj} / 11")`);
  console.log('Scenario 2 OK: player took', inj, 'after GM notification');

  // ---------------- Scenario 3: Lockpicking from the character sheet
  await P.click('tr:has-text("Lockpicking") button:has-text("Roll")');
  await G.waitForSelector('.event:has-text("Stalker Ivan: Lockpicking")');
  const lp = Object.values(s().events).find(e => e.kind === 'skill' && e.skill === 'Lockpicking');
  assert.equal(lp.baseSkill, 12);
  await G.click('.event:has-text("Stalker Ivan: Lockpicking") .head');
  await shot(G, '3-gm-sees-lockpicking');
  console.log('Scenario 3 OK: Lockpicking', lp.roll.total, 'vs', lp.effective, lp.roll.label);

  // ---------------- Inventory & weapon customization smoke
  await P.click('.nav button:has-text("Inventory")');
  await P.waitForSelector('.slot:has-text("Primary weapon") .tile');
  await shot(P, '4a-inventory');
  await P.click('.nav button:has-text("Equipment")');
  await P.click('.list-item:has-text("PSO-1") button:has-text("Install")');
  await waitFor(() => Object.values(s().items).some(i => i.defId === 'att-pso1' && i.loc.mount === 'optic'));
  await P.click('.list-item:has-text("PBS-1") button:has-text("Install")');
  await waitFor(() => Object.values(s().items).some(i => i.defId === 'att-pbs1' && i.loc.mount === 'muzzle'));
  await P.waitForTimeout(300);
  await shot(P, '4b-weapon-with-scope');

  // ---------------- Drag and drop: ammo from the ground onto a magazine; item into a pocket
  const inv = require('../../src/core/inventory');
  const spare = Object.values(s().items).find(i => i.defId === 'mag-ak762-30' && i.id !== mag && inv.rootOf(s(), i) === 'char:' + pc);
  d('item.unload', { holderId: spare.id });
  const watch = d('item.spawn', { defId: 'misc-watch', target: { p: 'char:' + pc, g: 'ground', x: 6, y: 6, r: 0 } }).result.ids[0];
  const ammoStack = Object.values(s().items).find(i => i.defId === 't1-ammo-7-62-39mm-fmj' && inv.rootOf(s(), i) === 'char:' + pc);
  if (ammoStack.loc.g !== 'ground') d('item.move', { itemId: ammoStack.id, target: { p: 'char:' + pc, g: 'ground', x: 0, y: 7, r: 0 } });
  await P.click('.nav button:has-text("Inventory")');
  const dragTo = async (fromSel, toSel, dx = 8, dy = 8) => {
    const a = await P.locator(fromSel).boundingBox(), b = await P.locator(toSel).boundingBox();
    await P.mouse.move(a.x + 10, a.y + 10); await P.mouse.down();
    await P.mouse.move(a.x + 30, a.y + 30, { steps: 4 }); await P.mouse.move(b.x + dx, b.y + dy, { steps: 8 }); await P.mouse.up();
  };
  await dragTo(`.tile[data-item="${ammoStack.id}"]`, `.tile[data-item="${spare.id}"]`);
  await waitFor(() => (s().items[spare.id].rounds || []).reduce((a, [, n]) => a + n, 0) === 30);
  await dragTo(`.tile[data-item="${watch}"]`, '.grid[data-grid="pockets"]', 52, 8);
  await waitFor(() => s().items[watch].loc.g === 'pockets');
  console.log('Drag & drop OK: loaded a magazine by dropping ammo; moved an item into a pocket');
  // context menu: unload via right-click
  await P.click(`.tile[data-item="${spare.id}"]`, { button: 'right' });
  await P.click('.ctx .it:has-text("Unload ammo")');
  await waitFor(() => !(s().items[spare.id].rounds || []).length);
  await P.click(`.tile[data-item="${spare.id}"]`, { button: 'right' });
  await P.click('.ctx .it:has-text("Quick load")');
  await waitFor(() => (s().items[spare.id].rounds || []).reduce((a, [, n]) => a + n, 0) === 30);
  console.log('Context menu OK: unload and quick load');

  // ---------------- Trader: GM generates and opens a shop; player buys an item
  const tr = d('trader.save', { name: 'Field Medic', type: 'medic', tier: 2 }).result.id;
  d('trader.generate', { id: tr });
  d('trader.open', { id: tr, charIds: [pc] });
  d('char.money', { id: pc, delta: 20000 });
  await P.click('.nav button:has-text("Trader")');
  const stock = inv.childrenOf(s(), 'trader:' + tr).find(i => i.qty === 1) || inv.childrenOf(s(), 'trader:' + tr)[0];
  const moneyBefore = s().characters[pc].session.money;
  await P.click(`.tile[data-item="${stock.id}"]`, { button: 'right' });
  await P.click('.ctx .it:has-text("Buy")');
  if (stock.qty > 1) await P.click('.modal button:has-text("OK")');
  await waitFor(() => s().characters[pc].session.money < moneyBefore);
  assert.ok(inv.ownedItems(s(), pc).some(i => i.defId === stock.defId), 'purchase delivered to inventory');
  await shot(P, '5-trader');
  console.log('Trader OK: bought', s().defs[stock.defId].name, 'for', moneyBefore - s().characters[pc].session.money, 'RU');

  // ---------------- Regression: a GM-made optic with only a base image (no overlay) is drawn on the weapon
  const optDef = d('def.save', { def: { name: 'Homemade red dot', category: 'attachment', sub: 'Optics', w: 1, h: 1, image: 'seed:att-reflex.png', attachment: { slot: 'optic', interfaces: ['picatinny', 'ak-dovetail'], mods: { acc: 1 } } } }).result.id;
  const optic = d('item.spawn', { defId: optDef, target: { p: 'char:' + pc, g: 'ground', x: 8, y: 0, r: 0 } }).result.ids[0];
  d('item.detach', { weaponId: akm, mountId: 'optic' });
  const gun = d('item.spawn', { defId: 't1-weapon-vpo-136-vepr-km', target: { p: 'char:' + pc, g: 'ground', x: 0, y: 2, r: 0 } }).result.ids[0];
  await P.click('.nav button:has-text("Inventory")');
  const imgsBefore = await P.locator(`.tile[data-item="${gun}"] img`).count();
  await dragTo(`.tile[data-item="${optic}"]`, `.tile[data-item="${gun}"]`, 40, 10);
  await waitFor(() => s().items[optic].loc.mount === 'optic');
  await P.waitForFunction(id => document.querySelectorAll(`.tile[data-item="${id}"] img`).length >= 2, gun);
  assert.ok((await P.locator(`.tile[data-item="${gun}"] img[src*="att-reflex"]`).count()) === 1, 'optic overlay drawn on the inventory tile');
  console.log('Attachment overlay OK: optic without an overlay image is drawn on the weapon (imgs', imgsBefore, '->', await P.locator(`.tile[data-item="${gun}"] img`).count(), ')');
  await shot(P, '6-optic-on-weapon-tile');

  // ---------------- GM: run an NPC's turn from the NPC control bar (attack, reload)
  await G.click('.nav button:has-text("GM Dashboard")');
  await G.waitForSelector('.npc-bar');
  const npcName = s().characters[bandit2].name;
  await G.selectOption('.npc-bar select >> nth=0', bandit2);
  await G.selectOption('.npc-bar select >> nth=1', 'item:' + bAk);
  const evBefore = Object.keys(s().events).length;
  await G.click('.npc-bar button:has-text("Attack")');
  await waitFor(() => Object.keys(s().events).length > evBefore);
  const npcEv = Object.values(s().events).sort((a, b) => b.seq - a.seq)[0];
  assert.equal(npcEv.actorId, bandit2, 'attack made by the chosen NPC');
  assert.equal(npcEv.targetId, pc, 'nearest PC preselected as target');
  if (npcEv.stage === 'awaiting-defense') d('combat.defend', { eventId: npcEv.id, type: 'none' });
  const roundsBefore = require('../../src/core/weapons').roundsAvailable(s(), s().items[bAk]);
  d('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + bandit2, loadFull: true });
  await G.click('.npc-bar button:has-text("Reload")');
  await waitFor(() => require('../../src/core/weapons').roundsAvailable(s(), s().items[bAk]) > roundsBefore);
  await shot(G, '7-npc-control-bar');
  console.log(`NPC control OK: ${npcName} attacked ${s().characters[pc].name} and reloaded from the bar`);

  // ---------------- GM: spawn from the catalog into a chosen receiver, and with the G picker
  await G.click('.nav button:has-text("Item Catalog")');
  await G.selectOption('.spawn-to select', 'char:' + bandit);
  await G.fill('.panel .search', 'Bandage');
  const bandBefore = inv.countOwned(s(), bandit, 'med-bandage', { includeGround: true });
  await G.hover('.cat-row:has-text("Bandage")');
  await G.click('.cat-row:has-text("Bandage") .spawn-btn');
  await waitFor(() => inv.countOwned(s(), bandit, 'med-bandage', { includeGround: true }) === bandBefore + 1);
  await G.dblclick('.cat-row:has-text("Bandage")');
  await waitFor(() => inv.countOwned(s(), bandit, 'med-bandage', { includeGround: true }) === bandBefore + 2);
  await G.click('.nav button:has-text("GM Dashboard")');
  await G.click(`.combatant:has-text("${s().characters[pc].name}")`);
  await G.keyboard.press('g');
  await G.waitForSelector('.modal:has-text("Spawn item")');
  await G.keyboard.type('Bread');
  await G.keyboard.press('Enter');
  await waitFor(() => inv.countOwned(s(), pc, 'eq-bread', { includeGround: true }) >= 1);
  console.log('Spawn OK: catalog + button, double-click, and the G picker spawned into the targeted character');

  // ---------------- Player: Ctrl+click quick transfer between ground and character
  const can = d('item.spawn', { defId: 'eq-canned', target: { p: 'char:' + pc, g: 'ground', x: 9, y: 7, r: 0 } }).result.ids[0];
  await P.click('.nav button:has-text("Inventory")');
  await P.click(`.tile[data-item="${can}"]`, { modifiers: ['Control'] });
  await waitFor(() => s().items[can] && s().items[can].loc.g !== 'ground');
  console.log('Ctrl+click quick transfer OK');

  assert.deepEqual(errors, [], 'no browser errors');
  console.log('E2E PASSED');
  await browser.close();
  await host.stop();
  process.exit(0);
})().catch(async e => { console.error('E2E FAILED:', e); process.exit(1); });

async function waitFor(pred, ms = 5000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (pred()) return; await new Promise(r => setTimeout(r, 50)); }
  throw new Error('Timed out waiting for condition: ' + pred.toString());
}
