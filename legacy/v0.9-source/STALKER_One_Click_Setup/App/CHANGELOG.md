## Build 4.5 — Full navigation recovery and installation verification

- Replaced the layered navigation patches with one independent `navigation.js` controller.
- All five Player and nine GM pages remain available even if an individual renderer fails during a page refresh.
- Added reliable tab and dropdown routing with network-role restrictions.
- Added a native Windows **Pages** menu as a backup navigation method.
- Added a build label and a startup completeness check for the packaged Electron app.
- Installer now checks the correct source version and navigation file, and launches the most recently updated installed executable.
- Existing inventory, NPCs, ammo, save formats, campaign data, and character profiles are unchanged.

## Build 4.4 — Navigation accessibility fix

- Added a visible **OPEN PAGE** selector next to the Player / Game Master view switch, with the complete available page list for the selected role.
- Reorganized the page buttons into a separate wrapping navigation row so buttons are not lost behind a cramped role switch.
- Synced the page selector with tab clicks, role changes, and programmatic navigation.
- Preserved role filtering: connected players cannot open GM-only pages.
- Updated version and added page-navigation regression tests at multiple window widths.
- Kept all existing catalogue, combat, inventory, profile, GM and saved-game data formats.

# Build 4 — Changes from maintenance 3.1

- Split application into `index.html`, `app.js`, `app.css`, `companion.js`, `companion.css`.
- Added player/GM views, GM dashboard and management panels.
- Moved ammunition and magazine UI to Inventory.
- Added item hover cards, contextual menus, favorites, inventory quick bar, encumbrance indicator, catalogue search and session journal.
- Added imported image auto-fit, optional near-white background removal, normalized transparent WebP storage, optional per-magazine weapon appearances and magazine appearance classifications.
- Added NPC/mutant templates, NPC GCS JSON import, loadouts, hex PNG generator.
- Added prepared encounters with separately tracked NPC copies, persistent NPC/stash loot, visibility controls, attack targets and looting with fit checks.
- Added GM controls for player HP, environment, campaign notes and backups/checkpoints.
- Added Electron desktop wrapper source, managed image assets, local disk save cache and auto-restore.
- Added optional GM-hosted WebSocket networking source, player save snapshots, loot transfer validation and TTS localhost bridge source.
- Added browser QA and isolated server rules regression tests.
- Preserved Tier 1 weapon art and reference CSVs.

**Build 4 is a substantial development build, not a verified production release.**

## Build 4.2 — Workflow repair (2026-11-03)
- Character New, Rename and Delete now use native-in-page modal dialogs instead of unsupported desktop `prompt()`/`confirm()` calls. Deleting the last character resets to a blank profile.
- Encounter cards have editable Name and Location fields with a Save button, in addition to the full Edit dialog.
- NPC creation/editing has an equipped-weapon dropdown (from the catalogue) and an equipment list with quantity and Remove controls. Weapon damage/RoF derive from its catalogue stats. Equipped weapons are added to the NPC's loot/loadout.
- Active encounter NPCs have Target NPC and NPC Attacks Player shortcuts. The GM combat panel has dedicated NPC attacker and local player selectors; selecting them populates the NPC's weapon stats and switches to the correct character profile.
- Item right-click menus include Load Magazine / Ammo for firearms and Load Mag for magazines. Ammo belongs to a physical magazine or built-in feed, not a generic weapon use count.
- NPC attackers must be chosen explicitly before GM attack resolution.

Known limitations: Windows desktop setup and UI interactions are not verified on a real Windows installation in this environment. Connected remote-player targeting requires additional multiplayer synchronization; this release targets local profiles. NPC magazine-by-magazine round consumption remains a separate future feature. Back up your existing save before upgrading.

## Build 4.3 — Contextual interactions and GM combat controls (2026-11-03)

- Blue bottom-right ammunition quantity badges on ammo inventory icons; correct updates after split, direct loading, unloading, and transfer.
- Unified right-click item menu; compatible physical ammo/magazine/weapon actions execute directly without additional loading dialogs.
- Reduced redundant controls through collapsed action groups, compact GM right-click panels, and GM combat workspace.
- GM-only NPC selection and actions. Players see read-only target assignments; network host requires GM assignment for player NPC damage reports.
- GM can choose local or connected players as NPC targets; NPC attack updates HP, wounds and ammunition once per round and attempts connected sync.
- Server public encounter snapshots exclude private NPC attack stats; only the assigned target receives the needed combat stats.
- Fixed stale target stat overlay on server updates, and closing context menus after nested actions.
- Browser regression tests: direct ammo load/unload, quantity preservation on split, compatible AKM magazine insertion, character create/rename/delete, role UI separation, and NPC turn limit. Server regression test passed.

Known limitations: local offline mode is not an access-control boundary; actual Radmin VPN, Windows installation and end-to-end multi-PC attack synchronization remain unverified. Client-submitted damage is bounded but not fully recalculated by the host.
