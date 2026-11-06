'use strict';
/**
 * Weapons, magazines, ammunition and attachments.
 *
 * Rounds are stored as a stack list, bottom → top: [[ammoDefId, count], ...]. The last
 * loaded round is fired first, so mixed loads behave like a real magazine.
 * Detachable-magazine weapons also have a `chamber` (one round).
 */
const { ActionError, assert } = require('./errors');
const cat = require('./catalog');
const inv = require('./inventory');

function weaponDef(s, item) {
  const d = inv.defOf(s, item);
  assert(d.weapon, `${d.name} is not a weapon.`);
  return d;
}

function roundCount(rounds) { return (rounds || []).reduce((a, [, n]) => a + n, 0); }

function pushRounds(rounds, ammoId, n) {
  const top = rounds[rounds.length - 1];
  if (top && top[0] === ammoId) top[1] += n; else rounds.push([ammoId, n]);
}

function popRound(rounds) {
  const top = rounds[rounds.length - 1];
  if (!top) return null;
  top[1] -= 1;
  if (top[1] <= 0) rounds.pop();
  return top[0];
}

function mountsOf(s, weapon) { return weaponDef(s, weapon).weapon.mounts; }

/** Map of mount id -> installed item. */
function installed(s, weapon) {
  const out = {};
  for (const c of inv.childrenOf(s, 'item:' + weapon.id)) if (c.loc.mount !== undefined) out[c.loc.mount] = c;
  return out;
}

function magazineIn(s, weapon) {
  const d = weaponDef(s, weapon);
  if (d.weapon.integral) return null;
  const mount = d.weapon.mounts.find(m => m.slot === 'magazine');
  return mount ? installed(s, weapon)[mount.id] || null : null;
}

/** Capacity and current rounds of whatever feeds the weapon. */
function feedState(s, weapon) {
  const d = weaponDef(s, weapon);
  if (d.weapon.kind === 'melee') return { kind: 'melee', rounds: 0, capacity: 0, chamber: null };
  if (d.weapon.integral) return { kind: 'integral', rounds: roundCount(weapon.rounds), capacity: d.weapon.integral.capacity, chamber: null, stacks: weapon.rounds || [] };
  const mag = magazineIn(s, weapon);
  const magDef = mag ? inv.defOf(s, mag) : null;
  return { kind: 'detachable', magazine: mag, rounds: (mag ? roundCount(mag.rounds) : 0) + (weapon.chamber ? 1 : 0), magRounds: mag ? roundCount(mag.rounds) : 0, capacity: magDef ? magDef.magazine.capacity : 0, chamber: weapon.chamber || null, stacks: mag?.rounds || [] };
}

/** Total rounds available to fire. */
function roundsAvailable(s, weapon) { return feedState(s, weapon).rounds; }

/* --------------------------------------------------------------- loading */

/** Holder (magazine item or integral-feed weapon) accepts this ammo definition. */
function holderAccepts(s, holder, ammoDef) {
  const d = inv.defOf(s, holder);
  if (d.magazine) return cat.ammoFitsMagazine(ammoDef, d);
  if (d.weapon?.integral) return cat.ammoFitsWeapon(ammoDef, d);
  return false;
}

function holderCapacity(s, holder) {
  const d = inv.defOf(s, holder);
  if (d.magazine) return d.magazine.capacity;
  if (d.weapon?.integral) return d.weapon.integral.capacity;
  throw new ActionError('That item does not hold ammunition.');
}

/**
 * Load up to `count` rounds from an ammo stack into a magazine or integral-feed weapon.
 * If the magazine is in a weapon, the rounds must also fit the weapon.
 */
function loadRounds(s, holder, ammoItem, count) {
  const ammoDef = inv.defOf(s, ammoItem);
  assert(ammoDef.ammo, `${ammoDef.name} is not ammunition.`);
  assert(holderAccepts(s, holder, ammoDef), `${ammoDef.name} does not fit ${inv.itemName(s, holder)}.`);
  if (holder.loc?.mount !== undefined) {
    const w = s.items[holder.loc.p.slice(5)];
    if (w) assert(cat.ammoFitsWeapon(ammoDef, inv.defOf(s, w)), `${ammoDef.name} cannot be fired by ${inv.itemName(s, w)}.`);
  }
  holder.rounds = holder.rounds || [];
  const room = holderCapacity(s, holder) - roundCount(holder.rounds);
  assert(room > 0, `${inv.itemName(s, holder)} is full.`);
  const n = Math.min(room, ammoItem.qty, count === undefined ? Infinity : Math.floor(count));
  assert(n >= 1, 'No rounds to load.');
  pushRounds(holder.rounds, ammoItem.defId, n);
  ammoItem.qty -= n;
  if (ammoItem.qty <= 0) delete s.items[ammoItem.id];
  return n;
}

