'use strict';
/**
 * Seed content for new campaigns: the existing Tier 1 catalog (converted to explicit
 * compatibility relationships), the AKM and example gear from earlier builds, and starter
 * armor, medical supplies, artifacts, materials, attachments, recipes, NPC templates and traders.
 *
 * Prices and many GURPS statistics are PROVISIONAL campaign values (marked in descriptions);
 * the GM edits them in the Item Catalog.
 */
const path = require('node:path');
const fs = require('node:fs');
const { caliberKey, normalizeDef } = require('./catalog');

const LEGACY_FILE = path.join(__dirname, '..', '..', 'data', 'seed', 'tier1-legacy.json');

const SUB_BY_TYPE = { Pistol: 'Pistols', SMG: 'Submachine Guns', Rifle: 'Rifles', Shotgun: 'Shotguns', Revolver: 'Revolvers' };
const RANGE_BY_SUB = { Pistols: '150/1600', 'Submachine Guns': '160/1900', Rifles: '500/3000', 'Sniper Rifles': '1000/4000', Shotguns: '50/125', 'Assault Rifles': '400/2500', Revolvers: '185/2000' };
const BULK_BY_SUB = { Pistols: -2, 'Submachine Guns': -3, Rifles: -5, 'Sniper Rifles': -6, Shotguns: -5, 'Assault Rifles': -4, Revolvers: -2 };
const PRICE_BY_SUB = { Pistols: 4500, 'Submachine Guns': 14000, Rifles: 18000, 'Sniper Rifles': 30000, Shotguns: 9000, 'Assault Rifles': 26000, Revolvers: 6000 };
const AMMO_PRICE = { '9x18pm': 15, '9x18pmm': 22, '9x19': 20, '7.62x25tok': 18, '.45acp': 30, '12/70': 40, '5.56x45': 45, '7.62x39': 40, '7.62x54r': 70, '7.62x51': 80, '7.92x33kurz': 55, '.357mag9x33r': 45 };

const PROVISIONAL = 'Provisional campaign statistics; verify against GURPS High-Tech before relying on them.';

function muzzleInterface(cal) { return 'thread-' + cal.replace(/[^a-z0-9.]/g, ''); }

/**
 * Default anchor points for the seed artwork. The Tier 1 images face LEFT (muzzle on the left);
 * images taller than wide are rotated (muzzle at the bottom). The GM fine-tunes anchors in the
 * Item Editor's anchor editor.
 */
function mountsFor(sub, cal, opts = {}) {
  const m = [];
  const vertical = opts.vertical;
  const P = (h, vtx) => (vertical ? vtx : h);
  if (sub === 'Pistols' || sub === 'Revolvers') {
    m.push({ id: 'muzzle', slot: 'muzzle', interfaces: [muzzleInterface(cal)], ...P({ x: 0.06, y: 0.3, rot: 180 }, { x: 0.5, y: 0.04, rot: -90 }), scale: 0.45, z: 2 });
    m.push({ id: 'side', slot: 'side', interfaces: ['pistol-rail'], ...P({ x: 0.4, y: 0.55, rot: 0 }, { x: 0.55, y: 0.4, rot: 90 }), scale: 0.3, z: 3 });
  } else {
    m.push({ id: 'optic', slot: 'optic', interfaces: opts.dovetail ? ['picatinny', 'ak-dovetail'] : ['picatinny'], ...P({ x: 0.5, y: 0.25, rot: 0 }, { x: 0.65, y: 0.5, rot: 90 }), scale: 0.28, z: 3 });
    m.push({ id: 'muzzle', slot: 'muzzle', interfaces: [muzzleInterface(cal)], ...P({ x: 0.04, y: 0.33, rot: 180 }, { x: 0.45, y: 0.97, rot: 90 }), scale: 0.22, z: 2 });
    if (sub !== 'Shotguns') m.push({ id: 'foregrip', slot: 'foregrip', interfaces: ['picatinny'], ...P({ x: 0.3, y: 0.58, rot: 0 }, { x: 0.3, y: 0.7, rot: 90 }), scale: 0.12, z: 1 });
    m.push({ id: 'side', slot: 'side', interfaces: ['picatinny'], ...P({ x: 0.26, y: 0.42, rot: 0 }, { x: 0.55, y: 0.25, rot: 90 }), scale: 0.12, z: 4 });
  }
  return m;
}

