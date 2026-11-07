'use strict';
/**
 * The Ready slot: "I will use this next turn".
 *
 * A character holds one item in the Hands slot (the weapon they fire). The Ready slot is a staging
 * slot: what is dragged into it is used automatically, depending on what it is:
 *
 *   magazine      → swapped into the weapon in hands; the old magazine goes to the rig, backpack,
 *                   pockets or ground (in that order). 2 turns: grab (this turn), load and rack
 *                   (next turn). A Fast-Draw (Ammo) success loads it on the same turn.
 *   stripper clip → loads the weapon's internal magazine. Takes the weapon's clip reload time
 *                   (the "(3)" in Shots; 3 s if not given), the grab being the first second.
 *                   A Fast-Draw (Ammo) success saves one second. The empty clip is stowed.
 *   loose rounds  → loaded one per turn into an internal magazine or tube; with the Fast-Draw (Ammo)
 *                   skill on the sheet a successful roll loads two. Continues every turn until the
 *                   weapon is full, the rounds run out, or the item is taken out of the Ready slot.
 *   consumable    → used next turn (the usual GM-approved proposal).
 *   weapon / item → drawn into Hands next turn; what was in hands goes to a free carry slot
 *                   (sling / back / holster / melee) or into storage. A Fast-Draw success draws it now.
 *
 * Timing applies only inside an active encounter (one-second turns). Outside combat everything
 * happens at once. During a break each second of the break counts as one turn.
 */
const inv = require('./inventory');
const cat = require('./catalog');
const weapons = require('./weapons');
const tempo = require('./tempo');
const chars = require('./characters');
const { ActionError, assert } = require('./errors');

const hasSkill = (c, skill) => ['sheet', 'GCS sheet'].includes(chars.skillLevel(c, skill).source);
const handsOf = (s, charId) => inv.equipped(s, charId, 'hands');

/** Seconds needed to load a stripper clip into this weapon. */
function clipSeconds(wDef) {
  const m = String(wDef?.weapon?.shots || '').match(/\((\d+)\)/);
  return Math.max(1, Number(wDef?.weapon?.clipSeconds) || (m ? Number(m[1]) : 3));
}

/** What the item in the Ready slot will do. Throws a user-facing error when it cannot be used. */
function classify(s, item, charId) {
  const d = inv.defOf(s, item);
  const w = handsOf(s, charId);
  const wd = w ? inv.defOf(s, w) : null;
  const name = inv.itemName(s, item);
  if (d.magazine) {
    assert(wd?.weapon?.kind === 'ranged', `Hold the weapon first: put it in the Hands slot, then drag ${name} into Ready.`);
    if (d.magazine.clip) {
      assert(cat.clipFitsWeapon(d, wd), `${name} is not a stripper clip for ${wd.name}.`);
      assert(weapons.roundCount(item.rounds), `${name} is empty.`);
      return { kind: 'clip', weaponId: w.id, label: `loading ${wd.name} from ${name}` };
    }
    assert(cat.magazineFitsWeapon(d, wd), wd.weapon.integral ? `${wd.name} has an internal magazine — drag loose rounds or a stripper clip instead.` : `${name} does not fit ${wd.name}.`);
    for (const [ammoId] of item.rounds || []) assert(cat.ammoFitsWeapon(s.defs[ammoId], wd), `${name} holds ${s.defs[ammoId]?.name}, which ${wd.name} cannot fire.`);
    return { kind: 'mag', weaponId: w.id, label: `reloading ${wd.name} with ${name}` };
  }
  if (d.ammo) {
    assert(wd?.weapon?.kind === 'ranged', `Hold the weapon first: put it in the Hands slot, then drag the rounds into Ready.`);
    assert(wd.weapon.integral, `${wd.name} takes magazines — load rounds into a magazine and drag the magazine into Ready.`);
    assert(cat.ammoFitsWeapon(d, wd), `${d.name} does not fit ${wd.name}.`);
    return { kind: 'rounds', weaponId: w.id, label: `loading ${d.name} into ${wd.name} round by round` };
  }
  if (d.consumable) return { kind: 'use', label: `using ${name}` };
  return { kind: 'draw', label: `drawing ${name}` };
}

