'use strict';
/**
 * Crafting, repair, consumables and jobs.
 */
const { ActionError, assert } = require('./errors');
const inv = require('./inventory');
const dice = require('./dice');
const chars = require('./characters');
const combat = require('./combat');

/** Owned stacks of a definition, carried first (ground last). */
function ownedStacks(s, charId, defId) {
  return inv.ownedItems(s, charId).filter(i => i.defId === defId).sort((a, b) => (a.qty || 1) - (b.qty || 1));
}

/** What a character has vs needs for a recipe. */
function recipeStatus(s, charId, recipe) {
  const inputs = recipe.inputs.map(x => ({ ...x, have: inv.countOwned(s, charId, x.defId, { includeGround: true }), name: s.defs[x.defId]?.name || x.defId }));
  const tools = (recipe.tools || []).map(defId => ({ defId, name: s.defs[defId]?.name || defId, have: inv.countOwned(s, charId, defId, { includeGround: true }) > 0 }));
  const c = s.characters[charId];
  const skill = recipe.skill ? chars.skillLevel(c, recipe.skill.name) : null;
  const ok = inputs.every(i => i.have >= i.qty) && tools.every(t => t.have) && (!skill || skill.level !== null);
  return { ok, inputs, tools, skill: skill ? { ...skill, effective: skill.level === null ? null : skill.level + (recipe.skill.mod || 0) } : null };
}

function consume(s, charId, defId, qty) {
  let left = qty;
  for (const it of ownedStacks(s, charId, defId)) {
    if (left <= 0) break;
    const take = Math.min(left, it.qty || 1);
    it.qty -= take; left -= take;
    if (it.qty <= 0) inv.destroy(s, it);
  }
  assert(left === 0, 'Not enough materials.');
}

/**
 * Craft a recipe. Materials are consumed and the result created exactly once per action.
 * If the recipe has a skill roll and it fails, materials are kept unless recipe.loseOnFailure.
 */
function craft(s, ctx, { charId, recipeId, targetItemId }) {
  const recipe = s.recipes[recipeId];
  assert(recipe && recipe.enabled !== false, 'Recipe not found.');
  assert(s.settings?.rules?.crafting !== false, 'Crafting is disabled in this campaign.');
  const st = recipeStatus(s, charId, recipe);
  assert(st.ok, 'Missing materials, tools or skill for this recipe.');
  let roll = null;
  if (recipe.skill) {
    roll = dice.successRoll(ctx, st.skill.effective);
    if (!roll.success) {
      if (recipe.loseOnFailure) for (const x of recipe.inputs) consume(s, charId, x.defId, x.qty);
      return { success: false, roll, lost: !!recipe.loseOnFailure };
    }
  }
  for (const x of recipe.inputs) consume(s, charId, x.defId, x.qty);
  const created = [];
  if (recipe.repair) {
    const target = inv.getItem(s, targetItemId);
    assert(inv.rootOf(s, target) === 'char:' + charId, 'Choose one of your own items to repair.');
    const d = inv.defOf(s, target);
    assert(!recipe.repair.categories?.length || recipe.repair.categories.includes(d.category), `This repair kit does not work on ${d.name}.`);
    const before = target.cond ?? 100;
    target.cond = Math.min(recipe.repair.max ?? 100, before + (recipe.repair.amount || 20));
    if (target.dp !== undefined && d.armor?.dpMax) target.dp = Math.min(d.armor.dpMax, target.dp + Math.ceil(d.armor.dpMax * (recipe.repair.amount || 20) / 100));
    return { success: true, roll, repaired: { itemId: target.id, before, after: target.cond } };
  }
  const out = recipe.output;
  assert(out && s.defs[out.defId], 'Recipe has no valid result.');
  let left = out.qty || 1;
  while (left > 0) {
    const it = inv.createItem(s, ctx, out.defId, { qty: Math.min(left, s.defs[out.defId].stack) });
    left -= it.qty;
    inv.storeOnCharacter(s, it, 'char:' + charId);
    created.push(it.id);
  }
  return { success: true, roll, created };
}

/**
 * Use a consumable (medkit, bandage, food). Creates an event; HP changes are proposals the user
 * applies (players may apply healing to their own character; GM decides for NPCs).
 */
