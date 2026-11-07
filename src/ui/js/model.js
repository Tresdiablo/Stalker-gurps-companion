// Read-only helpers over the view sent by the host. They mirror server rules only to build
// menus and previews; the host validates every action.
const cache = new WeakMap();

export function idx(v) {
  let x = cache.get(v);
  if (x) return x;
  const byParent = new Map();
  for (const it of Object.values(v.items || {})) {
    if (!it.loc) continue;
    if (!byParent.has(it.loc.p)) byParent.set(it.loc.p, []);
    byParent.get(it.loc.p).push(it);
  }
  x = { byParent };
  cache.set(v, x);
  return x;
}
export const children = (v, ref) => idx(v).byParent.get(ref) || [];
export const def = (v, it) => v.defs[it?.defId] || null;
export const itemName = (v, it) => it?.name || def(v, it)?.name || 'Unknown item';
export function rootOf(v, it) { let cur = it; for (let g = 0; g < 64 && cur?.loc?.p?.startsWith('item:'); g++) cur = v.items[cur.loc.p.slice(5)]; return cur?.loc?.p || null; }
export function descendants(v, ref) { const out = []; const st = [ref]; while (st.length) { const r = st.pop(); for (const c of children(v, r)) { out.push(c); st.push('item:' + c.id); } } return out; }
export function owned(v, charId) { return descendants(v, 'char:' + charId); }

export function footprint(v, it, rot) {
  const d = def(v, it); if (!d) return { w: 1, h: 1 };
  let w = d.w, h = d.h;
  for (const c of children(v, 'item:' + it.id)) if (c.loc.mount !== undefined) { const e = def(v, c)?.attachment?.extend; if (e) { w += e.w || 0; h += e.h || 0; } }
  const r = rot === undefined ? !!it.loc?.r : !!rot;
  return r ? { w: h, h: w } : { w, h };
}

const CHAR_GRIDS = [{ id: 'pockets', label: 'Pockets', w: 4, h: 1, compartments: [0, 1, 2, 3].map(x => ({ x, y: 0, w: 1, h: 1 })), accepts: [] }, { id: 'ground', label: 'Ground / Loose Loot', w: 10, h: 8, compartments: [], accepts: [] }];
export function gridsOf(v, ref) {
  const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)];
  if (kind === 'char') return CHAR_GRIDS;
  if (kind === 'stash') { const s = v.stashes[id]; return s ? [{ id: 'main', label: s.name, w: s.grid.w, h: s.grid.h, compartments: [], accepts: [] }] : []; }
  if (kind === 'trader') { const t = v.traders[id]; return t ? [{ id: 'main', label: t.name, w: t.grid.w, h: t.grid.h, compartments: [], accepts: [] }] : []; }
  if (kind === 'item') { const it = v.items[id]; return def(v, it)?.container?.grids || []; }
  return [];
}

/** Client-side placement preview (server is authoritative). */
export function canPlaceGrid(v, it, ref, gridId, x, y, r) {
  const g = gridsOf(v, ref).find(z => z.id === gridId);
  if (!g) return false;
  const d = def(v, it);
  if (g.accepts?.length && !g.accepts.includes(d?.category)) return false;
  if (ref === 'item:' + it.id) return false;
  let cur = v.items[ref.startsWith('item:') ? ref.slice(5) : ''];
  for (let k = 0; cur && k < 64; k++) { if (cur.id === it.id) return false; cur = cur.loc?.p?.startsWith('item:') ? v.items[cur.loc.p.slice(5)] : null; }
  const fp = footprint(v, it, r);
  if (x < 0 || y < 0 || x + fp.w > g.w || y + fp.h > g.h) return false;
  if (g.compartments?.length && !g.compartments.some(c => x >= c.x && y >= c.y && x + fp.w <= c.x + c.w && y + fp.h <= c.y + c.h)) return false;
  for (const o of children(v, ref)) {
    if (o.id === it.id || o.loc.g !== gridId) continue;
    const ofp = footprint(v, o);
    if (x < o.loc.x + ofp.w && x + fp.w > o.loc.x && y < o.loc.y + ofp.h && y + fp.h > o.loc.y) return false;
  }
  return true;
}

export const SLOTS = [
  ['ready', 'In hands', null, null],
  ['helmet', 'Helmet', ['armor'], ['Helmets']], ['face', 'Face', ['armor'], ['Masks']], ['armor', 'Body armor', ['armor'], ['Body Armor', 'Suits', 'Clothing']],
  ['rig', 'Tactical rig', ['equipment'], ['Tactical Rigs']], ['backpack', 'Backpack', ['equipment'], ['Backpacks']],
  ['primary', 'Primary', ['weapon'], null], ['secondary', 'Secondary', ['weapon'], null], ['holster', 'Holster', ['weapon'], ['Pistols', 'Revolvers']], ['melee', 'Melee', ['weapon'], ['Melee Weapons']],
  ['artifact1', 'Artifact', ['artifact'], null], ['artifact2', 'Artifact', ['artifact'], null], ['artifact3', 'Artifact', ['artifact'], null],
];
export function slotsFor(d) {
  if (!d) return [];
  if (d.slots?.length) return d.slots.includes('ready') ? d.slots : [...d.slots, 'ready'];
  return SLOTS.filter(([id, , cats, subs]) => (!cats || cats.includes(d.category)) && (!subs || subs.includes(d.sub)) && !(d.category === 'weapon' && (id === 'primary' || id === 'secondary') && d.sub === 'Melee Weapons')).map(s => s[0]);
}
export const equippedIn = (v, charId, slot) => children(v, 'char:' + charId).find(i => i.loc.slot === slot) || null;