/** Put an item away: rig, backpack, other worn containers, pockets, then the ground. */
function stow(s, item, charId) {
  const ref = 'char:' + charId;
  const rank = sl => ({ rig: 0, backpack: 1 }[sl] ?? 2);
  const containers = inv.childrenOf(s, ref).filter(c => c.loc.slot && c.id !== item.id && s.defs[c.defId]?.container).sort((a, b) => rank(a.loc.slot) - rank(b.loc.slot));
  item.loc = null;
  for (const c of containers) {
    try { inv.storeIn(s, item, 'item:' + c.id); return describeSpot(s, item); } catch (e) { if (e.code !== 'no-room') throw e; }
    if (!s.items[item.id]) return 'stacked';
  }
  inv.storeOnCharacter(s, item, ref);
  return s.items[item.id] ? describeSpot(s, item) : 'stacked';
}
function describeSpot(s, item) {
  const p = item.loc?.p || '';
  if (p.startsWith('item:')) { const c = s.items[p.slice(5)]; return c?.loc?.slot === 'rig' ? 'rig' : c?.loc?.slot === 'backpack' ? 'backpack' : inv.itemName(s, c); }
  return item.loc?.g === 'ground' ? 'ground' : item.loc?.g || 'storage';
}

/** Put a weapon/item that leaves the hands somewhere sensible. */
function holster(s, item, charId) {
  const ref = 'char:' + charId;
  for (const slot of ['primary', 'secondary', 'holster', 'melee']) {
    if (inv.canPlace(s, item, { p: ref, slot }).ok) { inv.place(s, item, { p: ref, slot }); return cat.EQUIP_SLOTS[slot].label; }
  }
  return stow(s, item, charId);
}

/* ------------------------------------------------------------------ the actions */

function doMag(s, item, charId, w) {
  const old = weapons.magazineIn(s, w);
  let where = null;
  if (old) { weapons.ejectMagazine(s, w, null); where = stow(s, old, charId); }
  const r = weapons.insertMagazine(s, w, item);
  if (!w.chamber && weapons.roundCount(item.rounds)) { weapons.chamberRound(s, w); r.chambered = true; }
  return `${inv.itemName(s, item)} in ${inv.itemName(s, w)}${r.chambered ? ', round chambered' : ''}${old ? ` (old magazine → ${where})` : ''}`;
}

function doClip(s, item, charId, w) {
  const wd = inv.defOf(s, w);
  const room = wd.weapon.integral.capacity - weapons.roundCount(w.rounds);
  w.rounds = w.rounds || [];
  let moved = 0;
  while (moved < room && weapons.roundCount(item.rounds)) {
    const top = item.rounds[item.rounds.length - 1];
    assert(cat.ammoFitsWeapon(s.defs[top[0]], wd), `${s.defs[top[0]]?.name} cannot be fired by ${wd.name}.`);
    const n = Math.min(room - moved, top[1]);
    top[1] -= n; if (!top[1]) item.rounds.pop();
    const last = w.rounds[w.rounds.length - 1];
    if (last && last[0] === top[0]) last[1] += n; else w.rounds.push([top[0], n]);
    moved += n;
  }
  const where = stow(s, item, charId);
  return `${moved} round${moved === 1 ? '' : 's'} stripped into ${wd.name} (clip → ${where})`;
}

/** Load up to `n` rounds; returns { loaded, done } (done: weapon full or rounds gone). */
function doRounds(s, item, charId, w, n) {
  const wd = inv.defOf(s, w);
  const room = wd.weapon.integral.capacity - weapons.roundCount(w.rounds);
  if (room <= 0) return { loaded: 0, done: true };
  const loaded = weapons.loadRounds(s, w, item, Math.min(n, room));
  const full = weapons.roundCount(w.rounds) >= wd.weapon.integral.capacity;
  const gone = !s.items[item.id];
  return { loaded, done: full || gone };
}

function doDraw(s, item, charId) {
  const ref = 'char:' + charId;
  const held = handsOf(s, charId);
  let where = null;
  if (held && held.id !== item.id) { held.loc = null; where = holster(s, held, charId); }
  inv.place(s, item, { p: ref, slot: 'hands' });
  return `${inv.itemName(s, item)} in hands${held && held.id !== item.id ? ` (${inv.itemName(s, held)} → ${where})` : ''}`;
}

/* ------------------------------------------------------------------ staging */

function fastDrawAmmo(s, ctx, c, a) {
  if (!hasSkill(c, 'Fast-Draw (Ammo)')) return null;
  const combat = require('./combat');
  const ev = combat.rollSkill(s, ctx, { actorId: c.id, skill: 'Fast-Draw (Ammo)', visibility: 'public', byUser: a?.playerId || 'GM', byGM: a?.role === 'gm', note: 'Reloading' });
  return ev.roll.success;
}

