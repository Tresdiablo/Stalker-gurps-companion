'use strict';
/**
 * Item definitions (the catalog). A definition describes a kind of item (one "AK-74"); item
 * instances (see inventory.js) reference a definition by id and carry per-object state.
 *
 * Compatibility is expressed through explicit identifiers, never free-text matching:
 *  - ammunition:  ammo.caliber       ∈ magazine.calibers / weapon.calibers
 *  - magazines:   magazine.family    ∈ weapon.magFamilies
 *  - attachments: attachment.slot === mount.slot  and  attachment.interfaces ∩ mount.interfaces ≠ ∅
 */

const CATEGORIES = {
  weapon: { label: 'Weapons', subs: ['Pistols', 'Revolvers', 'Submachine Guns', 'Shotguns', 'Assault Rifles', 'Battle Rifles', 'Marksman Rifles', 'Sniper Rifles', 'Rifles', 'Machine Guns', 'Launchers', 'Melee Weapons', 'Thrown'] },
  armor: { label: 'Armor & Clothing', subs: ['Body Armor', 'Helmets', 'Masks', 'Suits', 'Clothing'] },
  equipment: { label: 'Equipment', subs: ['Tactical Rigs', 'Backpacks', 'Tools', 'Electronics', 'Detectors', 'Lights', 'Food & Drink'] },
  medical: { label: 'Medical', subs: ['Bandages', 'Medkits', 'Drugs', 'Anti-radiation', 'Stimulants'] },
  material: { label: 'Crafting Materials', subs: ['Parts', 'Chemicals', 'Mutant Parts', 'Electronics', 'Repair'] },
  artifact: { label: 'Artifacts', subs: ['Gravitational', 'Chemical', 'Fire', 'Electrical', 'Miscellaneous'] },
  ammo: { label: 'Ammunition', subs: ['Pistol', 'Rifle', 'Shotgun', 'Grenades'] },
  magazine: { label: 'Magazines', subs: ['Pistol', 'SMG', 'Rifle', 'Shotgun', 'Stripper Clips', 'Integral'] },
  container: { label: 'Containers', subs: ['Pouches', 'Cases', 'Storage'] },
  attachment: { label: 'Attachments', subs: ['Optics', 'Muzzle Devices', 'Foregrips', 'Stocks', 'Tactical Devices', 'Underbarrel'] },
  misc: { label: 'Miscellaneous', subs: ['Valuables', 'Documents', 'Keys', 'Junk'] },
};

const RARITY = { common: 100, uncommon: 45, rare: 15, 'very rare': 5, unique: 1 };

const EQUIP_SLOTS = {
  hands: { label: 'Hands', categories: null }, // what the character holds and fires
  ready: { label: 'Ready (use next turn)', categories: null }, // staging: used automatically next turn
  primary: { label: 'Sling', categories: ['weapon'] }, // carried long guns (ids kept for old saves)
  secondary: { label: 'Back', categories: ['weapon'] },
  holster: { label: 'Holster', categories: ['weapon'], subs: ['Pistols', 'Revolvers'] },
  melee: { label: 'Melee / Sheath', categories: ['weapon'], subs: ['Melee Weapons'] },
  helmet: { label: 'Helmet', categories: ['armor'], subs: ['Helmets'] },
  face: { label: 'Face / Mask', categories: ['armor'], subs: ['Masks'] },
  armor: { label: 'Body Armor / Suit', categories: ['armor'], subs: ['Body Armor', 'Suits', 'Clothing'] },
  rig: { label: 'Tactical Rig', categories: ['equipment'], subs: ['Tactical Rigs'] },
  backpack: { label: 'Backpack', categories: ['equipment'], subs: ['Backpacks'] },
  artifact1: { label: 'Artifact Slot 1', categories: ['artifact'] },
  artifact2: { label: 'Artifact Slot 2', categories: ['artifact'] },
  artifact3: { label: 'Artifact Slot 3', categories: ['artifact'] },
};

const ATTACHMENT_SLOTS = {
  magazine: 'Magazine well',
  optic: 'Optic mount',
  muzzle: 'Muzzle',
  underbarrel: 'Underbarrel',
  foregrip: 'Foregrip',
  stock: 'Stock',
  side: 'Side rail',
  other: 'Other',
};

