'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, giveBuild } = require('./helpers.cjs');
const inv = require('../../src/core/inventory');
const weapons = require('../../src/core/weapons');

test('grid placement: bounds, collisions, compartments and rotation', () => {
  const { engine, gm, pc } = setup();
  const s = () => engine.state;
  const pack = engine.dispatch('item.spawn', { defId: 'sample-backpack', target: { p: 'char:' + pc, slot: 'backpack' } }, gm).result.ids[0];
  const rifle = engine.dispatch('item.spawn', { defId: 't1-weapon-sks', to: 'char:' + pc }, gm).result.ids[0]; // 5x1
  // SKS is 5x1: fits the 5x5 backpack at 0,0
  engine.dispatch('item.move', { itemId: rifle, target: { p: 'item:' + pack, g: 'main', x: 0, y: 0, r: 0 } }, gm);
  assert.equal(s().items[rifle].loc.p, 'item:' + pack);
  const pistol = engine.dispatch('item.spawn', { defId: 't1-weapon-pm', to: 'char:' + pc }, gm).result.ids[0];
  assert.throws(() => engine.dispatch('item.move', { itemId: pistol, target: { p: 'item:' + pack, g: 'main', x: 4, y: 0, r: 0 } }, gm), /occupied|fit/);
  assert.throws(() => engine.dispatch('item.move', { itemId: pistol, target: { p: 'item:' + pack, g: 'main', x: 4, y: 1, r: 0 } }, gm), /fit/);
  engine.dispatch('item.move', { itemId: pistol, target: { p: 'item:' + pack, g: 'main', x: 4, y: 1, r: 1 } }, gm); // rotated 1x2 fits
  assert.deepEqual(inv.footprint(s(), s().items[pistol]), { w: 1, h: 2 });
  // chest rig compartments are 1x2: a 2x1 pistol does not fit unrotated, a magazine does
  const rig = engine.dispatch('item.spawn', { defId: 'sample-chest-rig', target: { p: 'char:' + pc, slot: 'rig' } }, gm).result.ids[0];
  const pm2 = engine.dispatch('item.spawn', { defId: 't1-weapon-pm', to: 'char:' + pc }, gm).result.ids[0];
  assert.throws(() => engine.dispatch('item.move', { itemId: pm2, target: { p: 'item:' + rig, g: 'pouches', x: 0, y: 0, r: 0 } }, gm), /compartment|fit/);
  const mag = engine.dispatch('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + pc }, gm).result.ids[0];
  engine.dispatch('item.move', { itemId: mag, target: { p: 'item:' + rig, g: 'pouches', x: 2, y: 0, r: 0 } }, gm);
});

test('containers keep contents when moved and cannot contain themselves', () => {
  const { engine, gm, pc } = setup();
  const s = () => engine.state;
  const pack = engine.dispatch('item.spawn', { defId: 'pack-large', target: { p: 'char:' + pc, slot: 'backpack' } }, gm).result.ids[0];
  const small = engine.dispatch('item.spawn', { defId: 'sample-backpack', to: 'char:' + pc }, gm).result.ids[0];
  assert.equal(s().items[small].loc.p, 'item:' + pack, 'auto-stored in the equipped backpack');
  const bread = engine.dispatch('item.spawn', { defId: 'eq-bread', qty: 3, target: { p: 'item:' + small, g: 'main', x: 0, y: 0, r: 0 } }, gm).result.ids[0];
  assert.throws(() => engine.dispatch('item.move', { itemId: pack, target: { p: 'item:' + small, g: 'main', x: 1, y: 1, r: 0 } }, gm), /own contents|itself/);
  assert.throws(() => engine.dispatch('item.move', { itemId: small, target: { p: 'item:' + small, g: 'main', x: 1, y: 1, r: 0 } }, gm), /itself/);
  const st = Object.values(s().stashes)[0].id;
  engine.dispatch('item.move', { itemId: small, target: { p: 'stash:' + st, g: 'main', x: 0, y: 0, r: 0 } }, gm);
  assert.equal(s().items[bread].loc.p, 'item:' + small, 'contents travel with the container');
  assert.equal(inv.rootOf(s(), s().items[bread]), 'stash:' + st);
  assert.equal(Object.values(s().items).filter(i => i.defId === 'eq-bread').length, 1, 'no duplication');
});

test('stacks: merge, split, quantity limits', () => {
  const { engine, gm, pc } = setup();
  const s = () => engine.state;
  const ids = engine.dispatch('item.spawn', { defId: 't1-ammo-9-18mm-pm-fmj', qty: 45, to: 'char:' + pc }, gm).result.ids;
  const total = Object.values(s().items).filter(i => i.defId === 't1-ammo-9-18mm-pm-fmj').reduce((a, i) => a + i.qty, 0);
  assert.equal(total, 45);
  const big = ids.map(id => s().items[id]).filter(Boolean).find(i => i.qty === 30);
  const r = engine.dispatch('item.split', { itemId: big.id, qty: 10 }, gm);
  assert.equal(s().items[big.id].qty, 20);
  assert.equal(s().items[r.result.id].qty, 10);
  engine.dispatch('item.merge', { srcId: r.result.id, dstId: big.id }, gm);
  assert.equal(s().items[big.id].qty, 30);
  assert.equal(s().items[r.result.id], undefined);
});

test('magazines: explicit compatibility, loading, mixed loads, unloading, integral feeds', () => {
  const { engine, gm, player, pc } = setup();
  const s = () => engine.state;
  const kedrMag = engine.dispatch('item.spawn', { defId: 't1-mag-kedr-kedr-b-klin-30-round-magazine', to: 'char:' + pc }, gm).result.ids[0];
  const pm = engine.dispatch('item.spawn', { defId: 't1-ammo-9-18mm-pm-fmj', qty: 20, to: 'char:' + pc }, gm).result.ids[0];
  const pmm = engine.dispatch('item.spawn', { defId: 't1-ammo-9-18mm-pmm-fmj', qty: 20, to: 'char:' + pc }, gm).result.ids[0];
  const nato = engine.dispatch('item.spawn', { defId: 't1-ammo-5-56-45mm-fmj', qty: 10, to: 'char:' + pc }, gm).result.ids[0];
  assert.throws(() => engine.dispatch('item.load', { holderId: kedrMag, ammoId: nato }, player), /does not fit/);
  engine.dispatch('item.load', { holderId: kedrMag, ammoId: pm, count: 10 }, player);
  engine.dispatch('item.load', { holderId: kedrMag, ammoId: pmm, count: 5 }, player);
  assert.deepEqual(s().items[kedrMag].rounds, [['t1-ammo-9-18mm-pm-fmj', 10], ['t1-ammo-9-18mm-pmm-fmj', 5]]);
  // Kedr cannot fire PMM: inserting a magazine loaded with PMM is refused
  const kedr = engine.dispatch('item.spawn', { defId: 't1-weapon-pp-91-kedr', to: 'char:' + pc }, gm).result.ids[0];
  assert.throws(() => engine.dispatch('item.insertMag', { weaponId: kedr, magId: kedrMag }, player), /cannot fire/);
  const klin = engine.dispatch('item.spawn', { defId: 't1-weapon-pp-9-klin', to: 'char:' + pc }, gm).result.ids[0];
  engine.dispatch('item.insertMag', { weaponId: klin, magId: kedrMag }, player);
  assert.equal(s().items[klin].chamber, 't1-ammo-9-18mm-pmm-fmj', 'last loaded round chambers first');
  assert.equal(weapons.roundsAvailable(s(), s().items[klin]), 15);
  // magazine retains ammunition when removed
  engine.dispatch('item.ejectMag', { weaponId: klin }, player);
  assert.equal(weapons.roundCount(s().items[kedrMag].rounds), 14);
  assert.equal(s().items[klin].chamber, 't1-ammo-9-18mm-pmm-fmj', 'chambered round stays in the gun');
  // unload returns loose rounds and merges into stacks
  engine.dispatch('item.unload', { holderId: kedrMag }, player);
  assert.equal(weapons.roundCount(s().items[kedrMag].rounds), 0);
  const owned = d => inv.countOwned(s(), pc, d, { includeGround: true });
  assert.equal(owned('t1-ammo-9-18mm-pm-fmj'), 20);
  assert.equal(owned('t1-ammo-9-18mm-pmm-fmj'), 19);
  // integral feed: SKS loads directly, wrong caliber rejected, no magazine accepted
  const sks = engine.dispatch('item.spawn', { defId: 't1-weapon-sks', to: 'char:' + pc }, gm).result.ids[0];
  const x39 = engine.dispatch('item.spawn', { defId: 't1-ammo-7-62-39mm-fmj', qty: 30, to: 'char:' + pc }, gm).result.ids[0];
  engine.dispatch('item.quickLoad', { holderId: sks }, player);
  assert.equal(weapons.roundsAvailable(s(), s().items[sks]), 10);
  assert.ok(s().items[x39]);
  assert.throws(() => engine.dispatch('item.insertMag', { weaponId: sks, magId: kedrMag }, player), /internal magazine/);
});

test('attachments: compatibility, layered assembly moves and rotates as one object, stats update', () => {
  const { engine, gm, player, pc } = setup();
  const s = () => engine.state;
  const st = Object.values(s().stashes)[0].id;
  const akm = engine.dispatch('item.spawn', { defId: 'builtin-akm-76239', target: { p: 'stash:' + st, g: 'main', x: 0, y: 0, r: 0 } }, gm).result.ids[0];
  const pso = engine.dispatch('item.spawn', { defId: 'att-pso1', target: { p: 'stash:' + st, g: 'main', x: 0, y: 5, r: 0 } }, gm).result.ids[0];
  const sup = engine.dispatch('item.spawn', { defId: 'att-pbs1', target: { p: 'stash:' + st, g: 'main', x: 0, y: 6, r: 0 } }, gm).result.ids[0];
  const sup9 = engine.dispatch('item.spawn', { defId: 'att-sup9', target: { p: 'stash:' + st, g: 'main', x: 3, y: 6, r: 0 } }, gm).result.ids[0];
  assert.throws(() => engine.dispatch('item.attach', { weaponId: akm, attId: sup9 }, player), /no compatible/);
  engine.dispatch('item.attach', { weaponId: akm, attId: pso }, player);
  engine.dispatch('item.attach', { weaponId: akm, attId: sup }, player);
  assert.equal(s().items[sup].loc.mount, 'muzzle');
  assert.deepEqual(inv.footprint(s(), s().items[akm]), { w: 6, h: 2 }, 'suppressor lengthens the weapon');
  const stats = weapons.effectiveStats(s(), s().items[akm]);
  assert.equal(stats.scope, 2);
  // move + rotate the whole assembly
  engine.dispatch('item.move', { itemId: akm, target: { p: 'stash:' + st, g: 'main', x: 5, y: 0, r: 1 } }, player);
  assert.deepEqual(inv.footprint(s(), s().items[akm]), { w: 2, h: 6 });
  assert.equal(s().items[pso].loc.p, 'item:' + akm);
  assert.equal(s().items[sup].loc.p, 'item:' + akm);
  engine.dispatch('item.detach', { weaponId: akm, mountId: 'optic' }, player);
  assert.equal(weapons.effectiveStats(s(), s().items[akm]).scope, 0);
  assert.equal(inv.rootOf(s(), s().items[pso]), 'stash:' + st);
});

test('trader: generation, atomic purchase, insufficient funds, sale', () => {
  const { engine, gm, player, pc } = setup();
  const s = () => engine.state;
  const tr = engine.dispatch('trader.save', { name: 'Field Medic', type: 'medic', tier: 2 }, gm).result.id;
  engine.dispatch('trader.generate', { id: tr }, gm);
  const stock = inv.childrenOf(s(), 'trader:' + tr);
  assert.ok(stock.length > 0);
  assert.ok(stock.every(i => s().defs[i.defId].category === 'medical'));
  const item = stock[0];
  assert.throws(() => engine.dispatch('trader.buy', { traderId: tr, charId: pc, itemId: item.id, qty: 1 }, player), /not open/);
  engine.dispatch('trader.open', { id: tr, charIds: [pc] }, gm);
  assert.throws(() => engine.dispatch('trader.buy', { traderId: tr, charId: pc, itemId: item.id, qty: 1 }, player), /Not enough roubles/);
  assert.equal(inv.childrenOf(s(), 'trader:' + tr).length, stock.length, 'failed purchase changed nothing');
  assert.throws(() => engine.dispatch('char.money', { id: pc, delta: 50000 }, player), /Only the GM/);
  engine.dispatch('char.money', { id: pc, delta: 50000 }, gm);
  const before = s().characters[pc].session.money;
  const r = engine.dispatch('trader.buy', { traderId: tr, charId: pc, itemId: item.id, qty: 1 }, player, { requestId: 'buy-1' });
  engine.dispatch('trader.buy', { traderId: tr, charId: pc, itemId: item.id, qty: 1 }, player, { requestId: 'buy-1' });
  assert.equal(s().characters[pc].session.money, before - r.result.price, 'paid exactly once');
  assert.equal(inv.countOwned(s(), pc, item.defId, { includeGround: true }), 1);
  const mine = inv.ownedItems(s(), pc).find(i => i.defId === item.defId);
  const sold = engine.dispatch('trader.sell', { traderId: tr, charId: pc, itemId: mine.id, qty: 1 }, player);
  assert.ok(sold.result.price < r.result.price, 'sell price below buy price');
  assert.equal(inv.countOwned(s(), pc, item.defId, { includeGround: true }), 0);
  assert.equal(s().ledger.filter(l => l.kind === 'buy' || l.kind === 'sell').length, 2);
});

test('crafting consumes materials and creates the result exactly once', () => {
  const { engine, gm, player, pc, queue } = setup();
  const s = () => engine.state;
  giveBuild(engine, gm, pc, { skills: [{ name: 'First Aid', spec: '', level: 12 }] });
  engine.dispatch('item.spawn', { defId: 'mat-cloth', qty: 3, to: 'char:' + pc }, gm);
  queue.push(6, 6, 5); // 17 fails: materials kept for this recipe
  const f = engine.dispatch('craft.make', { charId: pc, recipeId: 'rc-bandage' }, player);
  assert.equal(f.result.success, false);
  assert.equal(inv.countOwned(s(), pc, 'mat-cloth', { includeGround: true }), 3);
  queue.push(2, 2, 2);
  engine.dispatch('craft.make', { charId: pc, recipeId: 'rc-bandage' }, player, { requestId: 'c1' });
  engine.dispatch('craft.make', { charId: pc, recipeId: 'rc-bandage' }, player, { requestId: 'c1' });
  assert.equal(inv.countOwned(s(), pc, 'mat-cloth', { includeGround: true }), 1);
  assert.equal(inv.countOwned(s(), pc, 'med-bandage', { includeGround: true }), 2);
  assert.throws(() => engine.dispatch('craft.make', { charId: pc, recipeId: 'rc-bandage' }, player), /Missing/);
});

test('NPC generation is compatibility-aware and NPCs persist independently', () => {
  const { engine, gm } = setup({ dice: [] });
  const s = () => engine.state;
  const enc = engine.dispatch('enc.create', { name: 'Bandit camp' }, gm).result.id;
  const r = engine.dispatch('npc.generate', { templateId: 'tpl-bandit', count: 6, rank: 2, encounterId: enc }, gm);
  assert.equal(r.result.ids.length, 6);
  const names = r.result.ids.map(id => s().characters[id].name);
  assert.deepEqual(names, ['Bandit 1', 'Bandit 2', 'Bandit 3', 'Bandit 4', 'Bandit 5', 'Bandit 6']);
  for (const id of r.result.ids) {
    for (const w of inv.childrenOf(s(), 'char:' + id).filter(i => s().defs[i.defId].weapon?.kind === 'ranged')) {
      const def = s().defs[w.defId];
      const feed = weapons.feedState(s(), w);
      assert.ok(feed.rounds > 0, `${def.name} generated loaded`);
      for (const [ammoId] of feed.stacks) assert.ok(def.weapon.calibers.includes(s().defs[ammoId].ammo.caliber));
    }
  }
  assert.equal(Object.keys(s().encounters[enc].combatants).length, 6);
  const dup = engine.dispatch('npc.duplicate', { id: r.result.ids[0] }, gm).result.id;
  assert.equal(s().characters[dup].name, 'Bandit 7');
  const a = inv.descendants(s(), 'char:' + r.result.ids[0]).map(i => i.id);
  const b = inv.descendants(s(), 'char:' + dup).map(i => i.id);
  assert.equal(a.length, b.length);
  assert.ok(a.every(id => !b.includes(id)), 'separate inventories');
});

test('jobs pay exactly once; loot from a released NPC can be taken by players', () => {
  const { engine, gm, player, pc } = setup();
  const s = () => engine.state;
  const job = engine.dispatch('job.save', { title: 'Find the documents', reward: { money: 3000 }, assigned: [pc] }, gm).result.id;
  engine.dispatch('job.pay', { id: job }, gm);
  assert.throws(() => engine.dispatch('job.pay', { id: job }, gm), /already been paid/);
  assert.equal(s().characters[pc].session.money, 3000);
  const npc = engine.dispatch('char.create', { name: 'Dead Bandit', kind: 'npc' }, gm).result.id;
  const loot = engine.dispatch('item.spawn', { defId: 'misc-watch', to: 'char:' + npc }, gm).result.ids[0];
  const enc = engine.dispatch('enc.create', { name: 'Loot test', participants: [pc, npc] }, gm).result.id;
  assert.throws(() => engine.dispatch('item.transfer', { itemId: loot, to: 'char:' + pc }, player), /cannot reach/);
  engine.dispatch('enc.releaseLoot', { id: enc, charId: npc }, gm);
  engine.dispatch('item.transfer', { itemId: loot, to: 'char:' + pc }, player);
  assert.equal(inv.rootOf(s(), s().items[loot]), 'char:' + pc);
  assert.equal(Object.values(s().items).filter(i => i.defId === 'misc-watch').length, 1);
  assert.throws(() => engine.dispatch('item.spawn', { defId: 'misc-watch', to: 'char:' + pc }, player), /Only the GM/);
});

test('grid sort packs items and merges stacks; character export/import keeps inventory', () => {
  const { engine, gm, pc } = setup();
  const s = () => engine.state;
  const st = Object.values(s().stashes)[0].id;
  engine.dispatch('item.spawn', { defId: 't1-weapon-sks', target: { p: 'stash:' + st, g: 'main', x: 4, y: 9, r: 0 } }, gm);
  engine.dispatch('item.spawn', { defId: 'eq-bread', qty: 2, target: { p: 'stash:' + st, g: 'main', x: 9, y: 19, r: 0 } }, gm);
  engine.dispatch('item.spawn', { defId: 'eq-bread', qty: 2, target: { p: 'stash:' + st, g: 'main', x: 0, y: 19, r: 0 } }, gm);
  engine.dispatch('item.sortGrid', { ref: 'stash:' + st, grid: 'main' }, gm);
  const items = inv.childrenOf(s(), 'stash:' + st);
  assert.equal(items.filter(i => i.defId === 'eq-bread').length, 1, 'stacks merged');
  assert.deepEqual([items.find(i => i.defId === 't1-weapon-sks').loc.x, items.find(i => i.defId === 't1-weapon-sks').loc.y], [0, 0]);
  const w = engine.dispatch('item.spawn', { defId: 'builtin-akm-76239', target: { p: 'char:' + pc, slot: 'primary' } }, gm).result.ids[0];
  const m = engine.dispatch('item.spawn', { defId: 'mag-ak762-30', to: 'char:' + pc, loadFull: true }, gm).result.ids[0];
  engine.dispatch('item.insertMag', { weaponId: w, magId: m }, gm);
  const doc = { format: 'stalker-gurps-character', version: 1, character: s().characters[pc], items: inv.descendants(s(), 'char:' + pc), defs: {} };
  const id = engine.dispatch('char.importPackage', { doc: JSON.parse(JSON.stringify(doc)) }, gm).result.id;
  const copy = inv.descendants(s(), 'char:' + id);
  assert.equal(copy.length, 2);
  const cw = copy.find(i => i.defId === 'builtin-akm-76239');
  assert.equal(weapons.roundsAvailable(s(), cw), 30);
  assert.ok(copy.every(i => !doc.items.some(o => o.id === i.id)), 'new item ids');
});