/**
 * Remove all rounds from a holder and store them as loose ammunition near the holder's owner.
 * Returns created/merged quantities by ammo definition.
 */
function unloadRounds(s, ctx, holder, destRef) {
  const stacks = holder.rounds || [];
  assert(roundCount(stacks), `${inv.itemName(s, holder)} is empty.`);
  const totals = {};
  for (const [id, n] of stacks) totals[id] = (totals[id] || 0) + n;
  if (holder.chamber && inv.defOf(s, holder).weapon) { totals[holder.chamber] = (totals[holder.chamber] || 0) + 1; }
  const dest = destRef || inv.rootOf(s, holder);
  assert(dest, 'Nowhere to put the unloaded rounds.');
  const created = [];
  for (const [ammoId, total] of Object.entries(totals)) {
    let left = total;
    const max = s.defs[ammoId]?.stack || 1;
    while (left > 0) {
      const it = inv.createItem(s, ctx, ammoId, { qty: Math.min(max, left) });
      left -= it.qty;
      if (dest.startsWith('char:')) inv.storeOnCharacter(s, it, dest); else inv.storeIn(s, it, dest);
      created.push(it.id);
    }
  }
  holder.rounds = [];
  if (inv.defOf(s, holder).weapon) holder.chamber = null;
  return totals;
}

/** Ammunition items reachable by a character (carried and ground) that fit the holder. */
function ammoChoices(s, charId, holder) {
  return inv.ownedItems(s, charId).filter(i => {
    const d = s.defs[i.defId];
    return d?.ammo && holderAccepts(s, holder, d);
  });
}

/* --------------------------------------------------------------- magazines in weapons */

function insertMagazine(s, weapon, mag) {
  const d = weaponDef(s, weapon);
  const md = inv.defOf(s, mag);
  assert(!d.weapon.integral, `${d.name} has an internal magazine; load it directly.`);
  assert(cat.magazineFitsWeapon(md, d), `${md.name} does not fit ${d.name}.`);
  for (const [ammoId] of mag.rounds || []) assert(cat.ammoFitsWeapon(s.defs[ammoId], d), `${md.name} is loaded with ${s.defs[ammoId]?.name}, which ${d.name} cannot fire.`);
  const mount = d.weapon.mounts.find(m => m.slot === 'magazine');
  assert(mount, `${d.name} has no magazine well.`);
  assert(!installed(s, weapon)[mount.id], 'Remove the current magazine first.');
  inv.place(s, mag, { p: 'item:' + weapon.id, mount: mount.id });
  let chambered = false;
  if (!weapon.chamber && roundCount(mag.rounds)) { weapon.chamber = popRound(mag.rounds); chambered = true; }
  return { chambered };
}

function ejectMagazine(s, weapon, target) {
  const mag = magazineIn(s, weapon);
  assert(mag, 'No magazine is inserted.');
  if (target) inv.place(s, mag, target);
  else {
    const root = inv.rootOf(s, weapon);
    if (root?.startsWith('char:')) inv.storeOnCharacter(s, mag, root); else inv.storeIn(s, mag, root);
  }
  return mag;
}

/** Chamber a round from the magazine (Ready). */
function chamberRound(s, weapon) {
  const d = weaponDef(s, weapon);
  assert(!d.weapon.integral, 'Internal-magazine weapons are fed directly.');
  assert(!weapon.chamber, 'A round is already chambered.');
  const mag = magazineIn(s, weapon);
  assert(mag && roundCount(mag.rounds), 'No rounds in the magazine.');
  weapon.chamber = popRound(mag.rounds);
}

/**
 * Fire `shots` rounds. Returns the ammo definition ids fired (in order). Refuses to fire more
 * rounds than are available. Detachable weapons fire the chambered round first and cycle.
 */
function fire(s, weapon, shots) {
  const n = Math.floor(shots);
  assert(n >= 1, 'Fire at least one shot.');
  const d = weaponDef(s, weapon);
  assert(d.weapon.kind === 'ranged', 'Melee weapons do not fire.');
  const available = roundsAvailable(s, weapon);
  assert(available >= n, `${d.name} has only ${available} round${available === 1 ? '' : 's'} loaded.`);
  const fired = [];
  if (d.weapon.integral) { for (let i = 0; i < n; i++) fired.push(popRound(weapon.rounds)); return fired; }
  const mag = magazineIn(s, weapon);
  for (let i = 0; i < n; i++) {
    fired.push(weapon.chamber);
    weapon.chamber = mag && roundCount(mag.rounds) ? popRound(mag.rounds) : null;
  }
  return fired;
}