function legacyDefs() {
  const raw = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8'));
  const defs = [];
  for (const w of raw.weapons) {
    const cal = caliberKey(w.gurps.caliber);
    let sub = SUB_BY_TYPE[w.weaponType] || 'Rifles';
    if (/sniper/i.test(w.name)) sub = 'Sniper Rifles';
    const calibers = [cal];
    if (w.supportsPMM && cal === '9x18pmm') calibers.push('9x18pm');
    const integral = w.integralFeed ? { capacity: Number(w.gurps.capacity) || 1, label: 'Internal magazine' } : null;
    defs.push({
      id: w.id, name: w.name, category: 'weapon', sub, tier: w.tier, w: w.w, h: w.h, weight: w.weight,
      value: PRICE_BY_SUB[sub] || 10000, image: w.image ? 'seed:' + w.image : '', rarity: 'common',
      description: `${w.description} ${PROVISIONAL}`,
      weapon: { kind: 'ranged', skill: w.gurps.skill, damage: w.gurps.damage, acc: Number(w.gurps.acc) || 0, range: RANGE_BY_SUB[sub], rof: w.gurps.rof, shots: w.gurps.shots + (integral ? '' : '+1'), bulk: BULK_BY_SUB[sub] || -4, rcl: Number(w.gurps.rcl) || 2, minST: sub === 'Pistols' ? 9 : 10, calibers, magFamilies: w.magFamilies, integral, mounts: mountsFor(sub, cal, { dovetail: /vepr|sks|svt|mosin|vpo|akm/i.test(w.name), vertical: w.h > w.w }), notes: w.gurps.gurpsNotes },
      legacyId: w.id,
    });
  }
  for (const m of raw.magazines) {
    if (m.integralMagazine) continue; // integral feeds are part of the weapon definition now
    const cal = caliberKey(m.gurps.caliber);
    const calibers = m.magFamily === 'kedr' ? ['9x18pm', '9x18pmm'] : [cal];
    defs.push({ id: m.id, name: m.name, category: 'magazine', sub: 'Rifle', tier: m.tier, w: m.w, h: m.h, weight: m.weight, value: 400 + 25 * (Number(m.gurps.capacity) || 10), rarity: 'common', description: m.description, magazine: { family: m.magFamily, capacity: Number(m.gurps.capacity) || 10, calibers }, legacyId: m.id });
  }
  for (const a of raw.ammunition) {
    const cal = caliberKey(a.gurps.caliber);
    const hp = / HP$/.test(a.name);
    const buck = /buckshot/i.test(a.name);
    const ammo = { caliber: cal, label: hp ? 'HP' : buck ? 'Buckshot' : /slug/i.test(a.name) ? 'Slug' : 'FMJ' };
    if (hp) { ammo.woundShift = 1; ammo.divisor = 0.5; }
    if (buck) { ammo.damage = '1d+1 pi'; ammo.projectiles = 9; }
    if (cal === '9x18pmm') ammo.onlyWeapons = ['t1-weapon-pp-9-klin'];
    defs.push({ id: a.id, name: a.name, category: 'ammo', sub: /12\/70/.test(cal) ? 'Shotgun' : /x(39|54|51|45|33)/.test(cal) ? 'Rifle' : 'Pistol', tier: 1, w: 1, h: 1, stack: a.stackSize || 30, weight: a.weight, value: AMMO_PRICE[cal] || 30, rarity: hp ? 'uncommon' : 'common', description: `${a.name}. ${hp ? 'Hollow-point: piercing damage one size larger, armor divisor (0.5) (GURPS High-Tech p.166).' : buck ? 'Buckshot: 9 projectiles of 1d+1 pi (GURPS High-Tech).' : ''} ${(a.gurps.gurpsNotes || '').replace(/Ammunition-type injury \/ armor effects are not automatically applied by current GURPS combat resolution\. /, '').replace(/Injury adjustments require GM adjudication\./, '')}`.trim(), ammo, legacyId: a.id });
  }
  return defs;
}

const art = f => 'seed:' + f;

