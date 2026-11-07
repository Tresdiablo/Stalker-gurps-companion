'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, giveBuild } = require('./helpers.cjs');
const weapons = require('../../src/core/weapons');
const inv = require('../../src/core/inventory');

function scene() {
  const t = setup();
  const { engine, gm, pc } = t;
  giveBuild(engine, gm, pc, { dx: 12, ht: 11, basicSpeed: 6, skills: [{ name: 'Guns', spec: 'Rifle', level: 14 }, { name: 'Fast-Draw', spec: 'Long Arm', level: 15 }] });
  const n1 = engine.dispatch('char.create', { name: 'Bandit 1', kind: 'npc' }, gm).result.id;
  const n2 = engine.dispatch('char.create', { name: 'Bandit 2', kind: 'npc' }, gm).result.id;
  for (const n of [n1, n2]) giveBuild(engine, gm, n, { basicSpeed: 5, skills: [{ name: 'Guns', spec: 'Pistol', level: 11 }] });
  const ak = engine.dispatch('item.spawn', { defId: 'builtin-akm-76239', target: { p: 'char:' + pc, slot: 'primary' } }, gm).result.ids[0];
  const mag = engine.dispatch('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + pc, loadFull: true }, gm).result.ids[0];
  engine.dispatch('item.insertMag', { weaponId: ak, magId: mag }, gm);
  engine.dispatch('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + pc, loadFull: true }, gm);
  const pm = engine.dispatch('item.spawn', { defId: 't1-weapon-pm', target: { p: 'char:' + n1, slot: 'holster' } }, gm).result.ids[0];
  const pmMag = engine.dispatch('item.spawn', { defId: 't1-mag-pm-pb-8-round-magazine', to: 'char:' + n1, loadFull: true }, gm).result.ids[0];
  engine.dispatch('item.insertMag', { weaponId: pm, magId: pmMag }, gm);
  const enc = engine.dispatch('enc.create', { name: 'Fight', participants: [pc, n1, n2] }, gm).result.id;
  return { ...t, n1, n2, ak, pm, enc };
}

test('turn cycle: order by speed, players act only on their turn, end their own turn, downed are skipped', () => {
  const t = scene();
  const { engine, gm, player, pc, n1, n2, enc } = t;
  const e = () => engine.state.encounters[enc];
  engine.dispatch('enc.start', { id: enc }, gm);
  assert.equal(e().order[0], pc, 'fastest first');
  assert.equal(inv.equipped(engine.state, n1, 'hands')?.id, t.pm, 'NPCs start with weapons drawn');
  assert.equal(inv.equipped(engine.state, pc, 'hands'), null, 'PCs keep weapons slung by default');
  assert.throws(() => engine.dispatch('enc.next', { id: enc }, { role: 'player', playerId: 'nobody' }), /own character/);
  engine.dispatch('enc.next', { id: enc, expect: pc }, player); // player ends own turn
  engine.dispatch('enc.next', { id: enc, expect: pc }, player); // duplicate click is ignored
  assert.equal(e().order[e().turn], n1);
  assert.throws(() => engine.dispatch('combat.maneuver', { id: enc, charId: pc, maneuver: 'aim', weaponId: t.ak, targetId: n1 }, player), /turn/);
  engine.dispatch('char.adjust', { id: n2, conditionsAdd: ['Unconscious'] }, gm);
  const r = engine.dispatch('enc.next', { id: enc }, gm);
  assert.match(r.summary, /skipped Bandit 2/);
  assert.equal(e().round, 2);
  assert.equal(e().order[e().turn], pc);
});

test('ready slot: readying takes a turn (or Fast-Draw), reloading takes the weapon reload time', () => {
  const t = scene();
  const { engine, gm, player, pc, n1, enc } = t;
  const e = () => engine.state.encounters[enc];
  engine.dispatch('enc.start', { id: enc }, gm);
  assert.throws(() => engine.dispatch('combat.attack', { actorId: pc, targetId: n1, weapon: { itemId: t.ak } }, player), /Draw AKM first/);
  engine.dispatch('item.move', { itemId: t.ak, target: { p: 'char:' + pc, slot: 'hands' } }, player);
  assert.equal(engine.state.items[t.ak].readyAt, 2);
  assert.throws(() => engine.dispatch('combat.attack', { actorId: pc, targetId: n1, weapon: { itemId: t.ak } }, player), /already spent \(drawing AKM\)/);
  engine.dispatch('enc.next', { id: enc }, gm); engine.dispatch('enc.next', { id: enc }, gm); engine.dispatch('enc.next', { id: enc }, gm);
  assert.equal(e().round, 2);
  assert.equal(engine.state.items[t.ak].readyAt, undefined, 'ready now');
  t.queue.push(6, 6, 6);
  engine.dispatch('combat.attack', { actorId: pc, targetId: n1, weapon: { itemId: t.ak }, shots: 1 }, player);
  engine.dispatch('weapon.reload', { weaponId: t.ak }, player);
  assert.equal(engine.state.items[t.ak].readyAt, 2 + 3, 'magazine change takes 3 s by default');
  // Fast-Draw: a pistol drawn by a skilled shooter is usable at once on a success
  const pistol = engine.dispatch('item.spawn', { defId: 't1-weapon-pm', target: { p: 'char:' + pc, slot: 'holster' } }, gm).result.ids[0];
  engine.dispatch('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + pc }, gm);
  t.queue.push(2, 2, 2); // Fast-Draw (Pistol) defaults from DX... success on 6
  engine.dispatch('item.ready', { itemId: pistol, fastDraw: true }, player);
  assert.equal(engine.state.items[pistol].loc.slot, 'hands');
  assert.equal(engine.state.items[pistol].readyAt, undefined, 'Fast-Draw success: ready immediately');
  assert.equal(engine.state.items[t.ak].loc.slot !== 'hands', true, 'the rifle went back to storage');
});

test('break: N seconds to spend, no attacks, clock advances; GM password and permissions', () => {
  const t = scene();
  const { engine, gm, player, pc, n1, enc } = t;
  const e = () => engine.state.encounters[enc];
  engine.dispatch('enc.start', { id: enc }, gm);
  assert.throws(() => engine.dispatch('enc.break', { id: enc, seconds: 5 }, player), /Only the GM/);
  engine.dispatch('enc.break', { id: enc, seconds: 5 }, gm);
  assert.deepEqual(e().break.remaining, { [pc]: 5 });
  assert.throws(() => engine.dispatch('combat.attack', { actorId: n1, targetId: pc, weapon: { itemId: t.pm } }, gm), /during a break/);
  engine.dispatch('item.move', { itemId: t.ak, target: { p: 'char:' + pc, slot: 'hands' } }, player); // 1 s, ready at once
  assert.equal(e().break.remaining[pc], 4);
  assert.equal(engine.state.items[t.ak].readyAt, undefined);
  t.queue.push(6, 6, 6);
  engine.dispatch('weapon.reload', { weaponId: t.ak }, player); // swaps to the full spare magazine: 3 s
  assert.equal(e().break.remaining[pc], 1);
  assert.throws(() => engine.dispatch('item.attach', { weaponId: t.ak, attId: engine.dispatch('item.spawn', { defId: 'att-pso1', to: 'char:' + pc }, gm).result.ids[0] }, player), /takes 3 s/);
  engine.dispatch('combat.maneuver', { id: enc, charId: pc, maneuver: 'aim', weaponId: t.ak, targetId: n1 }, player); // 1 s, out of turn is fine during a break
  assert.equal(e().break.remaining[pc], 0);
  engine.dispatch('enc.breakDone', { id: enc, charId: pc }, player);
  engine.dispatch('enc.endBreak', { id: enc }, gm);
  assert.equal(e().round, 6, 'round 1 + 5 seconds');
  assert.equal(e().break, undefined);
  assert.equal(e().combatants[pc].aim.turns, 1, 'aim taken during the break is kept');
  t.queue.push(1, 2, 2, 6, 6, 6);
  const r = engine.dispatch('combat.attack', { actorId: pc, targetId: n1, weapon: { itemId: t.ak }, shots: 1 }, player);
  assert.ok(engine.state.events[r.eventId]);
});
