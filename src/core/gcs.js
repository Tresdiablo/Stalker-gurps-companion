'use strict';
/**
 * Reader for native GURPS Character Sheet (GCS) files (.gcs, data version 2–5).
 *
 * GCS is authoritative for character-build data. Every value used here is the value GCS itself
 * calculated and saved into the file (`calc` blocks): attribute values, skill levels, relative
 * skill levels, weapon levels and damage, encumbrance-adjusted Move/Dodge, hit-location DR.
 * Nothing is re-derived here except point subtotals for display.
 *
 * The file is never modified by the companion.
 */
const crypto = require('node:crypto');

const MAX_FILE_BYTES = 40 * 1024 * 1024;

function hashText(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

function walk(list, out = [], depth = 0, parent = null) {
  for (const node of Array.isArray(list) ? list : []) {
    if (!node || typeof node !== 'object') continue;
    out.push({ node, depth, parent });
    if (Array.isArray(node.children)) walk(node.children, out, depth + 1, node);
  }
  return out;
}

function toNum(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** "3 lb", "1.5 kg", "12 oz" -> kilograms */
function weightKg(text) {
  const s = String(text ?? '').trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([a-z]*)/i);
  if (!m) return 0;
  const n = Number(m[1]);
  const u = (m[2] || 'lb').toLowerCase();
  if (u === 'kg') return n;
  if (u === 'g') return n / 1000;
  if (u === 'oz') return n * 0.0283495;
  if (u === 't' || u === 'tn') return n * 907.185;
  return n * 0.45359237;
}

function attributeMap(doc) {
  const out = {};
  for (const a of Array.isArray(doc.attributes) ? doc.attributes : []) {
    if (!a || !a.attr_id) continue;
    out[a.attr_id] = { value: toNum(a.calc?.value), current: toNum(a.calc?.current), points: toNum(a.calc?.points) || 0, damage: toNum(a.damage) || 0 };
  }
  // Data versions before 4 stored primary attributes as top-level fields.
  for (const [k, id] of [['ST', 'st'], ['DX', 'dx'], ['IQ', 'iq'], ['HT', 'ht']]) {
    if (!out[id] && toNum(doc[id]) !== null) out[id] = { value: toNum(doc[id]), points: 0 };
    if (!out[id] && toNum(doc[k]) !== null) out[id] = { value: toNum(doc[k]), points: 0 };
  }
  return out;
}

function traitKind(t) {
  const tags = (t.tags || t.categories || []).map(x => String(x).toLowerCase());
  const pts = toNum(t.calc?.points) ?? toNum(t.base_points) ?? 0;
  if (tags.includes('quirk') || pts === -1) return 'quirk';
  if (tags.includes('perk') || pts === 1) return 'perk';
  if (tags.includes('disadvantage') || pts < 0) return 'disadvantage';
  if (tags.includes('feature') || pts === 0) return 'feature';
  return 'advantage';
}

function weaponFrom(w, ownerName, ownerId) {
  const melee = !!(w.reach || w.parry || w.block || w.type === 'melee_weapon') && !w.rate_of_fire && !w.accuracy;
  const c = w.calc || {};
  return {
    id: w.id || null,
    owner: ownerName,
    ownerId,
    usage: w.usage || '',
    kind: melee ? 'melee' : 'ranged',
    level: toNum(c.level) ?? toNum(w.calc_level) ?? null,
    damage: c.damage || (typeof w.damage === 'string' ? w.damage : ''),
    parry: c.parry || w.parry || '',
    block: c.block || w.block || '',
    reach: c.reach || w.reach || '',
    acc: c.accuracy || w.accuracy || '',
    range: c.range || w.range || '',
    rof: c.rate_of_fire || w.rate_of_fire || '',
    shots: c.shots || w.shots || '',
    bulk: c.bulk || w.bulk || '',
    rcl: c.recoil || w.recoil || '',
    minST: c.strength || w.strength || '',
    skill: (w.defaults || []).filter(x => x.type === 'skill').map(x => (x.name?.qualifier || x.name || '') + (x.specialization?.qualifier ? ` (${x.specialization.qualifier})` : '')).filter(Boolean)[0] || '',
  };
}

/** Natural DR from traits (dr_bonus features on traits; equipment DR is tracked by the companion). */
function naturalDR(traits) {
  const out = {};
  for (const { node } of traits) {
    if (node.disabled || node.type === 'trait_container') continue;
    const levels = toNum(node.calc?.current_level) ?? toNum(node.levels) ?? 1;
    for (const f of node.features || []) {
      if (f.type !== 'dr_bonus') continue;
      const amount = (toNum(f.amount) || 0) * (f.per_level ? levels : 1);
      const locs = f.locations || (f.location ? [f.location] : ['all']);
      for (const l of locs) out[l] = (out[l] || 0) + amount;
    }
  }
  return out;
}

/**
 * Parse GCS JSON text into a normalized character build.
 * Throws a descriptive Error on invalid input.
 */
function parseGcs(text, { fileName = '' } = {}) {
  if (typeof text !== 'string') text = String(text || '');
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('GCS file is too large.');
  let doc;
  try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw new Error(`Not a valid GCS file (JSON error: ${e.message}).`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Not a GCS character file.');
  const version = toNum(doc.version) ?? toNum(doc.data_version);
  if (doc.type && !['character', 'gcs'].includes(doc.type)) throw new Error(`This GCS document is a "${doc.type}", not a character.`);
  if (!doc.profile && !doc.attributes && !doc.skills && !doc.traits && !doc.advantages) throw new Error('This file has no character data.');
  if (version !== null && version > 5) throw new Error(`GCS data version ${version} is newer than this companion understands (5). Update the companion.`);

  const attrs = attributeMap(doc);
  const get = (id, fallback = null) => attrs[id]?.value ?? fallback;
  const calc = doc.calc || {};
  const traitNodes = walk(doc.traits || doc.advantages || []);
  const skillNodes = walk(doc.skills || []);
  const spellNodes = walk(doc.spells || []);
  const equipNodes = walk(doc.equipment || []);
  const otherEquip = walk(doc.other_equipment || []);
  const warnings = [];

  const skills = [];
  for (const { node } of skillNodes) {
    if (node.type === 'skill_container' || (Array.isArray(node.children) && !node.difficulty)) continue;
    const level = toNum(node.calc?.level) ?? toNum(node.level);
    if (level === null) warnings.push(`Skill "${node.name}" has no level saved by GCS; open and re-save the file in GCS.`);
    skills.push({
      id: node.id || null,
      name: node.name || '',
      spec: node.specialization || '',
      technique: node.type === 'technique' || !!node.default,
      level,
      rsl: node.calc?.rsl || '',
      points: toNum(node.points) || 0,
      difficulty: node.difficulty || '',
      tags: node.tags || node.categories || [],
      reference: node.reference || '',
      notes: node.notes || node.local_notes || '',
    });
  }
  const spells = [];
  for (const { node } of spellNodes) {
    if (node.type === 'spell_container' || Array.isArray(node.children)) continue;
    spells.push({ id: node.id || null, name: node.name || '', level: toNum(node.calc?.level), rsl: node.calc?.rsl || '', points: toNum(node.points) || 0, college: node.college || [] });
  }

  const traits = [];
  for (const { node, depth } of traitNodes) {
    const container = node.type === 'trait_container' || node.type === 'advantage_container' || (Array.isArray(node.children) && node.children.length && node.base_points === undefined);
    traits.push({ id: node.id || null, name: node.name || '', container, depth, kind: container ? 'group' : traitKind(node), points: toNum(node.calc?.points) ?? toNum(node.base_points) ?? 0, level: toNum(node.calc?.current_level) ?? toNum(node.levels), disabled: !!node.disabled, notes: node.notes || node.local_notes || node.userdesc || '', reference: node.reference || '', tags: node.tags || [] });
  }

  const weapons = [];
  for (const { node } of traitNodes) for (const w of node.weapons || []) weapons.push(weaponFrom(w, node.name, node.id));
  for (const { node } of equipNodes) if (node.equipped !== false) for (const w of node.weapons || []) weapons.push(weaponFrom(w, node.description || node.name, node.id));

  const equipment = equipNodes.map(({ node, depth }) => ({ id: node.id || null, name: node.description || node.name || '', depth, qty: toNum(node.quantity) ?? 1, equipped: node.equipped !== false, weightKg: weightKg(node.calc?.extended_weight || node.weight || node.base_weight), value: toNum(node.calc?.extended_value) ?? toNum(node.value) ?? 0, notes: node.notes || '' }));
  const other = otherEquip.map(({ node, depth }) => ({ id: node.id || null, name: node.description || node.name || '', depth, qty: toNum(node.quantity) ?? 1, weightKg: weightKg(node.calc?.extended_weight || node.weight), notes: node.notes || '' }));

  const sum = arr => arr.reduce((a, b) => a + (b || 0), 0);
  const attrPoints = sum(Object.values(attrs).map(a => a.points));
  const traitTop = traitNodes.filter(t => t.depth === 0).map(t => toNum(t.node.calc?.points) ?? toNum(t.node.base_points) ?? 0);
  const advPoints = sum(traits.filter(t => !t.container && t.kind === 'advantage' && !t.disabled).map(t => t.points));
  const disPoints = sum(traits.filter(t => !t.container && (t.kind === 'disadvantage') && !t.disabled).map(t => t.points));
  const quirkPoints = sum(traits.filter(t => !t.container && t.kind === 'quirk' && !t.disabled).map(t => t.points));
  const perkPoints = sum(traits.filter(t => !t.container && t.kind === 'perk' && !t.disabled).map(t => t.points));
  const skillPoints = sum(skills.map(s => s.points));
  const spellPoints = sum(spells.map(s => s.points));
  const spent = attrPoints + sum(traitTop) + skillPoints + spellPoints;
  const total = toNum(doc.total_points) ?? null;

  const hitLocations = [];
  for (const loc of doc.settings?.body_type?.locations || []) {
    hitLocations.push({ id: loc.id, name: loc.choice_name || loc.table_name || loc.id, penalty: toNum(loc.hit_penalty) || 0, roll: loc.calc?.roll_range || '', dr: loc.calc?.dr || {}, drBonus: toNum(loc.dr_bonus) || 0 });
  }

  const hpMax = get('hp', get('st', 10));
  const fpMax = get('fp', get('ht', 10));
  const hpCurrent = attrs.hp?.current ?? (hpMax !== null ? hpMax - (attrs.hp?.damage || 0) : null);
  const fpCurrent = attrs.fp?.current ?? (fpMax !== null ? fpMax - (attrs.fp?.damage || 0) : null);

  const p = doc.profile || {};
  const build = {
    source: 'gcs',
    gcsVersion: version,
    gcsId: doc.id || null,
    fileName,
    name: p.name || doc.name || '',
    profile: { name: p.name || '', player: p.player_name || '', title: p.title || '', organization: p.organization || '', age: p.age || '', height: p.height || '', weight: p.weight || '', gender: p.gender || '', techLevel: p.tech_level || '', religion: p.religion || '', handedness: p.handedness || '', hair: p.hair || '', eyes: p.eyes || '', skin: p.skin || '' },
    portrait: typeof p.portrait === 'string' && p.portrait.length < 8 * 1024 * 1024 ? p.portrait : null,
    attributes: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, v.value])),
    attributePoints: Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k, v.points])),
    st: get('st', 10), dx: get('dx', 10), iq: get('iq', 10), ht: get('ht', 10),
    hp: hpMax, fp: fpMax, will: get('will', get('iq', 10)), per: get('per', get('iq', 10)),
    basicSpeed: get('basic_speed'), basicMove: get('basic_move'),
    dodge: Array.isArray(calc.dodge) ? calc.dodge[0] : null,
    dodgeByEncumbrance: Array.isArray(calc.dodge) ? calc.dodge : null,
    moveByEncumbrance: Array.isArray(calc.move) ? calc.move : null,
    thrust: calc.thrust || null, swing: calc.swing || null,
    basicLiftKg: calc.basic_lift ? weightKg(calc.basic_lift) : null,
    parryBonus: toNum(calc.parry_bonus) || 0, blockBonus: toNum(calc.block_bonus) || 0, dodgeBonus: toNum(calc.dodge_bonus) || 0,
    gcsCurrent: { hp: hpCurrent, fp: fpCurrent },
    skills, spells, traits, weapons, equipment, otherEquipment: other,
    notes: walk(doc.notes || []).map(({ node }) => node.text || node.markdown || '').filter(Boolean),
    points: { total, spent, unspent: total !== null ? total - spent : null, attributes: attrPoints, advantages: advPoints, disadvantages: disPoints, quirks: quirkPoints, perks: perkPoints, skills: skillPoints, spells: spellPoints },
    hitLocations,
    naturalDR: naturalDR(traitNodes),
    flags: {
      highPainThreshold: traits.some(t => !t.disabled && /^high pain threshold/i.test(t.name)),
      lowPainThreshold: traits.some(t => !t.disabled && /^low pain threshold/i.test(t.name)),
      combatReflexes: traits.some(t => !t.disabled && /^combat reflexes/i.test(t.name)),
      hardToKill: traits.find(t => !t.disabled && /^hard to kill/i.test(t.name))?.level || 0,
    },
    warnings,
  };
  return { build, hash: hashText(text) };
}

