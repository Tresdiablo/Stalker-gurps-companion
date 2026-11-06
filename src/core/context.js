'use strict';
/**
 * Execution context for engine actions.
 *
 * Every source of non-determinism (random numbers, generated ids, timestamps) goes
 * through a context. The context records a "tape" of produced values so that a journal
 * entry can be replayed after a crash and reproduce exactly the same state.
 */
const crypto = require('node:crypto');

function randomFloat() {
  // 53 bits of crypto randomness -> [0,1)
  const b = crypto.randomBytes(7);
  let n = 0;
  for (let i = 0; i < 7; i++) n = n * 256 + b[i];
  return (n % 2 ** 53) / 2 ** 53;
}

function shortId() {
  return crypto.randomBytes(9).toString('base64url');
}

class Context {
  /**
   * @param {object} [opts]
   * @param {Array} [opts.replay] tape to replay (values consumed in order)
   * @param {() => number} [opts.random] custom random source (tests)
   */
  constructor(opts = {}) {
    this.tape = [];
    this.replay = opts.replay ? opts.replay.slice() : null;
    this._random = opts.random || randomFloat;
    this._clock = opts.clock || (() => new Date().toISOString());
    this._idgen = opts.idgen || shortId;
  }
  _take(kind, make) {
    if (this.replay) {
      if (!this.replay.length) throw new Error('Replay tape exhausted');
      const [k, v] = this.replay.shift();
      if (k !== kind) throw new Error(`Replay tape mismatch: expected ${kind}, found ${k}`);
      this.tape.push([k, v]);
      return v;
    }
    const v = make();
    this.tape.push([kind, v]);
    return v;
  }
  random() { return this._take('r', this._random); }
  /** integer in [1, sides] */
  die(sides = 6) { return 1 + Math.floor(this.random() * sides); }
  uid(prefix = '') { return prefix + this._take('i', this._idgen); }
  now() { return this._take('t', this._clock); }
}

/** Deterministic context for tests: provide fixed dice values (1..6) in order. */
function fixedDice(values, opts = {}) {
  const queue = values.slice();
  let n = 0;
  return new Context({
    random: () => {
      if (!queue.length) throw new Error('fixedDice: ran out of dice values');
      const v = queue.shift();
      return (v - 1) / 6 + 1e-9;
    },
    idgen: () => 'id' + (++n),
    clock: () => opts.clock || '2026-01-01T00:00:00.000Z',
  });
}

module.exports = { Context, fixedDice, shortId };
