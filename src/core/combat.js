'use strict';
/**
 * Combat events, encounters and the Calculated → Resolved → Applied pipeline.
 *
 *   calculated        dice have been rolled; an attack may still need an active defense
 *   awaiting-defense  the attack succeeded; the defender must roll (or decline) a defense
 *   resolved          every required roll is done and a proposal (injury, FP, conditions) exists
 *   applied           an authorized user committed the proposal (or a custom amount)
 *   ignored           the GM chose not to apply anything
 *   closed            noncombat roll acknowledged by the GM
 *
 * Nothing in this module changes a character's HP except applyEvent/applyNotification, which
 * require an explicit GM decision (or a player acting on a GM notification for their own PC).
 * Each event can be applied at most once at a time; undo reverses the application exactly.
 */
const { ActionError, assert } = require('./errors');
const dice = require('./dice');
const rules = require('./rules');
const inv = require('./inventory');
const weapons = require('./weapons');
const chars = require('./characters');
const armor = require('./armor');

/* ================================================================== encounters */

function createEncounter(s, ctx, { name, participants = [], env = {} }) {
  const e = { id: ctx.uid('enc_'), name: String(name || 'Encounter').slice(0, 120), status: 'planning', round: 0, turn: 0, order: [], combatants: {}, env: { darkness: 0, weather: 0, notes: '', ...env }, distances: {}, createdAt: ctx.now(), endedAt: null, lootReleased: [] };
  s.encounters[e.id] = e;
  for (const id of participants) addCombatant(s, e, id);
  return e;
}

function getEncounter(s, id) { const e = s.encounters[id]; if (!e) throw new ActionError('Encounter not found.', 'missing'); return e; }
function getChar(s, id) { const c = s.characters[id]; if (!c) throw new ActionError('Character not found.', 'missing'); return c; }

function addCombatant(s, e, charId, side) {
  const c = getChar(s, charId);
  if (e.combatants[charId]) return e.combatants[charId];
  e.combatants[charId] = { charId, side: side || (c.kind === 'pc' ? 'players' : (c.faction || 'enemies')), initiative: initiativeOf(c), readyWeaponId: null, aim: null, maneuver: null, posture: c.session.posture || 'standing', targetId: null, cover: 'none', sm: 0, speed: 0, shock: 0, tempMods: [], actedRound: null };
  e.order.push(charId);
  sortOrder(s, e);
  return e.combatants[charId];
}

function removeCombatant(s, e, charId) {
  delete e.combatants[charId];
  e.order = e.order.filter(x => x !== charId);
  if (e.turn >= e.order.length) e.turn = 0;
}

/** Initiative order (B363): Basic Speed, then DX. Ties are left for the GM to reorder. */
function initiativeOf(c) { return { speed: Number(c.build.basicSpeed ?? 5), dx: Number(c.build.dx ?? 10) }; }

function sortOrder(s, e) {
  e.order.sort((a, b) => {
    const A = e.combatants[a].initiative, B = e.combatants[b].initiative;
    return (B.speed - A.speed) || (B.dx - A.dx);
  });
}

function distanceKey(a, b) { return [a, b].sort().join('|'); }
function setDistance(e, a, b, yards) {
  const y = Number(yards);
  assert(Number.isFinite(y) && y >= 0, 'Distance must be zero or more yards.');
  e.distances[distanceKey(a, b)] = y;
}
function getDistance(e, a, b) { const v = e?.distances?.[distanceKey(a, b)]; return v === undefined ? null : v; }

function startEncounter(s, e) {
  assert(e.order.length, 'Add combatants first.');
  for (const other of Object.values(s.encounters)) if (other.id !== e.id && other.status === 'active') other.status = 'paused';
  e.status = 'active';
  if (e.round < 1) { e.round = 1; e.turn = 0; }
}

/** Advance to the next combatant; expires shock and temporary modifiers per B419. */
function nextTurn(s, e) {
  assert(e.status === 'active', 'Encounter is not active.');
  const current = e.combatants[e.order[e.turn]];
  if (current) current.shock = 0; // shock affects only the victim's next turn
  e.turn += 1;
  if (e.turn >= e.order.length) { e.turn = 0; e.round += 1; }
  for (const cs of Object.values(e.combatants)) cs.tempMods = cs.tempMods.filter(m => !m.expiresRound || m.expiresRound >= e.round);
  return { round: e.round, actorId: e.order[e.turn] };
}

function endEncounter(s, ctx, e) { e.status = 'ended'; e.endedAt = ctx.now(); }

/**
 * Record a maneuver. Aim accumulates on the same weapon and target; any other maneuver
 * except Aim/Attack ends aiming (B364). Ready sets the readied weapon.
 */
function setManeuver(s, e, charId, { maneuver, weaponId = null, targetId = null, braced = false, posture }) {
  const cs = e.combatants[charId];
  assert(cs, 'Character is not in this encounter.');
  assert(rules.MANEUVERS[maneuver], 'Unknown maneuver.');
  cs.maneuver = maneuver;
  if (posture && rules.POSTURES[posture]) { cs.posture = posture; const c = s.characters[charId]; if (c) c.session.posture = posture; }
  if (targetId) cs.targetId = targetId;
  if (maneuver === 'aim') {
    assert(weaponId, 'Choose the weapon you are aiming.');
    const tgt = targetId || cs.targetId;
    assert(tgt, 'Choose a target to aim at.');
    if (cs.aim && cs.aim.weaponId === weaponId && cs.aim.targetId === tgt) { cs.aim.turns += 1; cs.aim.braced = braced || cs.aim.braced; }
    else cs.aim = { weaponId, targetId: tgt, turns: 1, braced: !!braced };
    cs.readyWeaponId = weaponId;
  } else if (maneuver === 'ready') {
    if (weaponId) cs.readyWeaponId = weaponId;
    cs.aim = null;
  } else if (maneuver !== 'attack' && maneuver !== 'aoaDetermined') {
    cs.aim = null;
  }
  return cs;
}