/** Summarize differences between two builds (for the sync report / conflict review). */
function diffBuilds(a, b) {
  const changes = [];
  if (!a) return [{ field: 'character', from: null, to: 'imported' }];
  for (const k of ['st', 'dx', 'iq', 'ht', 'hp', 'fp', 'will', 'per', 'basicSpeed', 'basicMove', 'dodge']) {
    if (a[k] !== b[k]) changes.push({ field: k, from: a[k], to: b[k] });
  }
  const key = s => `${s.name}${s.spec ? ` (${s.spec})` : ''}`;
  const am = new Map(a.skills.map(s => [key(s), s.level]));
  const bm = new Map(b.skills.map(s => [key(s), s.level]));
  for (const [k, v] of bm) if (am.get(k) !== v) changes.push({ field: `skill:${k}`, from: am.has(k) ? am.get(k) : null, to: v });
  for (const [k, v] of am) if (!bm.has(k)) changes.push({ field: `skill:${k}`, from: v, to: null });
  const at = new Set(a.traits.filter(t => !t.container).map(t => t.name));
  const bt = new Set(b.traits.filter(t => !t.container).map(t => t.name));
  for (const t of bt) if (!at.has(t)) changes.push({ field: `trait:${t}`, from: null, to: 'added' });
  for (const t of at) if (!bt.has(t)) changes.push({ field: `trait:${t}`, from: 'present', to: null });
  if ((a.points?.total) !== (b.points?.total)) changes.push({ field: 'points', from: a.points?.total, to: b.points?.total });
  return changes;
}

module.exports = { parseGcs, diffBuilds, weightKg, hashText, MAX_FILE_BYTES };
