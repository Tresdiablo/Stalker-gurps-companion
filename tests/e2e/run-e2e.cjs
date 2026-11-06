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
  await G.goto(host.url()); await G.waitForSelector('.nav');
  await P.goto(host.playerLink(pid)); await P.waitForSelector('.nav');
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
