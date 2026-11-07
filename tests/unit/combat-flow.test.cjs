'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, giveBuild } = require('./helpers.cjs');
const weapons = require('../../src/core/weapons');

function scene() {
  const t = setup();
  const { engine, gm, pc } = t;
  giveBuild(engine, gm, pc, { st: 11, dx: 12, iq: 11, ht: 11, hp: 11, fp: 11, basicSpeed: 5.75, basicMove: 5, dodge: 8, skills: [{ name: 'Guns', spec: 'Rifle', level: 13 }, { name: 'Lockpicking', spec: '', level: 12 }, { name: 'Guns', spec: 'Pistol', level: 12 }] });
  const bandit = engine.dispatch('char.create', { name: 'Bandit 1', kind: 'npc', faction: 'Bandits' }, gm).result.id;
  giveBuild(engine, gm, bandit, { st: 10, dx: 11, iq: 9, ht: 10, hp: 10, fp: 10, basicSpeed: 5.25, basicMove: 5, dodge: 8, skills: [{ name: 'Guns', spec: 'Pistol', level: 12 }] });
  // PC: AKM in primary slot with a loaded 30-round magazine
  const akm = engine.dispatch('item.spawn', { defId: 'builtin-akm-76239', target: { p: 'char:' + pc, slot: 'ready' } }, gm).result.ids[0];
  const mag = engine.dispatch('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + pc, loadFull: true, ammoId: 't1-ammo-7-62-39mm-fmj' }, gm).result.ids[0];
  engine.dispatch('item.insertMag', { weaponId: akm, magId: mag }, t.player);
  // Bandit: leather jacket (DR 1 torso) and a loaded TT pistol
  engine.dispatch('item.spawn', { defId: 'arm-leather-jacket', target: { p: 'char:' + bandit, slot: 'armor' } }, gm);
  const tt = engine.dispatch('item.spawn', { defId: 't1-weapon-tt', target: { p: 'char:' + bandit, slot: 'ready' } }, gm).result.ids[0];
  const ttMag = engine.dispatch('item.spawn', { defId: 't1-mag-tt-8-round-magazine', to: 'char:' + bandit, loadFull: true }, gm).result.ids[0];
  engine.dispatch('item.insertMag', { weaponId: tt, magId: ttMag }, gm);
  const enc = engine.dispatch('enc.create', { name: 'Ambush', participants: [pc, bandit] }, gm).result.id;
  engine.dispatch('enc.start', { id: enc }, gm);
  engine.dispatch('enc.distance', { id: enc, a: pc, b: bandit, yards: 20 }, gm);
  return { ...t, bandit, akm, mag, tt, enc };
}

test('Scenario 1: player attacks NPC; GM resolves defense and manually applies damage; undo works', () => {
  const t = scene();
  const { engine, gm, player, pc, bandit, akm, enc } = t;
  const s = () => engine.state;
  assert.equal(weapons.roundsAvailable(s(), s().items[akm]), 30, '29 in magazine + 1 chambered');

  // attack 3d6 = 2+2+1 = 5 vs effective 13 -6 (20 yd) +0 (3 shots) = 7 → margin 2 → 2 hits (Rcl 2)
  t.queue.push(2, 2, 1);
  const r = engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 3, hitLocation: 'torso' }, player, { requestId: 'atk-1' });
  let ev = s().events[r.eventId];
  assert.equal(ev.attack.baseSkill, 13);
  assert.equal(ev.attack.effective, 7);
  assert.equal(ev.attack.roll.total, 5);
  assert.equal(ev.attack.hits, 2);
  assert.equal(ev.stage, 'awaiting-defense', 'success is not yet a hit');
  assert.equal(weapons.roundsAvailable(s(), s().items[akm]), 27, 'ammo deducted when fired');

  // duplicate network delivery of the same attack does nothing
  const dup = engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 3 }, player, { requestId: 'atk-1' });
  assert.equal(dup.duplicate, true);
  assert.equal(weapons.roundsAvailable(s(), s().items[akm]), 27);

  // player cannot roll the NPC's defense
  assert.throws(() => engine.dispatch('combat.defend', { eventId: ev.id, type: 'dodge' }, player), /own character/);

  // GM rolls Dodge 6+6+5 = 17 → fails. Damage: hit 1 = 5d+1 (3,3,3,3,3)+1 = 16; hit 2 = (1,1,1,1,1)+1 = 6
  t.queue.push(6, 6, 5, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1);
  engine.dispatch('combat.defend', { eventId: ev.id, type: 'dodge' }, gm);
  ev = s().events[r.eventId];
  assert.equal(ev.defense.roll.success, false);
  assert.equal(ev.stage, 'resolved');
  assert.deepEqual(ev.damage.hits.map(h => h.basic), [16, 6]);
  assert.deepEqual(ev.damage.hits.map(h => h.dr), [1, 1], 'leather jacket DR 1 on torso');
  assert.deepEqual(ev.damage.hits.map(h => h.injury), [15, 5]);
  assert.equal(ev.proposal.hp, -20);
  assert.equal(s().characters[bandit].session.hp, 10, 'HP unchanged until the GM applies');

  // players cannot apply damage to NPCs
  assert.throws(() => engine.dispatch('combat.apply', { eventId: ev.id, mode: 'calculated' }, player), /Only the GM/);
  assert.throws(() => engine.dispatch('char.adjust', { id: bandit, hp: -5 }, player), /own character/);

  engine.dispatch('combat.apply', { eventId: ev.id, mode: 'calculated' }, gm, { requestId: 'apply-1' });
  assert.equal(s().characters[bandit].session.hp, -10);
  // repeated click / duplicate packet
  engine.dispatch('combat.apply', { eventId: ev.id, mode: 'calculated' }, gm, { requestId: 'apply-1' });
  assert.throws(() => engine.dispatch('combat.apply', { eventId: ev.id, mode: 'calculated' }, gm, { requestId: 'apply-2' }), /already been applied/);
  assert.equal(s().characters[bandit].session.hp, -10, 'damage applied exactly once');
  assert.ok(s().log.some(l => /GM applied -20 HP to Bandit 1/.test(l.summary)), 'combat log records the action');

  // undo, then apply a custom amount instead
  engine.dispatch('combat.undo', { eventId: ev.id }, gm);
  assert.equal(s().characters[bandit].session.hp, 10);
  engine.dispatch('combat.apply', { eventId: ev.id, mode: 'custom', hp: -7 }, gm);
  assert.equal(s().characters[bandit].session.hp, 3);
  assert.ok(s().log.some(l => l.override && /custom amount/.test(l.summary)), 'overrides are logged automatically');
});

