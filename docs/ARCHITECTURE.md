# Architecture

```
┌─────────────────────────── Electron (src/desktop) ───────────────────────────┐
│ GM window   player windows   pop-outs        native: file dialogs, menus     │
│      │            │              │            GCS launch (bundled gcs.exe)   │
│      └────── HTTP + WebSocket ───┘                                           │
│                    │                                                         │
│  ┌──────── Host (src/server/host.js) ────────┐   remote players (LAN/Radmin) │
│  │ sessions & join codes, static UI, assets  │◄── browser or desktop app     │
│  │ per-viewer views, broadcast, host commands│                               │
│  │   │             │              │          │                               │
│  │ Engine      GcsService     TtsBridge      │──► Tabletop Simulator         │
│  │ (core)      (watch .gcs)   (39999/39998)  │    External Editor API        │
│  │   │                                       │                               │
│  │ CampaignStore: snapshot + fsync'd journal + gzip backups + asset library  │
│  └───────────────────────────────────────────┘                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Layers

### `src/core/` — the domain (pure CommonJS)

These modules have no I/O and no UI. They are fully unit-tested.

| Module | Responsibility |
| --- | --- |
| `context.js` | Randomness, ids and time. Each action records a *tape*, so a journal entry replays exactly. |
| `dice.js` | 3d6 success rolls and criticals (B347-348), quick and regular contests, damage-expression parsing and rolling. |
| `rules.js` | GURPS 4e tables: SSR range/speed (extended without a limit), rapid fire, hits from margin, Dodge vs rapid fire, hit locations, wounding, injury with DR/armor divisor/limb caps, shock, major wounds, HP thresholds, encumbrance, postures, cover, maneuvers, modifier builders. |
| `catalog.js` | Item **definitions**. Compatibility uses explicit ids: caliber ids, magazine families, mount interfaces. |
| `inventory.js` | The single inventory engine for characters, NPCs, stashes, traders and containers. Each item has exactly one location (grid / slot / mount), so a transfer can never duplicate an item. Handles collision, compartments, rotation, the recursion guard, stacks and weight. |
| `weapons.js` | Magazines as real objects. Rounds are a stack list, so the last loaded round is fired first. Also chambers, integral feeds, load/unload, firing, attachments (the footprint grows) and effective stats with a breakdown. |
| `armor.js` | Layered DR by location, natural DR from the sheet, and the optional campaign DT/DP/condition rules and blunt trauma. |
| `characters.js` | The character model: `build` (owned by GCS) and `session` (owned by the companion). Skill lookup with defaults, derived Dodge/Move, and import that preserves damage. |
| `gcs.js` | Reader for native `.gcs` files (versions 2–5). It uses **GCS's own saved calculations** (`calc` blocks) and never re-derives GCS math. |
| `combat.js` | Encounters, turn order, maneuvers and aim, and the event pipeline: **calculated → awaiting-defense → resolved → applied** (or ignored/closed). Also GM overrides, notifications, undo, skill rolls, contests and follow-up rolls. |
| `traders.js` | Shop generation (type, tier, rarity, condition, economy), pricing, and atomic buy/sell. |
| `npcs.js` | Template-based generation. It is rank- and quality-aware and only issues compatible magazines and ammunition. Also duplication with separate inventories. |
| `crafting.js` | Recipes, repairs, consumables (as proposals), and jobs that pay exactly once. |
| `engine.js` | The **only** way state changes. |
| `views.js` | Per-viewer projections. Players never receive hidden NPC stats, GM notes, GM-only rolls, concealed target numbers or unreleased loot. |
| `campaign.js` | Schema, default settings (vanilla rules separated from campaign rules) and migrations. |
| `legacy.js` | Migration from Build 4.5 / 0.8 / 0.9 save maps, with a report. |
| `seed.js` | Starter content: the Tier 1 catalog converted, plus armor, medical supplies, artifacts, attachments, recipes, NPC templates and perks. |

`engine.js` checks every action in this order:

1. Permission check against the role and ownership.
2. Idempotency check by `requestId`. Duplicate packets and double clicks return the first result.
3. The action runs on a draft copy, so it is atomic: if it errors, nothing changes.
4. The action is written to the journal.
5. An audit log entry is written. GM overrides are flagged automatically.

### `src/server/` — host, storage and integrations

* `host.js` is an HTTP server for the UI, assets, upload/export/import/migrate endpoints and a WebSocket for actions and views. Sessions use HttpOnly SameSite=Strict cookies:
  * the GM gets a per-launch token,
  * players log in with a scrypt-hashed join code,
  * local player windows use one-time links.
  It binds to 127.0.0.1 by default. With LAN hosting enabled it binds to 0.0.0.0, which also works over Radmin VPN.
* `storage.js` keeps one folder per campaign. It holds:
  * `campaign.json`, the atomic snapshot,
  * `journal.ndjson`, with an fsync on every action,
  * `backups/*.json.gz`, which rotate,
  * `assets/` (content-addressed by SHA-256; originals are never overwritten),
  * a lock file, which detects crashes.
  On open, it replays the journal and reports the recovery.
* `gcs-service.js` finds the bundled `gcs.exe`, launches GCS, and polls linked `.gcs` files. GCS saves atomically. When a file changes it is imported.
* `tts-bridge.js` sends Lua to TTS (port 39999) and receives `sendExternalMessage` messages (port 39998).

### `src/ui/` — the renderer

It is built with Preact and htm as ES modules, with no bundler. The UI only *requests* actions. All rules run on the host.

| File | Contents |
| --- | --- |
| `inventory.js` | Grids, slots, pointer-based drag and drop (with rotation while dragging), **layered weapon art** (base PNG plus attachment overlays at the mount anchors, with variant and fallback priority), context menus, the inspector. |
| `events.js` | Roll/attack event cards with full calculation breakdowns and GM decision controls. |
| `combat.js` | Attack form, maneuvers, skill roller, vitals, and the player combat page. |
| `gm-dashboard.js` | The three-panel GM dashboard and the pending queue. |
| `gm-manage.js` | Managers for NPCs, encounters, characters, traders, the campaign and settings. |
| `gm-catalog.js` | The item editor, the image library (import, auto-fit trim stored as metadata, background removal into a *new* derived PNG) and the anchor editor. |
| `character.js`, `equipment.js`, `player.js` | Player pages. |

## Data model (abridged)

```
campaign = { schema, id, name, test, settings{rules, economy, ranks...}, players{},
  defs{ id: { name, category, sub, w, h, weight, value, stack, image, rarity, traders[],
              weapon{ kind, skill, damage, acc, range, rof, shots, bulk, rcl, calibers[],
                      magFamilies[], integral{capacity}, mounts[{id, slot, interfaces[], x, y, rot, scale, z, offsets}] },
              magazine{ family, capacity, calibers[] }, ammo{ caliber, divisor, woundShift, projectiles, onlyWeapons[] },
              attachment{ slot, interfaces[], mods{acc, scope, rcl, bulk, note}, extend{w,h}, art{image, anchorX, anchorY, scale} },
              armor{ dr, locations[], flexible, dt, dpMax }, container{ grids[] }, consumable{}, artifact{} } },
  items{ id: { defId, qty, cond, loc, rounds:[[ammoDefId, n]...], chamber, dp, hidden } },
  characters{ id: { kind: 'pc'|'npc', ownerId, rank, perks[], build{...GCS...}, gcs{path, hash, sync},
                    session{ hp, fp, conditions[], injuries[], posture, money, notes }, gmNotes, hidden, reveal } },
  stashes{}, traders{}, encounters{ id: { status, round, turn, order[], combatants{}, distances{}, env, lootReleased[] } },
  events{ id: { kind, stage, attack{}, defense{}, damage{hits[]}, proposal{}, applications[], notifications[], overrides[] } },
  npcTemplates{}, recipes{}, jobs{}, perks{}, assets{}, ledger[], log[], trash[], tts{links}, meta{seq, processed} }
```

## Rules policy

* Defaults follow the Basic Set. Each modifier carries a source (`B550`, `B364`, …) that the UI shows.
* Missing environmental information produces a warning rather than an assumption. For example, if no range is set, no range penalty is applied and the roll says so.
* Optional and campaign rules are separate switches, all off by default: blunt trauma, DT, DP and condition-scaled DR. *High-Tech* ammunition effects are on by default and can be switched off.
* HP never changes automatically.
  * NPC damage is applied only by `combat.apply` (GM only).
  * PC damage is applied either by the GM or by the player acting on a GM notification.
  * Every application can be undone exactly.
