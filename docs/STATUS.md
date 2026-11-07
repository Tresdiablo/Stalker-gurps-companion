# Development status — 1.0.0-beta.1

This rebuild replaces the v0.9 / Build 4.5 global-script application with a layered architecture (see `ARCHITECTURE.md`):

* an authoritative engine,
* per-viewer views,
* durable storage,
* a modular UI.

The original source is kept untouched in `legacy/v0.9-source/` for reference and rollback.

## GCS integration — what it is and is not

GCS is a native Go/Unison application. Its editor cannot be embedded inside the Electron window without porting its whole UI, so **single-window embedding is not done**. Instead:

* The installer bundles the **complete, unmodified official GCS 5.58.1** Windows release. The download is SHA-256-pinned and verified, and the MPL-2.0 notice is shipped with it. GCS runs in its own native window.
* All of GCS works in that window: creation, templates, libraries, advancement, calculators and file formats.
* The companion links each character (PC or NPC) to an original `.gcs` file. It watches the file and, whenever GCS saves, imports **GCS's own saved calculations**: attribute values, skill levels and relative levels, weapon levels and damage, Move/Dodge per encumbrance level, and hit-location DR.
* `.gcs` files are never written to. The companion owns session data (current HP/FP, conditions, inventory, ammunition and so on).
* Re-imports preserve damage already taken. If the sheet's recorded HP differs from the tracked HP, the companion shows a conflict notice with a one-click "Use GCS values".
* Remote players without the file can upload a `.gcs` file instead; that is a one-time import.
* The reader was checked against all **648 `.gcs` files of the official GCS master library**. All parsed, and the point totals reconcile with GCS. (Those files are not redistributed here.)

## Completed (working, persistent, tested)