function useConsumable(s, ctx, { charId, itemId, targetId, byUser }) {
  const c = s.characters[charId];
  const it = inv.getItem(s, itemId);
  assert(inv.rootOf(s, it) === 'char:' + charId, 'You do not have that item.');
  const d = inv.defOf(s, it);
  assert(d.consumable, `${d.name} cannot be used like that.`);
  const target = s.characters[targetId || charId];
  assert(target, 'Target not found.');
  const eff = d.consumable;
  let roll = null, heal = 0;
  const notes = [];
  if (eff.skill) {
    const sk = chars.skillLevel(c, eff.skill);
    if (sk.level !== null) {
      roll = dice.successRoll(ctx, sk.level + (eff.skillMod || 0));
      notes.push(`${eff.skill} ${sk.level}${eff.skillMod ? (eff.skillMod > 0 ? '+' : '') + eff.skillMod : ''}: rolled ${roll.total} — ${roll.label}`);
    } else notes.push(`${eff.skill}: no skill or default.`);
  }
  if (eff.heal) {
    const r = /d/.test(String(eff.heal)) ? dice.rollExpression(ctx, eff.heal).total : Number(eff.heal);
    heal = roll && !roll.success ? 0 : Math.max(0, r);
    if (roll && !roll.success) notes.push('Treatment failed: no HP restored.');
  }
  if (eff.uses) { it.uses = (it.uses ?? eff.uses) - 1; if (it.uses <= 0) { if (it.qty > 1) { it.qty -= 1; it.uses = eff.uses; } else inv.destroy(s, it); } }
  else { it.qty -= 1; if (it.qty <= 0) inv.destroy(s, it); }
  const ev = combat.newEvent(s, ctx, { kind: 'use', actorId: c.id, targetId: target.id, byUser, visibility: 'public', title: `${c.name} uses ${d.name}${target.id !== c.id ? ` on ${target.name}` : ''}`, use: { item: d.name, roll, heal, notes, cures: eff.cures || [], fp: eff.fp || 0, radiation: eff.radiation || 0 } });
  ev.proposal = { targetId: target.id, hp: Math.min(heal, Math.max(0, (target.build.hp ?? 10) - target.session.hp)), fp: eff.fp || 0, conditions: [], removeConditions: eff.cures || [] };
  ev.stage = 'resolved';
  ev.status = `Proposed: +${ev.proposal.hp} HP${eff.cures?.length ? `, removes ${eff.cures.join(', ')}` : ''}`;
  return ev;
}

/* ------------------------------------------------------------------ jobs */

function newJob(ctx, p) {
  return { id: ctx.uid('job_'), title: String(p.title || 'New job').slice(0, 120), employer: String(p.employer || ''), description: String(p.description || ''), objectives: (p.objectives || []).map(t => ({ text: String(t.text || t), done: !!t.done })), assigned: p.assigned || [], status: 'open', reward: { money: Math.max(0, Math.floor(Number(p.reward?.money) || 0)), split: p.reward?.split === 'split' ? 'split' : 'each', items: p.reward?.items || [] }, paid: false, gmNotes: String(p.gmNotes || ''), createdAt: ctx.now(), visible: p.visible !== false };
}

/** Pay a job reward exactly once. */
function payJob(s, ctx, jobId) {
  const j = s.jobs[jobId];
  assert(j, 'Job not found.');
  assert(!j.paid, 'This job has already been paid.', 'duplicate');
  assert(j.assigned.length, 'Assign characters before paying the reward.');
  const each = j.reward.split === 'split' ? Math.floor(j.reward.money / j.assigned.length) : j.reward.money;
  const payments = [];
  for (const cid of j.assigned) {
    const c = s.characters[cid];
    if (!c) continue;
    c.session.money += each;
    payments.push({ charId: cid, money: each });
    s.ledger.push({ id: ctx.uid('tx_'), at: ctx.now(), kind: 'reward', jobId: j.id, charId: cid, price: -each, qty: 0, defId: null });
  }
  for (const r of j.reward.items || []) {
    const first = s.characters[j.assigned[0]];
    if (!first || !s.defs[r.defId]) continue;
    let left = r.qty || 1;
    while (left > 0) { const it = inv.createItem(s, ctx, r.defId, { qty: Math.min(left, s.defs[r.defId].stack) }); left -= it.qty; inv.storeOnCharacter(s, it, 'char:' + first.id); }
  }
  j.paid = true; j.status = 'completed'; j.paidAt = ctx.now();
  return payments;
}

module.exports = { recipeStatus, craft, useConsumable, newJob, payJob, consume };
