'use strict';
/**
 * The single inventory engine shared by player characters, NPCs, traders, stashes and
 * containers. Every physical object is an item instance in `s.items` with exactly one location:
 *
 *   grid  { p: parentRef, g: gridId, x, y, r }   r = 1 when rotated 90°
 *   slot  { p: 'char:ID', slot: 'primary' }      equipment slot on a character
 *   mount { p: 'item:ID', mount: 'muzzle' }      attachment / magazine on a weapon
 *
 * Parent references: 'char:ID', 'stash:ID', 'trader:ID', 'item:ID'.
 * Because an object has exactly one location, transfers can never duplicate items.
 */
const { ActionError, assert } = require('./errors');
const { EQUIP_SLOTS, slotsFor } = require('./catalog');

const CHARACTER_GRIDS = [
  { id: 'pockets', label: 'Pockets', w: 4, h: 1, compartments: [{ x: 0, y: 0, w: 1, h: 1 }, { x: 1, y: 0, w: 1, h: 1 }, { x: 2, y: 0, w: 1, h: 1 }, { x: 3, y: 0, w: 1, h: 1 }], accepts: [], carried: true },
  { id: 'ground', label: 'Ground / Loose Loot', w: 10, h: 8, compartments: [], accepts: [], carried: false },
];

function parseRef(ref) {
  const i = String(ref || '').indexOf(':');
  if (i < 1) throw new ActionError(`Invalid location reference "${ref}"`);
  return { kind: ref.slice(0, i), id: ref.slice(i + 1) };
}

function getItem(s, id) { const it = s.items[id]; if (!it) throw new ActionError('That item no longer exists.', 'missing'); return it; }
function defOf(s, item) { const d = s.defs[item.defId]; if (!d) throw new ActionError(`Missing item definition ${item.defId}`); return d; }
function itemName(s, item) { return item.name || s.defs[item.defId]?.name || 'Unknown item'; }

function entityOf(s, ref) {
  const { kind, id } = parseRef(ref);
  const table = { char: s.characters, stash: s.stashes, trader: s.traders, item: s.items }[kind];
  if (!table || !table[id]) throw new ActionError('That location no longer exists.', 'missing');
  return { kind, id, entity: table[id] };
}

/** Grids available inside a parent. */
function gridsOf(s, ref) {
  const { kind, entity } = entityOf(s, ref);
  if (kind === 'char') return CHARACTER_GRIDS;
  if (kind === 'stash' || kind === 'trader') return [{ id: 'main', label: entity.name || 'Storage', w: entity.grid?.w || 10, h: entity.grid?.h || 10, compartments: [], accepts: [] }];
  if (kind === 'item') return defOf(s, entity).container?.grids || [];
  return [];
}

function gridOf(s, ref, gridId) {
  const g = gridsOf(s, ref).find(x => x.id === gridId);
  if (!g) throw new ActionError('That storage grid does not exist.');
  return g;
}

/** Direct children of a parent (any location kind). */
function childrenOf(s, ref) {
  const out = [];
  for (const it of Object.values(s.items)) if (it.loc && it.loc.p === ref) out.push(it);
  return out;
}

/** All descendants (recursive) of an item or entity. */
function descendants(s, ref) {
  const out = [];
  const stack = [ref];
  const byParent = new Map();
  for (const it of Object.values(s.items)) {
    if (!it.loc) continue;
    if (!byParent.has(it.loc.p)) byParent.set(it.loc.p, []);
    byParent.get(it.loc.p).push(it);
  }
  while (stack.length) {
    const r = stack.pop();
    for (const c of byParent.get(r) || []) { out.push(c); stack.push('item:' + c.id); }
  }
  return out;
}

/** Walk up from an item to its top-level owning entity reference (char/stash/trader). */
function rootOf(s, item) {
  let cur = item;
  for (let guard = 0; guard < 64; guard++) {
    const p = cur.loc?.p;
    if (!p) return null;
    if (!p.startsWith('item:')) return p;
    cur = s.items[p.slice(5)];
    if (!cur) return null;
  }
  throw new ActionError('Item hierarchy is too deep or circular.');
}