/* ================================================================== events */

function newEvent(s, ctx, props) {
  s.eventSeq = (s.eventSeq || 0) + 1;
  const e = props.encounterId ? s.encounters[props.encounterId] : null;
  const ev = { id: ctx.uid('ev_'), seq: s.eventSeq, at: ctx.now(), round: e ? e.round : null, visibility: 'public', stage: 'calculated', applications: [], notifications: [], overrides: [], warnings: [], ...props };
  s.events[ev.id] = ev;
  return ev;
}

function getEvent(s, id) { const ev = s.events[id]; if (!ev) throw new ActionError('Event not found.', 'missing'); return ev; }

function activeEncounterFor(s, charId) {
  return Object.values(s.encounters).find(e => e.status === 'active' && e.combatants[charId]) || null;
}

/* ================================================================== weapons for attacks */

/**
 * Resolve the attacker's weapon. Either an inventory item (companion-tracked ammunition and
 * attachments) or a weapon from the GCS sheet (natural attacks, GCS-only gear).
 */
function attackProfile(s, c, weaponRef) {
  if (weaponRef?.itemId) {
    const item = inv.getItem(s, weaponRef.itemId);
    const root = inv.rootOf(s, item);
    assert(root === 'char:' + c.id, `${inv.itemName(s, item)} is not carried by ${c.name}.`);
    const d = inv.defOf(s, item);
    assert(d.weapon, `${d.name} is not a weapon.`);
    const st = weapons.effectiveStats(s, item);
    const sk = chars.skillLevel(c, st.skill || (d.weapon.kind === 'melee' ? 'Brawling' : 'Guns'));
    return { source: 'item', item, def: d, name: inv.itemName(s, item), kind: d.weapon.kind, stats: st, level: sk.level, levelExplain: sk.explain, levelSource: sk.source, equipped: item.loc.slot !== undefined };
  }
  if (weaponRef?.gcsWeaponId !== undefined) {
    const w = (c.build.weapons || []).find((x, i) => (x.id || String(i)) === String(weaponRef.gcsWeaponId));
    assert(w, 'Weapon not found on the character sheet.');
    const stats = { acc: Number(w.acc) || 0, rcl: Number(w.rcl) || 1, bulk: Number(w.bulk) || 0, scope: 0, rof: w.rof || '1', damage: w.damage, range: w.range, minST: parseInt(w.minST, 10) || 0, skill: w.skill, breakdown: [] };
    return { source: 'gcs', gcs: w, name: `${w.owner}${w.usage ? ` (${w.usage})` : ''}`, kind: w.kind, stats, level: w.level, levelExplain: `GCS weapon level ${w.level}`, levelSource: 'GCS sheet', equipped: true };
  }
  throw new ActionError('Choose a weapon or attack.');
}

/** Apply ammunition effects (GURPS High-Tech p.165-166) to a parsed damage roll. */
function ammoAdjusted(parsed, ammoDef, enabled) {
  const notes = [];
  const p = { ...parsed };
  if (!ammoDef?.ammo || !enabled) return { parsed: p, notes };
  const a = ammoDef.ammo;
  const pierce = ['pi-', 'pi', 'pi+', 'pi++'];
  if (a.woundShift && pierce.includes(p.type)) {
    const i = Math.max(0, Math.min(3, pierce.indexOf(p.type) + a.woundShift));
    if (pierce[i] !== p.type) { notes.push(`${ammoDef.name}: ${p.type} → ${pierce[i]}`); p.type = pierce[i]; }
  }
  if (a.divisor && a.divisor !== 1) { p.divisor = (p.divisor && p.divisor !== 1 ? p.divisor : 1) * a.divisor; notes.push(`${ammoDef.name}: armor divisor (${a.divisor})`); }
  if (a.damageAdd) { p.add += a.damageAdd; notes.push(`${ammoDef.name}: damage ${a.damageAdd > 0 ? '+' : ''}${a.damageAdd}`); }
  if (a.damage) { const o = dice.parseDamage(a.damage); if (o) { Object.assign(p, o); notes.push(`${ammoDef.name}: damage ${a.damage}`); } }
  return { parsed: p, notes };
}

/* ================================================================== attack */

/**
 * Declare and roll an attack. Ammunition is deducted here, because pulling the trigger is the
 * committed action. HP is never changed here.
 */