test('Scenario 2: NPC attacks player; player defends; GM notifies; player applies once', () => {
  const t = scene();
  const { engine, gm, player, pc, bandit, tt } = t;
  const s = () => engine.state;
  // Bandit Guns (Pistol) 12, 20 yd (-6) → 6. Roll 1+2+2=5 → success.
  t.queue.push(1, 2, 2);
  const r = engine.dispatch('combat.attack', { actorId: bandit, targetId: pc, weapon: { itemId: tt }, shots: 1, hitLocation: 'torso' }, gm);
  // a player cannot attack on the NPC's behalf
  assert.throws(() => engine.dispatch('combat.attack', { actorId: bandit, targetId: pc, weapon: { itemId: tt } }, player), /Only the GM/);
  let ev = s().events[r.eventId];
  assert.equal(ev.stage, 'awaiting-defense');
  // player rolls own Dodge: 6+6+6 = 18 fails; damage 3d pi- : 4+4+4 = 12, no armor → 6 injury
  t.queue.push(6, 6, 6, 4, 4, 4);
  engine.dispatch('combat.defend', { eventId: ev.id, type: 'dodge' }, player);
  ev = s().events[r.eventId];
  assert.equal(ev.damage.totalInjury, 6);
  assert.equal(s().characters[pc].session.hp, 11, 'player HP not changed automatically');
  const n = engine.dispatch('combat.notify', { eventId: ev.id }, gm);
  const notif = s().events[r.eventId].notifications[0];
  assert.match(notif.text, /Bandit 1 hit Stalker Ivan for 6 injury/);
  engine.dispatch('combat.ackNotification', { eventId: ev.id, notifId: notif.id }, player);
  assert.equal(s().characters[pc].session.hp, 5);
  assert.throws(() => engine.dispatch('combat.ackNotification', { eventId: ev.id, notifId: notif.id }, player), /already applied/);
  assert.equal(s().characters[pc].session.hp, 5);
  assert.ok(n);
});

