'use strict';
/**
 * Browser test of the streamlined table flow: Quick fight (one dialog), NPCs visible and targeted
 * automatically, NPC auto-defense, turns that end by themselves, and pasting a spreadsheet into
 * the Item Catalog. Run: node tests/e2e/streamline.cjs   (screenshots in test-results/streamline/)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { Host } = require('../../src/server/host');

const OUT = path.join(__dirname, '..', '..', 'test-results', 'streamline');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const host = new Host({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sgc-stream-')), port: 0, log: { error: console.error } });
  await host.start();
  const d = (a, p) => host.dispatch(a, p, { role: 'gm' });
  const s = () => host.current.state;
  d('def.loadStarter', {});
  const ivan = d('char.create', { name: 'Stalker Ivan', kind: 'pc' }).result.id;
  d('char.manualBuild', { id: ivan, build: { dx: 13, ht: 11, basicSpeed: 7, skills: [{ name: 'Guns', spec: 'Rifle', level: 14 }] } });
  const ak = d('item.spawn', { defId: 'builtin-akm-76239', target: { p: 'char:' + ivan, slot: 'hands' } }).result.ids[0];
  d('item.insertMag', { weaponId: ak, magId: d('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + ivan, loadFull: true }).result.ids[0] });

  const browser = await chromium.launch();
  const page = () => browser.newContext({ viewport: { width: 1500, height: 900 } }).then(c => c.newPage());
  const [G, P] = await Promise.all([page(), page()]);
  const errors = [];
  for (const [n, pg] of [['GM', G], ['Ivan', P]]) pg.on('pageerror', x => errors.push(`${n}: ${x.message}`));
  const shot = async (pg, name) => { await pg.waitForTimeout(350); await pg.screenshot({ path: path.join(OUT, name + '.png') }); };
  const waitFor = async (pred, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (pred()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Timed out: ' + pred); };

  await G.goto(host.menuUrl()); await G.fill('input[type=password]', 'goyim'); await G.click('button:has-text("Enter as GM")');
  await G.click('button:has-text("Enter campaign")'); await G.waitForSelector('.nav');
  await P.goto(host.menuUrl()); await P.click('.menu-char:has-text("Stalker Ivan") button:has-text("Play")'); await P.waitForSelector('.nav');

  // ---- Quick fight: one dialog → encounter with the PCs + 2 bandits, started, NPCs visible
  await G.click('.nav button:has-text("Encounters")');
  await G.click('button:has-text("Quick fight")');
  await G.fill('.modal input[type=number]', '2');
  await shot(G, '1-quick-fight-dialog');
  await G.click('.modal button:has-text("Start fight")');
  await G.waitForSelector('.nav button.active:has-text("GM Dashboard")');
  const enc = Object.values(s().encounters).find(e => e.status === 'active');
  assert.ok(enc, 'encounter started');
  const npcs = enc.order.filter(id => s().characters[id].kind === 'npc');
  assert.equal(npcs.length, 2);
  assert.ok(npcs.every(id => !s().characters[id].hidden), 'NPCs revealed to players');
  assert.equal(enc.order[0], ivan, 'Ivan is fastest');
  console.log('Quick fight OK: encounter created, 2 NPCs generated and revealed, started, dashboard open');
  await shot(G, '2-gm-dashboard-player-turn');

  // ---- Ivan: target preselected, attack → NPC defends by itself → the turn passes on
  await P.click('.turn-pop button:has-text("Take my turn")');
  await P.waitForSelector('.nav button.active:has-text("Combat")');
  const tgt = await P.inputValue('label.field:has-text("Target") select');
  assert.ok(npcs.includes(tgt), 'an enemy is preselected as the target');
  await P.click('button:has-text("Roll attack")');
  await waitFor(() => s().encounters[enc.id].order[s().encounters[enc.id].turn] !== ivan);
  const ev = Object.values(s().events).filter(e => e.kind === 'attack').pop();
  assert.ok(ev.stage === 'closed' || ev.defense, 'a hit was defended automatically (or the attack missed)');
  if (ev.defense) assert.ok(['dodge', 'parry', 'block', 'none'].includes(ev.defense.type));
  console.log(`Attack OK: ${ev.status}; NPC defense ${ev.defense ? ev.defense.label || ev.defense.type : 'not needed'}; turn passed automatically`);
  await G.waitForSelector('.turn-pop:has-text("NPC turn")');
  await shot(G, '3-gm-npc-turn-after-auto-end');
  await G.click('.turn-pop button:has-text("Close")');

  // ---- paste a spreadsheet into the catalog
  await G.click('.nav button:has-text("Item Catalog")');
  await G.click('button:has-text("Paste from spreadsheet")');
  const sheet = [
    ['Name', 'Category', 'Subcategory', 'Damage', 'Acc', 'Range', 'RoF', 'Shots', 'Bulk', 'Rcl', 'ST', 'Caliber', 'Magazines', 'Capacity', 'DR', 'Covers', 'Weight', 'Price', 'Size'],
    ['Saiga-12K', 'Weapon', 'Shotguns', '1d+1 pi', '3', '50/125', '3x9', '8+1(3)', '-5', '1', '11', '12/70', 'saiga12', '', '', '', '3.6', '38000', '4x2'],
    ['Saiga 12 8-round magazine', 'Magazine', '', '', '', '', '', '', '', '', '', '12/70', 'saiga12', '8', '', '', '0.3', '900', '1x2'],
    ['PSZ-9a body armor', 'Armor', 'Body Armor', '', '', '', '', '', '', '', '', '', '', '', '12', 'torso, vitals, groin', '7.5', '45000', '3x3'],
    ['Mosin 5-round stripper clip', 'Magazine', 'Stripper Clips', '', '', '', '', '', '', '', '', '7.62x54R', 'mosin', '5', '', '', '0.02', '120', '1x1'],
  ].map(r => r.join('\t')).join('\n');
  await G.fill('.modal textarea', sheet);
  await G.waitForSelector('.modal .chip:has-text("1 weapon")');
  await shot(G, '4-paste-spreadsheet');
  await G.click('.modal button:has-text("Import 4 items")');
  await waitFor(() => Object.values(s().defs).some(x => x.name === 'Saiga-12K'));
  const saiga = Object.values(s().defs).find(x => x.name === 'Saiga-12K');
  assert.equal(saiga.weapon.skill, 'Guns (Shotgun)', 'skill from the subcategory');
  assert.deepEqual([saiga.w, saiga.h], [4, 2]);
  assert.deepEqual(saiga.weapon.magFamilies, ['saiga12']);
  assert.deepEqual(saiga.weapon.calibers, ['12/70'], 'a slash inside a caliber is not a separator');
  const armor = Object.values(s().defs).find(x => x.name === 'PSZ-9a body armor');
  assert.equal(armor.armor.dr, 12);
  assert.deepEqual(armor.armor.locations, ['torso', 'vitals', 'groin']);
  const clip = Object.values(s().defs).find(x => x.name === 'Mosin 5-round stripper clip');
  assert.equal(clip.magazine.clip, true);
  console.log('Spreadsheet paste OK: weapon (skill from subcategory), magazine, armor and stripper clip imported');

  assert.deepEqual(errors, [], 'no browser errors');
  console.log('STREAMLINE E2E PASSED');
  await browser.close(); await host.stop(); process.exit(0);
})().catch(e => { console.error('E2E FAILED:', e); process.exit(1); });
