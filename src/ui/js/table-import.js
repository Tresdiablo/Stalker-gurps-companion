// Paste a spreadsheet (Excel, Google Sheets, CSV) into the Item Catalog. The first row names the
// columns; names are matched loosely ("Dmg", "Damage", "damage" all work). Each row becomes a
// catalog definition with its behaviour filled from the columns present. Rows whose name matches
// an existing item update that item instead of adding a copy.
import { SUB_SKILL } from './idfields.js';

const SUBS = { weapon: ['Pistols', 'Revolvers', 'Submachine Guns', 'Shotguns', 'Assault Rifles', 'Battle Rifles', 'Marksman Rifles', 'Sniper Rifles', 'Rifles', 'Machine Guns', 'Launchers', 'Melee Weapons', 'Thrown'], armor: ['Body Armor', 'Helmets', 'Masks', 'Suits', 'Clothing'], equipment: ['Tactical Rigs', 'Backpacks', 'Tools', 'Electronics', 'Detectors', 'Lights', 'Food & Drink'], medical: ['Bandages', 'Medkits', 'Drugs', 'Anti-radiation', 'Stimulants'], material: ['Parts', 'Chemicals', 'Mutant Parts', 'Repair'], artifact: ['Gravitational', 'Chemical', 'Fire', 'Electrical', 'Miscellaneous'], ammo: ['Pistol', 'Rifle', 'Shotgun', 'Grenades'], magazine: ['SMG', 'Stripper Clips'], container: ['Pouches', 'Cases', 'Storage'], attachment: ['Optics', 'Muzzle Devices', 'Foregrips', 'Stocks', 'Tactical Devices', 'Underbarrel'], misc: ['Valuables', 'Documents', 'Keys', 'Junk'] };
const CAT_WORDS = { weapon: ['weapon', 'weapons', 'gun', 'guns', 'firearm', 'firearms', 'melee'], armor: ['armor', 'armour', 'clothing'], equipment: ['equipment', 'gear', 'tool', 'tools'], medical: ['medical', 'medicine', 'meds', 'med'], material: ['material', 'materials', 'crafting'], artifact: ['artifact', 'artifacts', 'artefact'], ammo: ['ammo', 'ammunition', 'rounds', 'cartridge'], magazine: ['magazine', 'magazines', 'mag', 'mags', 'clip', 'clips'], container: ['container', 'containers', 'case', 'pouch'], attachment: ['attachment', 'attachments', 'mod', 'mods'], misc: ['misc', 'miscellaneous', 'other', 'junk', 'valuables'] };

/** Column name → field. */
const ALIASES = {
  name: ['name', 'item', 'itemname', 'title'], id: ['id', 'itemid'],
  category: ['category', 'cat', 'class'], sub: ['sub', 'subcategory', 'type', 'kind', 'weapontype', 'group'],
  weight: ['weight', 'wt', 'kg', 'weightkg', 'mass'], value: ['value', 'price', 'cost', 'rub', 'roubles', 'rubles', '₽'],
  size: ['size', 'grid', 'cells', 'gridsize'], w: ['w', 'width'], h: ['h', 'height'], stack: ['stack', 'stacksize', 'maxstack'],
  tier: ['tier'], rarity: ['rarity'], description: ['description', 'desc', 'notes', 'note', 'text'], tags: ['tags', 'tag'],
  damage: ['damage', 'dmg'], acc: ['acc', 'accuracy'], range: ['range', 'halfdmax', '½d/max', '1/2d/max', 'halfd/max'], rof: ['rof', 'rateoffire'],
  shots: ['shots'], bulk: ['bulk'], rcl: ['rcl', 'recoil'], st: ['st', 'minst', 'strength'], skill: ['skill'],
  reach: ['reach'], parry: ['parry'], caliber: ['caliber', 'calibre', 'calibers', 'cal', 'cartridge', 'ammotype'],
  family: ['family', 'magfamily', 'magazinefamily', 'magazines', 'mag', 'mags', 'magazine', 'clipfamily'],
  capacity: ['capacity', 'cap', 'rounds', 'magsize'], internal: ['internal', 'integral', 'internalmagazine', 'tube', 'feed'],
  label: ['load', 'ammoload', 'loadtype'], divisor: ['divisor', 'armordivisor', 'ad', 'armourdivisor'], projectiles: ['projectiles', 'pellets'],
  dr: ['dr', 'damageresistance'], locations: ['locations', 'location', 'covers', 'coverage', 'protects'],
  heal: ['heal', 'heals', 'hp', 'healing'], fp: ['fp'], cures: ['cures', 'removes'], usetime: ['seconds', 'usetime', 'time'],
  slot: ['slot', 'mountslot', 'mount'], interfaces: ['interfaces', 'interface', 'rail', 'fits'], radiation: ['radiation', 'rad', 'rads'], effects: ['effects', 'effect'],
};
const norm = s => String(s || '').toLowerCase().replace(/[\s_\-.()]/g, '');
const FIELD = Object.fromEntries(Object.entries(ALIASES).flatMap(([f, list]) => list.map(a => [norm(a), f])));