/** Chain of item ids from an item up to (excluding) its root entity. */
function ancestors(s, item) {
  const out = [];
  let cur = item;
  for (let guard = 0; guard < 64 && cur?.loc?.p?.startsWith('item:'); guard++) {
    const id = cur.loc.p.slice(5);
    out.push(id);
    cur = s.items[id];
  }
  return out;
}

/** Footprint in cells, including attachment extensions and rotation. */
function footprint(s, item, rotated) {
  const d = defOf(s, item);
  let w = d.w, h = d.h;
  for (const c of childrenOf(s, 'item:' + item.id)) {
    if (c.loc.mount === undefined) continue;
    const ext = s.defs[c.defId]?.attachment?.extend;
    if (ext) { w += ext.w || 0; h += ext.h || 0; }
  }
  const r = rotated === undefined ? !!item.loc?.r : !!rotated;
  return r ? { w: h, h: w } : { w, h };
}

function rectsOverlap(a, b) { return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y; }

/**
 * Can `item` be placed at a target?
 * target: { p, g, x, y, r } (grid) | { p, slot } | { p, mount }
 */
function canPlace(s, item, target) {
  try { checkPlace(s, item, target); return { ok: true }; } catch (e) { if (e.userFacing) return { ok: false, reason: e.message }; throw e; }
}

function checkPlace(s, item, target) {
  assert(target && target.p, 'No destination given.');
  const dest = entityOf(s, target.p);
  // Recursion guard: a container may not be placed inside itself or any of its descendants.
  if (dest.kind === 'item') {
    assert(dest.id !== item.id, 'An item cannot be placed inside itself.');
    const chain = ancestors(s, dest.entity);
    assert(!chain.includes(item.id), 'A container cannot be placed inside one of its own contents.');
  }
  const d = defOf(s, item);
  if (target.slot !== undefined) {
    assert(dest.kind === 'char', 'Equipment slots exist only on characters.');
    assert(EQUIP_SLOTS[target.slot], 'Unknown equipment slot.');
    assert(slotsFor(d).includes(target.slot), `${itemName(s, item)} cannot be equipped in ${EQUIP_SLOTS[target.slot].label}.`);
    const occupant = childrenOf(s, target.p).find(c => c.loc.slot === target.slot && c.id !== item.id);
    assert(!occupant, `${EQUIP_SLOTS[target.slot].label} is already occupied.`);
    return true;
  }
  if (target.mount !== undefined) {
    assert(dest.kind === 'item', 'Attachments mount on weapons.');
    // compatibility is validated by weapons.js; here we only enforce occupancy
    const occupant = childrenOf(s, target.p).find(c => c.loc.mount === target.mount && c.id !== item.id);
    assert(!occupant, 'That mount is already occupied.');
    return true;
  }
  const grid = gridOf(s, target.p, target.g);
  if (grid.accepts.length) assert(grid.accepts.includes(d.category), `${grid.label || 'This compartment'} accepts only ${grid.accepts.join(', ')}.`);
  const fp = footprint(s, item, target.r);
  const x = Math.floor(target.x), y = Math.floor(target.y);
  assert(Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x + fp.w <= grid.w && y + fp.h <= grid.h, 'Item does not fit there.');
  const rect = { x, y, w: fp.w, h: fp.h };
  if (grid.compartments.length) assert(grid.compartments.some(c => rect.x >= c.x && rect.y >= c.y && rect.x + rect.w <= c.x + c.w && rect.y + rect.h <= c.y + c.h), 'Item must fit entirely within one compartment.');
  for (const other of childrenOf(s, target.p)) {
    if (other.id === item.id || other.loc.g !== target.g || other.loc.x === undefined) continue;
    const ofp = footprint(s, other);
    assert(!rectsOverlap(rect, { x: other.loc.x, y: other.loc.y, w: ofp.w, h: ofp.h }), 'That space is occupied.');
  }
  return true;
}

