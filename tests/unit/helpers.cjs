'use strict';
const { Context } = require('../../src/core/context');
const { Engine } = require('../../src/core/engine');
const campaign = require('../../src/core/campaign');

/** Context whose dice come from a queue (values 1..6); falls back to 3.5 average-ish when empty. */
class QueueContext extends Context {
  constructor(queue, opts) { super({ ...opts, random: () => { const v = queue.length ? queue.shift() : 4; return (v - 1) / 6 + 1e-9; } }); }
}

/** Build an engine with a seeded campaign, a GM, a player and a PC. */
function setup({ dice = [], auto = false } = {}) {
  const queue = dice;
  let n = 0;
  const base = campaign.emptyCampaign(new Context({ idgen: () => 'seed' + (++n), clock: () => '2026-01-01T00:00:00.000Z' }), { name: 'Test Campaign', test: true, seedCatalog: true });
  // most tests drive turns and NPC defenses by hand; `auto` keeps the streamlined defaults
  if (!auto) Object.assign(base.settings.rules, { autoEndTurn: false, autoNpcDefense: false });
  const journal = [];
  const engine = new Engine(base, { journal: e => journal.push(e), contextFactory: opts => opts.replay ? new Context(opts) : new QueueContext(queue) });
  const gm = { role: 'gm' };
  const pl = engine.dispatch('player.save', { name: 'Ivan (player)' }, gm).result.id;
  const player = { role: 'player', playerId: pl };
  const pc = engine.dispatch('char.create', { name: 'Stalker Ivan', kind: 'pc', ownerId: pl }, gm).result.id;
  return { engine, gm, player, pc, journal, queue, s: () => engine.state };
}

/** Give a character a manual build. */
function giveBuild(engine, gm, id, build) { engine.dispatch('char.manualBuild', { id, build }, gm); }

module.exports = { setup, giveBuild, QueueContext };
