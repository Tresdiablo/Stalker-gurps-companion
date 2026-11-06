'use strict';
/**
 * Characters (player characters and NPCs).
 *
 * build   — character-build data. Owned by GCS when `build.source === 'gcs'` (read-only here);
 *           otherwise a simple manual build used for quick NPCs.
 * session — campaign/session state owned by the companion: current HP/FP, conditions,
 *           injuries, posture, money. Re-importing a GCS file never resets session state.
 */
const { ActionError, assert } = require('./errors');
const rules = require('./rules');
const inv = require('./inventory');

const RANKS = ['Tourist', 'Rookie', 'Experienced', 'Professional', 'Veteran', 'Expert', 'Legend', 'Master'];

const CONDITIONS = ['Stunned', 'Knocked Down', 'Unconscious', 'Dead', 'Bleeding', 'Crippled Arm', 'Crippled Leg', 'Crippled Hand', 'Crippled Foot', 'Blinded', 'Irradiated', 'Poisoned', 'Infected', 'On Fire', 'Mortally Wounded', 'Exhausted', 'Afflicted'];

/** Attribute-based defaults for common skills (B173+). Missing skills fall back to these. */
const SKILL_DEFAULTS = {
  'guns': [['dx', -4]], 'beam weapons': [['dx', -4]], 'gunner': [['dx', -4]], 'liquid projector': [['dx', -4]],
  'throwing': [['dx', -3]], 'thrown weapon': [['dx', -4]], 'bow': [['dx', -5]], 'crossbow': [['dx', -4]],
  'knife': [['dx', -4]], 'brawling': [], 'boxing': [], 'wrestling': [], 'shortsword': [['dx', -5]], 'axe/mace': [['dx', -5]], 'spear': [['dx', -5]], 'broadsword': [['dx', -5]], 'staff': [['dx', -5]],
  'stealth': [['dx', -5], ['iq', -5]], 'observation': [['per', -5]], 'first aid': [['iq', -4]], 'lockpicking': [['iq', -5]],
  'survival': [['per', -5]], 'gambling': [['iq', -5]], 'merchant': [['iq', -5]], 'climbing': [['dx', -5]], 'swimming': [['ht', -4]],
  'running': [['ht', -5]], 'jumping': [], 'driving': [['dx', -5], ['iq', -5]], 'electronics repair': [['iq', -5]], 'armoury': [['iq', -5]],
  'mechanic': [['iq', -5]], 'scrounging': [['per', -4]], 'tracking': [['per', -5]], 'search': [['per', -5]], 'traps': [['iq', -5], ['dx', -5]],
  'fast-talk': [['iq', -5]], 'intimidation': [['will', -5]], 'diplomacy': [['iq', -6]], 'navigation': [['iq', -5]], 'physician': [['iq', -7]],
  'pharmacy': [['iq', -5]], 'tactics': [['iq', -6]], 'camouflage': [['iq', -4]], 'carousing': [['ht', -4]], 'streetwise': [['iq', -5]], 'hiking': [['ht', -5]],
  'interrogation': [['iq', -5]], 'detect lies': [['per', -6]], 'explosives': [['iq', -5]], 'acting': [['iq', -5]], 'holdout': [['iq', -5]], 'fast-draw': [],
  'chemistry': [['iq', -6]], 'naturalist': [['iq', -6]], 'hazardous materials': [['iq', -5]], 'forced entry': [['dx', 0]], 'urban survival': [['per', -5]],
};

function blankBuild(name = '') {
  return { source: 'manual', name, st: 10, dx: 10, iq: 10, ht: 10, hp: 10, fp: 10, will: 10, per: 10, basicSpeed: 5, basicMove: 5, dodge: 8, thrust: null, swing: null, skills: [], traits: [], weapons: [], equipment: [], notes: [], points: { total: null }, hitLocations: [], naturalDR: {}, flags: {}, profile: {}, attributes: {} };
}