function declareAttack(s, ctx, p, settings = {}) {
  const actor = getChar(s, p.actorId);
  const target = p.targetId ? getChar(s, p.targetId) : null;
  assert(!actor.session.conditions.includes('Dead'), `${actor.name} is dead.`);
  assert(!actor.session.conditions.includes('Unconscious'), `${actor.name} is unconscious.`);
  const enc = p.encounterId ? getEncounter(s, p.encounterId) : activeEncounterFor(s, actor.id);
  const cs = enc?.combatants[actor.id] || null;
  const tcs = enc && target ? enc.combatants[target.id] : null;
  const prof = attackProfile(s, actor, p.weapon);
  const warnings = [];
  assert(prof.level !== null && prof.level !== undefined, `${actor.name} has no level in ${prof.stats.skill || 'the weapon skill'} and it has no default. Add the skill in GCS.`);
  if (cs && prof.source === 'item' && cs.readyWeaponId && cs.readyWeaponId !== prof.item.id) warnings.push(`${prof.name} is not the readied weapon (${inv.itemName(s, s.items[cs.readyWeaponId] || { defId: '' })}).`);
  if (prof.source === 'item' && !prof.equipped) warnings.push(`${prof.name} is not in an equipment slot; drawing it normally requires a Ready maneuver.`);
  if (cs?.actedRound === enc?.round && enc?.round) warnings.push(`${actor.name} already attacked this round.`);

  const ranged = prof.kind === 'ranged';
  const rof = rules.parseRof(prof.stats.rof);
  let shots = 1, fired = [], ammoDef = null;
  if (ranged) {
    shots = Math.max(1, Math.floor(Number(p.shots) || 1));
    assert(shots <= Math.max(1, rof.rof), `${prof.name} has RoF ${prof.stats.rof}; cannot fire ${shots} shots.`);
    if (prof.source === 'item') {
      const available = weapons.roundsAvailable(s, prof.item);
      assert(available > 0, `${prof.name} is empty. Reload first.`);
      assert(shots <= available, `${prof.name} has only ${available} rounds loaded.`);
      fired = weapons.fire(s, prof.item, shots);
      ammoDef = s.defs[fired[fired.length - 1]] || null;
      for (const a of new Set(fired)) { const ad = s.defs[a]; if (ad?.ammo?.projectiles) rof.projectiles = ad.ammo.projectiles; }
    }
  }

  const rangeYards = p.range !== undefined && p.range !== null && p.range !== '' ? Number(p.range) : (enc && target ? getDistance(enc, actor.id, target.id) : null);
  const aim = cs?.aim && prof.source === 'item' && cs.aim.weaponId === prof.item.id && (!target || cs.aim.targetId === target.id) ? cs.aim : null;
  const aimTurns = p.aimTurns !== undefined ? Number(p.aimTurns) : (aim?.turns || 0);
  const maneuver = p.maneuver || (aimTurns ? 'attack' : (cs?.maneuver === 'moveAttack' ? 'moveAttack' : 'attack'));
  const hitLocation = p.hitLocation || 'torso';
  const common = { maneuver, hitLocation, shock: cs?.shock || 0, darkness: p.darkness ?? enc?.env?.darkness ?? 0, extra: (p.extraMods || []).concat((cs?.tempMods || []).map(m => ({ label: m.label, value: m.value, source: 'temp' }))) };
  const modset = ranged
    ? rules.rangedModifiers({ ...common, acc: prof.stats.acc, aimTurns, braced: p.braced ?? aim?.braced, scope: prof.stats.scope, bulk: prof.stats.bulk, range: rangeYards, targetSpeed: p.targetSpeed ?? tcs?.speed ?? 0, targetSM: p.targetSM ?? tcs?.sm ?? 0, targetPosture: p.targetPosture ?? tcs?.posture ?? target?.session.posture, cover: p.cover ?? tcs?.cover, coverCustom: p.coverCustom, weather: p.weather ?? enc?.env?.weather ?? 0, shots, projectiles: rof.projectiles, minST: prof.stats.minST, st: actor.build.st })
    : rules.meleeModifiers({ ...common, attackerPosture: cs?.posture || actor.session.posture, deceptive: p.deceptive || 0 });
  warnings.push(...modset.warnings);

  const range = ranged ? rules.parseRange(prof.stats.range, actor.build.st || 10) : { half: null, max: null };
  if (ranged && rangeYards !== null && range.max && rangeYards > range.max) warnings.push(`Target is beyond ${prof.name}'s maximum range (${range.max} yd).`);

  const effective = prof.level + modset.total;
  const roll = dice.successRoll(ctx, effective);
  const maxHits = shots * (rof.projectiles || 1);
  let hits = roll.success ? (ranged ? rules.hitsFromMargin(roll.margin, prof.stats.rcl, maxHits) : 1) : 0;

  const noDefense = roll.critical === 'success' || !!p.targetUnaware;
  const ev = newEvent(s, ctx, {
    kind: 'attack', encounterId: enc?.id || null, actorId: actor.id, targetId: target?.id || null, byUser: p.byUser || null,
    visibility: p.visibility || 'public',
    title: `${actor.name} attacks${target ? ` ${target.name}` : ''} with ${prof.name}`,
    attack: {
      weapon: { source: prof.source, itemId: prof.item?.id || null, gcsWeaponId: p.weapon?.gcsWeaponId ?? null, name: prof.name, kind: prof.kind, damage: prof.stats.damage, rcl: prof.stats.rcl, acc: prof.stats.acc, rof: prof.stats.rof, range: prof.stats.range, attachments: prof.stats.breakdown },
      baseSkill: prof.level, baseSkillExplain: prof.levelExplain, mods: modset.mods, effective, roll, shots, projectiles: rof.projectiles, maxHits, hits, fired, ammo: ammoDef ? { id: ammoDef.id, name: ammoDef.name } : null,
      maneuver, hitLocation, range: rangeYards, halfDamageRange: range.half, maxRange: range.max, aimTurns, noDefense,
      crit: roll.critical === 'success' ? 'Critical hit: no active defense allowed (B381). GM may roll on the Critical Hit Table (B556).' : roll.critical === 'failure' ? 'Critical miss: GM may roll on the Critical Miss Table (B556).' : null,
    },
    warnings,
  });

  if (cs) { cs.actedRound = enc.round; cs.aim = null; cs.maneuver = maneuver; if (target) cs.targetId = target.id; }

  if (!roll.success) { ev.stage = 'closed'; ev.status = roll.critical === 'failure' ? 'Critical miss' : 'Missed'; ev.proposal = null; return ev; }
  if (!target) { ev.stage = 'closed'; ev.status = 'Hit (no target selected)'; return ev; }
  if (noDefense) { ev.defense = { type: 'none', reason: roll.critical === 'success' ? 'critical hit' : 'target unaware' }; return rollEventDamage(s, ctx, ev, settings); }
  ev.stage = 'awaiting-defense';
  ev.status = 'Attack succeeded — awaiting defense';
  ev.defenseOptions = defenseOptions(s, target, enc, ranged);
  return ev;
}

