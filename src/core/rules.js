'use strict';
/**
 * GURPS Fourth Edition Basic Set rules used by the combat engine.
 * Page references are to the Basic Set (Characters "B1-B336", Campaigns "B337-B576").
 * Every modifier carries a `source` so the UI can explain the calculation; optional or
 * campaign-specific rules are tagged source:'house' and are only applied when enabled.
 */

const SOURCES = { vanilla: 'GURPS 4e', house: 'Campaign rule' };

/* ------------------------------------------------------------------ range / speed */

// Size and Speed/Range Table (B550). Linear measurement -> speed/range modifier.
const SSR = [[2, 0], [3, -1], [5, -2], [7, -3], [10, -4], [15, -5], [20, -6], [30, -7], [50, -8], [70, -9], [100, -10], [150, -11], [200, -12], [300, -13], [500, -14], [700, -15], [1000, -16], [1500, -17], [2000, -18], [3000, -19], [5000, -20], [7000, -21], [10000, -22]];

/**
 * Range/speed penalty for any distance (yards). The table repeats every factor of 10 with an
 * extra -6, so very long ranges (sniping on large maps) are supported without an artificial cap.
 */
function rangePenalty(yards) {
  const y = Math.max(0, Number(yards) || 0);
  if (y <= 2) return 0;
  let scale = 0, v = y;
  while (v > 10000) { v /= 10; scale += 6; }
  for (const [limit, mod] of SSR) if (v <= limit + 1e-9) return mod - scale;
  return -22 - scale;
}

/** Size modifier for a linear measurement (yards), same table read the other way. */
function sizeModifierForLength(yards) {
  return -rangePenalty(yards) - 2; // 2 yd = SM 0
}

/* ------------------------------------------------------------------ rapid fire */

/** Rapid-fire bonus (B373). */
function rapidFireBonus(shots) {
  const n = Math.floor(Number(shots) || 0);
  if (n < 5) return 0;
  const table = [[8, 1], [12, 2], [16, 3], [24, 4], [49, 5], [99, 6]];
  for (const [max, b] of table) if (n <= max) return b;
  let b = 6, cap = 99;
  while (n > cap) { cap = cap * 2 + 1; b++; }
  return b;
}

/** Parse a RoF string such as "10", "3x9" (shotgun), "3!" or "1". */
function parseRof(text) {
  const s = String(text ?? '1').replace(/×/g, 'x').trim();
  const m = s.match(/^(\d+)(?:\s*x\s*(\d+))?/i);
  if (!m) return { rof: 1, projectiles: 1, fullAutoOnly: false };
  return { rof: Number(m[1]), projectiles: Number(m[2] || 1), fullAutoOnly: s.includes('!') };
}

/**
 * Number of hits from a successful ranged attack (B373): one hit plus one per full multiple of
 * Recoil by which the roll succeeded, up to the number of shots (projectiles for shotguns).
 */
function hitsFromMargin(margin, recoil, maxHits) {
  if (margin < 0) return 0;
  const rcl = Math.max(1, Math.floor(Number(recoil) || 1));
  return Math.min(Math.max(1, maxHits), 1 + Math.floor(margin / rcl));
}

/** Hits negated by a successful Dodge against rapid fire (B375): 1 + margin / Recoil. */
function hitsDodged(margin, recoil, hits) {
  if (margin < 0) return 0;
  const rcl = Math.max(1, Math.floor(Number(recoil) || 1));
  return Math.min(hits, 1 + Math.floor(margin / rcl));
}

/* ------------------------------------------------------------------ hit locations */

const HIT_LOCATIONS = {
  torso: { label: 'Torso', penalty: 0 },
  vitals: { label: 'Vitals', penalty: -3 },
  skull: { label: 'Skull', penalty: -7 },
  eye: { label: 'Eye', penalty: -9 },
  face: { label: 'Face', penalty: -5 },
  neck: { label: 'Neck', penalty: -5 },
  groin: { label: 'Groin', penalty: -3 },
  arm: { label: 'Arm', penalty: -2 },
  leg: { label: 'Leg', penalty: -2 },
  hand: { label: 'Hand', penalty: -4 },
  foot: { label: 'Foot', penalty: -4 },
};