/** Move an item (and therefore everything inside/attached to it) to a target. */
function place(s, item, target) {
  checkPlace(s, item, target);
  if (target.slot !== undefined) item.loc = { p: target.p, slot: target.slot };
  else if (target.mount !== undefined) item.loc = { p: target.p, mount: target.mount };
  else item.loc = { p: target.p, g: target.g, x: Math.floor(target.x), y: Math.floor(target.y), r: target.r ? 1 : 0 };
  return item;
}

/** Find a free position in any grid of a parent (tries both orientations). */
function findSpot(s, item, ref, preferGrid) {
  const grids = gridsOf(s, ref).slice();
  if (preferGrid) grids.sort((a, b) => (b.id === preferGrid) - (a.id === preferGrid));
  for (const g of grids) {
    for (const r of [0, 1]) {
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
        const t = { p: ref, g: g.id, x, y, r };
        if (canPlace(s, item, t).ok) return t;
      }
    }
  }
  return null;
}

/** Can two stacks merge? Same definition, stackable, same condition, no contents. */
function stackable(s, a, b) {
  const d = defOf(s, a);
  return a.id !== b.id && a.defId === b.defId && d.stack > 1 && (a.cond ?? 100) === (b.cond ?? 100) && !a.rounds && !b.rounds && !a.name && !b.name;
}

/** Merge as much of `src` into `dst` as fits. Returns amount moved; deletes src if emptied. */
function mergeStacks(s, src, dst) {
  assert(stackable(s, src, dst), 'Those items cannot be stacked together.');
  const room = defOf(s, dst).stack - dst.qty;
  const n = Math.min(room, src.qty);
  if (n <= 0) return 0;
  dst.qty += n; src.qty -= n;
  if (src.qty <= 0) delete s.items[src.id];
  return n;
}

/**
 * Put an item somewhere inside a parent: first top up existing stacks, then find free space.
 * Returns { placed: true } or throws when there is no room.
 */
function storeIn(s, item, ref, opts = {}) {
  if (defOf(s, item).stack > 1) {
    for (const other of descendantsForStacking(s, ref)) {
      if (stackable(s, item, other)) { mergeStacks(s, item, other); if (!s.items[item.id]) return { merged: true }; }
    }
  }
  const spot = findSpot(s, item, ref, opts.preferGrid);
  if (!spot) throw new ActionError(`No room for ${itemName(s, item)}.`, 'no-room');
  place(s, item, spot);
  return { placed: true, spot };
}

function descendantsForStacking(s, ref) {
  return descendants(s, ref).filter(i => i.loc.g !== undefined);
}

/** Store into a character: equipped containers first, then pockets, finally the ground. */
function storeOnCharacter(s, item, charRef, { allowGround = true } = {}) {
  const containers = childrenOf(s, charRef).filter(c => c.loc.slot && defOf(s, c).container);
  const order = containers.sort((a, b) => (a.loc.slot === 'rig' ? -1 : 0) - (b.loc.slot === 'rig' ? -1 : 0));
  for (const c of order) {
    try { return storeIn(s, item, 'item:' + c.id); } catch (e) { if (e.code !== 'no-room') throw e; }
    if (!s.items[item.id]) return { merged: true };
  }
  const pocketSpot = (() => { for (let x = 0; x < 4; x++) { const t = { p: charRef, g: 'pockets', x, y: 0, r: 0 }; if (canPlace(s, item, t).ok) return t; } return null; })();
  if (pocketSpot) { place(s, item, pocketSpot); return { placed: true, spot: pocketSpot }; }
  if (!allowGround) throw new ActionError(`No room for ${itemName(s, item)}.`, 'no-room');
  const g = findSpot(s, item, charRef, 'ground');
  if (g && g.g === 'ground') { place(s, item, g); return { placed: true, spot: g, ground: true }; }
  throw new ActionError(`No room for ${itemName(s, item)}, not even on the ground.`, 'no-room');
}

