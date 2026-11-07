'use strict';
/**
 * Combat time: GURPS one-second turns, readying, reload time and "breaks".
 *
 * Turn mode (an encounter is active, no break):
 *   - players act only on their own character's turn (setting rules.enforceTurns)
 *   - an item put into the "In hands" (ready) slot is usable from the next round (Ready maneuver,
 *     B366); a successful Fast-Draw roll makes it usable immediately (B194)
 *   - reloading takes the weapon's reload time in seconds (the "(3)" in Shots 30+1(3), B279);
 *     the weapon is usable again when that many rounds have passed
 *   - with rules.readyRequired, attacks need the weapon in hands and ready
 *
 * Break mode (GM allots N seconds of downtime inside an encounter):
 *   - nobody attacks; the turn order pauses
 *   - every player character gets N seconds to spend on readying, reloading, swapping parts,
 *     aiming, loading magazines and using items; each action costs its time in seconds
 *   - when the break ends the clock advances N seconds (rounds), aim taken during the break is kept,
 *     shock and expired modifiers clear, and the turn order restarts from the top
 */
const { ActionError, assert } = require('./errors');

const DOWN = ['Dead', 'Unconscious'];
const isDown = c => !c || c.session.conditions.some(x => DOWN.includes(x)) || c.session.hp <= -5 * (c.build?.hp ?? 10);

function activeEncounterFor(s, charId) {
  return Object.values(s.encounters).find(e => e.status === 'active' && e.combatants[charId]) || null;
}

function rule(s, key) { return s.settings?.rules?.[key] !== false; }

/** Reload time from a GURPS Shots value: "30+1(3)" → 3 s for the magazine; "4(2i)" → 2 s per round. */
function reloadTime(weaponDef) {
  const shots = String(weaponDef?.weapon?.shots || '');
  const m = shots.match(/\((\d+)(i?)\)/);
  if (m) return { seconds: Number(m[1]), perRound: m[2] === 'i' };
  return weaponDef?.weapon?.integral ? { seconds: 1, perRound: true } : { seconds: 3, perRound: false };
}

/**
 * Charge combat time for an action by `charId`. Returns the context the caller needs:
 *   { mode: 'free' }                     no active encounter (or the GM acting outside the rules)
 *   { mode: 'break', enc, remaining }    seconds deducted from the character's break allowance
 *   { mode: 'turn', enc }                normal one-second turns
 * `seconds` may be a function of the remaining break time (for partial reloads).
 */
function spend(s, actor, charId, seconds, label) {
  const enc = activeEncounterFor(s, charId);
  if (!enc) return { mode: 'free' };
  const gm = actor?.role === 'gm';
  if (enc.break) {
    const c = s.characters[charId];
    if (gm && c?.kind === 'npc') return { mode: 'break', enc, remaining: Infinity };
    const left = enc.break.remaining[charId] ?? (c?.kind === 'pc' ? 0 : Infinity);
    const cost = typeof seconds === 'function' ? seconds(left) : seconds;
    if (!gm) assert(cost <= left, `${label} takes ${cost} s — ${c?.name || 'you'} ha${left === 1 ? 's' : 've'} ${left} s of the break left.`, 'time');
    if (Number.isFinite(left)) enc.break.remaining[charId] = Math.max(0, left - cost);
    return { mode: 'break', enc, remaining: enc.break.remaining[charId], cost };
  }
  if (!gm && rule(s, 'enforceTurns')) {
    const turnId = enc.order[enc.turn];
    assert(turnId === charId, `It is ${s.characters[turnId]?.name || 'someone else'}'s turn. Wait for yours.`, 'turn');
  }
  return { mode: 'turn', enc };
}

/** Mark an item busy (readying / reloading) for `seconds` of combat time. */
function markBusy(item, enc, seconds, why) {
  if (!enc || seconds <= 0) { delete item.readyAt; delete item.busy; return; }
  item.readyAt = enc.round + seconds;
  item.busy = why;
}

/** Why a weapon cannot be used for an attack right now (null when it can). */
function attackBlock(s, item, enc) {
  if (!enc || enc.status !== 'active') return null;
  if (enc.break) return 'Nobody attacks during a break. The GM ends the break to resume combat.';
  if (item.readyAt && enc.round < item.readyAt) return `${s.defs[item.defId]?.name || 'The weapon'} is still ${item.busy || 'being readied'} — usable from round ${item.readyAt}.`;
  if (rule(s, 'readyRequired') && item.loc?.slot !== 'ready') return `Ready ${s.defs[item.defId]?.name || 'the weapon'} first: drag it into the "In hands" slot (takes a turn, or roll Fast-Draw).`;
  return null;
}

/** Fast-Draw specialization for an item (B194). */
function fastDrawSkill(def) {
  if (!def) return null;
  if (def.category === 'ammo' || def.category === 'magazine') return 'Fast-Draw (Ammo)';
  if (def.weapon?.kind === 'melee') return /knife/i.test(def.weapon.skill || def.name) ? 'Fast-Draw (Knife)' : 'Fast-Draw (Sword)';
  if (def.weapon) return /pistol|revolver/i.test(def.sub) ? 'Fast-Draw (Pistol)' : 'Fast-Draw (Long Arm)';
  return null;
}

/* ------------------------------------------------------------------ breaks */

function startBreak(s, ctx, enc, seconds) {
  const n = Math.floor(Number(seconds));
  assert(enc.status === 'active', 'Start the encounter first.');
  assert(!enc.break, 'A break is already running.');
  assert(n >= 1 && n <= 600, 'A break lasts 1–600 seconds.');
  const remaining = {};
  for (const id of enc.order) if (s.characters[id]?.kind === 'pc' && !isDown(s.characters[id])) remaining[id] = n;
  enc.break = { seconds: n, remaining, done: [], startedAt: ctx.now(), fromRound: enc.round };
  return enc.break;
}

function endBreak(s, enc) {
  const b = enc.break;
  assert(b, 'There is no break to end.');
  enc.round += b.seconds; // the clock moves on; readying and reloading started before the break complete
  enc.turn = 0;
  for (const cs of Object.values(enc.combatants)) { cs.shock = 0; cs.tempMods = cs.tempMods.filter(m => !m.expiresRound || m.expiresRound >= enc.round); cs.actedRound = null; }
  for (const it of Object.values(s.items)) if (it.readyAt && it.readyAt <= enc.round) { delete it.readyAt; delete it.busy; }
  delete enc.break;
  skipDown(s, enc);
  return b;
}

/** Advance past downed combatants from the current position (keeps at least one step). */
function skipDown(s, enc) {
  const skipped = [];
  if (!rule(s, 'skipDown')) return skipped;
  for (let guard = 0; guard < enc.order.length; guard++) {
    const c = s.characters[enc.order[enc.turn]];
    if (!isDown(c)) break;
    skipped.push(c?.name);
    enc.turn += 1;
    if (enc.turn >= enc.order.length) { enc.turn = 0; enc.round += 1; }
  }
  return skipped;
}

module.exports = { isDown, activeEncounterFor, reloadTime, spend, markBusy, attackBlock, fastDrawSkill, startBreak, endBreak, skipDown, rule };