const EXTRA = [
  // AKM from Build 4.5
  { id: 'builtin-akm-76239', name: 'AKM', category: 'weapon', sub: 'Assault Rifles', tier: 2, w: 5, h: 2, weight: 4.3, value: 28000, rarity: 'uncommon', description: '7.62×39mm assault rifle. Grid size and tier are campaign values. ' + PROVISIONAL, weapon: { kind: 'ranged', skill: 'Guns (Rifle)', damage: '5d+1 pi', acc: 4, range: '400/3000', rof: '10', shots: '30+1', bulk: -5, rcl: 2, minST: 10, calibers: ['7.62x39'], magFamilies: ['ak762'], mounts: mountsFor('Assault Rifles', '7.62x39', { dovetail: true }) } },
  { id: 'mag-ak762-30', name: 'AK 7.62×39 30-round magazine', category: 'magazine', sub: 'Rifle', tier: 2, w: 1, h: 2, weight: 0.33, value: 1200, description: 'Steel AK-pattern magazine.', magazine: { family: 'ak762', capacity: 30, calibers: ['7.62x39'] } },
  { id: 'mag-ak762-10', name: 'AK 7.62×39 10-round magazine', category: 'magazine', sub: 'Rifle', tier: 1, w: 1, h: 1, weight: 0.2, value: 700, magazine: { family: 'ak762', capacity: 10, calibers: ['7.62x39'] } },
  { id: 'melee-knife', name: 'Combat Knife', category: 'weapon', sub: 'Melee Weapons', tier: 1, w: 1, h: 2, weight: 0.3, value: 900, description: 'Large knife (B272).', weapon: { kind: 'melee', skill: 'Knife', damage: 'sw-2 cut', reach: 'C,1', parry: '-1' }, slots: ['melee'] },

  // Attachments (artwork generated as simple silhouettes; replace in the Item Editor)
  { id: 'att-pso1', name: 'PSO-1 4× scope', category: 'attachment', sub: 'Optics', tier: 2, w: 2, h: 1, weight: 0.6, value: 9000, image: art('att-scope.png'), description: '4× telescopic sight: +2 when aiming (B412: +1 per second of Aim, up to the bonus).', attachment: { slot: 'optic', interfaces: ['ak-dovetail'], mods: { scope: 2 }, art: { image: art('att-scope.png'), anchorX: 0.5, anchorY: 0.85, scale: 1 } } },
  { id: 'att-reflex', name: 'Reflex sight', category: 'attachment', sub: 'Optics', tier: 2, w: 1, h: 1, weight: 0.2, value: 6000, image: art('att-reflex.png'), description: 'Red-dot reflex sight: +1 Acc (GURPS High-Tech p.156).', attachment: { slot: 'optic', interfaces: ['picatinny', 'ak-dovetail'], mods: { acc: 1 }, art: { image: art('att-reflex.png'), anchorX: 0.5, anchorY: 0.9, scale: 0.7 } } },
  { id: 'att-pbs1', name: 'PBS-1 suppressor (7.62×39)', category: 'attachment', sub: 'Muzzle Devices', tier: 2, w: 2, h: 1, weight: 0.5, value: 8000, image: art('att-suppressor.png'), description: 'Sound suppressor. Hearing rolls to notice the shot at −4 (campaign value; see High-Tech p.158). Lengthens the weapon by one cell.', attachment: { slot: 'muzzle', interfaces: ['thread-7.62x39'], mods: { note: 'Suppressed: Hearing −4 to notice' }, extend: { w: 1, h: 0 }, art: { image: art('att-suppressor.png'), anchorX: 0.02, anchorY: 0.5, scale: 1 } } },
  { id: 'att-sup9', name: 'Pistol suppressor (9×18/9×19)', category: 'attachment', sub: 'Muzzle Devices', tier: 1, w: 1, h: 1, weight: 0.25, value: 4500, image: art('att-suppressor.png'), description: 'Sound suppressor for 9 mm pistols and SMGs.', attachment: { slot: 'muzzle', interfaces: ['thread-9x18pm', 'thread-9x19', 'thread-9x18pmm'], mods: { note: 'Suppressed: Hearing −4 to notice' }, extend: { w: 1, h: 0 }, art: { image: art('att-suppressor.png'), anchorX: 0.02, anchorY: 0.5, scale: 1 } } },
  { id: 'att-foregrip', name: 'Vertical foregrip', category: 'attachment', sub: 'Foregrips', tier: 1, w: 1, h: 1, weight: 0.15, value: 1500, image: art('att-foregrip.png'), description: 'Vertical foregrip. No standard GURPS modifier (cosmetic / handling note).', attachment: { slot: 'foregrip', interfaces: ['picatinny'], mods: { note: 'Foregrip' }, art: { image: art('att-foregrip.png'), anchorX: 0.5, anchorY: 0.05, scale: 1 } } },
  { id: 'att-light', name: 'Tactical flashlight', category: 'attachment', sub: 'Tactical Devices', tier: 1, w: 1, h: 1, weight: 0.15, value: 1200, image: art('att-light.png'), description: 'Weapon light: illuminates a cone; reduces darkness penalties for the target area at GM discretion.', attachment: { slot: 'side', interfaces: ['picatinny', 'pistol-rail'], mods: { note: 'Weapon light' }, art: { image: art('att-light.png'), anchorX: 0.5, anchorY: 0.5, scale: 1 } } },

  // Armor and clothing (Basic Set B282-288 style DR; durability/DT used only when enabled)
  { id: 'arm-leather-jacket', name: 'Leather jacket', category: 'armor', sub: 'Clothing', tier: 1, w: 2, h: 2, weight: 2, value: 1500, description: 'Heavy leather: DR 1, flexible (B283).', armor: { dr: 1, locations: ['torso', 'vitals', 'arm'], flexible: true, dt: 0, dpMax: 10, material: 'leather' } },
  { id: 'arm-sunrise', name: 'Stalker suit (Sunrise pattern)', category: 'armor', sub: 'Suits', tier: 2, w: 3, h: 3, weight: 5, value: 25000, rarity: 'uncommon', description: 'Kevlar-lined stalker suit: DR 4 flexible. Campaign DT 1, 30 DP when optional armor rules are enabled.', armor: { dr: 4, locations: ['torso', 'vitals', 'groin', 'arm', 'leg'], flexible: true, dt: 1, dpMax: 30, material: 'kevlar' } },
  { id: 'arm-military-vest', name: 'Military body armor', category: 'armor', sub: 'Body Armor', tier: 3, w: 3, h: 3, weight: 8, value: 45000, rarity: 'rare', description: 'Ceramic-plate tactical vest: DR 12 torso/vitals (typical TL8 vest with plates). Campaign DT 3, 40 DP.', armor: { dr: 12, locations: ['torso', 'vitals'], flexible: false, dt: 3, dpMax: 40, material: 'ceramic' } },
  { id: 'arm-steel-helmet', name: 'Steel helmet', category: 'armor', sub: 'Helmets', tier: 1, w: 2, h: 2, weight: 1.3, value: 3000, description: 'Steel pot helmet: DR 4 skull.', armor: { dr: 4, locations: ['skull'], dt: 1, dpMax: 15, material: 'steel' } },
  { id: 'arm-sphere', name: 'Ballistic helmet', category: 'armor', sub: 'Helmets', tier: 3, w: 2, h: 2, weight: 1.6, value: 18000, rarity: 'uncommon', description: 'Kevlar/ceramic helmet: DR 8 skull.', armor: { dr: 8, locations: ['skull'], dt: 2, dpMax: 20, material: 'kevlar' } },
  { id: 'arm-gasmask', name: 'GP-5 gas mask', category: 'armor', sub: 'Masks', tier: 1, w: 2, h: 2, weight: 0.9, value: 2500, description: 'Gas mask: DR 1 face; protects against airborne contaminants (GM adjudicates).', armor: { dr: 1, locations: ['face', 'eye'], dpMax: 8 } },
  // Example gear from Build 4.5 (ids preserved for migration)
  { id: 'sample-chest-rig', name: 'Basic Chest Rig', category: 'equipment', sub: 'Tactical Rigs', tier: 1, w: 3, h: 2, weight: 0.8, value: 3500, description: 'Chest rig with six 1×2 magazine pouches.', container: { grids: [{ id: 'pouches', label: 'Pouches', w: 6, h: 2, compartments: [0, 1, 2, 3, 4, 5].map(x => ({ x, y: 0, w: 1, h: 2 })) }] } },
  { id: 'sample-backpack', name: 'Small Field Backpack', category: 'equipment', sub: 'Backpacks', tier: 1, w: 3, h: 3, weight: 1.2, value: 4000, description: 'Backpack with a 5×5 storage grid.', container: { grids: [{ id: 'main', label: 'Main compartment', w: 5, h: 5 }] } },
  { id: 'pack-large', name: 'Large Hiking Backpack', category: 'equipment', sub: 'Backpacks', tier: 2, w: 4, h: 4, weight: 2.2, value: 9000, rarity: 'uncommon', description: 'Large backpack: 6×7 main compartment.', container: { grids: [{ id: 'main', label: 'Main compartment', w: 6, h: 7 }] } },
  { id: 'sample-helmet', name: 'Basic Combat Helmet', category: 'armor', sub: 'Helmets', tier: 1, w: 2, h: 2, weight: 1.5, value: 3000, description: 'Example helmet from Build 4.5. Set DR to match the helmet model.', armor: { dr: 3, locations: ['skull'] } },
  { id: 'sample-mask', name: 'Protective Respirator Mask', category: 'armor', sub: 'Masks', tier: 1, w: 2, h: 2, weight: 0.6, value: 2000, description: 'Example protective mask from Build 4.5.', armor: { dr: 0, locations: ['face'] } },
  { id: 'sample-armor-rig', name: 'Basic Armored Carrier (No Storage)', category: 'armor', sub: 'Body Armor', tier: 2, w: 3, h: 3, weight: 4.5, value: 15000, description: 'Example armor carrier from Build 4.5. Set DR for the armor model.', armor: { dr: 8, locations: ['torso', 'vitals'] } },

  // Containers
  { id: 'cont-ammo-case', name: 'Ammo case', category: 'container', sub: 'Cases', tier: 1, w: 2, h: 2, weight: 1, value: 3000, description: 'Holds ammunition and magazines in a 4×4 grid.', container: { grids: [{ id: 'main', label: 'Ammo case', w: 4, h: 4, accepts: ['ammo', 'magazine'] }] } },
  { id: 'cont-med-case', name: 'Medical case', category: 'container', sub: 'Cases', tier: 1, w: 2, h: 2, weight: 0.8, value: 2500, description: 'Holds medical supplies in a 3×3 grid.', container: { grids: [{ id: 'main', label: 'Medical case', w: 3, h: 3, accepts: ['medical'] }] } },
  { id: 'cont-lead', name: 'Lead artifact container', category: 'container', sub: 'Cases', tier: 2, w: 1, h: 1, weight: 1.5, value: 5000, rarity: 'uncommon', description: 'Shielded container for one artifact (blocks its radiation).', container: { grids: [{ id: 'main', label: 'Shielded slot', w: 1, h: 1, accepts: ['artifact'] }] } },

  // Equipment
  { id: 'eq-detector', name: 'Anomaly detector', category: 'equipment', sub: 'Detectors', tier: 1, w: 1, h: 2, weight: 0.4, value: 6000, description: 'Beeps near anomalies. GM may grant +2 to rolls to notice anomalies.' },
  { id: 'eq-flashlight', name: 'Flashlight', category: 'equipment', sub: 'Lights', tier: 1, w: 1, h: 1, weight: 0.3, value: 600 },
  { id: 'eq-toolkit', name: 'Basic toolkit', category: 'equipment', sub: 'Tools', tier: 1, w: 2, h: 1, weight: 2, value: 3500, description: 'Tool used by repair recipes (not consumed).' },
  { id: 'eq-bread', name: 'Loaf of bread', category: 'equipment', sub: 'Food & Drink', tier: 1, w: 1, h: 1, stack: 5, weight: 0.4, value: 60, consumable: { fp: 1 } },
  { id: 'eq-canned', name: 'Canned meat', category: 'equipment', sub: 'Food & Drink', tier: 1, w: 1, h: 1, stack: 5, weight: 0.35, value: 120, consumable: { fp: 1 } },
  { id: 'eq-vodka', name: 'Vodka', category: 'equipment', sub: 'Food & Drink', tier: 1, w: 1, h: 1, stack: 3, weight: 0.6, value: 200, description: 'Zone folk remedy for radiation (campaign effect: removes Irradiated at GM discretion).', consumable: { cures: ['Irradiated'] } },

  // Medical
  { id: 'med-bandage', name: 'Bandage', category: 'medical', sub: 'Bandages', tier: 1, w: 1, h: 1, stack: 5, weight: 0.05, value: 150, description: 'Bandaging stops bleeding and restores 1 HP (B424).', consumable: { heal: 1, cures: ['Bleeding'] } },
  { id: 'med-kit', name: 'First aid kit', category: 'medical', sub: 'Medkits', tier: 1, w: 1, h: 1, weight: 0.5, value: 900, description: 'First Aid roll; success restores 1d HP (campaign value based on B424) and stops bleeding.', consumable: { skill: 'First Aid', heal: '1d', cures: ['Bleeding'] } },
  { id: 'med-army-kit', name: 'Army medkit', category: 'medical', sub: 'Medkits', tier: 2, w: 1, h: 1, weight: 0.6, value: 2200, rarity: 'uncommon', description: 'First Aid +1; success restores 1d+1 HP (campaign value).', consumable: { skill: 'First Aid', skillMod: 1, heal: '1d+1', cures: ['Bleeding'] } },
  { id: 'med-antirad', name: 'Anti-radiation drugs', category: 'medical', sub: 'Anti-radiation', tier: 1, w: 1, h: 1, stack: 3, weight: 0.05, value: 1100, consumable: { cures: ['Irradiated'] } },
  { id: 'med-painkiller', name: 'Painkillers', category: 'medical', sub: 'Drugs', tier: 1, w: 1, h: 1, stack: 5, weight: 0.05, value: 500, description: 'Ignore shock penalties for one hour (campaign effect; GM applies).', consumable: {} },

  // Crafting materials
  { id: 'mat-gunparts', name: 'Gun parts', category: 'material', sub: 'Parts', tier: 1, w: 1, h: 1, stack: 10, weight: 0.3, value: 400 },
  { id: 'mat-cloth', name: 'Clean cloth', category: 'material', sub: 'Repair', tier: 1, w: 1, h: 1, stack: 10, weight: 0.1, value: 50 },
  { id: 'mat-chem', name: 'Chemical reagents', category: 'material', sub: 'Chemicals', tier: 1, w: 1, h: 1, stack: 10, weight: 0.2, value: 300 },
  { id: 'mat-electronics', name: 'Electronic scrap', category: 'material', sub: 'Electronics', tier: 1, w: 1, h: 1, stack: 10, weight: 0.2, value: 250 },
  { id: 'mat-kevlar', name: 'Kevlar patch', category: 'material', sub: 'Repair', tier: 2, w: 1, h: 1, stack: 10, weight: 0.1, value: 700 },
  { id: 'mat-mutant-tail', name: 'Blind dog tail', category: 'material', sub: 'Mutant Parts', tier: 1, w: 1, h: 1, stack: 5, weight: 0.2, value: 350 },

  // Artifacts (effects are descriptive; the GM applies them)
  { id: 'art-jellyfish', name: 'Jellyfish', category: 'artifact', sub: 'Gravitational', tier: 1, w: 1, h: 1, weight: 0.5, value: 8000, rarity: 'uncommon', description: 'Slowly draws radiation from the body. Campaign effect.', artifact: { effects: ['Removes Irradiated after 1 day worn'], radiation: 0 } },
  { id: 'art-stoneblood', name: 'Stone Blood', category: 'artifact', sub: 'Chemical', tier: 1, w: 1, h: 1, weight: 0.6, value: 6000, rarity: 'uncommon', artifact: { effects: ['+1 HT for natural healing rolls (campaign)', 'Emits radiation'], radiation: 1 } },
  { id: 'art-fireball', name: 'Fireball', category: 'artifact', sub: 'Fire', tier: 2, w: 1, h: 1, weight: 0.4, value: 14000, rarity: 'rare', artifact: { effects: ['Warms the bearer; +2 vs cold (campaign)'], radiation: 1 } },
  { id: 'art-flash', name: 'Flash', category: 'artifact', sub: 'Electrical', tier: 2, w: 1, h: 1, weight: 0.3, value: 12000, rarity: 'rare', artifact: { effects: ['Restores 1 FP per hour (campaign)'], radiation: 1 } },

  // Misc
  { id: 'misc-flashdrive', name: 'Encrypted flash drive', category: 'misc', sub: 'Documents', tier: 1, w: 1, h: 1, weight: 0.02, value: 2000, rarity: 'uncommon' },
  { id: 'misc-documents', name: 'Classified documents', category: 'misc', sub: 'Documents', tier: 2, w: 1, h: 1, weight: 0.1, value: 5000, rarity: 'rare', tags: ['quest'] },
  { id: 'misc-watch', name: 'Wristwatch', category: 'misc', sub: 'Valuables', tier: 1, w: 1, h: 1, weight: 0.05, value: 900 },
];