/** Create a new item instance (not yet placed). */
function createItem(s, ctx, defId, props = {}) {
  const d = s.defs[defId];
  if (!d) throw new ActionError(`Unknown item definition ${defId}`);
  const item = { id: ctx.uid('it_'), defId, qty: 1, cond: 100, ...props };
  if (d.stack <= 1) item.qty = 1;
  item.qty = Math.max(1, Math.min(d.stack, Math.floor(item.qty)));
  if (d.weapon?.integral && !item.rounds) item.rounds = [];
  if (d.magazine && !item.rounds) item.rounds = [];
  if (d.armor?.dpMax && item.dp === undefined) item.dp = d.armor.dpMax;
  s.items[item.id] = item;
  return item;
}

/** Split `qty` units off a stack into a new stack at target (or auto-placed in same parent). */
function splitStack(s, ctx, item, qty, target) {
  const n = Math.floor(qty);
  assert(Number.isInteger(n) && n >= 1 && n < item.qty, 'Choose an amount smaller than the stack.');
  const copy = { id: ctx.uid('it_'), defId: item.defId, qty: n, cond: item.cond ?? 100 };
  s.items[copy.id] = copy;
  item.qty -= n;
  try {
    if (target) place(s, copy, target);
    else {
      const root = item.loc?.p;
      const spot = root ? findSpot(s, copy, root) : null;
      if (!spot) throw new ActionError('No room for the split stack.', 'no-room');
      place(s, copy, spot);
    }
  } catch (e) { item.qty += n; delete s.items[copy.id]; throw e; }
  return copy;
}

/** Delete an item and everything inside or attached to it. Returns removed items (for undo). */
function destroy(s, item) {
  const removed = [item, ...descendants(s, 'item:' + item.id)];
  for (const r of removed) delete s.items[r.id];
  return removed;
}

/** Weight (kg) of an item including stack, loaded rounds, attachments and contents. */
function weightOf(s, item) {
  const d = defOf(s, item);
  let w = d.weight * (item.qty || 1);
  for (const [ammoId, n] of item.rounds || []) w += (s.defs[ammoId]?.weight || 0) * n;
  if (item.chamber) w += s.defs[item.chamber]?.weight || 0;
  for (const c of childrenOf(s, 'item:' + item.id)) w += weightOf(s, c);
  return w;
}

/** Items a character carries: equipment slots and pockets (plus everything inside them). */
function carriedItems(s, charId) {
  const ref = 'char:' + charId;
  const top = childrenOf(s, ref).filter(i => i.loc.slot !== undefined || i.loc.g === 'pockets');
  return top;
}

function carriedWeightKg(s, charId) {
  return carriedItems(s, charId).reduce((a, i) => a + weightOf(s, i), 0);
}

/** Equipped item in a slot, if any. */
function equipped(s, charId, slot) {
  return childrenOf(s, 'char:' + charId).find(i => i.loc.slot === slot) || null;
}

/** Count units of a definition available to a character (carried + ground optional). */
function countOwned(s, charId, defId, { includeGround = false } = {}) {
  let n = 0;
  for (const it of ownedItems(s, charId, { includeGround })) if (it.defId === defId) n += it.qty || 1;
  return n;
}

function ownedItems(s, charId, { includeGround = true } = {}) {
  const ref = 'char:' + charId;
  return descendants(s, ref).filter(it => {
    if (includeGround) return true;
    let top = it;
    while (top.loc.p.startsWith('item:')) top = s.items[top.loc.p.slice(5)];
    return top.loc.g !== 'ground';
  });
}

/** Rotate an item in place if the rotated footprint fits. */
function rotate(s, item) {
  assert(item.loc && item.loc.g !== undefined, 'Only items in a storage grid can be rotated.');
  place(s, item, { ...item.loc, r: item.loc.r ? 0 : 1 });
}

module.exports = {
  CHARACTER_GRIDS, parseRef, getItem, defOf, itemName, entityOf, gridsOf, gridOf, childrenOf, descendants, rootOf, ancestors,
  footprint, canPlace, checkPlace, place, findSpot, stackable, mergeStacks, storeIn, storeOnCharacter, createItem,
  splitStack, destroy, weightOf, carriedItems, carriedWeightKg, equipped, countOwned, ownedItems, rotate,
};
