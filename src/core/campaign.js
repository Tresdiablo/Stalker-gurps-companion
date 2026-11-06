'use strict';
/**
 * Campaign state shape, defaults and schema migrations.
 */
const seed = require('./seed');
const { RANKS } = require('./characters');
const { RANK_NPC } = require('./npcs');

const SCHEMA_VERSION = 1;

const DEFAULT_RULES = {
  // GURPS High-Tech ammunition effects (hollow-point, AP, buckshot). Standard GURPS 4e supplement rules.
  ammoEffects: true,
  // Optional Basic Set rule (B379).
  bluntTrauma: false,
  // Campaign-specific S.T.A.L.K.E.R. armor rules — all off by default.
  armorDT: false,
  armorDurability: false,
  conditionAffectsDR: false,
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

function emptyCampaign(ctx, { name = 'S.T.A.L.K.E.R. Campaign', seedContent = true, test = false } = {}) {
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
    s.defs = seed.buildDefs();
    for (const t of seed.NPC_TEMPLATES) s.npcTemplates[t.id] = JSON.parse(JSON.stringify(t));
    for (const r of seed.RECIPES) s.recipes[r.id] = { enabled: true, ...JSON.parse(JSON.stringify(r)) };
    for (const p of seed.PERKS) s.perks[p.id] = { ...p };
  }
  return s;
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
  return report;
}

module.exports = { SCHEMA_VERSION, DEFAULT_RULES, defaultSettings, emptyCampaign, migrate };