/** Available active defenses for a target (B374-377). */
function defenseOptions(s, c, enc, ranged) {
  const d = chars.derived(s, c);
  const opts = [{ type: 'dodge', label: 'Dodge', value: d.dodge }];
  if (!ranged) {
    const parries = (c.build.weapons || []).filter(w => w.parry && !isNaN(parseInt(w.parry, 10))).map(w => ({ type: 'parry', label: `Parry (${w.owner}${w.usage ? ' ' + w.usage : ''})`, value: parseInt(w.parry, 10) }));
    opts.push(...parries);
    const blocks = (c.build.weapons || []).filter(w => w.block && !isNaN(parseInt(w.block, 10))).map(w => ({ type: 'block', label: `Block (${w.owner})`, value: parseInt(w.block, 10) }));
    opts.push(...blocks);
  }
  const cs = enc?.combatants[c.id];
  if (cs?.maneuver === 'aoaDetermined' || cs?.maneuver === 'aoaStrong') return [{ type: 'none', label: 'No defense (All-Out Attack)', value: null }];
  return opts.concat([{ type: 'none', label: 'No defense', value: null }]);
}

/**
 * Resolve the target's active defense. GM may roll for any target; a player may roll only for
 * their own character (checked by the engine's permission layer).
 */
function resolveDefense(s, ctx, eventId, p, settings = {}) {
  const ev = getEvent(s, eventId);
  assert(ev.kind === 'attack' && ev.stage === 'awaiting-defense', 'This attack is not waiting for a defense roll.');
  const target = getChar(s, ev.targetId);
  const enc = ev.encounterId ? s.encounters[ev.encounterId] : null;
  const cs = enc?.combatants[target.id];
  const ranged = ev.attack.weapon.kind === 'ranged';
  if (p.type === 'none') {
    ev.defense = { type: 'none', reason: p.reason || 'declined / unable' };
    return rollEventDamage(s, ctx, ev, settings);
  }
  const options = defenseOptions(s, target, enc, ranged);
  const opt = options.find(o => o.type === p.type && (p.label ? o.label === p.label : true));
  assert(opt && opt.value !== null, 'That defense is not available.');
  const base = p.base !== undefined && p.byGM ? Number(p.base) : opt.value;
  const modset = rules.defenseModifiers({ type: p.type, ranged, base, posture: cs?.posture || target.session.posture, retreat: !!p.retreat, dodgeAndDrop: !!p.dodgeAndDrop, allOutDefense: cs?.maneuver === 'allOutDefense', stunned: target.session.conditions.includes('Stunned'), extra: p.extraMods || [] });
  const effective = Math.max(3, base + modset.total);
  const roll = dice.successRoll(ctx, effective);
  const hitsBefore = ev.attack.hits;
  const dodged = roll.success ? (ranged && hitsBefore > 1 ? rules.hitsDodged(roll.margin, ev.attack.weapon.rcl, hitsBefore) : 1) : 0;
  ev.defense = { type: p.type, label: opt.label, base, mods: modset.mods, effective, roll, hitsBefore, hitsDefended: Math.min(hitsBefore, dodged), byUser: p.byUser || null, hidden: !!p.hidden };
  ev.attack.hitsAfterDefense = hitsBefore - ev.defense.hitsDefended;
  if (p.dodgeAndDrop && cs) { cs.posture = 'prone'; target.session.posture = 'prone'; }
  if (ev.attack.hitsAfterDefense <= 0) { ev.stage = 'closed'; ev.status = 'Defended — no hits'; ev.proposal = null; return ev; }
  return rollEventDamage(s, ctx, ev, settings);
}

