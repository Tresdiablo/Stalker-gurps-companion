'use strict';
/**
 * Traders and shops. A trader's stock lives in the trader's own inventory grid, so buying and
 * selling are ordinary item moves plus a money transfer. The engine runs every action inside a
 * transaction, so money, stock and inventory always change together or not at all.
 */
const { ActionError, assert } = require('./errors');
const inv = require('./inventory');
const weapons = require('./weapons');
const { RARITY } = require('./catalog');

const TRADER_TYPES = {
  medic: { label: 'Medic', categories: ['medical'], subs: {} },
  technician: { label: 'Technician', categories: ['attachment', 'material', 'magazine', 'equipment'], subs: { equipment: ['Tools', 'Electronics', 'Detectors', 'Lights'] } },
  general: { label: 'General Goods', categories: ['misc', 'equipment', 'medical', 'ammo', 'material', 'container'], subs: { medical: ['Bandages', 'Medkits', 'Anti-radiation'], equipment: ['Food & Drink', 'Lights', 'Tools'] } },
  weapons: { label: 'Weapons', categories: ['weapon', 'ammo', 'magazine', 'attachment'], subs: {} },
  armor: { label: 'Armor & Clothing', categories: ['armor'], subs: {} },
  equipment: { label: 'Equipment', categories: ['equipment', 'container'], subs: {} },
};

function newTrader(ctx, { name, type = 'general', tier = 1 }) {
  assert(TRADER_TYPES[type], 'Unknown trader type.');
  return { id: ctx.uid('tr_'), name: String(name || TRADER_TYPES[type].label).slice(0, 80), type, tier: Math.max(1, Math.min(5, Math.floor(tier) || 1)), buyMult: 1, sellMult: 0.5, money: null, grid: { w: 12, h: 8 }, open: false, openFor: [], priceOverrides: {}, notes: '', portrait: null };
}

function getTrader(s, id) { const t = s.traders[id]; if (!t) throw new ActionError('Trader not found.', 'missing'); return t; }

function deals(trader, def) {
  if (def.traders?.length) return def.traders.includes(trader.type);
  const t = TRADER_TYPES[trader.type];
  if (!t.categories.includes(def.category)) return false;
  const subs = t.subs[def.category];
  return !subs || !def.sub || subs.includes(def.sub);
}

function conditionFactor(cond) { return 0.3 + 0.7 * Math.max(0, Math.min(100, cond ?? 100)) / 100; }

/** Base value of an item instance including loaded rounds and attachments (roubles). */
function itemValue(s, item) {
  const d = inv.defOf(s, item);
  let v = d.value * conditionFactor(item.cond) * (item.qty || 1);
  for (const [ammoId, n] of item.rounds || []) v += (s.defs[ammoId]?.value || 0) * n;
  if (item.chamber) v += s.defs[item.chamber]?.value || 0;
  for (const c of inv.childrenOf(s, 'item:' + item.id)) v += itemValue(s, c);
  return v;
}

function economyMult(s) { return Number(s.settings?.economy?.priceMult) || 1; }

/** Price a player pays for an item (or `qty` units of a stack). */
function buyPrice(s, trader, item, qty) {
  if (trader.priceOverrides?.[item.id] !== undefined) return Math.round(trader.priceOverrides[item.id] * (qty || item.qty || 1) / (item.qty || 1));
  const unit = itemValue(s, item) / (item.qty || 1);
  return Math.max(0, Math.round(unit * (qty || item.qty || 1) * trader.buyMult * economyMult(s)));
}

/** Price a trader pays a player. */
function sellPrice(s, trader, item, qty) {
  const unit = itemValue(s, item) / (item.qty || 1);
  return Math.max(0, Math.round(unit * (qty || item.qty || 1) * trader.sellMult * economyMult(s)));
}

function weightedPick(ctx, list, weight) {
  const total = list.reduce((a, x) => a + weight(x), 0);
  if (total <= 0) return null;
  let r = ctx.random() * total;
  for (const x of list) { r -= weight(x); if (r <= 0) return x; }
  return list[list.length - 1];
}

/**
 * Generate stock for a trader. Considers specialization, rarity, tier, condition and the
 * campaign's economy settings. Existing stock is removed first unless keepExisting is set.
 */
