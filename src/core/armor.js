'use strict';
/**
 * Armor protection. Standard GURPS: DR of every worn layer covering the location adds together
 * (B286 layering) plus natural DR from the character sheet.
 *
 * Optional campaign armor (each setting is independent and off by default):
 *  - armorDT:           damage threshold — penetrating damage ≤ DT causes no injury
 *  - armorDurability:   armor loses durability points (DP) when hit
 *  - conditionAffectsDR: DR scales with DP (50% at 0 DP, 100% at full)
 */
const inv = require('./inventory');

const ARMOR_SLOTS = ['helmet', 'face', 'armor', 'rig'];

/** Body locations covered by each hit location for armor purposes (vitals use torso armor). */
const COVERAGE_ALIAS = { vitals: 'torso', eye: 'face' };

function wornArmor(s, charId) {
  return inv.childrenOf(s, 'char:' + charId).filter(i => ARMOR_SLOTS.includes(i.loc.slot) && s.defs[i.defId]?.armor);
}

function layerDR(def, item, type, rulesOn) {
  const a = def.armor;
  let dr = a.drByType && a.drByType[type] !== undefined ? Number(a.drByType[type]) : a.dr;
  const notes = [];
  if (rulesOn.conditionAffectsDR && a.dpMax) {
    const ratio = Math.max(0, Math.min(1, (item.dp ?? a.dpMax) / a.dpMax));
    const scaled = Math.floor(dr * (0.5 + 0.5 * ratio));
    if (scaled !== dr) notes.push(`condition ${Math.round(ratio * 100)}%: DR ${dr} → ${scaled} (campaign rule)`);
    dr = scaled;
  }
  return { dr, notes };
}

/**
 * DR at a hit location for a character.
 * @returns {{dr:number, layers:Array, natural:number, dt:number, notes:string[]}}
 */
function protection(s, c, location, type = 'cr', rulesOn = {}) {
  const loc = COVERAGE_ALIAS[location] && location !== 'eye' ? COVERAGE_ALIAS[location] : location;
  const layers = [];
  let dt = 0;
  for (const it of wornArmor(s, c.id)) {
    const d = s.defs[it.defId];
    const covers = d.armor.locations.includes(location) || d.armor.locations.includes(loc);
    if (!covers) continue;
    const { dr, notes } = layerDR(d, it, type, rulesOn);
    layers.push({ itemId: it.id, name: d.name, dr, flexible: !!d.armor.flexible, notes, dp: it.dp ?? null, dpMax: d.armor.dpMax || null });
    if (rulesOn.armorDT && d.armor.dt) dt = Math.max(dt, Number(d.armor.dt) || 0);
  }
  const nat = c.build?.naturalDR || {};
  const natural = (nat.all || 0) + (nat[location] || 0) + (location !== loc ? (nat[loc] || 0) : 0);
  const dr = layers.reduce((a, l) => a + l.dr, 0) + natural;
  const notes = [];
  if (natural) notes.push(`natural DR ${natural} (character sheet)`);
  return { dr, layers, natural, dt, notes, flexibleOnly: layers.length > 0 && layers.every(l => l.flexible) };
}

/**
 * Blunt trauma (B379, optional): flexible armor that stops all damage still causes 1 HP per
 * full 5 points of crushing (10 points of other damage) stopped.
 */
function bluntTrauma(basic, dr, type, flexibleOnly) {
  if (!flexibleOnly || basic <= 0 || basic > dr) return 0;
  if (!['cr', 'pi-', 'pi', 'pi+', 'pi++', 'cut', 'imp'].includes(type)) return 0;
  return Math.floor(basic / (type === 'cr' ? 5 : 10));
}

/** Durability loss for a hit (campaign rule): 1 DP per hit plus 1 per full 10 basic damage stopped. */
function durabilityLoss(basic, effectiveDR) {
  const stopped = Math.min(basic, effectiveDR);
  return stopped > 0 ? 1 + Math.floor(stopped / 10) : 0;
}

module.exports = { ARMOR_SLOTS, wornArmor, protection, bluntTrauma, durabilityLoss };