/** Roll damage for every remaining hit and build the injury proposal. */
function rollEventDamage(s, ctx, ev, settings = {}) {
  const r = settings.rules || {};
  const target = getChar(s, ev.targetId);
  const attacker = s.characters[ev.actorId];
  const hits = ev.attack.hitsAfterDefense ?? ev.attack.hits;
  const parsedBase = dice.parseDamage(attacker ? rules.resolveStrengthDamage(ev.attack.weapon.damage, chars.derived(s, attacker).thrust, chars.derived(s, attacker).swing) : ev.attack.weapon.damage);
  assert(parsedBase, `Cannot read damage "${ev.attack.weapon.damage}". Edit the weapon's damage.`);
  const firedAmmo = ev.attack.fired || [];
  const results = [];
  let totalInjury = 0, totalFP = 0;
  const maxHP = target.build.hp ?? 10;
  const notes = [];
  for (let i = 0; i < hits; i++) {
    const ammoDef = s.defs[firedAmmo[Math.min(i, firedAmmo.length - 1)]] || null;
    const { parsed, notes: ammoNotes } = ammoAdjusted(parsedBase, ammoDef, r.ammoEffects !== false);
    let location = ev.attack.hitLocation;
    let locRoll = null;
    if (location === 'random') { locRoll = dice.rollDice(ctx, 3); location = rules.randomHitLocation(locRoll[0] + locRoll[1] + locRoll[2]); }
    const dmg = dice.rollDamage(ctx, parsed);
    let basic = dmg.total;
    const steps = [...ammoNotes];
    if (ev.attack.halfDamageRange && ev.attack.range !== null && ev.attack.range >= ev.attack.halfDamageRange) { const before = basic; basic = Math.floor(basic / 2); steps.push(`Beyond 1/2D (${ev.attack.halfDamageRange} yd): ${before} → ${basic} (B378)`); }
    const prot = armor.protection(s, target, location, parsed.type, r);
    const inj = rules.resolveInjury({ basic, type: parsed.type, divisor: parsed.divisor, dr: prot.dr, location, maxHP });
    let injury = inj.injury;
    steps.push(...prot.layers.map(l => `${l.name}: DR ${l.dr}${l.notes.length ? ` (${l.notes.join('; ')})` : ''}`), ...prot.notes, ...inj.steps);
    if (r.armorDT && prot.dt && inj.penetrating > 0 && inj.penetrating <= prot.dt) { steps.push(`Damage threshold ${prot.dt}: ${inj.penetrating} penetrating stopped (campaign rule)`); injury = 0; }
    let blunt = 0;
    if (r.bluntTrauma && injury === 0) { blunt = armor.bluntTrauma(basic, inj.effectiveDR, parsed.type, prot.flexibleOnly); if (blunt) steps.push(`Blunt trauma: ${blunt} HP (B379 optional rule)`); }
    const armorLoss = r.armorDurability ? prot.layers.filter(l => l.dpMax).map(l => ({ itemId: l.itemId, name: l.name, loss: armor.durabilityLoss(basic, l.dr) })).filter(x => x.loss) : [];
    const hitInjury = inj.fatigue ? 0 : injury + blunt;
    const fp = inj.fatigue ? injury : 0;
    totalInjury += hitInjury; totalFP += fp;
    results.push({ n: i + 1, location, locRoll, dice: dmg.dice, damageText: dice.formatDamage(parsed), basic, dr: prot.dr, effectiveDR: inj.effectiveDR, penetrating: inj.penetrating, mult: inj.woundingMultiplier, injury: hitInjury, fp, crippled: inj.crippled, steps, armorLoss, ammo: ammoDef?.name || null, shock: rules.shockPenalty(hitInjury, maxHP, { highPain: target.build.flags?.highPainThreshold, lowPain: target.build.flags?.lowPainThreshold }), major: rules.isMajorWound(hitInjury, maxHP) });
  }
  const followUps = [];
  for (const h of results) {
    if (h.major) followUps.push({ kind: 'knockdown', label: `Major wound (${h.injury} > HP/2): HT${rules.knockdownModifier(h.location, { highPain: target.build.flags?.highPainThreshold }) || ''} roll vs knockdown/stun (B420)`, modifier: rules.knockdownModifier(h.location, { highPain: target.build.flags?.highPainThreshold }) });
    if (h.crippled) followUps.push({ kind: 'cripple', label: `${rules.HIT_LOCATIONS[h.location]?.label} crippled (B420)`, condition: `Crippled ${rules.HIT_LOCATIONS[h.location]?.label}` });
  }
  const th = rules.hpThresholdEffects(target.session.hp, target.session.hp - totalInjury, maxHP);
  notes.push(...th.notes);
  ev.damage = { hits: results, totalInjury, totalFP, shock: Math.max(-4, results.reduce((a, h) => a + h.shock, 0)), notes, followUps: followUps.concat(th.checks) };
  ev.proposal = { targetId: target.id, hp: -totalInjury, fp: -totalFP, conditions: followUps.filter(f => f.condition).map(f => f.condition), armor: results.flatMap(h => h.armorLoss) };
  ev.stage = 'resolved';
  ev.status = totalInjury || totalFP || ev.proposal.conditions.length ? `Awaiting GM decision — ${totalInjury} HP${totalFP ? `, ${totalFP} FP` : ''} proposed` : 'Hit — no injury (armor stopped it)';
  return ev;
}

/* ================================================================== GM decisions */

function activeApplication(ev) { return ev.applications.find(a => !a.undone) || null; }

/**
 * Apply an event's consequence to the target (GM decision).
 * mode 'calculated' applies the proposal; 'custom' uses the given hp/fp (deltas, negative = loss).
 */
function applyEvent(s, ctx, eventId, p, byUser) {
  const ev = getEvent(s, eventId);
  assert(!activeApplication(ev), 'This result has already been applied. Undo it first to change it.', 'duplicate');
  assert(['resolved', 'applied', 'ignored'].includes(ev.stage), 'Finish the required rolls before applying a result.');
  const targetId = p.targetId || ev.proposal?.targetId || ev.targetId;
  const target = getChar(s, targetId);
  let hp = 0, fp = 0, conditions = [], armorLoss = [];
  if (p.mode === 'calculated') {
    assert(ev.proposal, 'This event has no calculated damage to apply.');
    hp = ev.proposal.hp; fp = ev.proposal.fp; conditions = p.includeConditions === false ? [] : ev.proposal.conditions.slice(); armorLoss = ev.proposal.armor || [];
  } else {
    hp = Math.trunc(Number(p.hp) || 0); fp = Math.trunc(Number(p.fp) || 0); conditions = Array.isArray(p.conditions) ? p.conditions.slice() : [];
  }
  return commitApplication(s, ctx, ev, target, { hp, fp, conditions, armorLoss, mode: p.mode, byUser });
}

