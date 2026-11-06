'use strict';
/**
 * GURPS Fourth Edition dice: success rolls (B343-348), contests (B348-349),
 * and damage-expression parsing.
 */

/** Roll n six-sided dice; returns the individual values. */
function rollDice(ctx, n, sides = 6) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(ctx.die(sides));
  return out;
}

/**
 * Evaluate a 3d6 roll against an effective skill (B347-348).
 * - 3 or 4 is always a critical success.
 * - 5 is a critical success if effective skill >= 15; 6 if effective skill >= 16.
 * - 18 is always a critical failure. 17 is a critical failure if effective skill <= 15,
 *   otherwise an ordinary failure. 17 or 18 always fail.
 * - Any roll >= effective skill + 10 is a critical failure.
 */
function evaluateSuccess(total, effective) {
  const eff = Math.floor(effective);
  let success = total <= eff;
  let critical = null;
  if (total <= 4) { success = true; critical = 'success'; }
  else if (total === 5 && eff >= 15) { success = true; critical = 'success'; }
  else if (total === 6 && eff >= 16) { success = true; critical = 'success'; }
  if (total >= 17) success = false;
  if (total === 18) critical = 'failure';
  else if (total === 17 && eff <= 15) critical = 'failure';
  else if (!critical && total >= eff + 10) critical = 'failure';
  return {
    success,
    critical,
    margin: eff - total,
    label: critical === 'success' ? 'Critical success' : critical === 'failure' ? 'Critical failure' : success ? 'Success' : 'Failure',
  };
}

/** Roll 3d6 against an effective skill. */
function successRoll(ctx, effective) {
  const dice = rollDice(ctx, 3);
  const total = dice[0] + dice[1] + dice[2];
  return { dice, total, effective: Math.floor(effective), ...evaluateSuccess(total, effective) };
}

/**
 * Quick contest (B348): both roll; the winner is the one who succeeds by more / fails by less.
 * Ties are ties (the status quo is maintained).
 */
function quickContest(ctx, a, b) {
  const ra = successRoll(ctx, a);
  const rb = successRoll(ctx, b);
  let winner = 'tie';
  if (ra.success && !rb.success) winner = 'a';
  else if (rb.success && !ra.success) winner = 'b';
  else if (ra.margin > rb.margin) winner = 'a';
  else if (rb.margin > ra.margin) winner = 'b';
  return { a: ra, b: rb, winner, marginOfVictory: Math.abs(ra.margin - rb.margin) };
}

/**
 * Regular contest (B349): repeat until one succeeds and the other fails. Capped to avoid
 * runaway loops; GURPS suggests lowering high skills, which callers may do before calling.
 */
function regularContest(ctx, a, b, maxRounds = 20) {
  const rounds = [];
  for (let i = 0; i < maxRounds; i++) {
    const ra = successRoll(ctx, a), rb = successRoll(ctx, b);
    rounds.push({ a: ra, b: rb });
    if (ra.success && !rb.success) return { rounds, winner: 'a' };
    if (rb.success && !ra.success) return { rounds, winner: 'b' };
  }
  return { rounds, winner: 'undecided' };
}

const DAMAGE_TYPES = ['pi++', 'pi+', 'pi-', 'pi', 'cut', 'imp', 'cr', 'burn', 'cor', 'tox', 'fat', 'aff', 'spec', 'tbb'];

/**
 * Parse a GURPS damage expression such as "5d+1 pi", "6dx2 cut", "3d(2) pi+",
 * "2d-1(0.5) pi-", "1d+2 cr ex". Unknown trailing text is preserved in `notes`.
 */
function parseDamage(text) {
  const s = String(text || '').trim().replace(/×/g, 'x').replace(/−/g, '-');
  const m = s.match(/^(\d+)\s*d(?:6)?\s*([+-]\s*\d+)?\s*(?:x\s*(\d+(?:\.\d+)?))?\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))?\s*([a-z+-]+)?\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))?\s*(.*)$/i);
  if (!m) {
    const flat = s.match(/^([+-]?\d+)\s*([a-z+-]+)?\s*(.*)$/i);
    if (flat) return { dice: 0, add: Number(flat[1]), mult: 1, divisor: 1, type: normType(flat[2]), notes: flat[3] || '', text: s };
    return null;
  }
  return {
    dice: Number(m[1]),
    add: m[2] ? Number(m[2].replace(/\s+/g, '')) : 0,
    mult: m[3] ? Number(m[3]) : 1,
    divisor: Number(m[4] || m[6] || 1),
    type: normType(m[5]),
    notes: (m[7] || '').trim(),
    text: s,
  };
}

function normType(t) {
  const v = String(t || '').toLowerCase().trim();
  return DAMAGE_TYPES.includes(v) ? v : (v ? v : 'cr');
}

function formatDamage(d) {
  if (!d) return '';
  let s = d.dice ? `${d.dice}d` : '';
  if (d.add) s += (d.add > 0 ? '+' : '') + d.add;
  if (!d.dice && !d.add) s = '0';
  if (d.mult && d.mult !== 1) s += `x${d.mult}`;
  if (d.divisor && d.divisor !== 1) s += `(${d.divisor})`;
  return `${s} ${d.type}`.trim();
}

/**
 * Roll basic damage (B378). Minimum basic damage is 1 for any damage type except crushing,
 * which may be 0. Returns individual dice for display.
 */
function rollDamage(ctx, parsed) {
  const dice = rollDice(ctx, parsed.dice);
  const sum = dice.reduce((a, b) => a + b, 0) + parsed.add;
  let total = Math.floor(sum * (parsed.mult || 1));
  const min = parsed.type === 'cr' ? 0 : 1;
  if (total < min) total = min;
  return { dice, total, raw: sum, parsed };
}

/** Roll a generic expression such as "3d6", "2d+1", "1d6-2" (used for misc rolls). */
function rollExpression(ctx, text) {
  const s = String(text || '').trim().toLowerCase().replace(/\s+/g, '');
  const m = s.match(/^(\d*)d(\d*)([+-]\d+)?$/);
  if (!m) throw new Error(`Cannot parse dice expression "${text}"`);
  const n = Number(m[1] || 1), sides = Number(m[2] || 6), add = Number(m[3] || 0);
  if (n < 1 || n > 100 || sides < 2 || sides > 1000) throw new Error('Dice expression out of range');
  const dice = rollDice(ctx, n, sides);
  return { dice, add, total: dice.reduce((a, b) => a + b, 0) + add, text: s };
}

module.exports = { rollDice, evaluateSuccess, successRoll, quickContest, regularContest, parseDamage, formatDamage, rollDamage, rollExpression, DAMAGE_TYPES };