/* --------------------------------------------------------------- attachments */

function compatibleMounts(s, weapon, attItem) {
  const d = weaponDef(s, weapon);
  const ad = inv.defOf(s, attItem);
  return d.weapon.mounts.filter(m => m.slot !== 'magazine' && cat.attachmentFitsMount(ad, m, d));
}

/** Install an attachment, validating compatibility and that the larger weapon still fits. */
function installAttachment(s, weapon, attItem, mountId) {
  const d = weaponDef(s, weapon);
  const ad = inv.defOf(s, attItem);
  assert(ad.attachment, `${ad.name} is not a weapon attachment.`);
  const mount = mountId ? d.weapon.mounts.find(m => m.id === mountId) : compatibleMounts(s, weapon, attItem).find(m => !installed(s, weapon)[m.id]);
  assert(mount, `${ad.name} has no compatible free mount on ${d.name}.`);
  assert(cat.attachmentFitsMount(ad, mount, d), `${ad.name} does not fit the ${mount.label} of ${d.name}.`);
  assert(!installed(s, weapon)[mount.id], `${mount.label} is already occupied.`);
  const previous = attItem.loc;
  inv.place(s, attItem, { p: 'item:' + weapon.id, mount: mount.id });
  // An attachment may lengthen the weapon; it must still fit where it is.
  if (weapon.loc?.g !== undefined && (ad.attachment.extend.w || ad.attachment.extend.h)) {
    const ok = inv.canPlace(s, weapon, weapon.loc);
    if (!ok.ok) { attItem.loc = previous; throw new ActionError(`With ${ad.name} installed, ${d.name} no longer fits in its current space.`); }
  }
  return mount;
}

function removeAttachment(s, weapon, mountId, target) {
  const att = installed(s, weapon)[mountId];
  assert(att, 'Nothing is installed there.');
  const mount = mountsOf(s, weapon).find(m => m.id === mountId);
  if (mount?.slot === 'magazine') return ejectMagazine(s, weapon, target);
  if (target) inv.place(s, att, target);
  else {
    const root = inv.rootOf(s, weapon);
    if (root?.startsWith('char:')) inv.storeOnCharacter(s, att, root); else inv.storeIn(s, att, root);
  }
  return att;
}

/* --------------------------------------------------------------- effective stats */

/**
 * Effective weapon statistics with a breakdown of every attachment modifier.
 * Base values come from the definition; attachments add numeric modifiers.
 */
function effectiveStats(s, weapon) {
  const d = weaponDef(s, weapon);
  const w = d.weapon;
  const base = { acc: Number(w.acc) || 0, rcl: Number(w.rcl) || 1, bulk: Number(w.bulk) || 0, scope: 0, damageAdd: 0, rof: w.rof || '1', damage: w.damage || '', range: w.range || '', minST: Number(w.minST) || 0, skill: w.skill || '', shots: w.shots || '' };
  const out = { ...base, breakdown: [] };
  for (const [mountId, att] of Object.entries(installed(s, weapon))) {
    const ad = s.defs[att.defId];
    if (!ad?.attachment) continue;
    for (const [k, v] of Object.entries(ad.attachment.mods || {})) {
      if (typeof v !== 'number' || !v) continue;
      if (k in out && typeof out[k] === 'number') { out[k] += v; out.breakdown.push({ stat: k, value: v, source: ad.name, mount: mountId }); }
    }
    if (ad.attachment.mods?.note) out.breakdown.push({ stat: 'note', value: 0, source: ad.name, note: ad.attachment.mods.note });
  }
  out.rcl = Math.max(1, out.rcl);
  out.feed = feedState(s, weapon);
  return out;
}

/** Ammo definition of the next round to be fired (top of feed). */
function nextRound(s, weapon) {
  const d = weaponDef(s, weapon);
  if (d.weapon.integral) { const r = weapon.rounds || []; return r.length ? r[r.length - 1][0] : null; }
  if (weapon.chamber) return weapon.chamber;
  const mag = magazineIn(s, weapon);
  const r = mag?.rounds || [];
  return r.length ? r[r.length - 1][0] : null;
}

module.exports = {
  roundCount, pushRounds, popRound, mountsOf, installed, magazineIn, feedState, roundsAvailable, holderAccepts, holderCapacity,
  loadRounds, unloadRounds, ammoChoices, insertMagazine, ejectMagazine, chamberRound, fire, compatibleMounts, installAttachment,
  removeAttachment, effectiveStats, nextRound,
};