/** Random hit location (B552), rolled on 3d6. */
function randomHitLocation(total) {
  if (total <= 4) return 'skull';
  if (total === 5) return 'face';
  if (total <= 7) return 'leg';
  if (total === 8) return 'arm';
  if (total <= 10) return 'torso';
  if (total === 11) return 'groin';
  if (total === 12) return 'arm';
  if (total <= 14) return 'leg';
  if (total === 15) return 'hand';
  if (total === 16) return 'foot';
  return 'neck';
}

const BASE_WOUNDING = { 'pi-': 0.5, pi: 1, 'pi+': 1.5, 'pi++': 2, cut: 1.5, imp: 2, cr: 1, burn: 1, cor: 1, tox: 1, fat: 1, tbb: 1, aff: 0, spec: 1 };

/** Wounding modifier for a damage type at a hit location (B379, B398-400). */
function woundingModifier(type, location) {
  const t = type in BASE_WOUNDING ? type : 'cr';
  let m = BASE_WOUNDING[t];
  const pierce = ['pi-', 'pi', 'pi+', 'pi++'];
  switch (location) {
    case 'skull': if (t !== 'tox') m = 4; break;
    case 'eye': if (t === 'imp' || pierce.includes(t) || t === 'tbb') m = 4; break;
    case 'face': if (t === 'cor') m = 1.5; break;
    case 'neck': if (t === 'cr' || t === 'cor') m = 1.5; else if (t === 'cut') m = 2; break;
    case 'vitals': if (t === 'imp' || pierce.includes(t)) m = 3; else if (t === 'tbb') m = 2; break;
    case 'arm': case 'leg': case 'hand': case 'foot':
      if (t === 'imp' || t === 'pi+' || t === 'pi++') m = 1; break;
    default: break;
  }
  return m;
}

/** Injury needed (strictly more than) to cripple a location (B420-421). */
function crippleThreshold(location, maxHP) {
  if (location === 'arm' || location === 'leg') return maxHP / 2;
  if (location === 'hand' || location === 'foot') return maxHP / 3;
  if (location === 'eye') return maxHP / 10;
  return null;
}

/**
 * Resolve one hit: basic damage vs DR -> penetrating damage -> wounding -> injury.
 * @param {object} p
 * @param {number} p.basic basic damage rolled (after 1/2D halving)
 * @param {string} p.type damage type
 * @param {number} p.divisor armor divisor (0.5, 2, 3, 5, 10...)
 * @param {number} p.dr DR at the location (before divisor)
 * @param {string} p.location hit-location key
 * @param {number} p.maxHP target maximum HP (for limb crippling caps)
 */
function resolveInjury({ basic, type, divisor = 1, dr = 0, location = 'torso', maxHP = 10, extraDR = 0 }) {
  const steps = [];
  let effDR = Math.max(0, Number(dr) || 0);
  if (divisor && divisor !== 1) {
    const before = effDR;
    effDR = divisor < 1 ? effDR / divisor : Math.floor(effDR / divisor);
    steps.push(`Armor divisor (${divisor}): DR ${before} → ${effDR}`);
  }
  if (location === 'skull') { effDR += 2; steps.push('Skull: +2 natural DR (B399)'); }
  if (extraDR) { effDR += extraDR; steps.push(`Additional DR +${extraDR}`); }
  const penetrating = Math.max(0, basic - effDR);
  const mult = woundingModifier(type, location);
  let injury = 0;
  if (penetrating > 0) {
    injury = Math.floor(penetrating * mult);
    if (injury < 1 && mult > 0) injury = 1; // minimum 1 injury if any damage penetrates (B379)
  }
  let crippled = false;
  const threshold = crippleThreshold(location, maxHP);
  if (threshold !== null && injury > threshold) {
    crippled = true;
    const cap = Math.floor(threshold) + 1;
    if (injury > cap) { steps.push(`Limb crippled: injury capped at ${cap} (excess lost, B398)`); injury = cap; }
    else steps.push('Location crippled (B420)');
  }
  return { basic, dr: Number(dr) || 0, effectiveDR: effDR, penetrating, woundingMultiplier: mult, injury, crippled, type, location, steps, fatigue: type === 'fat' };
}