const ARMOR_LOCATIONS = ['skull', 'face', 'eye', 'neck', 'torso', 'vitals', 'groin', 'arm', 'leg', 'hand', 'foot'];

/** Canonical caliber id from a display string: "7.62×39mm" -> "7.62x39". */
function caliberKey(text) {
  return String(text || '').toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '').replace(/(\d)mm/g, '$1').replace(/[()]/g, '')
    .replace(/tokarev/, 'tok').replace(/magnum/, 'mag');
}

function num(v, d = 0) { const n = Number(v); return Number.isFinite(n) ? n : d; }
function arr(v) { return Array.isArray(v) ? v : (v === undefined || v === null || v === '' ? [] : [v]); }

/** Validate and normalize a definition. Throws on invalid input. */
function normalizeDef(input) {
  const d = { ...input };
  if (!d.id || typeof d.id !== 'string') throw new Error('Item definition requires an id');
  d.name = String(d.name || '').trim();
  if (!d.name) throw new Error('Item definition requires a name');
  if (!CATEGORIES[d.category]) throw new Error(`Unknown category "${d.category}"`);
  d.sub = d.sub || '';
  d.description = String(d.description || '');
  d.value = Math.max(0, num(d.value));
  d.weight = Math.max(0, num(d.weight));
  d.w = Math.max(1, Math.min(20, Math.floor(num(d.w, 1))));
  d.h = Math.max(1, Math.min(20, Math.floor(num(d.h, 1))));
  d.stack = Math.max(1, Math.floor(num(d.stack, 1)));
  d.tier = Math.max(1, Math.min(5, Math.floor(num(d.tier, 1))));
  d.rarity = RARITY[d.rarity] ? d.rarity : 'common';
  d.traders = arr(d.traders);
  d.tags = arr(d.tags);
  d.image = d.image || '';
  d.slots = arr(d.slots).filter(s => EQUIP_SLOTS[s]);
  if (d.weapon) {
    const w = d.weapon;
    w.kind = w.kind === 'melee' ? 'melee' : 'ranged';
    w.calibers = arr(w.calibers).map(String);
    w.magFamilies = arr(w.magFamilies).map(String);
    w.mounts = arr(w.mounts).map(m => ({ id: String(m.id), label: m.label || ATTACHMENT_SLOTS[m.slot] || m.id, slot: ATTACHMENT_SLOTS[m.slot] ? m.slot : 'other', interfaces: arr(m.interfaces), x: num(m.x, 0.5), y: num(m.y, 0.5), rot: num(m.rot), scale: num(m.scale, 1), z: Math.floor(num(m.z, 1)), offsets: m.offsets || {} }));
    if (w.integral) w.integral = { capacity: Math.max(1, Math.floor(num(w.integral.capacity, 1))), label: w.integral.label || 'Internal magazine' };
    if (!w.integral && w.kind === 'ranged' && w.magFamilies.length && !w.mounts.some(m => m.slot === 'magazine')) {
      w.mounts.unshift({ id: 'magwell', label: 'Magazine well', slot: 'magazine', interfaces: w.magFamilies.slice(), x: 0.45, y: 0.7, rot: 0, scale: 1, z: 0, offsets: {} });
    }
  }
  if (d.magazine) {
    d.magazine.capacity = Math.max(1, Math.floor(num(d.magazine.capacity, 1)));
    d.magazine.calibers = arr(d.magazine.calibers).map(String);
    d.magazine.family = String(d.magazine.family || '');
    d.magazine.clip = !!d.magazine.clip || d.sub === 'Stripper Clips'; // loads an internal magazine, then is put away
  }
  if (d.ammo) d.ammo.caliber = String(d.ammo.caliber || '');
  if (d.attachment) {
    d.attachment.slot = ATTACHMENT_SLOTS[d.attachment.slot] ? d.attachment.slot : 'other';
    d.attachment.interfaces = arr(d.attachment.interfaces);
    d.attachment.mods = d.attachment.mods || {};
    d.attachment.extend = d.attachment.extend || { w: 0, h: 0 };
    d.attachment.weapons = arr(d.attachment.weapons); // optional explicit weapon-def whitelist
  }
  if (d.armor) {
    d.armor.dr = num(d.armor.dr);
    d.armor.locations = arr(d.armor.locations).filter(l => ARMOR_LOCATIONS.includes(l));
    if (d.armor.drByType && typeof d.armor.drByType !== 'object') delete d.armor.drByType;
  }
  if (d.container) {
    d.container.grids = arr(d.container.grids).map((g, i) => ({ id: g.id || 'g' + i, label: g.label || '', w: Math.max(1, Math.floor(num(g.w, 1))), h: Math.max(1, Math.floor(num(g.h, 1))), compartments: arr(g.compartments), accepts: arr(g.accepts) }));
  }
  return d;
}