/** Finish everything a staged item does, at once (outside combat, or the GM's "instant"). */
function resolveAll(s, ctx, a, item, charId, plan) {
  const c = s.characters[charId];
  const w = plan.weaponId ? s.items[plan.weaponId] : null;
  if (plan.kind === 'mag') return doMag(s, item, charId, w);
  if (plan.kind === 'clip') return doClip(s, item, charId, w);
  if (plan.kind === 'rounds') {
    const before = weapons.roundCount(w.rounds);
    doRounds(s, item, charId, w, Infinity);
    if (s.items[item.id]) stow(s, item, charId);
    return `${weapons.roundCount(w.rounds) - before} rounds loaded into ${inv.itemName(s, w)}`;
  }
  if (plan.kind === 'use') {
    const crafting = require('./crafting');
    item.loc = null; stow(s, item, charId); // use it from storage
    const ev = crafting.useConsumable(s, ctx, { charId, itemId: item.id, targetId: charId, byUser: a?.playerId || 'GM' });
    return ev.title;
  }
  return doDraw(s, item, charId);
}

/**
 * Drag into Ready. Outside combat: done at once. In a break: done at once, paying seconds.
 * In turn mode: the grab is this turn's action; the item is used at the start of the next turn.
 */
function stage(s, ctx, a, item, charId, { instant = false } = {}) {
  const c = s.characters[charId];
  assert(c, 'Only characters have a Ready slot.');
  const ref = 'char:' + charId;
  const enc0 = tempo.activeEncounterFor(s, charId);
  if (enc0 && !enc0.break && !instant) tempo.spend(s, a, charId, 0, 'Readying an item'); // whose turn is it?
  const plan = classify(s, item, charId);
  const occupant = inv.equipped(s, charId, 'ready');
  assert(!occupant || occupant.id === item.id, `The Ready slot already holds ${occupant ? inv.itemName(s, occupant) : ''} — take it out first.`);
  const enc = tempo.activeEncounterFor(s, charId);
  if (!enc || instant) {
    if (enc && instant) { /* GM override: no time */ }
    item.loc = null;
    inv.place(s, item, { p: ref, slot: 'ready' });
    const note = resolveAll(s, ctx, a, item, charId, plan);
    if (s.items[item.id]?.loc?.slot === 'ready') stow(s, s.items[item.id], charId);
    return `${c.name}: ${note}`;
  }
  if (enc.break) {
    const w = plan.weaponId ? s.items[plan.weaponId] : null;
    let cost = 1, extra = '';
    if (plan.kind === 'mag') cost = 2;
    if (plan.kind === 'clip') cost = clipSeconds(inv.defOf(s, w));
    if (['mag', 'clip'].includes(plan.kind) && fastDrawAmmo(s, ctx, c, a)) { cost = Math.max(1, cost - 1); extra = ' (Fast-Draw)'; }
    let rate = 1;
    if (plan.kind === 'rounds') {
      rate = hasSkill(c, 'Fast-Draw (Ammo)') ? 2 : 1;
      const room = inv.defOf(s, w).weapon.integral.capacity - weapons.roundCount(w.rounds);
      const want = Math.min(room, item.qty);
      assert(want > 0, `${inv.itemName(s, w)} is already full.`);
      let n = want;
      const t = tempo.spend(s, a, charId, left => { if (Number.isFinite(left)) n = Math.max(1, Math.min(want, Math.floor(left * rate))); return Math.ceil(n / rate); }, 'Loading rounds');
      item.loc = null; inv.place(s, item, { p: ref, slot: 'ready' });
      const r = doRounds(s, item, charId, w, n);
      if (s.items[item.id]) stow(s, item, charId);
      return `${c.name} loaded ${r.loaded} round${r.loaded === 1 ? '' : 's'} into ${inv.itemName(s, w)} (${Math.ceil(n / rate)} s of the break${Number.isFinite(t.remaining) ? `, ${t.remaining} s left` : ''})`;
    }
    const t = tempo.spend(s, a, charId, cost, plan.label);
    item.loc = null; inv.place(s, item, { p: ref, slot: 'ready' });
    const note = resolveAll(s, ctx, a, item, charId, plan);
    if (s.items[item.id]?.loc?.slot === 'ready') stow(s, s.items[item.id], charId);
    return `${c.name}: ${note}${extra} (${cost} s of the break${Number.isFinite(t.remaining) ? `, ${t.remaining} s left` : ''})`;
  }
  // turn mode: grabbing it is this turn's Ready maneuver
  tempo.spend(s, a, charId, 1, 'Grabbing an item');
  const cs = enc.combatants[charId];
  assert(cs, `${c.name} is not in this encounter.`);
  assert(cs.turnSpent !== enc.round, `${c.name}'s turn is already spent (${cs.turnSpentOn || 'busy'}).`);
  item.loc = null;
  inv.place(s, item, { p: ref, slot: 'ready' });
  let due = enc.round + 1, fast = false;
  const w = plan.weaponId ? s.items[plan.weaponId] : null;
  if (plan.kind === 'mag') { fast = !!fastDrawAmmo(s, ctx, c, a); if (fast) due = enc.round; }
  if (plan.kind === 'clip') { const secs = clipSeconds(inv.defOf(s, w)); fast = !!fastDrawAmmo(s, ctx, c, a); due = enc.round + secs - 1 - (fast ? 1 : 0); }
  if (plan.kind === 'draw') {
    const skill = tempo.fastDrawSkill(inv.defOf(s, item));
    if (skill && hasSkill(c, skill)) {
      const combat = require('./combat');
      const ev = combat.rollSkill(s, ctx, { actorId: charId, skill, visibility: 'public', byUser: a?.playerId || 'GM', byGM: a?.role === 'gm', note: 'Drawing' });
      if (ev.roll.success) { fast = true; due = enc.round; }
    }
  }
  item.stage = { kind: plan.kind, weaponId: plan.weaponId || null, due, label: plan.label, since: enc.round };
  cs.maneuver = 'ready'; cs.aim = null;
  spendTurn(cs, enc, plan.kind === 'mag' || plan.kind === 'clip' ? 'grabbing the ' + (plan.kind === 'clip' ? 'clip' : 'magazine') : 'readying');
  if (due <= enc.round) {
    const note = step(s, ctx, a, item, charId, enc);
    return `${c.name}: ${note}${fast ? ' (Fast-Draw)' : ''}`;
  }
  return `${c.name} is ${plan.label} — ${due === enc.round + 1 ? 'next turn' : `done in round ${due}`}`;
}

