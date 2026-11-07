// Item Editor inputs with drop-downs of ids already used in the catalog. Each field only offers
// ids of its own kind (calibers in a caliber field, interfaces in an interface field, ...), and the
// ones that match the item being edited come first (e.g. magazine families that take the
// weapon's calibers). Anything new can still be typed: Enter or comma adds it.
import { html, useState, useRef, tipProps } from './ui.js';

/* --------------------------------------------------------------------- GURPS skills */
export const WEAPON_SKILLS = {
  Guns: ['Guns (Pistol)', 'Guns (Rifle)', 'Guns (Shotgun)', 'Guns (SMG)', 'Guns (LMG)', 'Guns (Grenade Launcher)', 'Guns (Gyroc)', 'Guns (Musket)', 'Gunner (Machine Gun)', 'Gunner (Cannon)', 'Gunner (Rockets)', 'Gunner (Catapult)', 'Liquid Projector (Flamethrower)', 'Liquid Projector (Sprayer)', 'Liquid Projector (Water Cannon)', 'Artillery (Cannon)', 'Beam Weapons (Pistol)', 'Beam Weapons (Rifle)'],
  'Bows & thrown': ['Bow', 'Crossbow', 'Sling', 'Blowpipe', 'Bolas', 'Lasso', 'Net', 'Spear Thrower', 'Throwing', 'Dropping', 'Thrown Weapon (Axe/Mace)', 'Thrown Weapon (Dart)', 'Thrown Weapon (Harpoon)', 'Thrown Weapon (Knife)', 'Thrown Weapon (Shuriken)', 'Thrown Weapon (Spear)', 'Thrown Weapon (Stick)'],
  Melee: ['Knife', 'Axe/Mace', 'Broadsword', 'Shortsword', 'Smallsword', 'Rapier', 'Saber', 'Main-Gauche', 'Jitte/Sai', 'Tonfa', 'Spear', 'Staff', 'Polearm', 'Flail', 'Kusari', 'Whip', 'Two-Handed Axe/Mace', 'Two-Handed Flail', 'Two-Handed Sword', 'Garrote', 'Force Sword', 'Force Whip', 'Lance'],
  Unarmed: ['Brawling', 'Boxing', 'Karate', 'Judo', 'Wrestling', 'Sumo Wrestling'],
};
export const MEDICAL_SKILLS = ['First Aid', 'Physician', 'Surgery', 'Pharmacy', 'Diagnosis', 'Esoteric Medicine', 'Veterinary', 'HT'];

/** The weapon skill that goes with a subcategory (filled in automatically). */
export const SUB_SKILL = {
  Pistols: 'Guns (Pistol)', Revolvers: 'Guns (Pistol)', 'Submachine Guns': 'Guns (SMG)', Shotguns: 'Guns (Shotgun)',
  'Assault Rifles': 'Guns (Rifle)', 'Battle Rifles': 'Guns (Rifle)', 'Marksman Rifles': 'Guns (Rifle)', 'Sniper Rifles': 'Guns (Rifle)', Rifles: 'Guns (Rifle)',
  'Machine Guns': 'Guns (LMG)', Launchers: 'Guns (Grenade Launcher)', 'Melee Weapons': 'Knife', Thrown: 'Throwing',
};
const AUTO_SKILLS = new Set(Object.values(SUB_SKILL));
/**
 * Apply a new subcategory to a definition: when it is a weapon and its skill is empty or was set
 * automatically, use the skill for the new subcategory (melee subcategories also switch the kind).
 */
export function withSub(d, sub) {
  const out = { ...d, sub };
  if (out.category === 'weapon' && out.weapon && SUB_SKILL[sub] && (!out.weapon.skill || AUTO_SKILLS.has(out.weapon.skill))) {
    out.weapon = { ...out.weapon, skill: SUB_SKILL[sub], kind: sub === 'Melee Weapons' ? 'melee' : sub === 'Thrown' ? out.weapon.kind : 'ranged' };
  }
  return out;
}

/* --------------------------------------------------------------------- id pools */
const uniq = a => [...new Set(a.filter(Boolean).map(String))].sort((x, y) => x.localeCompare(y));
const asList = x => Array.isArray(x) ? x : String(x || '').split(',').map(s => s.trim()).filter(Boolean);