function buildDefs() {
  const out = {};
  for (const d of [...legacyDefs(), ...EXTRA]) out[d.id] = normalizeDef(d);
  return out;
}

const SKILLS = (list) => list.map(([name, spec, level]) => ({ name, spec, level, rsl: '', points: 0 }));
const BUILD = (o) => ({ source: 'template', name: o.name, st: o.st ?? 10, dx: o.dx ?? 10, iq: o.iq ?? 10, ht: o.ht ?? 10, hp: o.hp ?? o.st ?? 10, fp: o.fp ?? o.ht ?? 10, will: o.will ?? o.iq ?? 10, per: o.per ?? o.iq ?? 10, basicSpeed: o.speed ?? ((o.dx ?? 10) + (o.ht ?? 10)) / 4, basicMove: o.move ?? Math.floor(((o.dx ?? 10) + (o.ht ?? 10)) / 4), dodge: Math.floor(o.speed ?? ((o.dx ?? 10) + (o.ht ?? 10)) / 4) + 3, skills: SKILLS(o.skills || []), traits: (o.traits || []).map(([name, points, kind]) => ({ name, points, kind })), weapons: o.weapons || [], equipment: [], notes: [], points: { total: o.points ?? null }, hitLocations: [], naturalDR: o.dr || {}, flags: o.flags || {}, profile: {}, attributes: {} });

