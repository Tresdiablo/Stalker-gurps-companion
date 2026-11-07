'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, giveBuild } = require('./helpers.cjs');
const { viewFor } = require('../../src/core/views');

test('player view never contains GM-only data', () => {
  const t = setup();
  const { engine, gm, player, pc } = t;
  giveBuild(engine, gm, pc, { skills: [{ name: 'Guns', spec: 'Pistol', level: 12 }, { name: 'Observation', spec: '', level: 12 }] });
  const npc = engine.dispatch('char.create', { name: 'Secret Sniper', kind: 'npc' }, gm).result.id;
  engine.dispatch('char.update', { id: npc, gmNotes: 'Works for the Monolith' }, gm);
  engine.dispatch('item.spawn', { defId: 'misc-documents', to: 'char:' + npc }, gm);
  const enc = engine.dispatch('enc.create', { name: 'Hidden', participants: [pc, npc] }, gm).result.id;
  engine.dispatch('enc.start', { id: enc }, gm);
  t.queue.push(1, 1, 2);
  engine.dispatch('roll.skill', { actorId: npc, skill: 'Guns (Pistol)', visibility: 'gm' }, gm);
  const req = engine.dispatch('roll.request', { actorId: pc, skill: 'Observation', visibility: 'hidden', mods: [{ label: 'Camouflaged sniper', value: -4 }] }, gm).result.eventId;
  t.queue.push(3, 3, 3);
  const rolled = engine.dispatch('roll.skill', { actorId: pc, skill: 'Observation', requestEventId: req }, player).result.eventId;
  engine.dispatch('npc.reveal', { id: npc, reveal: false }, gm);

  const v = viewFor(engine.state, player);
  const text = JSON.stringify(v);
  assert.ok(!text.includes('Monolith'), 'GM notes are not sent');
  assert.ok(!v.characters[npc], 'hidden NPC is not sent');
  assert.ok(!Object.values(v.items).some(i => i.defId === 'misc-documents'), 'NPC inventory is not sent');
  assert.equal(v.gmNotes, undefined);
  assert.ok(!Object.values(v.events).some(e => e.actorId === npc), 'GM-only NPC roll is not sent');
  const mine = v.events[rolled];
  assert.equal(mine.effective, undefined, 'concealed target number is not sent');
  assert.equal(mine.roll.success, undefined, 'concealed result is not sent');
  assert.equal(mine.mods, undefined);
  const g = viewFor(engine.state, gm);
  assert.equal(g.events[rolled].effective, 12 - 4);
  assert.equal(g.characters[npc].gmNotes, 'Works for the Monolith');
});

test('players see a revealed NPC only descriptively by default', () => {
  const t = setup();
  const { engine, gm, player, pc } = t;
  const npc = engine.dispatch('char.create', { name: 'Bandit 1', kind: 'npc' }, gm).result.id;
  engine.dispatch('npc.reveal', { id: npc, reveal: true }, gm);
  const enc = engine.dispatch('enc.create', { name: 'Fight', participants: [pc, npc] }, gm).result.id;
  engine.dispatch('char.adjust', { id: npc, hp: -4 }, gm);
  const v = viewFor(engine.state, player);
  assert.equal(v.characters[npc].status, 'Wounded');
  assert.equal(v.characters[npc].session.hp, undefined);
  assert.equal(v.characters[npc].build?.skills, undefined);
  assert.ok(v.encounters[enc]);
  engine.dispatch('settings.update', { rules: { npcStatusToPlayers: 'exact' } }, gm);
  assert.equal(viewFor(engine.state, player).characters[npc].session.hp, 6);
  assert.throws(() => engine.dispatch('settings.update', { rules: { npcStatusToPlayers: 'exact' } }, player), /Only the GM/);
});

test('players cannot touch other players characters', () => {
  const t = setup();
  const { engine, gm, pc } = t;
  const p2 = engine.dispatch('player.save', { name: 'Second' }, gm).result.id;
  const other = { role: 'player', playerId: p2 };
  assert.throws(() => engine.dispatch('char.adjust', { id: pc, hp: -1 }, other), /own character/);
  assert.throws(() => engine.dispatch('roll.skill', { actorId: pc, skill: 'DX' }, other), /own character/);
  const it = engine.dispatch('item.spawn', { defId: 'misc-watch', to: 'char:' + pc }, gm).result.ids[0];
  assert.throws(() => engine.dispatch('item.drop', { itemId: it }, other), /cannot reach/);
  const v = viewFor(engine.state, other);
  assert.ok(!v.items[it], "other player's inventory not visible");
  assert.equal(v.characters[pc].session.money, undefined);
});

test('unrevealed NPC names are redacted from player event titles', () => {
  const t = setup();
  const { engine, gm, player, pc } = t;
  const npc = engine.dispatch('char.create', { name: 'Ghost Sniper', kind: 'npc' }, gm).result.id;
  engine.dispatch('char.manualBuild', { id: npc, build: { skills: [{ name: 'Guns', spec: 'Rifle', level: 15 }] } }, gm);
  const enc = engine.dispatch('enc.create', { name: 'Sniped', participants: [pc, npc] }, gm).result.id;
  engine.dispatch('enc.start', { id: enc, revealNpcs: false }, gm); // ambush: NPCs stay hidden
  engine.dispatch('char.manualBuild', { id: npc, build: { skills: [{ name: 'Guns', spec: 'Rifle', level: 15 }] } }, gm);
  engine.state.characters[npc].build.weapons = [{ id: 'w1', owner: 'Rifle', kind: 'ranged', level: 15, damage: '7d pi', rof: '1', rcl: '2', acc: '5', range: '1000/4000' }];
  t.queue.push(1, 1, 2);
  const r = engine.dispatch('combat.attack', { actorId: npc, targetId: pc, weapon: { gcsWeaponId: 'w1' }, range: 300 }, gm);
  const pv = viewFor(engine.state, player).events[r.eventId];
  assert.ok(pv, 'the target sees the attack against them');
  assert.ok(!pv.title.includes('Ghost Sniper'), 'NPC name redacted');
  assert.equal(pv.attack.effective, undefined, 'NPC effective skill hidden');
  assert.equal(pv.attack.mods, undefined, 'NPC modifiers hidden');
});
