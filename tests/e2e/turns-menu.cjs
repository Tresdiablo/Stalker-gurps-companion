'use strict';
/**
 * Browser test: main menu (GM password, character locks), the turn cycle with "your turn" and
 * "NPC turn" pop-ups, readying a weapon in hands, and a break in the action.
 * Run: node tests/e2e/turns-menu.cjs   (screenshots in test-results/turns/)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { Host } = require('../../src/server/host');

const OUT = path.join(__dirname, '..', '..', 'test-results', 'turns');
fs.mkdirSync(OUT, { recursive: true });
const gm = { role: 'gm' };

(async () => {
  const host = new Host({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sgc-turns-')), port: 0, log: { error: console.error } });
  await host.start();
  const d = (a, p) => host.dispatch(a, p, gm);
  const s = () => host.current.state;
  d('def.loadStarter', {});
  d('settings.update', { rules: { autoEndTurn: false } }); // this test ends turns by hand
  const ivan = d('char.create', { name: 'Stalker Ivan', kind: 'pc' }).result.id;
  const marta = d('char.create', { name: 'Marta', kind: 'pc' }).result.id;
  d('char.manualBuild', { id: ivan, build: { dx: 13, ht: 11, basicSpeed: 6, skills: [{ name: 'Guns', spec: 'Rifle', level: 14 }] } });
  d('char.manualBuild', { id: marta, build: { dx: 12, ht: 10, basicSpeed: 5.5, skills: [{ name: 'Guns', spec: 'Pistol', level: 13 }] } });
  const rifle = d('item.spawn', { defId: 'builtin-akm-76239', target: { p: 'char:' + ivan, slot: 'primary' } }).result.ids[0];
  const mag = d('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + ivan, loadFull: true }).result.ids[0];
  d('item.insertMag', { weaponId: rifle, magId: mag });
  d('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + ivan, loadFull: true }); // spare
  const enc = d('enc.create', { name: 'Checkpoint', participants: [ivan, marta] }).result.id;
  const npcs = d('npc.generate', { templateId: 'tpl-bandit', count: 2, rank: 2, encounterId: enc }).result.ids;
  for (const id of npcs) d('npc.reveal', { id, reveal: true });
  d('enc.start', { id: enc });
  const e = () => s().encounters[enc];
  assert.equal(e().order[0], ivan);

  const browser = await chromium.launch();
  const ctx = () => browser.newContext({ viewport: { width: 1500, height: 900 } });
  const [G, A, B, C] = await Promise.all([ctx(), ctx(), ctx(), ctx()]).then(cs => Promise.all(cs.map(c => c.newPage())));
  const errors = [];
  for (const [n, pg] of [['GM', G], ['Ivan', A], ['Marta', B], ['Third', C]]) pg.on('pageerror', x => errors.push(`${n}: ${x.message}`));
  const shot = async (pg, name) => { await pg.waitForTimeout(350); return pg.screenshot({ path: path.join(OUT, name + '.png') }); };
  const waitFor = async (pred, ms = 5000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Timed out: ' + pred); };

  // ---- main menu + GM password
  await G.goto(host.menuUrl()); await G.waitForSelector('.menu-body');
  await shot(G, '1-main-menu');
  await G.fill('input[type=password]', 'wrong'); await G.click('button:has-text("Enter as GM")');
  await G.waitForSelector('.notice-bar:has-text("Wrong GM password")');
  await G.fill('input[type=password]', 'goyim'); await G.click('button:has-text("Enter as GM")');
  await G.waitForSelector('button:has-text("Enter campaign")'); await G.click('button:has-text("Enter campaign")');
  await G.waitForSelector('.nav');
  console.log('GM password OK (wrong refused, "goyim" accepted)');

  // ---- players pick characters; a character in use is locked for others
  await A.goto(host.menuUrl()); await A.waitForSelector('.menu-char');
  await A.click('.menu-char:has-text("Stalker Ivan") button:has-text("Play")');
  await A.waitForSelector('.nav');
  await C.goto(host.menuUrl()); await C.waitForSelector('.menu-char:has-text("Stalker Ivan").locked', { timeout: 8000 });
  assert.equal(await C.locator('.menu-char:has-text("Stalker Ivan") button').isDisabled(), true, 'Ivan is locked for others');
  await shot(C, '2-menu-ivan-locked');
  await C.close();
  await B.goto(host.menuUrl()); await B.waitForSelector('.menu-char');
  await B.click('.menu-char:has-text("Marta") button:has-text("Play")'); await B.waitForSelector('.nav');
  console.log('Character locking OK');

  // ---- Ivan's turn: pop-up, ready the rifle (takes the turn), end turn
  await A.waitForSelector('.turn-pop:has-text("Your turn")');
  await shot(A, '3-your-turn-popup');
  await A.click('.turn-pop button:has-text("Take my turn")');
  await A.waitForSelector('.nav button.active:has-text("Combat")');
  await A.waitForSelector('.notice-bar:has-text("not in your hands")');
  await A.click('.notice-bar button:has-text("Draw it")');
  await waitFor(() => s().items[rifle].loc.slot === 'hands' && s().items[rifle].readyAt === 2);
  await A.waitForSelector('.notice-bar:has-text("turn is spent (drawing")');
  await shot(A, '4-readying-rifle');
  await A.click('.turn-bar button:has-text("End my turn")');
  await waitFor(() => e().order[e().turn] === marta);
  // Marta: pop-up, ends turn with the E key
  await B.waitForSelector('.turn-pop:has-text("Your turn")');
  await B.click('.turn-pop button:has-text("Close")');
  await B.keyboard.press('e');
  await waitFor(() => s().characters[e().order[e().turn]].kind === 'npc');
  // GM: NPC pop-up names the NPC and who is next
  const npcName = s().characters[e().order[e().turn]].name;
  await G.waitForSelector(`.turn-pop:has-text("NPC turn"):has-text("${npcName}")`);
  await shot(G, '5-gm-npc-turn-popup');
  await G.click('.turn-pop button:has-text("Skip turn")');
  await waitFor(() => e().turn === 3);
  await G.waitForSelector('.turn-pop:has-text("NPC turn")');
  await G.click('.turn-pop button:has-text("Skip turn")');
  await waitFor(() => e().round === 2 && e().order[e().turn] === ivan);
  assert.equal(s().items[rifle].readyAt, undefined, 'rifle readied by round 2');
  await A.waitForSelector('.turn-pop:has-text("Your turn")');
  await A.click('.turn-pop button:has-text("Close")');
  console.log('Turn cycle OK: player pop-ups, end turn (button and E key), GM NPC pop-ups, readying completes next round');

  // ---- break: GM allots 5 seconds; Ivan reloads (3 s) and finishes; GM ends the break
  await G.click('.nav button:has-text("GM Dashboard")');
  await G.click('button:has-text("Break…")');
  await G.fill('.modal input[type=number]', '5'); await G.click('.modal button:has-text("OK")');
  await waitFor(() => !!e().break);
  await A.waitForSelector('.turn-bar.break:has-text("You have 5 s")');
  await shot(A, '6-break-player');
  await A.click('.nav button:has-text("Combat")');
  await A.click('button:has-text("Reload")');
  await waitFor(() => e().break?.remaining[ivan] === 2);
  await A.waitForSelector('.turn-bar.break:has-text("You have 2 s")');
  await A.click('.turn-bar button:has-text("done")');
  await G.waitForSelector('.turn-bar.break:has-text("done")');
  await shot(G, '7-break-gm');
  await G.click('.turn-bar button:has-text("End break")');
  await waitFor(() => !e().break && e().round === 7);
  console.log('Break OK: 5 s allotted, reload cost 3 s, clock advanced to round 7');

  // after a break the order restarts from the top: Ivan is told it is his turn again
  await A.waitForSelector('.turn-pop:has-text("Your turn")');
  await A.click('.turn-pop button:has-text("Close")');
  // ---- Ready slot: stage a magazine for next turn from the context menu; it goes in automatically
  await A.click('.nav button:has-text("Inventory")');
  const spare = A.locator('.grid .tile:has-text("AK 7.62")').first();
  await spare.click({ button: 'right' });
  await A.click('.ctx .it:has-text("Use next turn")');
  await A.waitForSelector('.slot.ready-slot .stage-note');
  await shot(A, '8-ready-slot-staged');
  await A.click('.turn-bar button:has-text("End my turn")');
  await waitFor(() => e().order[e().turn] !== ivan);
  while (e().order[e().turn] !== ivan) d('enc.next', { id: enc });
  await waitFor(() => e().order[e().turn] === ivan && e().round === 8);
  await A.waitForSelector('.turn-pop:has-text("This turn")');
  await shot(A, '9-turn-spent-reloading');
  await A.click('.turn-pop button:has-text("Close")');
  assert.equal(e().combatants[ivan].turnSpent, 8);
  console.log('Ready slot OK: magazine staged, loaded automatically at the start of the next turn');

  // ---- main menu button frees the character
  await A.click('button:has-text("Main menu")');
  await A.waitForSelector('.menu-char');
  await A.waitForSelector('.menu-char:has-text("Stalker Ivan"):not(.locked)', { timeout: 8000 });
  console.log('Main menu / switch character OK');

  assert.deepEqual(errors, [], 'no browser errors');
  console.log('TURNS & MENU E2E PASSED');
  await browser.close(); await host.stop(); process.exit(0);
})().catch(e => { console.error('E2E FAILED:', e); process.exit(1); });