/** Default equipment slots for a definition. */
function slotsFor(def) {
  if (def.slots && def.slots.length) return [...new Set([...def.slots, 'hands', 'ready'])];
  const out = [];
  for (const [slot, rule] of Object.entries(EQUIP_SLOTS)) {
    if (!rule.categories) { out.push(slot); continue; } // anything can be held in hands
    if (!rule.categories.includes(def.category)) continue;
    if (rule.subs && !rule.subs.includes(def.sub)) continue;
    if (def.category === 'weapon' && (slot === 'primary' || slot === 'secondary') && def.sub === 'Melee Weapons') continue;
    out.push(slot);
  }
  return out;
}

/** Ammunition `ammoDef` can be loaded into magazine `magDef`. */
function ammoFitsMagazine(ammoDef, magDef) {
  return !!(ammoDef?.ammo && magDef?.magazine && magDef.magazine.calibers.includes(ammoDef.ammo.caliber));
}

/** Ammunition can be fired by weapon (explicit weapon calibers, plus optional per-ammo whitelist). */
function ammoFitsWeapon(ammoDef, weaponDef) {
  if (!ammoDef?.ammo || !weaponDef?.weapon) return false;
  if (!weaponDef.weapon.calibers.includes(ammoDef.ammo.caliber)) return false;
  const only = arr(ammoDef.ammo.onlyWeapons);
  return !only.length || only.includes(weaponDef.id);
}

/** Magazine family is accepted by the weapon. */
function magazineFitsWeapon(magDef, weaponDef) {
  return !!(magDef?.magazine && !magDef.magazine.clip && weaponDef?.weapon && !weaponDef.weapon.integral && weaponDef.weapon.magFamilies.includes(magDef.magazine.family));
}

/** Stripper clip loads this weapon's internal magazine (clip family listed in the weapon's families). */
function clipFitsWeapon(clipDef, weaponDef) {
  return !!(clipDef?.magazine?.clip && weaponDef?.weapon?.integral && weaponDef.weapon.magFamilies.includes(clipDef.magazine.family)
    && clipDef.magazine.calibers.some(c => weaponDef.weapon.calibers.includes(c)));
}

/** Attachment fits a specific weapon mount. */
function attachmentFitsMount(attDef, mount, weaponDef) {
  if (!attDef?.attachment || !mount) return false;
  if (attDef.attachment.slot !== mount.slot) return false;
  if (attDef.attachment.weapons.length && !attDef.attachment.weapons.includes(weaponDef.id)) return false;
  if (!mount.interfaces.length || !attDef.attachment.interfaces.length) return false;
  return attDef.attachment.interfaces.some(i => mount.interfaces.includes(i));
}

/** Which ammunition definitions fit a magazine/weapon definition. */
function compatibleAmmo(defs, holderDef) {
  return Object.values(defs).filter(a => a.ammo && (holderDef.magazine ? ammoFitsMagazine(a, holderDef) : ammoFitsWeapon(a, holderDef)));
}

module.exports = { CATEGORIES, RARITY, EQUIP_SLOTS, ATTACHMENT_SLOTS, ARMOR_LOCATIONS, caliberKey, normalizeDef, slotsFor, ammoFitsMagazine, ammoFitsWeapon, magazineFitsWeapon, clipFitsWeapon, attachmentFitsMount, compatibleAmmo, num, arr };