function commitApplication(s, ctx, ev, target, { hp, fp, conditions, armorLoss = [], mode, byUser }) {
  const before = { hp: target.session.hp, fp: target.session.fp, conditions: target.session.conditions.slice() };
  target.session.hp += hp;
  target.session.fp += fp;
  const added = conditions.filter(c => !target.session.conditions.includes(c));
  target.session.conditions.push(...added);
  const armorApplied = [];
  for (const a of armorLoss) { const it = s.items[a.itemId]; if (it && it.dp !== undefined) { const b = it.dp; it.dp = Math.max(0, it.dp - a.loss); armorApplied.push({ itemId: it.id, before: b, after: it.dp }); } }
  if (hp < 0 && ev.damage?.hits?.length) {
    target.session.injuries.unshift({ id: ctx.uid('inj_'), eventId: ev.id, at: ctx.now(), amount: -hp, locations: ev.damage.hits.filter(h => h.injury).map(h => h.location) });
    target.session.injuries = target.session.injuries.slice(0, 200);
    const enc = ev.encounterId ? s.encounters[ev.encounterId] : null;
    const tcs = enc?.combatants[target.id];
    if (tcs && ev.damage.shock) { tcs.shock = Math.max(-4, Math.min(tcs.shock || 0, ev.damage.shock)); }
    if (tcs?.aim) tcs.aim.disturbed = true; // B364: injury forces a Will roll to keep aiming
  }
  const app = { id: ctx.uid('app_'), at: ctx.now(), byUser: byUser || null, mode, targetId: target.id, hp, fp, conditionsAdded: added, armor: armorApplied, before, after: { hp: target.session.hp, fp: target.session.fp }, undone: false };
  ev.applications.push(app);
  ev.stage = 'applied';
  ev.status = `Applied: ${hp ? `${hp > 0 ? '+' : ''}${hp} HP` : ''}${fp ? ` ${fp > 0 ? '+' : ''}${fp} FP` : ''}${added.length ? ` ${added.join(', ')}` : ''}`.trim() || 'Applied (no change)';
  return app;
}

/** Reverse an application exactly (HP/FP deltas, added conditions, armor DP). */
function undoApplication(s, ctx, eventId, appId) {
  const ev = getEvent(s, eventId);
  const app = ev.applications.find(a => a.id === appId) || activeApplication(ev);
  assert(app && !app.undone, 'Nothing to undo.');
  const target = getChar(s, app.targetId);
  target.session.hp -= app.hp;
  target.session.fp -= app.fp;
  target.session.conditions = target.session.conditions.filter(c => !app.conditionsAdded.includes(c));
  for (const c of app.conditionsRemoved || []) if (!target.session.conditions.includes(c)) target.session.conditions.push(c);
  for (const a of app.armor) { const it = s.items[a.itemId]; if (it) it.dp = a.before; }
  target.session.injuries = target.session.injuries.filter(i => i.eventId !== ev.id || app.hp >= 0);
  app.undone = true; app.undoneAt = ctx.now();
  ev.stage = ev.kind === 'adjust' ? 'ignored' : (ev.kind === 'attack' || ev.proposal ? 'resolved' : 'closed');
  ev.status = 'Application undone — awaiting GM decision';
  return app;
}

function ignoreEvent(s, eventId) {
  const ev = getEvent(s, eventId);
  assert(!activeApplication(ev), 'Undo the applied result before ignoring it.');
  ev.stage = 'ignored'; ev.status = 'Ignored by GM';
  return ev;
}

function closeEvent(s, eventId) {
  const ev = getEvent(s, eventId);
  if (ev.stage === 'awaiting-defense') throw new ActionError('Resolve the defense first, or choose No defense.');
  if (!activeApplication(ev) && ev.stage !== 'ignored') ev.stage = ev.proposal && ev.proposal.hp ? ev.stage : 'closed';
  ev.reviewed = true;
  if (ev.stage !== 'applied' && ev.stage !== 'ignored') { ev.stage = 'closed'; ev.status = ev.status ? `${ev.status} · reviewed` : 'Reviewed'; }
  return ev;
}

/** GM informs the target's player of an injury; the player may then apply it once. */
function notifyTarget(s, ctx, eventId, { text, hp, fp = 0 }) {
  const ev = getEvent(s, eventId);
  const target = getChar(s, ev.proposal?.targetId || ev.targetId);
  assert(target.kind === 'pc', 'Notifications are for player characters.');
  const amount = hp !== undefined ? Math.trunc(Number(hp)) : (ev.proposal?.hp || 0);
  const fpAmt = Math.trunc(Number(fp) || ev.proposal?.fp || 0);
  const n = { id: ctx.uid('ntf_'), at: ctx.now(), to: target.id, text: text || `${s.characters[ev.actorId]?.name || 'Attacker'} hit ${target.name} for ${-amount} injury.`, hp: amount, fp: fpAmt, applied: false, appId: null };
  ev.notifications.push(n);
  if (ev.stage === 'resolved') ev.status = `Player notified (${-amount} HP)`;
  return n;
}

/** Player (or GM) applies a GM-authorized notification to the PC. Idempotent. */
function applyNotification(s, ctx, eventId, notifId, byUser) {
  const ev = getEvent(s, eventId);
  const n = ev.notifications.find(x => x.id === notifId);
  assert(n, 'Notification not found.');
  assert(!n.applied, 'You already applied this.', 'duplicate');
  assert(!activeApplication(ev), 'The GM already applied this result.', 'duplicate');
  const target = getChar(s, n.to);
  const app = commitApplication(s, ctx, ev, target, { hp: n.hp, fp: n.fp, conditions: [], mode: 'player-acknowledged', byUser });
  n.applied = true; n.appId = app.id;
  return app;
}

/**
 * GM override of a rolled value. Records the change and recomputes what depends on it.
 * field: 'attackSuccess' | 'effective' | 'hits' | 'target' | 'hitInjury' | 'defenseSuccess'
 */
