'use strict';
// The Ready slot: magazines (2 turns), round-by-round loading, stripper clips, consumables,
// drawing weapons; free outside combat; seconds during a break; old saves migrate to the Hands slot.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, giveBuild } = require('./helpers.cjs');
const weapons = require('../../src/core/weapons');
const inv = require('../../src/core/inventory');
const campaign = require('../../src/core/campaign');

function scene({ fastAmmo = false } = {}) {
  const t = setup();
  const { engine, gm, pc } = t;
  const skills = [{ name: 'Guns', spec: 'Rifle', level: 14 }];
  if (fastAmmo) skills.push({ name: 'Fast-Draw', spec: 'Ammo', level: 14 });
  giveBuild(engine, gm, pc, { dx: 12, ht: 11, basicSpeed: 6, skills });
  const n1 = engine.dispatch('char.create', { name: 'Bandit', kind: 'npc' }, gm).result.id;
  giveBuild(engine, gm, n1, { basicSpeed: 5 });
  const sp = (defId, extra) => engine.dispatch('item.spawn', { defId, ...extra }, gm).result.ids[0];
  const rig = sp('sample-chest-rig', { target: { p: 'char:' + pc, slot: 'rig' } });
  const ak = sp('builtin-akm-76239', { target: { p: 'char:' + pc, slot: 'hands' } });
  const mag1 = sp('mag-ak762-10', { to: 'char:' + pc, loadFull: true });
  engine.dispatch('item.insertMag', { weaponId: ak, magId: mag1 }, gm);
  const mag2 = sp('mag-ak762-30', { to: 'char:' + pc, loadFull: true });
  const enc = engine.dispatch('enc.create', { name: 'Fight', participants: [pc, n1] }, gm).result.id;
  const e = () => engine.state.encounters[enc];
  const toReady = (itemId, who = t.player) => engine.dispatch('item.move', { itemId, target: { p: 'char:' + pc, slot: 'ready' } }, who);
  const next = () => engine.dispatch('enc.next', { id: enc }, gm);
  return { ...t, n1, sp, rig, ak, mag1, mag2, enc, e, toReady, next };
}

test('outside combat the Ready slot acts at once; the old magazine goes into the rig', () => {
  const t = scene();
  const r = t.toReady(t.mag2);
  assert.match(r.summary, /AK 7.62×39 30-round magazine in AKM/);
  assert.equal(weapons.magazineIn(t.s(), t.s().items[t.ak]).id, t.mag2);
  assert.equal(t.s().items[t.mag1].loc.p, 'item:' + t.rig, 'old magazine stowed in the chest rig');
  assert.equal(inv.equipped(t.s(), t.pc, 'ready'), null, 'Ready slot is empty again');
});

test('in combat a magazine takes 2 turns: grab now, load and rack next turn; the turn is spent', () => {
  const t = scene();
  t.engine.dispatch('enc.start', { id: t.enc }, t.gm);
  assert.equal(t.e().order[0], t.pc);
  const r = t.toReady(t.mag2);
  assert.match(r.summary, /next turn/);
  assert.equal(t.s().items[t.mag2].loc.slot, 'ready');
  assert.equal(t.s().items[t.mag2].stage.due, 2);
  assert.throws(() => t.engine.dispatch('combat.attack', { actorId: t.pc, targetId: t.n1, weapon: { itemId: t.ak }, shots: 1 }, t.player), /turn is already spent/);
  t.next(); // bandit
  assert.throws(() => t.toReady(t.mag1), /turn/i, 'not your turn');
  const r2 = t.next(); // round 2, Ivan: the magazine goes in automatically
  assert.match(r2.summary, /30-round magazine in AKM/);
  assert.equal(weapons.magazineIn(t.s(), t.s().items[t.ak]).id, t.mag2);
  assert.equal(t.s().items[t.mag1].loc.p, 'item:' + t.rig);
  assert.throws(() => t.engine.dispatch('combat.attack', { actorId: t.pc, targetId: t.n1, weapon: { itemId: t.ak }, shots: 1 }, t.player), /spent/, 'loading used this turn too');
  t.next(); t.next(); // round 3
  t.queue.push(1, 1, 1, 6, 6, 6);
  const a = t.engine.dispatch('combat.attack', { actorId: t.pc, targetId: t.n1, weapon: { itemId: t.ak }, shots: 1 }, t.player);
  assert.ok(t.s().events[a.eventId]);
});