function newCharacter(ctx, { kind = 'pc', name = 'New Character', build, ownerId = null, faction = '', rank = 1 } = {}) {
  const b = build || blankBuild(name);
  const hp = b.hp ?? 10, fp = b.fp ?? 10;
  return {
    id: ctx.uid(kind === 'npc' ? 'npc_' : 'pc_'),
    kind, name: name || b.name || 'Unnamed', nickname: '', faction, rank, ownerId,
    portrait: null,
    build: b,
    gcs: null, // { path, hash, importedAt, fileName, sync: 'auto'|'paused', pendingConflict }
    session: { hp: b.gcsCurrent?.hp ?? hp, fp: b.gcsCurrent?.fp ?? fp, conditions: [], injuries: [], posture: 'standing', money: 0, notes: '', crippled: [] },
    perks: [], // rank perks granted by GM
    gmNotes: '', // GM only
    hidden: kind === 'npc', // NPCs hidden from players until revealed
    reveal: { name: kind !== 'npc', status: false, stats: false },
    templateId: null,
    createdAt: ctx.now(),
    archived: false,
  };
}

function norm(x) { return String(x || '').trim().toLowerCase(); }

/** Parse "Guns (Rifle)" into name/spec. */
function splitSkill(text) {
  const m = String(text || '').match(/^\s*(.*?)\s*(?:\((.*)\))?\s*$/);
  return { name: m ? m[1] : '', spec: m && m[2] ? m[2] : '' };
}

function attr(c, key) {
  const b = c.build;
  const v = { st: b.st, dx: b.dx, iq: b.iq, ht: b.ht, will: b.will, per: b.per, hp: b.hp, fp: b.fp }[key];
  return Number(v ?? 10);
}

/**
 * Effective base level of a skill for a character, with an explanation.
 * Uses the GCS-calculated level when the skill exists on the sheet. Otherwise:
 *  - another specialization of the same skill at -2 for Guns (B199) when known
 *  - the attribute default from SKILL_DEFAULTS
 */
function skillLevel(c, skillText) {
  const { name, spec } = splitSkill(skillText);
  const list = c.build.skills || [];
  const exact = list.find(s => norm(s.name) === norm(name) && norm(s.spec) === norm(spec) && s.level !== null && !s.technique);
  if (exact) return { level: exact.level, source: c.build.source === 'gcs' ? 'GCS sheet' : 'sheet', explain: `${skillText} ${exact.level}${exact.rsl ? ` (${exact.rsl})` : ''}` };
  const attrNames = { st: 1, dx: 1, iq: 1, ht: 1, will: 1, per: 1 };
  if (attrNames[norm(name)] && !spec) { const v = attr(c, norm(name)); return { level: v, source: 'attribute', explain: `${name.toUpperCase()} ${v}` }; }
  const candidates = [];
  if (spec) {
    for (const s of list) if (norm(s.name) === norm(name) && s.level !== null && !s.technique && norm(s.spec) !== norm(spec)) {
      const penalty = norm(name) === 'guns' ? -2 : -4;
      candidates.push({ level: s.level + penalty, source: 'related specialization', explain: `${s.name} (${s.spec}) ${s.level} ${penalty}` });
    }
  }
  for (const [a, mod] of SKILL_DEFAULTS[norm(name)] || []) candidates.push({ level: attr(c, a) + mod, source: 'default', explain: `default ${a.toUpperCase()}${mod}` });
  if (!candidates.length) return { level: null, source: 'none', explain: `${skillText}: not on sheet and has no default` };
  candidates.sort((a, b) => b.level - a.level);
  return candidates[0];
}

/** Basic Speed-derived and encumbrance-adjusted Dodge/Move. */
function derived(s, c) {
  const b = c.build;
  const carriedKg = inv.carriedWeightKg(s, c.id);
  const enc = rules.encumbrance(b.st || 10, carriedKg * rules.KG_TO_LB);
  const level = Math.min(4, enc.level);
  let dodge = b.dodgeByEncumbrance ? b.dodgeByEncumbrance[level] : (b.dodge ?? Math.floor((b.basicSpeed ?? 5) + 3)) + enc.dodge;
  let move = b.moveByEncumbrance ? b.moveByEncumbrance[level] : Math.max(1, Math.floor((b.basicMove ?? 5) * enc.move));
  const notes = [];
  const reeling = c.session.hp < (b.hp ?? 10) / 3;
  const tired = c.session.fp < (b.fp ?? 10) / 3;
  if (reeling || tired) { dodge = Math.ceil(dodge / 2); move = Math.ceil(move / 2); notes.push(reeling ? 'HP below 1/3: Move and Dodge halved (B419).' : 'FP below 1/3: Move and Dodge halved (B426).'); }
  const st = tired ? Math.ceil((b.st ?? 10) / 2) : (b.st ?? 10);
  const dmg = (b.thrust && b.swing) ? { thrust: b.thrust, swing: b.swing } : rules.strengthDamage(b.st || 10);
  return {
    carriedKg, encumbrance: enc, dodge, move, st, notes,
    thrust: dmg.thrust, swing: dmg.swing,
    state: rules.vitalState(c.session.hp, b.hp ?? 10, c.session.fp, b.fp ?? 10, { dead: c.session.conditions.includes('Dead'), unconscious: c.session.conditions.includes('Unconscious') }),
  };
}