function overrideEvent(s, ctx, eventId, { field, value, hitIndex }, byUser, settings = {}) {
  const ev = getEvent(s, eventId);
  assert(!activeApplication(ev), 'Undo the applied result before overriding it.');
  const rec = (from, to) => ev.overrides.push({ at: ctx.now(), byUser, field, from, to, hitIndex: hitIndex ?? null });
  if (ev.kind === 'skill' || ev.kind === 'attribute') {
    if (field === 'effective') { const v = Number(value); rec(ev.roll.effective, v); Object.assign(ev.roll, { effective: v, ...dice.evaluateSuccess(ev.roll.total, v) }); ev.effective = v; }
    else if (field === 'success') { rec(ev.roll.success, !!value); ev.roll.success = !!value; ev.roll.label = value ? 'Success (GM)' : 'Failure (GM)'; }
    else throw new ActionError('That value cannot be overridden on this roll.');
    ev.status = ev.roll.label;
    return ev;
  }
  assert(ev.kind === 'attack', 'Only attacks and rolls can be overridden.');
  const a = ev.attack;
  const restartFromAttack = () => {
    delete ev.defense; delete ev.damage; ev.proposal = null; delete a.hitsAfterDefense;
    const target = ev.targetId ? s.characters[ev.targetId] : null;
    if (!a.roll.success || a.hits <= 0) { ev.stage = 'resolved'; ev.status = 'Missed (GM)'; return; }
    if (!target) { ev.stage = 'resolved'; ev.status = 'Hit (no target)'; return; }
    if (a.noDefense) { ev.defense = { type: 'none', reason: 'GM' }; rollEventDamage(s, ctx, ev, settings); return; }
    ev.stage = 'awaiting-defense'; ev.status = 'Attack succeeded — awaiting defense';
    ev.defenseOptions = defenseOptions(s, target, ev.encounterId ? s.encounters[ev.encounterId] : null, a.weapon.kind === 'ranged');
  };
  switch (field) {
    case 'effective': {
      const v = Number(value); assert(Number.isFinite(v), 'Enter a number.');
      rec(a.effective, v); a.effective = v; Object.assign(a.roll, dice.evaluateSuccess(a.roll.total, v), { effective: v });
      a.hits = a.roll.success ? (a.weapon.kind === 'ranged' ? rules.hitsFromMargin(a.roll.margin, a.weapon.rcl, a.maxHits) : 1) : 0;
      restartFromAttack(); break;
    }
    case 'attackSuccess': {
      rec(a.roll.success, !!value); a.roll.success = !!value; a.roll.label = value ? 'Success (GM)' : 'Failure (GM)';
      a.hits = value ? Math.max(1, a.hits) : 0; restartFromAttack(); break;
    }
    case 'hits': {
      const v = Math.max(0, Math.min(a.maxHits, Math.floor(Number(value)))); rec(a.hits, v); a.hits = v; restartFromAttack(); break;
    }
    case 'target': {
      const t = getChar(s, value); rec(ev.targetId, t.id); ev.targetId = t.id; ev.title = ev.title.replace(/attacks.*with/, `attacks ${t.name} with`); restartFromAttack(); break;
    }
    case 'defenseSuccess': {
      assert(ev.defense && ev.defense.roll, 'No defense roll to override.');
      rec(ev.defense.roll.success, !!value); ev.defense.roll.success = !!value;
      ev.defense.hitsDefended = value ? ev.defense.hitsBefore : 0; a.hitsAfterDefense = ev.defense.hitsBefore - ev.defense.hitsDefended;
      if (a.hitsAfterDefense <= 0) { delete ev.damage; ev.proposal = null; ev.stage = 'resolved'; ev.status = 'Defended (GM)'; } else rollEventDamage(s, ctx, ev, settings);
      break;
    }
    case 'hitInjury': {
      assert(ev.damage && ev.damage.hits[hitIndex], 'No such hit.');
      const v = Math.max(0, Math.floor(Number(value))); const h = ev.damage.hits[hitIndex];
      rec(h.injury, v); h.injury = v; h.steps.push(`GM set injury to ${v}`);
      ev.damage.totalInjury = ev.damage.hits.reduce((x, y) => x + y.injury, 0);
      ev.proposal.hp = -ev.damage.totalInjury; ev.status = `Awaiting GM decision — ${ev.damage.totalInjury} HP proposed`;
      break;
    }
    default: throw new ActionError('Unknown override.');
  }
  return ev;
}

/* ================================================================== skill and attribute rolls */

/**
 * Roll a skill or attribute. visibility:
 *   public  everyone sees the result
 *   gm      only the GM (and the roller, who sees only that a secret roll was made)
 *   hidden  the roller sees dice but not the target number or success (GM-concealed target)
 */
function rollSkill(s, ctx, p) {
  const c = getChar(s, p.actorId);
  const sk = chars.skillLevel(c, p.skill);
  let base = p.baseOverride !== undefined && p.byGM ? Number(p.baseOverride) : sk.level;
  assert(base !== null && base !== undefined, `${c.name} has no ${p.skill} skill and it has no default.`);
  const mods = (p.mods || []).filter(m => Number(m.value)).map(m => ({ label: String(m.label || 'Modifier').slice(0, 80), value: Number(m.value), source: m.source || 'situational' }));
  const enc = activeEncounterFor(s, c.id);
  const cs = enc?.combatants[c.id];
  if (cs?.shock && p.applyShock !== false) mods.push({ label: 'Shock (DX/IQ-based rolls, B419)', value: cs.shock, source: 'B419' });
  const effective = base + mods.reduce((a, m) => a + m.value, 0);
  const roll = dice.successRoll(ctx, effective);
  const ev = newEvent(s, ctx, { kind: 'skill', encounterId: enc?.id || null, actorId: c.id, byUser: p.byUser || null, visibility: ['public', 'gm', 'hidden'].includes(p.visibility) ? p.visibility : 'public', title: `${c.name}: ${p.skill}`, skill: p.skill, baseSkill: base, baseExplain: sk.explain, baseSource: sk.source, mods, effective, roll, note: String(p.note || '').slice(0, 300), requestId: p.requestEventId || null });
  ev.stage = 'resolved';
  ev.status = roll.label;
  if (p.requestEventId) { const req = s.events[p.requestEventId]; if (req && req.kind === 'request') { req.stage = 'closed'; req.status = 'Rolled'; req.fulfilledBy = ev.id; } }
  return ev;
}