function spendTurn(cs, enc, why) { cs.turnSpent = enc.round; cs.turnSpentOn = why; }

/**
 * One turn's worth of a staged item for its owner (called when their turn starts, or right after
 * a successful Fast-Draw). Returns a note for the log, or null when nothing happened.
 */
function step(s, ctx, a, item, charId, enc) {
  const st = item.stage; if (!st) return null;
  const c = s.characters[charId];
  const cs = enc.combatants[charId];
  const w = st.weaponId ? s.items[st.weaponId] : null;
  if (st.weaponId && (!w || inv.equipped(s, charId, 'hands')?.id !== w.id)) {
    delete item.stage; stow(s, item, charId);
    return `${c.name} no longer holds the weapon — ${inv.itemName(s, item)} put away`;
  }
  if (enc.round < st.due) { if (cs) { cs.maneuver = 'ready'; spendTurn(cs, enc, st.label); } return `${c.name} keeps ${st.label} (done in round ${st.due})`; }
  if (cs) { cs.maneuver = 'ready'; cs.aim = null; spendTurn(cs, enc, st.label); }
  if (st.kind === 'rounds') {
    const fd = fastDrawAmmo(s, ctx, c, a);
    const r = doRounds(s, item, charId, w, fd ? 2 : 1);
    if (r.done) { if (s.items[item.id]) { delete item.stage; stow(s, item, charId); } }
    const left = inv.defOf(s, w).weapon.integral.capacity - weapons.roundCount(w.rounds);
    return `${c.name} loaded ${r.loaded} round${r.loaded === 1 ? '' : 's'} into ${inv.itemName(s, w)}${fd ? ' (Fast-Draw)' : ''} — ${weapons.roundCount(w.rounds)}/${inv.defOf(s, w).weapon.integral.capacity}${r.done ? '' : `, ${left} to go`}`;
  }
  delete item.stage;
  const note = resolveAll(s, ctx, a, item, charId, st);
  if (s.items[item.id]?.loc?.slot === 'ready') stow(s, s.items[item.id], charId);
  return `${c.name}: ${note}`;
}

/** At the start of a character's turn: run what is staged in their Ready slot. */
function onTurnStart(s, ctx, enc, charId) {
  const it = inv.equipped(s, charId, 'ready');
  if (!it?.stage) return null;
  try { return step(s, ctx, { role: 'gm' }, it, charId, enc); } catch (e) {
    if (!e.userFacing) throw e;
    delete it.stage; stow(s, it, charId);
    return `${s.characters[charId]?.name}: ${e.message}`;
  }
}

/** A break ends or the encounter stops: staged actions finish (time has passed). */
function finishAll(s, ctx, enc) {
  const notes = [];
  for (const id of enc.order) {
    const it = inv.equipped(s, id, 'ready');
    if (!it?.stage) continue;
    const st = it.stage; delete it.stage;
    try { notes.push(resolveAll(s, ctx, { role: 'gm' }, it, id, st)); } catch (e) { if (!e.userFacing) throw e; notes.push(e.message); }
    if (s.items[it.id]?.loc?.slot === 'ready') stow(s, s.items[it.id], id);
  }
  return notes;
}

/** Taken out of the Ready slot: cancel (the turn already spent is not refunded). */
function unstage(item) { delete item.stage; }

module.exports = { classify, stage, step, onTurnStart, finishAll, unstage, stow, holster, clipSeconds, hasSkill };