test('Scenario 3: noncombat skill check reaches the GM with full details', () => {
  const t = scene();
  const { engine, player, pc } = t;
  t.queue.push(3, 3, 4);
  const r = engine.dispatch('roll.skill', { actorId: pc, skill: 'Lockpicking', mods: [{ label: 'Good tools', value: 1 }] }, player);
  const ev = engine.state.events[r.eventId];
  assert.equal(ev.kind, 'skill');
  assert.equal(ev.baseSkill, 12);
  assert.equal(ev.effective, 13);
  assert.equal(ev.roll.total, 10);
  assert.equal(ev.roll.margin, 3);
  assert.equal(ev.roll.success, true);
  // missing skill falls back to its default with an explanation
  t.queue.push(1, 1, 1);
  const d = engine.dispatch('roll.skill', { actorId: pc, skill: 'Stealth' }, player);
  assert.match(engine.state.events[d.eventId].baseExplain, /default DX-5/);
});

test('GM overrides recompute downstream results; aim accumulates and resets', () => {
  const t = scene();
  const { engine, gm, player, pc, bandit, akm, enc } = t;
  engine.dispatch('combat.maneuver', { id: enc, charId: pc, maneuver: 'aim', weaponId: akm, targetId: bandit, braced: true }, player);
  engine.dispatch('combat.maneuver', { id: enc, charId: pc, maneuver: 'aim', weaponId: akm, targetId: bandit }, player);
  assert.equal(engine.state.encounters[enc].combatants[pc].aim.turns, 2);
  t.queue.push(6, 6, 6); // 18: critical failure regardless
  const r = engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 1 }, player);
  const ev = engine.state.events[r.eventId];
  const keys = ev.attack.mods.map(m => m.key);
  assert.ok(keys.includes('acc') && keys.includes('aim') && keys.includes('braced'));
  assert.equal(ev.attack.effective, 13 + 4 + 1 + 1 - 6);
  assert.equal(ev.attack.roll.critical, 'failure');
  assert.equal(engine.state.encounters[enc].combatants[pc].aim, null, 'attacking ends the aim');
  engine.dispatch('combat.override', { eventId: ev.id, field: 'attackSuccess', value: true }, gm);
  assert.equal(engine.state.events[r.eventId].stage, 'awaiting-defense');
  t.queue.push(2, 2, 2);
  engine.dispatch('combat.defend', { eventId: ev.id, type: 'none' }, gm);
  assert.equal(engine.state.events[r.eventId].stage, 'resolved');
  engine.dispatch('combat.override', { eventId: ev.id, field: 'hitInjury', value: 3, hitIndex: 0 }, gm);
  assert.equal(engine.state.events[r.eventId].proposal.hp, -3);
  assert.ok(engine.state.events[r.eventId].overrides.length >= 2);
});

test('cannot fire more rounds than loaded; RoF enforced', () => {
  const t = scene();
  const { engine, player, pc, bandit, akm } = t;
  assert.throws(() => engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 11 }, player), /RoF/);
  t.queue.push(6, 6, 6, 6, 6, 6, 6, 6, 6);
  engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 10 }, player);
  engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 10 }, player);
  assert.equal(weapons.roundsAvailable(engine.state, engine.state.items[akm]), 10);
  engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 10 }, player);
  assert.throws(() => engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 1 }, player), /empty/);
});

test('journal replay reproduces the exact state (crash recovery)', () => {
  const t = scene();
  const { engine, player, pc, bandit, akm, gm } = t;
  t.queue.push(2, 2, 1, 6, 6, 5, 3, 3, 3, 3, 3, 1, 1, 1, 1, 1);
  const r = engine.dispatch('combat.attack', { actorId: pc, targetId: bandit, weapon: { itemId: akm }, shots: 3 }, player);
  engine.dispatch('combat.defend', { eventId: r.eventId, type: 'dodge' }, gm);
  engine.dispatch('combat.apply', { eventId: r.eventId, mode: 'calculated' }, gm);
  const { Engine } = require('../../src/core/engine');
  const campaign = require('../../src/core/campaign');
  const { Context } = require('../../src/core/context');
  // rebuild from the very first snapshot: replay every journal entry after campaign creation
  let n = 0;
  const base = campaign.emptyCampaign(new Context({ idgen: () => 'seed' + (++n), clock: () => '2026-01-01T00:00:00.000Z' }), { name: 'Test Campaign', test: true, seedCatalog: true });
  const e2 = new Engine(base);
  for (const entry of t.journal) e2.replay(entry);
  const strip = x => { const c = structuredClone(x); c.meta.processed = {}; return require('node:crypto').createHash('sha256').update(JSON.stringify(c)).digest('hex'); };
  assert.equal(strip(e2.state), strip(engine.state), 'replayed state hash matches');
});