/** Change current HP/FP. Returns an adjustment record (for undo and the audit log). */
function adjustPool(c, pool, delta, reason = '') {
  assert(pool === 'hp' || pool === 'fp', 'Unknown pool.');
  const d = Math.trunc(Number(delta));
  assert(Number.isFinite(d) && d !== 0, 'Enter a non-zero amount.');
  const before = c.session[pool];
  c.session[pool] = before + d;
  return { pool, before, after: c.session[pool], delta: d, reason };
}

function setConditions(c, add = [], remove = []) {
  const set = new Set(c.session.conditions);
  for (const x of remove) set.delete(x);
  for (const x of add) { assert(typeof x === 'string' && x.trim() && x.length < 60, 'Invalid condition.'); set.add(x.trim()); }
  const before = c.session.conditions.slice();
  c.session.conditions = [...set];
  return { before, after: c.session.conditions.slice() };
}

/**
 * Apply an imported GCS build, preserving session state. Damage already taken is preserved
 * (current = new max - previous damage) so changing max HP in GCS does not heal or hurt.
 */
function applyImportedBuild(c, build) {
  const prev = c.build;
  const hpDamage = (prev?.hp ?? build.hp) - c.session.hp;
  const fpDamage = (prev?.fp ?? build.fp) - c.session.fp;
  c.build = build;
  if (prev && prev.source === 'gcs') {
    c.session.hp = (build.hp ?? 10) - hpDamage;
    c.session.fp = (build.fp ?? 10) - fpDamage;
  } else if (!prev || prev.source !== 'gcs') {
    // first import: take current values from the sheet when it records damage, else keep tracked damage
    c.session.hp = build.gcsCurrent?.hp ?? ((build.hp ?? 10) - Math.max(0, hpDamage));
    c.session.fp = build.gcsCurrent?.fp ?? ((build.fp ?? 10) - Math.max(0, fpDamage));
  }
  if (build.name && (!c.name || c.name === 'New Character')) c.name = build.name;
}

/** Update a manual build (GM tool for NPCs and non-GCS characters). */
function updateManualBuild(c, patch) {
  assert(c.build.source !== 'gcs', 'This character is managed by GCS. Edit it in GCS; the companion will synchronize.');
  const b = c.build;
  const prevMax = { hp: b.hp ?? 10, fp: b.fp ?? 10 };
  for (const k of ['st', 'dx', 'iq', 'ht', 'hp', 'fp', 'will', 'per', 'basicSpeed', 'basicMove', 'dodge']) {
    if (patch[k] !== undefined) { const v = Number(patch[k]); assert(Number.isFinite(v) && v >= 0 && v <= 100, `Invalid ${k}.`); b[k] = v; }
  }
  if (patch.thrust !== undefined) b.thrust = patch.thrust || null;
  if (patch.swing !== undefined) b.swing = patch.swing || null;
  if (Array.isArray(patch.skills)) b.skills = patch.skills.map(x => ({ name: String(x.name || ''), spec: String(x.spec || ''), level: Number(x.level), points: Number(x.points) || 0, rsl: '' })).filter(x => x.name && Number.isFinite(x.level));
  if (Array.isArray(patch.traits)) b.traits = patch.traits.map(x => ({ name: String(x.name || ''), points: Number(x.points) || 0, kind: x.kind || 'advantage', notes: x.notes || '' })).filter(x => x.name);
  if (patch.naturalDR !== undefined) b.naturalDR = patch.naturalDR || {};
  // keep damage already taken when maximum HP/FP change
  c.session.hp += (b.hp ?? 10) - prevMax.hp;
  c.session.fp += (b.fp ?? 10) - prevMax.fp;
  if (patch.flags) b.flags = { ...b.flags, ...patch.flags };
}

module.exports = { RANKS, CONDITIONS, SKILL_DEFAULTS, blankBuild, newCharacter, splitSkill, skillLevel, derived, adjustPool, setConditions, applyImportedBuild, updateManualBuild, attr };
