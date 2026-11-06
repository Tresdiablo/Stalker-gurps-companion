'use strict';
/**
 * NPC templates and generation. Generated equipment always respects explicit compatibility:
 * magazines are chosen by the weapon's magazine families and ammunition by caliber.
 */
const { ActionError, assert } = require('./errors');
const inv = require('./inventory');
const weapons = require('./weapons');
const cat = require('./catalog');
const chars = require('./characters');
const { weightedPick } = require('./traders');

const QUALITY = {
  poor: { label: 'Poor', maxTier: 1, condition: [35, 70] },
  standard: { label: 'Standard', maxTier: 2, condition: [55, 90] },
  good: { label: 'Good', maxTier: 3, condition: [70, 100] },
  elite: { label: 'Elite', maxTier: 5, condition: [85, 100] },
};

/** Default rank effects for NPC generation (configurable in campaign settings). */
const RANK_NPC = [
  { skill: -1, quality: 'poor' }, { skill: 0, quality: 'poor' }, { skill: 1, quality: 'standard' }, { skill: 2, quality: 'standard' },
  { skill: 3, quality: 'good' }, { skill: 4, quality: 'good' }, { skill: 5, quality: 'elite' }, { skill: 6, quality: 'elite' },
];

function cloneBuild(b) { return JSON.parse(JSON.stringify(b)); }