function generateStock(s, ctx, traderId, opts = {}) {
  const t = getTrader(s, traderId);
  const eco = s.settings?.economy || {};
  if (!opts.keepExisting) for (const it of inv.childrenOf(s, 'trader:' + t.id)) inv.destroy(s, it);
  const candidates = Object.values(s.defs).filter(d => deals(t, d) && d.tier <= t.tier + (opts.tierSlack ?? 0) && d.rarity !== 'unique' && !d.tags.includes('no-trade'));
  assert(candidates.length, 'No catalog items match this trader type and tier.');
  const kinds = Math.min(candidates.length, Math.max(1, Math.floor(opts.kinds ?? eco.stockKinds ?? (10 + t.tier * 4))));
  const chosen = new Set();
  const weight = d => (RARITY[d.rarity] || 50) * (d.tier === t.tier ? 1.5 : 1) * (eco.availability?.[d.category] ?? 1);
  for (let guard = 0; chosen.size < kinds && guard < kinds * 20; guard++) {
    const pick = weightedPick(ctx, candidates.filter(d => !chosen.has(d.id)), weight);
    if (!pick) break;
    chosen.add(pick.id);
  }
  const made = [];
  const [cmin, cmax] = opts.condition || eco.condition || [70 + t.tier * 5, 100];
  for (const defId of chosen) {
    const d = s.defs[defId];
    const stacks = d.stack > 1 ? 1 + Math.floor(ctx.random() * 2) : 1 + (RARITY[d.rarity] >= 45 && ctx.random() < 0.3 ? 1 : 0);
    for (let k = 0; k < stacks; k++) {
      const qty = d.stack > 1 ? Math.max(1, Math.floor(d.stack * (0.3 + ctx.random() * 0.7))) : 1;
      const cond = d.stack > 1 || d.category === 'ammo' ? 100 : Math.round(Math.min(cmax, Math.max(cmin, cmin + ctx.random() * (cmax - cmin))));
      const it = inv.createItem(s, ctx, defId, { qty, cond });
      if (!placeInTrader(s, t, it)) { delete s.items[it.id]; continue; }
      made.push(it.id);
    }
  }
  return made;
}

function placeInTrader(s, t, item) {
  for (let grow = 0; grow < 4; grow++) {
    const spot = inv.findSpot(s, item, 'trader:' + t.id);
    if (spot) { inv.place(s, item, spot); return true; }
    t.grid.h += 4;
  }
  return false;
}

function shopOpenFor(t, charId) { return t.open && (!t.openFor.length || t.openFor.includes(charId)); }

/** Atomic purchase. */
function buy(s, ctx, { traderId, charId, itemId, qty }) {
  const t = getTrader(s, traderId);
  const c = s.characters[charId];
  assert(c, 'Character not found.');
  assert(shopOpenFor(t, charId), `${t.name}'s shop is not open for ${c.name}.`);
  let item = inv.getItem(s, itemId);
  assert(inv.rootOf(s, item) === 'trader:' + t.id, 'That item is not for sale here.');
  assert(item.loc.p === 'trader:' + t.id, 'Buy the container, not an item inside it.');
  const n = qty ? Math.floor(qty) : item.qty;
  assert(n >= 1 && n <= item.qty, 'Invalid quantity.');
  const price = buyPrice(s, t, item, n);
  assert(c.session.money >= price, `Not enough roubles: ${price} ₽ needed, ${c.session.money} ₽ available.`, 'funds');
  if (n < item.qty) {
    const part = inv.createItem(s, ctx, item.defId, { qty: n, cond: item.cond });
    item.qty -= n;
    item = part;
  }
  item.loc = null;
  const placed = inv.storeOnCharacter(s, item, 'char:' + c.id);
  c.session.money -= price;
  if (t.money !== null && t.money !== undefined) t.money += price;
  const rec = { id: ctx.uid('tx_'), at: ctx.now(), kind: 'buy', traderId: t.id, charId: c.id, defId: item.defId, qty: n, price, itemId: placed.merged ? null : item.id };
  s.ledger.push(rec);
  return { ...rec, ground: !!placed.ground };
}

/** Atomic sale. */
function sell(s, ctx, { traderId, charId, itemId, qty }) {
  const t = getTrader(s, traderId);
  const c = s.characters[charId];
  assert(c, 'Character not found.');
  assert(shopOpenFor(t, charId), `${t.name}'s shop is not open for ${c.name}.`);
  let item = inv.getItem(s, itemId);
  assert(inv.rootOf(s, item) === 'char:' + c.id, 'You can only sell your own items.');
  const d = inv.defOf(s, item);
  assert(deals(t, d) || t.buysAnything, `${t.name} does not buy ${d.name}.`);
  assert(!inv.childrenOf(s, 'item:' + item.id).some(ch => ch.loc.g !== undefined), 'Empty the container before selling it.');
  const n = qty ? Math.floor(qty) : item.qty;
  assert(n >= 1 && n <= item.qty, 'Invalid quantity.');
  const price = sellPrice(s, t, item, n);
  if (t.money !== null && t.money !== undefined) assert(t.money >= price, `${t.name} cannot afford that (${t.money} ₽ available).`, 'funds');
  if (n < item.qty) { const part = inv.createItem(s, ctx, item.defId, { qty: n, cond: item.cond }); item.qty -= n; item = part; }
  item.loc = null;
  assert(placeInTrader(s, t, item), 'The trader has no room for that.');
  c.session.money += price;
  if (t.money !== null && t.money !== undefined) t.money -= price;
  const rec = { id: ctx.uid('tx_'), at: ctx.now(), kind: 'sell', traderId: t.id, charId: c.id, defId: item.defId, qty: n, price, itemId: item.id };
  s.ledger.push(rec);
  return rec;
}

module.exports = { TRADER_TYPES, newTrader, getTrader, deals, itemValue, buyPrice, sellPrice, generateStock, buy, sell, shopOpenFor, conditionFactor, weightedPick };