export function imageUrl(v, ref) {
  if (!ref) return null;
  if (ref.startsWith('seed:')) return '/seed/' + ref.slice(5);
  const a = v.assets?.[ref];
  return a ? '/assets/' + a.file : null;
}

export const roundCount = rounds => (rounds || []).reduce((a, [, n]) => a + n, 0);
export function ammoFitsHolder(v, ammoDef, holderDef) {
  if (!ammoDef?.ammo) return false;
  if (holderDef?.magazine) return holderDef.magazine.calibers.includes(ammoDef.ammo.caliber);
  if (holderDef?.weapon?.integral) return holderDef.weapon.calibers.includes(ammoDef.ammo.caliber) && (!ammoDef.ammo.onlyWeapons?.length || ammoDef.ammo.onlyWeapons.includes(holderDef.id));
  return false;
}
export function magFitsWeapon(magDef, wDef) { return !!(magDef?.magazine && wDef?.weapon && !wDef.weapon.integral && wDef.weapon.magFamilies.includes(magDef.magazine.family)); }
export function attachFits(attDef, mount, wDef) {
  if (!attDef?.attachment || attDef.attachment.slot !== mount.slot) return false;
  if (attDef.attachment.weapons?.length && !attDef.attachment.weapons.includes(wDef.id)) return false;
  return attDef.attachment.interfaces.some(i => mount.interfaces.includes(i));
}
export const installed = (v, w) => Object.fromEntries(children(v, 'item:' + w.id).filter(c => c.loc.mount !== undefined).map(c => [c.loc.mount, c]));
export const myChars = v => Object.values(v.characters).filter(c => v.role === 'gm' ? c.kind === 'pc' : c.mine);
export const charName = (v, id) => v.characters[id]?.name || '—';
export const LOCATIONS = [['torso', 'Torso', 0], ['vitals', 'Vitals', -3], ['skull', 'Skull', -7], ['eye', 'Eye', -9], ['face', 'Face', -5], ['neck', 'Neck', -5], ['groin', 'Groin', -3], ['arm', 'Arm', -2], ['leg', 'Leg', -2], ['hand', 'Hand', -4], ['foot', 'Foot', -4], ['random', 'Random (3d6)', 0]];
export const POSTURES = [['standing', 'Standing'], ['crouching', 'Crouching'], ['kneeling', 'Kneeling'], ['sitting', 'Sitting'], ['crawling', 'Crawling'], ['prone', 'Lying down']];
export const COVER = [['none', 'No cover', 0], ['light', 'Light cover / brush', -2], ['half', 'Half exposed', -3], ['headShoulders', 'Head & shoulders', -4], ['headOnly', 'Head only', -5], ['behindFigure', 'Behind another figure', -4]];
export const MANEUVERS = [['attack', 'Attack'], ['aim', 'Aim'], ['aoaDetermined', 'All-Out Attack (Det.)'], ['moveAttack', 'Move & Attack'], ['allOutDefense', 'All-Out Defense'], ['ready', 'Ready'], ['move', 'Move'], ['concentrate', 'Concentrate'], ['wait', 'Wait'], ['doNothing', 'Do Nothing']];
export const CONDITIONS = ['Stunned', 'Knocked Down', 'Unconscious', 'Dead', 'Bleeding', 'Crippled Arm', 'Crippled Leg', 'Crippled Hand', 'Crippled Foot', 'Blinded', 'Irradiated', 'Poisoned', 'Infected', 'On Fire', 'Mortally Wounded', 'Exhausted'];
export function activeEncounterFor(v, charId) { return Object.values(v.encounters || {}).find(e => e.status === 'active' && e.combatants[charId]) || null; }
export function distanceBetween(e, a, b) { const k = [a, b].sort().join('|'); return e?.distances?.[k] ?? null; }
/** Events that need a GM decision: an open defense roll or an unapplied injury/heal proposal. */
export function needsGm(e) {
  if (e.stage === 'awaiting-defense') return true;
  if (e.stage !== 'resolved' || !e.proposal) return false;
  if ((e.applications || []).some(a => !a.undone)) return false;
  return !!(e.proposal.hp || e.proposal.fp || e.proposal.conditions?.length || e.proposal.removeConditions?.length);
}