| Area | Notes |
| --- | --- |
| Storage and recovery | Atomic snapshots and an fsync'd per-action journal with deterministic replay, so nothing is lost after a crash. Also: rotating and named gzip backups, restore with a safety backup, portable campaign packages including images, a test-campaign flag, and character export/import. |
| Migration | Converts Build 4.5 / 0.8 / 0.9 saves (desktop `profiles.json` or a chosen file) into a new campaign, with a detailed report of what was migrated, warnings, and what was not transferred. The old data is never modified. |
| Permissions | Enforced in the engine, not only by hiding buttons. Players cannot: control NPCs, change NPC HP, see hidden NPCs/stats/GM notes/GM-only rolls/concealed target numbers/unreleased loot, create money or items, override calculations, or use host commands. |
| Dice and rules | 3d6 success and criticals, contests, skill defaults, range/speed (SSR extended past 10,000 yd), Acc/aim/brace/scope, posture, cover, size, darkness, rapid fire and hits from margin, Dodge vs rapid fire, retreat, dodge-and-drop, hit locations (random and targeted), wounding modifiers, armor divisor, minimum injury, limb crippling and caps, shock, major-wound knockdown rolls, HP/FP thresholds and death checks (rolled by the GM), encumbrance, 1/2D halving, *High-Tech* ammunition effects. Each modifier lists its page reference. |
| Combat pipeline | Calculated → awaiting defense → resolved → applied / ignored. HP never changes automatically. GM tools: apply calculated or custom amount, FP, conditions, ignore, notify player, exact undo. GM overrides (effective skill, hit/miss, hit count, target, per-hit injury) are logged automatically. Duplicate packets and double clicks are absorbed. Ammunition is deducted when fired, and firing more than is loaded is refused. |
| GM dashboard | Combatants (HP/FP, conditions, weapon and ammo, DR, turn marker), live feed with filters, pending-decision queue, a selected-target panel (quick HP/FP, conditions, posture, cover, SM, speed, distances, temporary modifiers, NPC attacks and rolls, roll requests, quick contests, loot release, reveal/hide), and keyboard shortcuts. |
| Player combat | Weapon, target, hit location, shots (limited by RoF and rounds), range, quick modifiers, maneuvers (Aim accumulates on the same weapon and target; Ready), posture, defense prompts, GM notifications with one-click self-apply, skill and attribute rolls, GM roll requests (public / GM-only / concealed). |
| Inventory | Dragging stays aligned with the cursor at any Settings → Interface scale (the drag ghost has the item's grid size, also when picked up from an equipment slot). One engine for characters, NPCs, stashes, traders and containers. Grid snapping, collisions, compartments, accepted-category restrictions, rotation (button, `R` key, or while dragging), stacks (merge, split, sort), contents travelling with containers, recursion guard, equipment slots, pockets, ground, weight and encumbrance, drag and drop, context menus, search, quick transfer. |
| Weapons | Magazines are real items that keep their rounds. Mixed loads fire last-in-first-out. Chambered rounds, integral feeds, load/unload/quick-load, insert/eject/swap, explicit caliber/family/interface compatibility (for example PMM ammo fits only the Klin), attachments that lengthen the weapon, and effective stats with a breakdown. |
| Modular art | Base PNG with layered attachment overlays at per-weapon anchors (position, rotation, scale, layer, per-model offsets). The fallback chain is layered art, then a preconfigured variant, then the base image or a silhouette. The whole assembly moves and rotates as one object. The anchor editor has a live compatible preview. The image library supports PNG import, auto-fit trim (stored as metadata) and background removal into a new derived file; originals are never altered. |
| Armor | Layered DR by location plus natural DR. Optional rules, each off by default: blunt trauma (B379), DT, DP, condition-scaled DR. DP loss is applied only when the GM applies the damage. |
| NPCs | Manager (search, faction filter, identity, ranks, manual stats, full inventory, sheet, GCS link), template generation by faction/rank/quality/count with compatible magazines and ammunition, duplication with separate inventories, templates from existing NPCs, persistence. |
| Encounters | Create, add PCs and NPCs, generate groups into the encounter, turn order by Basic Speed and DX (reorderable), rounds, environment, per-pair distances, start/next/end/archive, loot release, persistence. |
| Traders | Six trader types, Generate Shop (specialization, tier, rarity, condition, economy settings, stock limits), GM editing and price overrides, open for chosen characters, atomic buy and sell (funds, stock and space all checked), ledger. |
| Campaign systems | Crafting (green/red availability, tools, skill rolls, repair recipes, result created exactly once), consumables (as proposals, self-apply for own PC), jobs (objectives, assignment, rewards paid exactly once), eight ranks plus perks (requests, approvals, allowance), stashes with access lists, notes, audit log, trash restore. |
| GM controls | NPC control bar (auto-follows NPC turns, nearest-PC target, attack / reload / aim / maneuver / posture / next turn, secret rolls); searchable spawn picker (`G`) aimed at the selected character; catalog "Spawn into" receiver with + / double-click / right-click; one-click Reload for any firearm (best magazine or loose rounds); bulk distances; quick encounter with all PCs; Ctrl+click quick transfer. |
| Turn cycle | Turn bar with round / current / next; "Your turn" pop-up and chime for the player whose character acts; "NPC turn" pop-up for the GM naming the NPC and who is next; players end their own turn (button or `E`, stale clicks ignored); downed combatants skipped; options to enforce turn order. |
| 1-second combat | Hands slot (drawing takes the turn, Fast-Draw makes it instant), Sling/Back carry slots, and a Ready slot that stages an item for the next turn: magazines (grab + load = 2 turns, Fast-Draw (Ammo) = 1), loose rounds (1 per turn, 2 with Fast-Draw (Ammo)), stripper clips (reload time from Shots), consumables, drawing weapons. Pulled magazines and empty clips go rig → backpack → pockets → ground. Spent turns block attacks and are shown in the turn pop-up. Free outside encounters; seconds during breaks. Old saves move the former "In hands" items to Hands (schema 2). |
| Item Editor | Drop-downs of catalog IDs per field kind (calibers, magazine/clip families, interfaces, weapon ids, tags, conditions, container categories, mount interfaces) with matching IDs first; GURPS gun/thrown/melee/unarmed skill list; subcategory → weapon skill; category → behaviour; grid preview with picture-shape check. |
| Breaks | GM allots N seconds; per-player second budgets spent by ready / reload / attach / load / aim / use; no attacks; "I'm done" per player; ending advances the clock N rounds, completes readying, restarts the order. |
| Main menu & GM password | Character picker with server-side locks (one person per character), join codes, GM password (default `goyim`, salted scrypt hash, changeable in Settings), logout back to the menu. |
| Start screen | GM: continue / switch / create / test campaign, import, migrate, pre-session checklist. Player: pick a character. Both show who is online. |
| Catalog | New campaigns start empty; optional built-in starter catalog; "Remove unused items" cleanup. |
| Multiplayer | Up to 8 people at once (GM + 7 players, enforced on the host at login and connection; one seat always reserved for the GM). GM-hosted WebSocket host with join codes. Live views for every client. Reconnects and retries with idempotent request ids. LAN binding for Radmin VPN. One-time local player windows for single-computer play. |
| Tabletop Simulator | Optional bridge over the External Editor API with a connection indicator. Spawns black hex NPC tokens, links tokens by GUID, selects a character from TTS, pushes approved status text (never HP numbers). Includes the `tts/Global.lua` script. The legacy `/tts/select` endpoint still works. |
| Desktop | Electron shell: single instance, GM window, player and pop-out windows, native file dialogs, GCS menu, `appId`/`productName` kept so `%APPDATA%` data continues. NSIS installer configuration. |

## Partially completed / known limitations

* **GCS single window:** not possible without porting GCS's UI (see above). There are two native windows, with automatic sync.
* **No writes back to GCS:** the companion never writes HP/FP into the `.gcs` file. This is intentional, to protect the source files.
* **Windows build not run here:**
  * The Windows installer was **not executed on Windows** in this environment.
  * The Electron app was launched and smoke-tested on Linux under Xvfb, and the GCS archive checksum was verified here.
  * Please run `INSTALL_WINDOWS.cmd` and smoke-test on Windows. The checklist is below.
* **Tabletop Simulator untested:** the bridge was tested against a fake TTS socket only, not a real TTS session.
* **TTS token images:** they must be public URLs to show for other TTS players. Local host URLs only work on the GM's own TTS.
* **TTS port clash:** TTS editor plugins (Atom / VS Code) use the same port.
* **Remote multiplayer:** tested over localhost WebSockets with two browser sessions, **not over a real LAN or Radmin VPN**. Windows Firewall may prompt.
* **Melee:**
  * Attack, parry, block and dodge (with retreat) work, using GCS weapon parry/block values.
  * Not automated: grappling, feints as contests, deceptive attacks (the engine supports them, the UI does not expose them), and close-combat specifics.
* **Critical hit and miss tables:** not rolled automatically. The GM is told which table applies (B556).
* **Skull/face/eye miss-by-1 rule:** "misses by 1 hits the torso" is not automated.
* **Shotguns:** close-range rules are simplified (B409 projectile handling at very short range).
* **Bleeding, natural healing and recovery timing:** conditions and consumables only. There is no scheduling of recovery rolls.
* **Aim disturbed by injury:** a disturbed aim is flagged, but the Will roll to keep aiming is left to the GM.
* **Encumbrance skill penalties:** encumbrance penalties to skills such as Climbing, Stealth and Swimming are not applied automatically.
* **Turn enforcement:** turn order is advisory. Acting out of turn produces a warning, not a block.
* **Undo:**
  * Exact undo exists for every HP/FP/condition/armor application, plus a trash for deleted items and characters.
  * There is no general "undo any action". Backups and restore points cover that coarser case.
* **Image tools:** auto-fit trim and flat-colour background removal only. There is no manual crop rectangle yet.
* **Windows and panels:** floating container windows and extra app windows exist, but there is no full docking layout.
* **Prices and statistics:** most item statistics and all prices are provisional campaign values inherited from or derived from your earlier catalog. Review them in the Item Catalog.
* **Performance:** each committed change pushes a full per-viewer view. That is fine for typical campaigns (thousands of items); diff-based sync is a possible later optimization.

## Remaining work (suggested next steps)

1. Native Windows smoke test:
   * install,
   * launch GCS from the menu,
   * link a real `.gcs` file, save in GCS and confirm the auto-import,
   * restart the app and confirm persistence,
   * run a session with a second PC over Radmin VPN,
   * load `tts/Global.lua` in TTS and spawn tokens.
2. Calibrate the default attachment anchors for every Tier 1 image in the anchor editor. The defaults assume left-facing artwork.
3. Optional: grappling and feint workflows, critical-table rollers, an encumbrance skill-penalty switch, bleeding automation.
4. Optional: manual crop UI, docking layout, diff-based view sync.

## Tests performed

* `npm test`: **54 tests, all passing**. They cover:
  * dice, criticals, contests, damage parsing,
  * SSR range, rapid fire, hits and Dodge vs rapid fire,
  * wounding, injury, armor divisor, limb caps, shock, thresholds, encumbrance, modifiers,
  * the three required demonstration scenarios at the engine level,
  * duplicate events and idempotency, undo, custom damage, overrides,
  * aim accumulation and reset, RoF and ammunition limits,
  * deterministic journal replay,
  * grid placement, compartments and rotation, containers and the recursion guard, stacks,
  * magazine/ammo compatibility (PMM/Klin), mixed loads, chamber, eject/unload, integral feeds,
  * attachments with footprint, assembly move/rotate and stats,
  * trader generation, atomic buy and sell, insufficient funds,
  * crafting exactly once, NPC generation compatibility and duplication, jobs paid once, loot release,
  * sort and character import,
  * player-view redaction (GM notes, hidden NPCs, GM-only rolls, concealed targets, NPC names and stats),
  * cross-player permissions,
  * storage crash recovery, torn journal lines, backup/restore, export/import,
  * the WebSocket host (join codes, server-side permission denials, live updates, idempotent retries),
  * GCS file watching (never writes) and import that preserves damage, with a diff and conflict note,
  * the TTS bridge protocol,
  * turn order, readying (normal and Fast-Draw), reload times, breaks and their second budgets,
  * the Ready slot: magazines in 2 turns, Fast-Draw (Ammo), round-by-round loading, stripper clips, consumables, drawing, cancelling, breaks, and the save migration,
  * GM password, main-menu join, character locks and logout on the host,
  * legacy migration from a representative 0.9 save fixture.
* `node tests/e2e/run-e2e.cjs`: **passing**. It drives the real UI in Chromium with a GM window and a player window. It covers:
  * Scenario 1: player assault-rifle attack → GM resolves defense → proposed injury, HP unchanged → Apply calculated → HP decreases → combat log → NPC Manager shows the HP → undo and re-apply,
  * Scenario 2: NPC attack → player defense prompt → GM notifies → player applies → sheet and dashboard update,
  * Scenario 3: Lockpicking from the sheet → GM sees it immediately,
  * drag ammo onto a magazine, drag an item into a pocket,
  * context-menu unload and quick-load,
  * trader purchase,
  * installing a scope and suppressor with layered rendering.
* `node tests/e2e/turns-menu.cjs`: **passing**. GM, two players and a third window in Chromium: wrong GM password refused and `goyim` accepted, a character in use locked for others, "Your turn" and "NPC turn" pop-ups, readying a rifle (usable next round), ending turns by button and `E`, a 5-second break with a 3-second reload, ending the break (clock to round 7), a magazine staged in the Ready slot and loaded automatically at the start of the next turn, and returning to the main menu frees the character.
* `node tests/e2e/item-editor.cjs`: **passing**. Category switches on the Weapon behaviour, Shotguns/Pistols set the skill, the magazine-family drop-down lists families that take the chosen caliber first, and the saved definition has the picked IDs.
* GCS reader run over the 648 master-library `.gcs` files: all parsed, and point totals match.
* Pinned GCS archives downloaded and checked: 5.58.0 `1bf69c17…` matches the earlier build's pin; 5.58.1 `fb209e11…` is now pinned.
* Electron app launched under Xvfb on Linux: the GM window loaded with no page errors and the preload bridge was available.

### Windows smoke-test checklist

- [ ] `INSTALL_WINDOWS.cmd` finishes and the shortcut opens the GM window.
- [ ] GCS → Open GURPS Character Sheet launches the bundled GCS.
- [ ] Characters → (character) → Link .gcs file… then save in GCS → "synchronized from GCS" toast.
- [ ] Close and reopen the app → campaign, HP and inventory are unchanged.
- [ ] Migrate the previous build's save → the report looks right.
- [ ] Windows → Player window → the three combat scenarios work.

## Build and run

* **Windows install:** double-click `INSTALL_WINDOWS.cmd`. The installer lands in `%LOCALAPPDATA%\STALKER GURPS Companion\installers`.
* **Development:** `npm install && npm start` (Electron), or `node src/server/cli.cjs` (browser).
* **Tests:** `npm test`, and `npm run test:e2e` (needs Playwright with Chromium).
* **Campaign data:**
  * desktop: `%APPDATA%\STALKER GURPS Companion\campaign-data\`,
  * CLI: `./.campaign-data`.

## Files

Everything outside `legacy/` is new in this rebuild:

* `src/core/*`: domain engine (19 modules)
* `src/server/*`: host, storage, GCS service, TTS bridge, CLI
* `src/desktop/*`: Electron main and preload
* `src/ui/*`: interface (index, CSS, 13 modules, vendored htm/preact)
* `data/seed/*`: Tier 1 catalog reference and images (from your build), plus generated attachment silhouettes
* `tts/Global.lua`: Tabletop Simulator script
* `tests/unit/*`, `tests/e2e/*`, `tests/fixtures/*`
* `tools/install-windows.ps1`, `INSTALL_WINDOWS.cmd`, `RUN_DEV.cmd`, `vendor/gcs/*`
* `README.md`, `docs/ARCHITECTURE.md`, `docs/STATUS.md`
* `legacy/v0.9-source/`: your uploaded v0.9 source, unchanged