/** GM asks a player to roll a skill. */
function requestRoll(s, ctx, { actorId, skill, mods = [], visibility = 'public', note = '' }) {
  const c = getChar(s, actorId);
  const ev = newEvent(s, ctx, { kind: 'request', actorId: c.id, title: `GM requests ${skill} from ${c.name}`, skill, mods, requestVisibility: visibility, note: String(note).slice(0, 300), visibility: 'public', stage: 'pending', status: 'Waiting for player' });
  return ev;
}

/** Quick contest between two characters (B348), rolled by the GM. */
function rollContest(s, ctx, { a, b, skillA, skillB, modsA = 0, modsB = 0, visibility = 'gm' }) {
  const ca = getChar(s, a), cb = getChar(s, b);
  const la = chars.skillLevel(ca, skillA), lb = chars.skillLevel(cb, skillB);
  assert(la.level !== null && lb.level !== null, 'Both characters need a level in the chosen skills.');
  const res = dice.quickContest(ctx, la.level + Number(modsA), lb.level + Number(modsB));
  const ev = newEvent(s, ctx, { kind: 'contest', actorId: ca.id, targetId: cb.id, visibility, title: `Quick contest: ${ca.name} (${skillA}) vs ${cb.name} (${skillB})`, contest: { skillA, skillB, levelA: la.level + Number(modsA), levelB: lb.level + Number(modsB), ...res } });
  ev.stage = 'resolved';
  ev.status = res.winner === 'tie' ? 'Tie' : `${res.winner === 'a' ? ca.name : cb.name} wins by ${res.marginOfVictory}`;
  return ev;
}

/** Follow-up roll for an attack event (knockdown, consciousness, death check). */
function rollFollowUp(s, ctx, eventId, { index }) {
  const ev = getEvent(s, eventId);
  const f = ev.damage?.followUps?.[index];
  assert(f && f.kind !== 'cripple', 'No roll for that follow-up.');
  const target = getChar(s, ev.targetId);
  const ht = Number(target.build.ht ?? 10) + (f.modifier || 0);
  const roll = dice.successRoll(ctx, ht);
  f.result = { roll, effective: ht, at: ctx.now() };
  if (f.kind === 'knockdown' && !roll.success) f.suggest = roll.margin <= -5 || roll.critical === 'failure' ? ['Unconscious'] : ['Stunned', 'Knocked Down'];
  if (f.kind === 'consciousness' && !roll.success) f.suggest = ['Unconscious'];
  if (f.kind === 'death' && !roll.success) f.suggest = ['Dead'];
  return f;
}

/** Free-form dice roll (e.g. "2d+1"). */
function rollFree(s, ctx, { actorId, expression, visibility = 'public', label = '' }) {
  const r = dice.rollExpression(ctx, expression);
  const ev = newEvent(s, ctx, { kind: 'roll', actorId: actorId || null, visibility, title: `${actorId ? s.characters[actorId]?.name + ': ' : ''}${label || expression}`, free: r });
  ev.stage = 'resolved'; ev.status = `${r.total}`;
  return ev;
}

/** GM-only manual adjustment of a character outside of an event (still logged and undoable). */
function manualAdjust(s, ctx, { charId, hp = 0, fp = 0, conditionsAdd = [], conditionsRemove = [], reason = '' }, byUser) {
  const c = getChar(s, charId);
  const before = { hp: c.session.hp, fp: c.session.fp, conditions: c.session.conditions.slice() };
  c.session.hp += Math.trunc(Number(hp) || 0);
  c.session.fp += Math.trunc(Number(fp) || 0);
  const added = conditionsAdd.filter(x => !c.session.conditions.includes(x));
  const removed = conditionsRemove.filter(x => c.session.conditions.includes(x));
  c.session.conditions = c.session.conditions.filter(x => !removed.includes(x)).concat(added);
  const ev = newEvent(s, ctx, { kind: 'adjust', actorId: c.id, targetId: c.id, byUser, visibility: c.kind === 'npc' ? 'gm' : 'public', title: `${c.name}: ${[hp ? `${hp > 0 ? '+' : ''}${hp} HP` : '', fp ? `${fp > 0 ? '+' : ''}${fp} FP` : '', added.length ? `+${added.join(', ')}` : '', removed.length ? `−${removed.join(', ')}` : ''].filter(Boolean).join(' ') || 'no change'}`, reason: String(reason).slice(0, 200), stage: 'applied' });
  ev.applications.push({ id: ctx.uid('app_'), at: ctx.now(), byUser, mode: 'manual', targetId: c.id, hp: Math.trunc(Number(hp) || 0), fp: Math.trunc(Number(fp) || 0), conditionsAdded: added, conditionsRemoved: removed, armor: [], before, after: { hp: c.session.hp, fp: c.session.fp }, undone: false });
  return ev;
}

module.exports = {
  createEncounter, getEncounter, addCombatant, removeCombatant, sortOrder, setDistance, getDistance, startEncounter, nextTurn, endEncounter, setManeuver,
  newEvent, getEvent, activeEncounterFor, attackProfile, declareAttack, defenseOptions, resolveDefense, rollEventDamage,
  applyEvent, undoApplication, ignoreEvent, closeEvent, notifyTarget, applyNotification, overrideEvent, activeApplication,
  rollSkill, requestRoll, rollContest, rollFollowUp, rollFree, manualAdjust, ammoAdjusted,
};