/* ------------------------------------------------------------------ injury effects */

/** Shock penalty from a single hit's injury (B419); returns a negative number or 0. */
function shockPenalty(injury, maxHP, { highPain = false, lowPain = false } = {}) {
  if (highPain || injury <= 0) return 0;
  const per = maxHP >= 20 ? Math.floor(maxHP / 10) : 1;
  let p = Math.floor(injury / per);
  if (lowPain) p *= 2;
  return -Math.min(lowPain ? 8 : 4, p);
}

/** Major wound (B420): a single injury greater than HP/2. */
function isMajorWound(injury, maxHP) { return injury > maxHP / 2; }

/** HT modifier for the knockdown/stun roll after a major wound (B420). */
function knockdownModifier(location, { highPain = false } = {}) {
  let m = 0;
  if (location === 'face' || location === 'vitals' || location === 'groin') m = -5;
  if (location === 'skull' || location === 'eye') m = -10;
  if (highPain) m += 3;
  return m;
}

/**
 * Consequences of moving from HP `before` to `after` (B419). Returns follow-up checks that
 * the GM may want to roll; nothing is applied automatically.
 */
function hpThresholdEffects(before, after, maxHP) {
  const notes = [];
  const checks = [];
  if (after <= maxHP / 3 && before > maxHP / 3) notes.push('HP below 1/3: halve Move and Dodge (round up).');
  if (after <= 0 && before > 0) { notes.push('HP 0 or less: roll HT each turn to remain conscious (unless taking Do Nothing).'); checks.push({ kind: 'consciousness', attr: 'ht', label: 'HT roll to remain conscious' }); }
  for (let k = 1; k <= 4; k++) {
    const line = -k * maxHP;
    if (before > line && after <= line) { notes.push(`Reached −${k}×HP: HT roll or die (B419).`); checks.push({ kind: 'death', attr: 'ht', label: `HT roll at −${k}×HP or die` }); }
  }
  if (after <= -5 * maxHP && before > -5 * maxHP) notes.push('−5×HP: immediate death.');
  if (after <= -10 * maxHP && before > -10 * maxHP) notes.push('−10×HP: total bodily destruction.');
  return { notes, checks };
}

/** Status summary for HP/FP (B419, B426). */
function vitalState(hp, maxHP, fp, maxFP, flags = {}) {
  if (flags.dead || hp <= -5 * maxHP) return 'dead';
  if (flags.unconscious || fp <= -maxFP) return 'unconscious';
  if (hp <= 0) return 'critical';
  if (hp <= maxHP / 3 || fp <= maxFP / 3) return 'reeling';
  if (hp < maxHP) return 'wounded';
  return 'healthy';
}

/* ------------------------------------------------------------------ encumbrance */

/** Basic Lift in pounds (B15): ST²/5, rounded to a whole number when 10 or more. */
function basicLift(st) {
  const bl = (st * st) / 5;
  return bl >= 10 ? Math.round(bl) : bl;
}

const ENCUMBRANCE = [
  { level: 0, name: 'None', mult: 1, move: 1, dodge: 0 },
  { level: 1, name: 'Light', mult: 2, move: 0.8, dodge: -1 },
  { level: 2, name: 'Medium', mult: 3, move: 0.6, dodge: -2 },
  { level: 3, name: 'Heavy', mult: 6, move: 0.4, dodge: -3 },
  { level: 4, name: 'Extra-Heavy', mult: 10, move: 0.2, dodge: -4 },
];