const NPC_TEMPLATES = [
  { id: 'tpl-bandit', name: 'Bandit', archetype: 'Human', faction: 'Bandits', rank: 2, quality: 'poor', money: [100, 900],
    build: BUILD({ name: 'Bandit', st: 11, dx: 11, iq: 9, ht: 10, skills: [['Guns', 'Pistol', 12], ['Guns', 'Shotgun', 12], ['Guns', 'SMG', 11], ['Guns', 'Rifle', 11], ['Knife', '', 12], ['Brawling', '', 12], ['Intimidation', '', 10], ['Stealth', '', 10], ['Observation', '', 9]], traits: [['Bad Temper', -10, 'disadvantage'], ['Greed', -15, 'disadvantage']] }),
    loadout: [{ slot: 'primary', options: [{ defId: 't1-weapon-sawed-off', weight: 3 }, { defId: 't1-weapon-mp-133', weight: 2 }, { defId: 't1-weapon-pp-91-kedr', weight: 2 }, { defId: 'builtin-akm-76239', weight: 1 }], mags: [1, 3] }, { slot: 'holster', options: ['t1-weapon-pm', 't1-weapon-tt'], chance: 0.6, mags: [1, 2] }, { slot: 'armor', options: ['arm-leather-jacket'], chance: 0.8 }, { slot: 'melee', options: ['melee-knife'], chance: 0.5 }],
    loot: [{ defId: 'eq-bread', chance: 0.5, qty: [1, 2] }, { defId: 'eq-vodka', chance: 0.4, qty: [1, 1] }, { defId: 'med-bandage', chance: 0.6, qty: [1, 3] }, { defId: 'misc-watch', chance: 0.15 }] },
  { id: 'tpl-loner', name: 'Loner', archetype: 'Human', faction: 'Loners', rank: 3, quality: 'standard', money: [200, 1500],
    build: BUILD({ name: 'Loner', st: 10, dx: 12, iq: 10, ht: 11, skills: [['Guns', 'Rifle', 13], ['Guns', 'Pistol', 12], ['Guns', 'Shotgun', 12], ['Guns', 'SMG', 12], ['Knife', '', 11], ['First Aid', '', 11], ['Survival', 'Radioactive Wasteland', 11], ['Observation', '', 11], ['Stealth', '', 11]] }),
    loadout: [{ slot: 'primary', options: [{ defId: 't1-weapon-sks', weight: 2 }, { defId: 't1-weapon-mosin-infantry', weight: 1 }, { defId: 't1-weapon-vpo-136-vepr-km', weight: 2 }, { defId: 'builtin-akm-76239', weight: 1 }], mags: [2, 3] }, { slot: 'holster', options: ['t1-weapon-pm', 't1-weapon-cz-75b'], chance: 0.7 }, { slot: 'armor', options: [{ defId: 'arm-leather-jacket', weight: 2 }, { defId: 'arm-sunrise', weight: 1 }] }, { slot: 'rig', options: ['sample-chest-rig'], chance: 0.5 }],
    loot: [{ defId: 'med-kit', chance: 0.6 }, { defId: 'med-bandage', chance: 0.7, qty: [1, 3] }, { defId: 'eq-canned', chance: 0.5 }, { defId: 'med-antirad', chance: 0.4 }] },
  { id: 'tpl-soldier', name: 'Soldier', archetype: 'Human', faction: 'Military', rank: 4, quality: 'good', money: [300, 1200],
    build: BUILD({ name: 'Soldier', st: 11, dx: 12, iq: 10, ht: 12, skills: [['Guns', 'Rifle', 14], ['Guns', 'Pistol', 13], ['Guns', 'SMG', 13], ['Tactics', '', 11], ['Knife', '', 12], ['First Aid', '', 11], ['Observation', '', 11]], traits: [['Fit', 5, 'advantage'], ['Duty (Army)', -10, 'disadvantage']] }),
    loadout: [{ slot: 'primary', options: [{ defId: 'builtin-akm-76239', weight: 3 }, { defId: 't1-weapon-vpo-136-vepr-km', weight: 1 }], mags: [3, 4] }, { slot: 'holster', options: ['t1-weapon-pm'], mags: [1, 2] }, { slot: 'armor', options: [{ defId: 'arm-military-vest', weight: 1 }, { defId: 'arm-sunrise', weight: 1 }] }, { slot: 'helmet', options: ['arm-steel-helmet', 'arm-sphere'], chance: 0.8 }, { slot: 'rig', options: ['sample-chest-rig'] }],
    loot: [{ defId: 'med-army-kit', chance: 0.5 }, { defId: 'med-bandage', chance: 0.8, qty: [1, 3] }, { defId: 'misc-documents', chance: 0.05 }] },
  { id: 'tpl-blind-dog', name: 'Blind Dog', archetype: 'Mutant', faction: 'Mutants', rank: 2, quality: 'poor',
    build: BUILD({ name: 'Blind Dog', st: 8, dx: 13, iq: 4, ht: 11, hp: 9, per: 13, speed: 6, move: 9, skills: [['Brawling', '', 13], ['Tracking', '', 13]], weapons: [{ id: 'bite', owner: 'Bite', usage: '', kind: 'melee', level: 13, damage: '1d-1 cut', reach: 'C', skill: 'Brawling' }] }),
    loadout: [], loot: [{ defId: 'mat-mutant-tail', chance: 0.6 }] },
  { id: 'tpl-flesh', name: 'Flesh', archetype: 'Mutant', faction: 'Mutants', rank: 2, quality: 'poor',
    build: BUILD({ name: 'Flesh', st: 15, dx: 9, iq: 3, ht: 12, hp: 18, speed: 5, move: 5, skills: [['Brawling', '', 11]], weapons: [{ id: 'charge', owner: 'Ram / bite', usage: '', kind: 'melee', level: 11, damage: '1d+2 cr', reach: 'C', skill: 'Brawling' }], dr: { all: 1 } }),
    loadout: [], loot: [] },
  { id: 'tpl-bloodsucker', name: 'Bloodsucker', archetype: 'Mutant', faction: 'Mutants', rank: 5, quality: 'poor',
    build: BUILD({ name: 'Bloodsucker', st: 16, dx: 13, iq: 6, ht: 13, hp: 20, speed: 7, move: 8, skills: [['Brawling', '', 15], ['Stealth', '', 15]], weapons: [{ id: 'claws', owner: 'Claws', usage: '', kind: 'melee', level: 15, damage: '2d cut', reach: 'C,1', skill: 'Brawling' }, { id: 'tentacles', owner: 'Mouth tentacles', usage: '', kind: 'melee', level: 14, damage: '1d+2 imp', reach: 'C', skill: 'Brawling' }], dr: { all: 2 }, flags: { highPainThreshold: true } }),
    loadout: [], loot: [] },
];