/** Split pasted text into rows of cells (tab, semicolon or comma separated; quotes respected). */
export function parseTable(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const head = lines[0];
  const sep = head.includes('\t') ? '\t' : (head.split(';').length > head.split(',').length ? ';' : ',');
  const split = line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"' && !cur.trim()) q = true;
      else if (ch === sep) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  return lines.map(split);
}

export const caliberKey = t => String(t || '').toLowerCase().replace(/×/g, 'x').replace(/\s+/g, '').replace(/(\d)mm/g, '$1').replace(/[()]/g, '').replace(/tokarev/, 'tok').replace(/magnum/, 'mag');
const list = s => String(s || '').split(/[,;|]/).map(x => x.trim()).filter(Boolean);
const words = s => String(s || '').split(/[,;/|]/).map(x => x.trim()).filter(Boolean); // for plain words (locations), never calibers like 12/70
const numOr = (x, d) => { const n = Number(String(x ?? '').replace(/[^\d.\-]/g, '')); return x === undefined || x === '' || !Number.isFinite(n) ? d : n; };
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

function guessCategory(r) {
  const c = norm(r.category);
  if (c) for (const [k, words] of Object.entries(CAT_WORDS)) if (words.map(norm).includes(c) || norm(k) === c) return k;
  const sub = norm(r.sub);
  if (sub) for (const [k, subs] of Object.entries(SUBS)) if (subs.some(x => norm(x) === sub)) return k;
  if (/clip/i.test(r.sub || r.name || '') && r.capacity) return 'magazine';
  if (r.damage || r.rof || r.shots) return 'weapon';
  if (r.capacity && r.family) return 'magazine';
  if (r.caliber && !r.damage) return 'ammo';
  if (r.dr) return 'armor';
  if (r.heal) return 'medical';
  return 'misc';
}
function matchSub(category, sub) {
  if (!sub) return '';
  const all = [...(SUBS[category] || []), ...Object.values(SUBS).flat()];
  return all.find(x => norm(x) === norm(sub)) || all.find(x => norm(x).startsWith(norm(sub)) || norm(sub).startsWith(norm(x).replace(/s$/, ''))) || sub;
}

/**
 * Turn table rows into catalog definitions. `existing` (name → id) makes rows update items with
 * the same name. Returns { defs, problems, columns: { used, ignored } }.
 */