const KG_TO_LB = 2.2046226218;

/** Encumbrance level (B17) for a carried weight in pounds. */
function encumbrance(st, carriedLb) {
  const bl = basicLift(st);
  const found = ENCUMBRANCE.find(e => carriedLb <= e.mult * bl + 1e-9);
  if (!found) return { ...ENCUMBRANCE[4], name: 'Overloaded', overloaded: true, basicLift: bl, carried: carriedLb };
  return { ...found, overloaded: false, basicLift: bl, carried: carriedLb };
}

/* ------------------------------------------------------------------ postures, cover */

// Posture table (B551). attack = melee attack modifier, defense = active defense modifier,
// target = modifier to ranged attacks against someone in that posture.
const POSTURES = {
  standing: { label: 'Standing', attack: 0, defense: 0, target: 0 },
  crouching: { label: 'Crouching', attack: -2, defense: 0, target: -2 },
  kneeling: { label: 'Kneeling', attack: -2, defense: -2, target: -2 },
  crawling: { label: 'Crawling', attack: -4, defense: -3, target: -2 },
  sitting: { label: 'Sitting', attack: -2, defense: -2, target: -2 },
  prone: { label: 'Lying Down', attack: -4, defense: -3, target: -2 },
};

// Partial cover / exposure of the target (B407 "Cover", B549). The GM may also enter a custom value.
const COVER = {
  none: { label: 'No cover', value: 0 },
  light: { label: 'Behind light cover (brush, foliage)', value: -2 },
  half: { label: 'Half exposed', value: -3 },
  headShoulders: { label: 'Head and shoulders exposed', value: -4 },
  headOnly: { label: 'Only head exposed', value: -5 },
  behindFigure: { label: 'Behind another figure', value: -4 },
};

const MANEUVERS = {
  attack: { label: 'Attack', aim: false },
  aim: { label: 'Aim', aim: true },
  aoaDetermined: { label: 'All-Out Attack (Determined)', ranged: 1, melee: 4, noDefense: true },
  aoaStrong: { label: 'All-Out Attack (Strong)', meleeDamage: 2, noDefense: true },
  moveAttack: { label: 'Move and Attack' },
  allOutDefense: { label: 'All-Out Defense', defense: 2 },
  ready: { label: 'Ready' },
  move: { label: 'Move' },
  concentrate: { label: 'Concentrate' },
  doNothing: { label: 'Do Nothing' },
  wait: { label: 'Wait' },
  feint: { label: 'Feint' },
};

/**
 * Build the modifier list for a ranged attack.
 * Every entry: { key, label, value, source }. Missing environmental information is reported in
 * `warnings` rather than assumed.
 */