/** Suggestions for an id field: [{ value, label?, group }]. `d` is the item being edited. */
export function idOptions(v, kind, d) {
  const defs = Object.values(v.defs).filter(x => x.id !== d.id);
  const opt = (values, group, label = x => x) => values.map(x => ({ value: x, label: label(x), group }));
  const split = (all, preferred, groupYes, groupNo, label) => [...opt(all.filter(x => preferred.has(x)), groupYes, label), ...opt(all.filter(x => !preferred.has(x)), groupNo, label)];
  switch (kind) {
    case 'caliber': {
      const all = uniq(defs.flatMap(x => [...(x.weapon?.calibers || []), ...(x.magazine?.calibers || []), x.ammo?.caliber]));
      return opt(all, 'Calibers in the catalog');
    }
    case 'magFamily': { // for a weapon: families of magazines that take its calibers first
      const cals = new Set(asList(d.weapon?.calibers));
      const fams = defs.filter(x => x.magazine);
      const all = uniq([...fams.map(x => x.magazine.family), ...defs.flatMap(x => x.weapon?.magFamilies || [])]);
      const pref = new Set(fams.filter(x => x.magazine.calibers.some(c => cals.has(c))).map(x => x.magazine.family));
      const names = f => { const n = fams.filter(x => x.magazine.family === f).map(x => x.name); return n.length ? `${f} — ${n.slice(0, 2).join(', ')}${n.length > 2 ? '…' : ''}` : f; };
      return cals.size ? split(all, pref, `Takes ${[...cals].join(', ')}`, 'Other families', names) : opt(all, 'Magazine families', names);
    }
    case 'family': { // for a magazine/clip: families of weapons that fire its calibers first
      const cals = new Set(asList(d.magazine?.calibers));
      const ws = defs.filter(x => x.weapon);
      const all = uniq([...ws.flatMap(x => x.weapon.magFamilies || []), ...defs.map(x => x.magazine?.family)]);
      const pref = new Set(ws.filter(x => x.weapon.calibers.some(c => cals.has(c))).flatMap(x => x.weapon.magFamilies));
      const names = f => { const n = ws.filter(x => x.weapon.magFamilies.includes(f)).map(x => x.name); return n.length ? `${f} — ${n.slice(0, 3).join(', ')}${n.length > 3 ? '…' : ''}` : f; };
      return cals.size ? split(all, pref, `Weapons that fire ${[...cals].join(', ')}`, 'Other families', names) : opt(all, 'Families', names);
    }
    case 'interface': { // for an attachment: interfaces of mounts of the same category first
      const slot = d.attachment?.slot;
      const mounts = defs.flatMap(x => x.weapon?.mounts || []);
      const all = uniq([...mounts.flatMap(m => m.interfaces || []), ...defs.flatMap(x => x.attachment?.interfaces || []), 'picatinny']);
      const pref = new Set(mounts.filter(m => m.slot === slot).flatMap(m => m.interfaces || []));
      return slot ? split(all, pref, `Used by ${slot} mounts`, 'Other interfaces') : opt(all, 'Interfaces');
    }
    case 'mountInterface': { // for a weapon mount (slot passed in d.__mountSlot)
      const slot = d.__mountSlot;
      const atts = defs.filter(x => x.attachment);
      const all = uniq([...atts.flatMap(x => x.attachment.interfaces), ...defs.flatMap(x => (x.weapon?.mounts || []).flatMap(m => m.interfaces || [])), 'picatinny']);
      const pref = new Set(atts.filter(x => x.attachment.slot === slot).flatMap(x => x.attachment.interfaces));
      return split(all, pref, `${slot} attachments use`, 'Other interfaces');
    }
    case 'attachWeapon': { // weapons with a matching mount first
      const slot = d.attachment?.slot, ifs = new Set(asList(d.attachment?.interfaces));
      const ws = defs.filter(x => x.weapon);
      const fits = new Set(ws.filter(x => (x.weapon.mounts || []).some(m => m.slot === slot && (m.interfaces || []).some(i => ifs.has(i)))).map(x => x.id));
      return split(ws.map(x => x.id), fits, 'Weapons with a matching mount', 'Other weapons', id => `${v.defs[id]?.name || id} (${id})`);
    }
    case 'ammoWeapon': { // weapons that fire this caliber first
      const cal = d.ammo?.caliber;
      const ws = defs.filter(x => x.weapon?.kind === 'ranged');
      const fits = new Set(ws.filter(x => x.weapon.calibers.includes(cal)).map(x => x.id));
      return split(ws.map(x => x.id), fits, cal ? `Fire ${cal}` : 'Weapons', 'Other weapons', id => `${v.defs[id]?.name || id} (${id})`);
    }
    case 'condition': {
      const base = ['Bleeding', 'Irradiated', 'Poisoned', 'Infected', 'Stunned', 'On Fire', 'Exhausted', 'Blinded', 'Knocked Down', 'Crippled Arm', 'Crippled Leg', 'Mortally Wounded'];
      return opt(uniq([...base, ...defs.flatMap(x => x.consumable?.cures || [])]), 'Conditions');
    }
    case 'tag': return opt(uniq(['gm-only', 'no-trade', ...defs.flatMap(x => x.tags || [])]), 'Tags');
    case 'category': return opt(['weapon', 'armor', 'equipment', 'medical', 'material', 'artifact', 'ammo', 'magazine', 'container', 'attachment', 'misc'], 'Categories');
    case 'weaponSkill': return [...Object.entries(WEAPON_SKILLS).flatMap(([g, l]) => opt(l, g)), ...opt(uniq(defs.map(x => x.weapon?.skill)).filter(sk => !Object.values(WEAPON_SKILLS).flat().includes(sk)), 'Used in this catalog')];
    case 'medicalSkill': return opt(uniq([...MEDICAL_SKILLS, ...defs.map(x => x.consumable?.skill)]), 'Skills');
    default: return [];
  }
}