export function rowsToDefs(rows, existing = {}) {
  if (rows.length < 2) return { defs: [], problems: ['Paste a header row and at least one item row.'], columns: { used: [], ignored: [] } };
  const header = rows[0].map(h => FIELD[norm(h)] || null);
  const used = rows[0].filter((h, i) => header[i]), ignored = rows[0].filter((h, i) => !header[i] && h);
  if (!header.includes('name')) return { defs: [], problems: ['No "Name" column found in the first row.'], columns: { used, ignored } };
  const defs = [], problems = [];
  rows.slice(1).forEach((cells, n) => {
    const r = {};
    header.forEach((f, i) => { if (f && cells[i] !== undefined && cells[i] !== '') r[f] = cells[i]; });
    if (!r.name) return;
    const category = guessCategory(r);
    const sub = matchSub(category, r.sub);
    let [w, h] = [numOr(r.w, 0), numOr(r.h, 0)];
    if ((!w || !h) && r.size) { const m = String(r.size).match(/(\d+)\s*[x×*]\s*(\d+)/i); if (m) { w = Number(m[1]); h = Number(m[2]); } }
    const d = {
      id: r.id || existing[r.name.toLowerCase()] || 'item-' + slug(r.name), name: r.name, category, sub,
      w: w || 1, h: h || 1, weight: numOr(r.weight, 0), value: numOr(r.value, 0), stack: numOr(r.stack, category === 'ammo' ? 60 : 1), tier: numOr(r.tier, 1),
      rarity: ['common', 'uncommon', 'rare', 'very rare', 'unique'].includes(String(r.rarity || '').toLowerCase()) ? String(r.rarity).toLowerCase() : 'common',
      description: r.description || '', tags: r.tags ? list(r.tags) : [],
    };
    const cals = r.caliber ? list(r.caliber).map(caliberKey) : [];
    if (category === 'weapon') {
      const melee = sub === 'Melee Weapons' || (!r.rof && !r.shots && !r.caliber && (r.reach || r.parry || /sw|thr/.test(r.damage || '')));
      const internalCap = /^(y|yes|true|1|internal|tube|integral)$/i.test(r.internal || '') ? numOr(r.capacity, numOr(String(r.shots || '').split(/[+(]/)[0], 1)) : null;
      d.weapon = melee
        ? { kind: 'melee', skill: r.skill || SUB_SKILL[sub] || 'Knife', damage: r.damage || 'sw cut', reach: r.reach || 'C', parry: r.parry || '0', minST: numOr(r.st, 10) }
        : { kind: 'ranged', skill: r.skill || SUB_SKILL[sub] || 'Guns (Rifle)', damage: r.damage || '', acc: numOr(r.acc, 0), range: r.range || '', rof: r.rof || '1', shots: r.shots || '', bulk: numOr(r.bulk, -4), rcl: numOr(r.rcl, 2), minST: numOr(String(r.st || '').replace(/[†B]/g, ''), 10), calibers: cals, magFamilies: r.family ? list(r.family) : [], integral: internalCap ? { capacity: internalCap } : null, mounts: [] };
      if (!melee && !d.weapon.damage) problems.push(`Row ${n + 2} (${r.name}): no damage given.`);
      if (!melee && !cals.length) problems.push(`Row ${n + 2} (${r.name}): no caliber — no ammunition will fit until you set one.`);
    }
    if (category === 'magazine') {
      const clip = /clip/i.test(`${sub} ${r.name}`);
      d.magazine = { family: r.family ? list(r.family)[0] : slug(r.name), capacity: numOr(r.capacity, 10), calibers: cals, clip };
      if (clip && !sub) d.sub = 'Stripper Clips';
      if (!cals.length) problems.push(`Row ${n + 2} (${r.name}): magazine without a caliber.`);
    }
    if (category === 'ammo') {
      d.ammo = { caliber: cals[0] || '', label: r.label || (/\bhp\b/i.test(r.name) ? 'HP' : /\bap\b/i.test(r.name) ? 'AP' : /buck/i.test(r.name) ? 'Buckshot' : /slug/i.test(r.name) ? 'Slug' : 'FMJ') };
      if (r.divisor) d.ammo.divisor = numOr(r.divisor, 1);
      if (r.damage) d.ammo.damage = r.damage;
      if (r.projectiles) d.ammo.projectiles = numOr(r.projectiles, 1);
      if (!cals.length) problems.push(`Row ${n + 2} (${r.name}): ammunition without a caliber.`);
    }
    if (category === 'armor') d.armor = { dr: numOr(r.dr, 1), locations: r.locations ? words(r.locations).map(x => x.toLowerCase()) : ['torso', 'vitals'] };
    if (category === 'medical' || r.heal || r.cures) d.consumable = { heal: r.heal || 0, ...(r.fp ? { fp: numOr(r.fp, 0) } : {}), ...(r.skill ? { skill: r.skill } : {}), ...(r.cures ? { cures: list(r.cures) } : {}), ...(r.usetime ? { seconds: numOr(r.usetime, 1) } : {}) };
    if (category === 'attachment') d.attachment = { slot: String(r.slot || (/optic|scope|sight/i.test(`${sub} ${r.name}`) ? 'optic' : /suppress|muzzle|brake/i.test(`${sub} ${r.name}`) ? 'muzzle' : /grip/i.test(`${sub} ${r.name}`) ? 'foregrip' : /stock/i.test(`${sub} ${r.name}`) ? 'stock' : 'side')).toLowerCase(), interfaces: r.interfaces ? list(r.interfaces) : ['picatinny'], mods: {}, extend: { w: 0, h: 0 } };
    if (category === 'artifact') d.artifact = { effects: r.effects ? list(r.effects) : [], radiation: numOr(r.radiation, 0) };
    defs.push(d);
  });
  return { defs, problems, columns: { used, ignored } };
}