const RECIPES = [
  { id: 'rc-bandage', name: 'Improvised bandages', inputs: [{ defId: 'mat-cloth', qty: 2 }], tools: [], skill: { name: 'First Aid', mod: 0 }, output: { defId: 'med-bandage', qty: 2 }, time: '10 minutes', notes: 'Medical crafting.' },
  { id: 'rc-medkit', name: 'Assemble first aid kit', inputs: [{ defId: 'med-bandage', qty: 3 }, { defId: 'mat-chem', qty: 1 }], tools: [], skill: { name: 'First Aid', mod: -2 }, output: { defId: 'med-kit', qty: 1 }, time: '30 minutes' },
  { id: 'rc-antirad', name: 'Brew anti-radiation drugs', inputs: [{ defId: 'mat-chem', qty: 2 }, { defId: 'eq-vodka', qty: 1 }], tools: [], skill: { name: 'Pharmacy', mod: 0 }, output: { defId: 'med-antirad', qty: 1 }, time: '2 hours', loseOnFailure: true },
  { id: 'rc-gunrepair', name: 'Weapon maintenance (+25% condition)', inputs: [{ defId: 'mat-gunparts', qty: 2 }], tools: ['eq-toolkit'], skill: { name: 'Armoury', mod: 0 }, repair: { categories: ['weapon'], amount: 25 }, time: '1 hour' },
  { id: 'rc-armorrepair', name: 'Patch armor (+20% condition)', inputs: [{ defId: 'mat-kevlar', qty: 1 }, { defId: 'mat-cloth', qty: 1 }], tools: ['eq-toolkit'], skill: { name: 'Armoury', mod: -1 }, repair: { categories: ['armor'], amount: 20 }, time: '1 hour' },
];

const PERKS = [
  { id: 'perk-steady', name: 'Steady Hands', description: '+1 to Guns when braced (campaign perk).', minRank: 2 },
  { id: 'perk-zone-sense', name: 'Zone Sense', description: '+2 to notice anomalies (campaign perk).', minRank: 3 },
  { id: 'perk-pack-mule', name: 'Pack Mule', description: 'Basic Lift calculated as if ST +1 (campaign perk).', minRank: 3 },
  { id: 'perk-fast-reload', name: 'Fast Reload', description: 'Magazine changes take one less second (campaign perk).', minRank: 4 },
];

module.exports = { buildDefs, NPC_TEMPLATES, RECIPES, PERKS, LEGACY_FILE };