/* --------------------------------------------------------------------- the inputs */
function Dropdown({ options, chosen, text, onPick }) {
  const q = text.trim().toLowerCase();
  const shown = options.filter(o => !chosen.includes(o.value) && (!q || `${o.value} ${o.label || ''}`.toLowerCase().includes(q))).slice(0, 60);
  if (!shown.length) return q ? html`<div class="id-drop"><div class="id-opt dim">Enter adds “${text.trim()}”</div></div>` : null;
  let last = null;
  return html`<div class="id-drop">${shown.map(o => {
    const head = o.group !== last ? html`<div class="id-group">${o.group}</div>` : null; last = o.group;
    return html`${head}<div class="id-opt" onMouseDown=${e => { e.preventDefault(); onPick(o.value); }}>${o.label || o.value}</div>`;
  })}</div>`;
}

/** Several ids (chips). `value` may be an array or a comma-separated string. */
export function TokenField({ label, value, onChange, options, tip, cls = '', placeholder = 'type or pick…' }) {
  const vals = asList(value);
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const inp = useRef();
  const add = x => { x = String(x).trim(); if (x && !vals.includes(x)) onChange([...vals, x]); setText(''); };
  return html`<label class="field id-field ${cls}" ...${tipProps(tip)} onClick=${() => inp.current?.focus()}>${label}
    <div class="id-box">${vals.map(x => html`<span class="id-chip">${x}<button type="button" onMouseDown=${e => { e.preventDefault(); onChange(vals.filter(y => y !== x)); }}>✕</button></span>`)}
      <input ref=${inp} value=${text} placeholder=${vals.length ? '' : placeholder} onFocus=${() => setOpen(true)} onBlur=${() => { setOpen(false); if (text.trim()) add(text); }}
        onInput=${e => { const t = e.target.value; if (t.endsWith(',')) add(t.slice(0, -1)); else setText(t); }}
        onKeyDown=${e => { if (e.key === 'Enter') { e.preventDefault(); add(text); } else if (e.key === 'Backspace' && !text && vals.length) onChange(vals.slice(0, -1)); else if (e.key === 'Escape') setOpen(false); }} /></div>
    ${open ? html`<${Dropdown} options=${options} chosen=${vals} text=${text} onPick=${add} />` : null}</label>`;
}

/** One id, free text allowed. */
export function PickField({ label, value, onChange, options, tip, cls = '', placeholder = 'type or pick…' }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState(false); // filter only after typing; on focus show everything
  return html`<label class="field id-field ${cls}" ...${tipProps(tip)}>${label}
    <div class="id-box single"><input value=${value ?? ''} placeholder=${placeholder} onFocus=${() => { setOpen(true); setFilter(false); }} onBlur=${() => setOpen(false)}
      onInput=${e => { onChange(e.target.value); setFilter(true); setOpen(true); }} onKeyDown=${e => { if (e.key === 'Escape' || e.key === 'Enter') setOpen(false); }} /><span class="id-caret">▾</span></div>
    ${open ? html`<${Dropdown} options=${options} chosen=${[]} text=${filter ? value || '' : ''} onPick=${x => { onChange(x); setOpen(false); }} />` : null}</label>`;
}
