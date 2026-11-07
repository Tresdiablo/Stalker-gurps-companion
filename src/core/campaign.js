'use strict';
/**
 * Campaign state shape, defaults and schema migrations.
 */
const seed = require('./seed');
const { RANKS } = require('./characters');
const { RANK_NPC } = require('./npcs');

const SCHEMA_VERSION = 2;

const DEFAULT_RULES = {
  // GURPS High-Tech ammunition effects (hollow-point, AP, buckshot). Standard GURPS 4e supplement rules.
  ammoEffects: true,
  // Optional Basic Set rule (B379).
  bluntTrauma: false,
  // Campaign-specific S.T.A.L.K.E.R. armor rules — all off by default.
  armorDT: false,
  armorDurability: false,
  conditionAffectsDR: false,
  // One-second combat (GURPS standard): turn order, readying items, reload time.
  readyRequired: true, // attacks need the weapon in hands; readying takes a turn (B366)
  enforceTurns: true, // players act only on their own turn during combat
  skipDown: true, // dead/unconscious combatants are skipped in the turn order
  autoEndTurn: true, // a turn ends by itself once it is used (attack, aim, drawing, Ready-slot action)
  autoNpcDefense: true, // NPCs roll their best active defense automatically (the GM can still undo)
  // Workflow options.
  crafting: true,
  playerSelfAdjust: true, // players may adjust their own HP/FP manually (e.g. when told by the GM)
  npcStatusToPlayers: 'descriptive', // 'none' | 'descriptive' | 'exact'
  showDamageToPlayers: false, // show applied injury numbers to players
};

function defaultSettings() {
  return {
    rules: { ...DEFAULT_RULES },
    economy: { priceMult: 1, currency: '₽', stockKinds: null, condition: null, availability: {} },
    ranks: RANKS.map((name, i) => ({ name, npc: { ...RANK_NPC[i] }, requirement: '' })),
    perkPerRank: 1,
    autosaveSeconds: 20,
    hostLan: false,
    port: 7788,
  };
}

/**
 * New campaign. The item catalog starts EMPTY unless seedCatalog is set; the built-in starter
 * catalog can be added later from the Item Catalog ("Load starter catalog").
 */
function emptyCampaign(ctx, { name = 'S.T.A.L.K.E.R. Campaign', seedContent = true, seedCatalog = false, test = false } = {}) {
  const s = {
    schema: SCHEMA_VERSION,
    id: ctx.uid('cmp_'),
    name,
    test,
    createdAt: ctx.now(),
    notes: '',
    gmNotes: '',
    settings: defaultSettings(),
    players: {},
    defs: {},
    items: {},
    characters: {},
    stashes: {},
    traders: {},
    encounters: {},
    events: {},
    eventSeq: 0,
    npcTemplates: {},
    recipes: {},
    jobs: {},
    perks: {},
    perkRequests: [],
    assets: {},
    ledger: [],
    log: [],
    trash: [],
    tts: { links: {} },
    meta: { processed: {}, seq: 0 },
  };
  if (seedContent) {
    for (const t of seed.NPC_TEMPLATES) {
      const copy = JSON.parse(JSON.stringify(t));
      if (!seedCatalog) { copy.loadout = []; copy.loot = []; } // gear refers to catalog items
      s.npcTemplates[t.id] = copy;
    }
    for (const p of seed.PERKS) s.perks[p.id] = { ...p };
    if (seedCatalog) addStarterCatalog(s);
  }
  return s;
}

/**
 * Add the built-in starter catalog (Tier 1 weapons, magazines, ammunition, armor, medical,
 * artifacts, attachments, containers), its recipes and the NPC template gear. Existing
 * definitions with the same id are left untouched. Returns counts.
 */
function addStarterCatalog(s) {
  let defs = 0, recipes = 0, templates = 0;
  for (const [id, d] of Object.entries(seed.buildDefs())) if (!s.defs[id]) { s.defs[id] = d; defs++; }
  for (const r of seed.RECIPES) if (!s.recipes[r.id]) { s.recipes[r.id] = { enabled: true, ...JSON.parse(JSON.stringify(r)) }; recipes++; }
  for (const t of seed.NPC_TEMPLATES) {
    const cur = s.npcTemplates[t.id];
    if (!cur) { s.npcTemplates[t.id] = JSON.parse(JSON.stringify(t)); templates++; }
    else if (!(cur.loadout || []).length && !(cur.loot || []).length) { cur.loadout = JSON.parse(JSON.stringify(t.loadout)); cur.loot = JSON.parse(JSON.stringify(t.loot)); templates++; }
  }
  return { defs, recipes, templates };
}

/** Upgrade older campaign files in place. */
function migrate(s) {
  const report = [];
  if (!s.schema) { s.schema = 1; report.push('Initialized schema version.'); }
  const base = defaultSettings();
  s.settings = { ...base, ...(s.settings || {}), rules: { ...DEFAULT_RULES, ...(s.settings?.rules || {}) }, economy: { ...base.economy, ...(s.settings?.economy || {}) } };
  for (const k of ['players', 'defs', 'items', 'characters', 'stashes', 'traders', 'encounters', 'events', 'npcTemplates', 'recipes', 'jobs', 'perks', 'assets']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  for (const k of ['ledger', 'log', 'trash', 'perkRequests']) if (!Array.isArray(s[k])) s[k] = [];
  s.tts = s.tts || { links: {} };
  s.meta = s.meta || { processed: {}, seq: 0 };
  s.meta.processed = s.meta.processed || {};
  if (s.schema < 2) {
    // schema 2: the old "In hands" slot (id 'ready') becomes 'hands'; 'ready' is now the staging slot
    let n = 0;
    for (const it of Object.values(s.items)) if (it.loc?.slot === 'ready') { it.loc.slot = 'hands'; n++; }
    s.schema = 2;
    report.push(`Moved ${n} held item(s) into the new Hands slot.`);
  }
  return report;
}

module.exports = { SCHEMA_VERSION, DEFAULT_RULES, defaultSettings, emptyCampaign, addStarterCatalog, migrate };
