'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const dice = require('../../src/core/dice');
const rules = require('../../src/core/rules');
const { fixedDice } = require('../../src/core/context');

test('success roll: ordinary success and failure with margins', () => {
  assert.deepEqual(pick(dice.evaluateSuccess(10, 12)), { success: true, critical: null, margin: 2 });
  assert.deepEqual(pick(dice.evaluateSuccess(13, 12)), { success: false, critical: null, margin: -1 });
  assert.equal(dice.evaluateSuccess(12, 12).success, true, 'equal to skill succeeds');
});

test('critical successes (B347)', () => {
  assert.equal(dice.evaluateSuccess(3, 5).critical, 'success');
  assert.equal(dice.evaluateSuccess(4, 3).critical, 'success');
  assert.equal(dice.evaluateSuccess(4, 3).success, true, '3-4 always succeed');
  assert.equal(dice.evaluateSuccess(5, 15).critical, 'success');
  assert.equal(dice.evaluateSuccess(5, 14).critical, null);
  assert.equal(dice.evaluateSuccess(6, 16).critical, 'success');
  assert.equal(dice.evaluateSuccess(6, 15).critical, null);
});

test('critical failures (B348)', () => {
  assert.equal(dice.evaluateSuccess(18, 25).critical, 'failure');
  assert.equal(dice.evaluateSuccess(17, 15).critical, 'failure');
  assert.equal(dice.evaluateSuccess(17, 16).critical, null);
  assert.equal(dice.evaluateSuccess(17, 16).success, false, '17 always fails');
  assert.equal(dice.evaluateSuccess(16, 6).critical, 'failure', 'fail by 10+');
  assert.equal(dice.evaluateSuccess(15, 6).critical, null);
});

test('successRoll uses the context dice', () => {
  const r = dice.successRoll(fixedDice([1, 2, 3]), 10);
  assert.deepEqual(r.dice, [1, 2, 3]);
  assert.equal(r.total, 6);
  assert.equal(r.margin, 4);
});

test('quick contest picks the better margin', () => {
  const r = dice.quickContest(fixedDice([3, 3, 3, 4, 4, 4]), 12, 12); // 9 vs 12 (m3) and 12 vs 12 (m0)
  assert.equal(r.winner, 'a');
  assert.equal(r.marginOfVictory, 3);
});

test('damage parsing', () => {
  assert.deepEqual(pd('5d+1 pi'), { dice: 5, add: 1, mult: 1, divisor: 1, type: 'pi' });
  assert.deepEqual(pd('6dx2 cut'), { dice: 6, add: 0, mult: 2, divisor: 1, type: 'cut' });
  assert.deepEqual(pd('3d(2) pi+'), { dice: 3, add: 0, mult: 1, divisor: 2, type: 'pi+' });
  assert.deepEqual(pd('2d-1 pi- (0.5)'), { dice: 2, add: -1, mult: 1, divisor: 0.5, type: 'pi-' });
  assert.equal(pd('1d-1 cut').type, 'cut');
  const r = dice.rollDamage(fixedDice([1]), dice.parseDamage('1d-3 cut'));
  assert.equal(r.total, 1, 'minimum basic damage 1 for cutting');
  const c = dice.rollDamage(fixedDice([1]), dice.parseDamage('1d-3 cr'));
  assert.equal(c.total, 0, 'crushing can be 0');
});

test('range penalties follow the SSR table and extend beyond 10,000 yd', () => {
  assert.equal(rules.rangePenalty(2), 0);
  assert.equal(rules.rangePenalty(3), -1);
  assert.equal(rules.rangePenalty(75), -10);
  assert.equal(rules.rangePenalty(100), -10);
  assert.equal(rules.rangePenalty(101), -11);
  assert.equal(rules.rangePenalty(1000), -16);
  assert.equal(rules.rangePenalty(20000), -24);
});

test('rapid fire bonus and hits (B373)', () => {
  assert.equal(rules.rapidFireBonus(4), 0);
  assert.equal(rules.rapidFireBonus(5), 1);
  assert.equal(rules.rapidFireBonus(10), 2);
  assert.equal(rules.rapidFireBonus(16), 3);
  assert.equal(rules.rapidFireBonus(24), 4);
  assert.equal(rules.rapidFireBonus(50), 6);
  assert.equal(rules.rapidFireBonus(100), 7);
  assert.equal(rules.hitsFromMargin(0, 2, 10), 1);
  assert.equal(rules.hitsFromMargin(5, 2, 10), 3);
  assert.equal(rules.hitsFromMargin(30, 2, 10), 10, 'capped at shots fired');
  assert.equal(rules.hitsFromMargin(-1, 2, 10), 0);
  assert.equal(rules.hitsDodged(3, 2, 5), 2);
});