function rangedModifiers(o) {
  const mods = [];
  const warnings = [];
  const add = (key, label, value, source = 'B') => { if (value) mods.push({ key, label, value, source }); };
  const moveAttack = o.maneuver === 'moveAttack';
  if (o.aimTurns > 0 && !moveAttack) {
    add('acc', `Aim: weapon Acc ${o.acc}`, o.acc, 'B364');
    if (o.aimTurns >= 2) add('aim', `Aimed ${o.aimTurns} turns`, Math.min(2, o.aimTurns - 1), 'B364');
    if (o.braced) add('braced', 'Braced weapon', 1, 'B364');
    if (o.scope) add('scope', `Optic +${o.scope} (limited to seconds aimed)`, Math.min(o.scope, o.aimTurns), 'B412');
  }
  if (o.maneuver === 'aoaDetermined') add('aoa', 'All-Out Attack (Determined)', 1, 'B365');
  if (moveAttack) add('moveAttack', 'Move and Attack (−2 or Bulk, whichever is worse)', Math.min(-2, Number(o.bulk) || 0), 'B365');
  if (o.range === null || o.range === undefined || o.range === '') warnings.push('Range not supplied — no range penalty applied.');
  else {
    const distance = Number(o.range) + (Number(o.targetSpeed) || 0);
    add('range', `Range ${o.range} yd${o.targetSpeed ? ` + speed ${o.targetSpeed} yd/s` : ''}`, rangePenalty(distance), 'B550');
  }
  if (o.targetSM) add('sm', `Target size modifier ${o.targetSM > 0 ? '+' : ''}${o.targetSM}`, Number(o.targetSM), 'B550');
  const posture = POSTURES[o.targetPosture];
  if (posture && posture.target) add('targetPosture', `Target ${posture.label.toLowerCase()}`, posture.target, 'B551');
  if (o.cover && COVER[o.cover]) add('cover', COVER[o.cover].label, COVER[o.cover].value, 'B407');
  if (o.coverCustom) add('coverCustom', 'Cover (GM value)', Number(o.coverCustom), 'GM');
  if (o.darkness) add('darkness', 'Darkness / visibility', -Math.abs(Number(o.darkness)), 'B394');
  if (o.weather) add('weather', 'Weather / obscurement', -Math.abs(Number(o.weather)), 'GM');
  if (o.hitLocation && o.hitLocation !== 'random' && HIT_LOCATIONS[o.hitLocation]) add('location', `Hit location: ${HIT_LOCATIONS[o.hitLocation].label}`, HIT_LOCATIONS[o.hitLocation].penalty, 'B398');
  if (o.shots) add('rof', `Rapid fire: ${o.shots} shots${o.projectiles > 1 ? ` × ${o.projectiles} projectiles` : ''}`, rapidFireBonus(o.shots * (o.projectiles || 1)), 'B373');
  if (o.shock) add('shock', 'Shock (injury last turn)', o.shock, 'B419');
  if (o.minST && o.st && o.st < o.minST) add('minST', `ST ${o.st} below weapon ST ${o.minST}`, o.st - o.minST, 'B270');
  for (const m of o.extra || []) if (Number(m.value)) mods.push({ key: 'extra', label: m.label || 'Modifier', value: Number(m.value), source: m.source || 'GM' });
  return { mods, warnings, total: mods.reduce((a, m) => a + m.value, 0) };
}

/** Modifier list for a melee attack. */
function meleeModifiers(o) {
  const mods = [];
  const add = (key, label, value, source) => { if (value) mods.push({ key, label, value, source }); };
  if (o.maneuver === 'aoaDetermined') add('aoa', 'All-Out Attack (Determined)', 4, 'B365');
  if (o.maneuver === 'moveAttack') add('moveAttack', 'Move and Attack', -4, 'B365');
  const posture = POSTURES[o.attackerPosture];
  if (posture && posture.attack) add('posture', `Attacking while ${posture.label.toLowerCase()}`, posture.attack, 'B551');
  if (o.hitLocation && o.hitLocation !== 'random' && HIT_LOCATIONS[o.hitLocation]) add('location', `Hit location: ${HIT_LOCATIONS[o.hitLocation].label}`, HIT_LOCATIONS[o.hitLocation].penalty, 'B398');
  if (o.deceptive) add('deceptive', `Deceptive attack −${o.deceptive * 2}`, -2 * o.deceptive, 'B369');
  if (o.darkness) add('darkness', 'Darkness / visibility', -Math.abs(Number(o.darkness)), 'B394');
  if (o.shock) add('shock', 'Shock (injury last turn)', o.shock, 'B419');
  for (const m of o.extra || []) if (Number(m.value)) mods.push({ key: 'extra', label: m.label || 'Modifier', value: Number(m.value), source: m.source || 'GM' });
  return { mods, warnings: [], total: mods.reduce((a, m) => a + m.value, 0) };
}