function nextNumberedName(s, base) {
  const re = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (\\d+)$`);
  let max = 0;
  for (const c of Object.values(s.characters)) { const m = c.name.match(re); if (m) max = Math.max(max, Number(m[1])); }
  return `${base} ${max + 1}`;
}

function pickDef(s, ctx, options, maxTier) {
  const list = (options || []).map(o => (typeof o === 'string' ? { defId: o, weight: 1 } : o)).filter(o => s.defs[o.defId] && s.defs[o.defId].tier <= maxTier);
  const fallback = (options || []).map(o => (typeof o === 'string' ? { defId: o, weight: 1 } : o)).filter(o => s.defs[o.defId]);
  const pool = list.length ? list : fallback;
  return pool.length ? weightedPick(ctx, pool, o => o.weight || 1)?.defId : null;
}

function randInt(ctx, [a, b]) { return a + Math.floor(ctx.random() * (b - a + 1)); }

/**
 * Arm an NPC with a weapon definition plus compatible magazines and ammunition.
 * Returns warnings when the catalog lacks compatible feed items.
 */
function equipWeapon(s, ctx, npc, defId, slot, { mags = [1, 3], cond = [60, 100], ammoPrefer } = {}) {
  const warnings = [];
  const d = s.defs[defId];
  const w = inv.createItem(s, ctx, defId, { cond: randInt(ctx, cond) });
  const ref = 'char:' + npc.id;
  try { inv.place(s, w, { p: ref, slot }); } catch { inv.storeOnCharacter(s, w, ref); }
  if (d.weapon.kind !== 'ranged') return { weapon: w, warnings };
  const ammoDefs = Object.values(s.defs).filter(a => cat.ammoFitsWeapon(a, d));
  if (!ammoDefs.length) { warnings.push(`${d.name}: no compatible ammunition in the catalog.`); return { weapon: w, warnings }; }
  const ammoDef = (ammoPrefer && ammoDefs.find(a => a.id === ammoPrefer)) || weightedPick(ctx, ammoDefs, a => (a.rarity === 'common' ? 5 : 1));
  if (d.weapon.integral) {
    w.rounds = [[ammoDef.id, d.weapon.integral.capacity]];
    const spare = inv.createItem(s, ctx, ammoDef.id, { qty: Math.min(ammoDef.stack, d.weapon.integral.capacity * randInt(ctx, mags)) });
    try { inv.storeOnCharacter(s, spare, ref, { allowGround: false }); } catch { delete s.items[spare.id]; }
    return { weapon: w, warnings };
  }
  const magDefs = Object.values(s.defs).filter(m => cat.magazineFitsWeapon(m, d) && cat.ammoFitsMagazine(ammoDef, m));
  if (!magDefs.length) { warnings.push(`${d.name}: no compatible magazine in the catalog.`); return { weapon: w, warnings }; }
  const magDef = magDefs.slice().sort((a, b) => (b.rarity === 'common') - (a.rarity === 'common'))[0];
  const n = randInt(ctx, mags);
  for (let i = 0; i < n; i++) {
    const m = inv.createItem(s, ctx, magDef.id, {});
    m.rounds = [[ammoDef.id, magDef.magazine.capacity]];
    if (i === 0) { m.loc = null; weapons.insertMagazine(s, w, m); }
    else { try { inv.storeOnCharacter(s, m, ref, { allowGround: false }); } catch { delete s.items[m.id]; warnings.push('No room for a spare magazine.'); } }
  }
  return { weapon: w, warnings };
}

/**
 * Generate NPCs from a template.
 * @param {{templateId:string, count?:number, rank?:number, quality?:string, faction?:string, name?:string}} p
 */
function generate(s, ctx, p) {
  const t = s.npcTemplates[p.templateId];
  assert(t, 'NPC template not found.');
  const count = Math.max(1, Math.min(50, Math.floor(p.count || 1)));
  const rank = Math.max(1, Math.min(8, Math.floor(p.rank || t.rank || 2)));
  const rankCfg = (s.settings?.ranks?.[rank - 1]) || {};
  const rn = { ...RANK_NPC[rank - 1], ...(rankCfg.npc || {}) };
  const quality = QUALITY[p.quality || t.quality || rn.quality] ? (p.quality || t.quality || rn.quality) : 'standard';
  const q = QUALITY[quality];
  const out = [];
  const warnings = [];
  for (let i = 0; i < count; i++) {
    const build = cloneBuild(t.build || chars.blankBuild());
    build.source = 'template';
    const bonus = rn.skill || 0;
    if (bonus) for (const sk of build.skills) sk.level += bonus;
    const npc = chars.newCharacter(ctx, { kind: 'npc', name: nextNumberedName(s, p.name || t.name), build, faction: p.faction || t.faction || '', rank });
    npc.templateId = t.id;
    npc.archetype = t.archetype || '';
    npc.portrait = t.portrait || null;
    s.characters[npc.id] = npc;
    for (const slotDef of t.loadout || []) {
      if (slotDef.chance !== undefined && ctx.random() > slotDef.chance) continue;
      const defId = pickDef(s, ctx, slotDef.options, q.maxTier);
      if (!defId) { warnings.push(`${t.name}: no catalog item for ${slotDef.slot}.`); continue; }
      const d = s.defs[defId];
      if (d.weapon) warnings.push(...equipWeapon(s, ctx, npc, defId, slotDef.slot, { mags: slotDef.mags || [1, 3], cond: q.condition }).warnings);
      else {
        const it = inv.createItem(s, ctx, defId, { cond: randInt(ctx, q.condition) });
        try { inv.place(s, it, { p: 'char:' + npc.id, slot: slotDef.slot }); } catch { try { inv.storeOnCharacter(s, it, 'char:' + npc.id); } catch { delete s.items[it.id]; } }
      }
    }
    for (const l of t.loot || []) {
      if (ctx.random() > (l.chance ?? 1) || !s.defs[l.defId]) continue;
      const d = s.defs[l.defId];
      let left = randInt(ctx, l.qty || [1, 1]);
      while (left > 0) {
        const it = inv.createItem(s, ctx, l.defId, { qty: Math.min(left, d.stack), cond: d.stack > 1 ? 100 : randInt(ctx, q.condition) });
        left -= it.qty;
        try { inv.storeOnCharacter(s, it, 'char:' + npc.id, { allowGround: false }); } catch { delete s.items[it.id]; break; }
      }
    }
    if (t.money) npc.session.money = randInt(ctx, t.money);
    out.push(npc);
  }
  return { npcs: out, warnings: [...new Set(warnings)] };
}

/** Duplicate an NPC: new identity and a separate copy of its inventory. */
function duplicate(s, ctx, npcId) {
  const src = s.characters[npcId];
  assert(src && src.kind === 'npc', 'NPC not found.');
  const copy = JSON.parse(JSON.stringify(src));
  copy.id = ctx.uid('npc_');
  copy.name = nextNumberedName(s, src.name.replace(/\s+\d+$/, ''));
  copy.session = { ...copy.session, hp: copy.build.hp ?? 10, fp: copy.build.fp ?? 10, conditions: [], injuries: [] };
  s.characters[copy.id] = copy;
  const map = new Map();
  const items = inv.descendants(s, 'char:' + src.id);
  for (const it of items) map.set(it.id, ctx.uid('it_'));
  for (const it of items) {
    const n = JSON.parse(JSON.stringify(it));
    n.id = map.get(it.id);
    n.loc = { ...n.loc, p: n.loc.p === 'char:' + src.id ? 'char:' + copy.id : 'item:' + map.get(n.loc.p.slice(5)) };
    s.items[n.id] = n;
  }
  return copy;
}

module.exports = { QUALITY, RANK_NPC, generate, duplicate, equipWeapon, nextNumberedName };