test('Fast-Draw (Ammo) on the sheet: a successful roll loads the magazine on the same turn', () => {
  const t = scene({ fastAmmo: true });
  t.engine.dispatch('enc.start', { id: t.enc }, t.gm);
  t.queue.push(1, 2, 2); // 5 — success
  const r = t.toReady(t.mag2);
  assert.match(r.summary, /Fast-Draw/);
  assert.equal(weapons.magazineIn(t.s(), t.s().items[t.ak]).id, t.mag2);
});

test('round-by-round: one round per turn into an internal magazine, two with Fast-Draw (Ammo)', () => {
  for (const fastAmmo of [false, true]) {
    const t = scene({ fastAmmo });
    const sks = t.sp('t1-weapon-sks', { to: 'char:' + t.pc });
    t.engine.dispatch('item.move', { itemId: sks, target: { p: 'char:' + t.pc, slot: 'hands' }, instant: true }, t.gm);
    assert.equal(inv.equipped(t.s(), t.pc, 'hands').id, sks);
    const ammo = t.sp('t1-ammo-7-62-39mm-fmj', { to: 'char:' + t.pc, qty: 3 });
    t.engine.dispatch('enc.start', { id: t.enc }, t.gm);
    t.toReady(ammo);
    t.next();
    t.queue.push(1, 1, 1);
    const r = t.next(); // round 2
    assert.match(r.summary, fastAmmo ? /loaded 2 rounds/ : /loaded 1 round /);
    assert.equal(weapons.roundCount(t.s().items[sks].rounds), fastAmmo ? 2 : 1);
    t.next(); t.queue.push(1, 1, 1); t.next(); // round 3
    assert.equal(weapons.roundCount(t.s().items[sks].rounds), fastAmmo ? 3 : 2);
    if (fastAmmo) assert.equal(t.s().items[ammo], undefined, 'all rounds used');
    else assert.equal(t.s().items[ammo].loc.slot, 'ready', 'still loading');
  }
});

test('stripper clip loads the SKS in its reload time (3 s), then the clip is stowed', () => {
  const t = scene();
  const sks = t.sp('t1-weapon-sks', { to: 'char:' + t.pc });
  t.engine.dispatch('item.move', { itemId: sks, target: { p: 'char:' + t.pc, slot: 'hands' }, instant: true }, t.gm);
  const clip = t.sp('clip-sks-10', { to: 'char:' + t.pc, loadFull: true });
  assert.throws(() => t.engine.dispatch('item.insertMag', { weaponId: sks, magId: clip }, t.gm), /internal magazine/);
  t.engine.dispatch('enc.start', { id: t.enc }, t.gm);
  t.toReady(clip);
  assert.equal(t.s().items[clip].stage.due, 3);
  t.next(); const r2 = t.next(); // round 2: still loading
  assert.match(r2.summary, /keeps loading/);
  assert.equal(weapons.roundCount(t.s().items[sks].rounds), 0);
  t.next(); const r3 = t.next(); // round 3
  assert.match(r3.summary, /10 rounds stripped into SKS/);
  assert.equal(weapons.roundCount(t.s().items[sks].rounds), 10);
  assert.equal(weapons.roundCount(t.s().items[clip].rounds), 0);
  assert.notEqual(t.s().items[clip].loc.slot, 'ready');
});

test('consumables are used next turn; weapons are drawn next turn; taking the item out cancels', () => {
  const t = scene();
  const kit = t.sp('med-kit', { to: 'char:' + t.pc });
  t.engine.dispatch('enc.start', { id: t.enc }, t.gm);
  t.toReady(kit);
  t.next(); const r = t.next();
  assert.match(r.summary, /First aid kit|aid/i);
  // weapon draw from the sling
  const pm = t.sp('t1-weapon-pm', { target: { p: 'char:' + t.pc, slot: 'holster' } });
  t.next(); t.next(); // round 3
  t.toReady(pm);
  t.next(); t.next(); // round 4
  assert.equal(inv.equipped(t.s(), t.pc, 'hands').id, pm);
  assert.equal(t.s().items[t.ak].loc.slot, 'primary', 'the rifle went to the sling');
  // cancel: drag out before the turn comes
  t.next(); t.next(); // round 5
  const bandage = t.sp('med-bandage', { to: 'char:' + t.pc });
  t.toReady(bandage);
  assert.ok(t.s().items[bandage].stage);
  t.engine.dispatch('item.move', { itemId: bandage, target: { p: 'char:' + t.pc, g: 'ground', x: 9, y: 7 } }, t.player);
  assert.equal(t.s().items[bandage].stage, undefined, 'taken out: cancelled');
});