test('wounding modifiers and hit locations (B379, B398)', () => {
  assert.equal(rules.woundingModifier('pi', 'vitals'), 3);
  assert.equal(rules.woundingModifier('imp', 'skull'), 4);
  assert.equal(rules.woundingModifier('tox', 'skull'), 1);
  assert.equal(rules.woundingModifier('pi++', 'arm'), 1);
  assert.equal(rules.woundingModifier('cut', 'neck'), 2);
  assert.equal(rules.woundingModifier('pi-', 'torso'), 0.5);
  assert.equal(rules.randomHitLocation(10), 'torso');
  assert.equal(rules.randomHitLocation(3), 'skull');
});

test('injury: DR, armor divisor, minimum injury, skull DR, limb cap', () => {
  let r = rules.resolveInjury({ basic: 8, type: 'pi', dr: 3, location: 'torso', maxHP: 10 });
  assert.equal(r.injury, 5);
  r = rules.resolveInjury({ basic: 8, type: 'pi', divisor: 2, dr: 6, location: 'torso', maxHP: 10 });
  assert.equal(r.effectiveDR, 3); assert.equal(r.injury, 5);
  r = rules.resolveInjury({ basic: 4, type: 'pi-', dr: 3, location: 'torso', maxHP: 10 });
  assert.equal(r.injury, 1, 'minimum 1 when penetrating');
  r = rules.resolveInjury({ basic: 3, type: 'pi', dr: 3, location: 'torso', maxHP: 10 });
  assert.equal(r.injury, 0);
  r = rules.resolveInjury({ basic: 5, type: 'pi', dr: 0, location: 'skull', maxHP: 10 });
  assert.equal(r.effectiveDR, 2); assert.equal(r.injury, 12);
  r = rules.resolveInjury({ basic: 20, type: 'pi', dr: 0, location: 'arm', maxHP: 10 });
  assert.equal(r.crippled, true); assert.equal(r.injury, 6, 'excess over HP/2 is lost');
  r = rules.resolveInjury({ basic: 4, type: 'pi', dr: 2, divisor: 0.5, location: 'torso', maxHP: 10 });
  assert.equal(r.effectiveDR, 4); assert.equal(r.injury, 0, 'divisor (0.5) doubles DR');
});

test('shock, major wounds and thresholds', () => {
  assert.equal(rules.shockPenalty(3, 10), -3);
  assert.equal(rules.shockPenalty(9, 10), -4);
  assert.equal(rules.shockPenalty(9, 20), -4);
  assert.equal(rules.shockPenalty(3, 20), -1);
  assert.equal(rules.shockPenalty(3, 10, { highPain: true }), 0);
  assert.equal(rules.isMajorWound(6, 10), true);
  assert.equal(rules.isMajorWound(5, 10), false);
  const t = rules.hpThresholdEffects(5, -11, 10);
  assert.ok(t.checks.some(c => c.kind === 'consciousness'));
  assert.ok(t.checks.some(c => c.kind === 'death'));
});

test('encumbrance (B17)', () => {
  assert.equal(rules.basicLift(10), 20);
  assert.equal(rules.basicLift(11), 24);
  assert.equal(rules.encumbrance(10, 20).name, 'None');
  assert.equal(rules.encumbrance(10, 21).name, 'Light');
  assert.equal(rules.encumbrance(10, 61).name, 'Heavy');
  assert.equal(rules.encumbrance(10, 201).overloaded, true);
});

test('ranged modifiers: aim, range, posture, cover, location; missing range is a warning', () => {
  const m = rules.rangedModifiers({ acc: 4, aimTurns: 2, braced: true, range: 75, targetPosture: 'prone', cover: 'half', hitLocation: 'torso', shots: 1, projectiles: 1 });
  const by = Object.fromEntries(m.mods.map(x => [x.key, x.value]));
  assert.deepEqual(by, { acc: 4, aim: 1, braced: 1, range: -10, targetPosture: -2, cover: -3 });
  assert.equal(m.total, -9);
  const w = rules.rangedModifiers({ acc: 4, aimTurns: 0, shots: 1 });
  assert.ok(w.warnings[0].includes('Range not supplied'));
});

function pick(r) { return { success: r.success, critical: r.critical, margin: r.margin }; }
function pd(t) { const x = dice.parseDamage(t); return { dice: x.dice, add: x.add, mult: x.mult, divisor: x.divisor, type: x.type }; }