/** Active defense modifiers (B374-377). */
function defenseModifiers(o) {
  const mods = [];
  const add = (key, label, value, source) => { if (value) mods.push({ key, label, value, source }); };
  const posture = POSTURES[o.posture];
  if (posture && posture.defense) add('posture', `Defending while ${posture.label.toLowerCase()}`, posture.defense, 'B551');
  if (o.retreat && !o.ranged) add('retreat', 'Retreat', o.type === 'dodge' ? 3 : 1, 'B377');
  if (o.dodgeAndDrop && o.ranged && o.type === 'dodge') add('drop', 'Dodge and Drop vs ranged', 3, 'B377');
  if (o.allOutDefense) add('aod', 'All-Out Defense (Increased)', 2, 'B366');
  if (o.stunned) add('stunned', 'Stunned', -4, 'B420');
  if (o.deceptive) add('deceptive', 'Attacker deceptive attack', -o.deceptive, 'B369');
  if (o.reeling && o.type === 'dodge') add('reeling', 'HP below 1/3: Dodge halved', -Math.floor(o.base / 2), 'B419');
  for (const m of o.extra || []) if (Number(m.value)) mods.push({ key: 'extra', label: m.label || 'Modifier', value: Number(m.value), source: m.source || 'GM' });
  return { mods, total: mods.reduce((a, m) => a + m.value, 0) };
}

/** Parse "500/2900" or "x15/x20" ranges. For STx multipliers pass the user's ST. */
function parseRange(text, st = 10) {
  const s = String(text || '').trim();
  if (!s) return { half: null, max: null };
  const parts = s.split('/').map(p => p.trim());
  const val = p => {
    if (!p) return null;
    const m = p.match(/^x\s*(\d+(?:\.\d+)?)/i);
    if (m) return Math.round(Number(m[1]) * st);
    const n = Number(p.replace(/[^\d.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  if (parts.length === 1) return { half: null, max: val(parts[0]) };
  return { half: val(parts[0]), max: val(parts[1]) };
}

/** Replace "thr"/"sw" in melee damage text with the character's damage dice (B16). */
function resolveStrengthDamage(text, thrust, swing) {
  return String(text || '').replace(/\bthr\b/gi, thrust || '1d-2').replace(/\bsw\b/gi, swing || '1d')
    .replace(/(\d+)d([+-]\d+)?([+-]\d+)/g, (m, d, a, b) => {
      const add = Number(a || 0) + Number(b || 0);
      return `${d}d${add ? (add > 0 ? '+' : '') + add : ''}`;
    });
}

/** Thrust/swing damage by ST (B16) for characters without GCS data. */
function strengthDamage(st) {
  const t = [null, '1d-6', '1d-6', '1d-5', '1d-5', '1d-4', '1d-4', '1d-3', '1d-3', '1d-2', '1d-2', '1d-1', '1d-1', '1d', '1d', '1d+1', '1d+1', '1d+2', '1d+2', '2d-1', '2d-1'];
  const s = [null, '1d-5', '1d-5', '1d-4', '1d-4', '1d-3', '1d-3', '1d-2', '1d-2', '1d-1', '1d', '1d+1', '1d+2', '2d-1', '2d', '2d+1', '2d+2', '3d-1', '3d', '3d+1', '3d+2'];
  const i = Math.max(1, Math.min(20, Math.floor(st)));
  return { thrust: t[i], swing: s[i] };
}

module.exports = {
  SOURCES, rangePenalty, sizeModifierForLength, rapidFireBonus, parseRof, hitsFromMargin, hitsDodged,
  HIT_LOCATIONS, randomHitLocation, woundingModifier, crippleThreshold, resolveInjury, shockPenalty,
  isMajorWound, knockdownModifier, hpThresholdEffects, vitalState, basicLift, encumbrance, ENCUMBRANCE,
  KG_TO_LB, POSTURES, COVER, MANEUVERS, rangedModifiers, meleeModifiers, defenseModifiers, parseRange,
  resolveStrengthDamage, strengthDamage,
};