test('during a break the Ready slot works at once and costs seconds (magazine 2 s)', () => {
  const t = scene();
  t.engine.dispatch('enc.start', { id: t.enc }, t.gm);
  t.engine.dispatch('enc.break', { id: t.enc, seconds: 5 }, t.gm);
  t.toReady(t.mag2);
  assert.equal(weapons.magazineIn(t.s(), t.s().items[t.ak]).id, t.mag2);
  assert.equal(t.e().break.remaining[t.pc], 3);
});

test('old saves: items in the former "In hands" slot move to Hands', () => {
  const s = { schema: 1, items: { a: { id: 'a', defId: 'x', loc: { p: 'char:c', slot: 'ready' } } } };
  const report = campaign.migrate(s);
  assert.equal(s.items.a.loc.slot, 'hands');
  assert.equal(s.schema, 2);
  assert.match(report.join(' '), /Hands/);
});

test('streamlined: turns end by themselves once used, spent turns pass, NPCs defend automatically', () => {
  const t = setup({ auto: true });
  const { engine, gm, player, pc } = t;
  giveBuild(engine, gm, pc, { dx: 12, ht: 11, basicSpeed: 6, skills: [{ name: 'Guns', spec: 'Rifle', level: 14 }] });
  const n1 = engine.dispatch('char.create', { name: 'Bandit', kind: 'npc' }, gm).result.id;
  giveBuild(engine, gm, n1, { basicSpeed: 5, dx: 10, ht: 10 });
  const sp = (defId, extra) => engine.dispatch('item.spawn', { defId, ...extra }, gm).result.ids[0];
  const ak = sp('builtin-akm-76239', { target: { p: 'char:' + pc, slot: 'hands' } });
  engine.dispatch('item.insertMag', { weaponId: ak, magId: sp('mag-ak762-30', { to: 'char:' + pc, loadFull: true }) }, gm);
  const spare = sp('mag-ak762-30', { to: 'char:' + pc, loadFull: true });
  const enc = engine.dispatch('enc.create', { name: 'Fight', participants: [pc, n1] }, gm).result.id;
  const e = () => engine.state.encounters[enc];
  engine.dispatch('enc.start', { id: enc }, gm);
  // attack: hit, the NPC dodges by itself, and the turn passes to the bandit
  t.queue.push(3, 3, 3, 6, 6, 6); // attack 9 (hit, not critical), dodge 18 (fail)
  const r = engine.dispatch('combat.attack', { actorId: pc, targetId: n1, weapon: { itemId: ak }, shots: 1 }, player);
  const ev = engine.state.events[r.result.eventId];
  assert.equal(ev.defense.type, 'dodge', 'NPC rolled its best defense');
  assert.equal(ev.stage, 'resolved', 'injury is calculated, waiting for the GM to apply it');
  assert.equal(engine.state.characters[n1].session.hp, 10, 'HP never changes without the GM');
  assert.equal(e().order[e().turn], n1, 'turn passed to the bandit');
  assert.match(r.summary, /Bandit's turn/);
  // GM ends the bandit's turn; Ivan stages a magazine: his turn passes at once
  engine.dispatch('enc.next', { id: enc }, gm);
  assert.equal(e().order[e().turn], pc);
  engine.dispatch('item.move', { itemId: spare, target: { p: 'char:' + pc, slot: 'ready' } }, player);
  assert.equal(e().order[e().turn], n1, 'grabbing the magazine used the turn');
  // bandit's turn ends; Ivan's next turn is spent loading → passes straight back to the bandit
  const r2 = engine.dispatch('enc.next', { id: enc }, gm);
  assert.match(r2.summary, /30-round magazine in AKM/);
  assert.equal(e().order[e().turn], n1);
  assert.equal(e().round, 3);
});
