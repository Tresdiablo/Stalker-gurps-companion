# Build 4.5 Integrated Beta 0.6 — Detailed implementation report

## Base and files

This is an **in-place extension** of the uploaded `STALKER_GURPS_One_Click_Setup_Build_4_5_FULL_PATCH(1).zip`. Original application state, local profile format, UI design, catalog, image assets, GCS importer, original GM encounters/NPCs, Electron configuration and installer tools are preserved. No Python application architecture or Beta 0.5 codebase was substituted.

Modified source: `App/app.js`, `App/companion.js`, `App/navigation.js`, `App/index.html`, `App/desktop/main.cjs`, and `App/package.json`. Added modules `App/integrated.js`, `App/integrated.css`; launch helper `OPEN_IN_BROWSER.cmd` and browser regression checks.

## Added / integrated features

1. **GM equipment workbench.** New categories for optics, suppressors, kits and armor plates; unique definitions and instances; category/subcategory, origin, weight, value, dimensions, DR/DT/DP, GURPS fields, compatible weapons and mounting interfaces, modifiers; compatible-item quick spawn; existing item editor retained.
2. **Weapon mounting.** Install/remove physical optics and suppressors; slot occupancy, proprietary model restriction, AK dovetail/Picatinny/Weaver/thread/QD/custom mounts, adapter-kit dependencies, upgrade-kit mount changes and conflicts. Only physical removable attachments create separate items; kit-internal modifications remain descriptive fields.
3. **Weapon stats and image variants.** Equipped attachment modifiers affect supported weapon accuracy, recoil and damage, with source tooltips and effective-stat badges for equipped-character attributes; matching configuration-tag artwork with fallback. Imports multiple item images into the original IndexedDB asset manager, draft/retag/delete variants and detect duplicate configurations.
4. **Swappable armor plates.** Front/back/left/right plates with independent DP; carrier and plate physical instances; size restrictions, swapping/removal, DP damage/repair, directional DR/DT previews, broken-plate protection loss. GM-approved NPC injury can also decrease worn plate DP in selectable raw-damage or post-DR modes, or GM can enter wear manually. The formula is explicitly provisional campaign logic, not a published GURPS rule.
5. **Inventory.** Tarkov-like drag ghost shows only the item picture (no name/durability overlays), including image rotation; Shift multi-selection and selected-group drag; relative positions and collision checks for grouped grid transfers; rollback on invalid group placement. Drag ghost prioritizes item artwork; item-art rotates with grid footprint. Storage and context menus retained/extended.
6. **Custom pouch layout.** Visual compartment positions and dimensions; draggable pouches, row spacing, storage category prohibitions/allowances, maximum weight and editor save checks. Equipped containers continue using Build 4.5's placement engine and 1-inch inventory cells.
7. **Portable container contents.** Equipped rig/backpack contents are associated with their parent on unequip/drop and restored on re-equip; access the list in Player → Equipment. Parent deletion and sale are blocked if they would orphan dependent equipment.
8. **Manual GURPS consequences.** Player and NPC attacks compute/log outcomes without automatically reducing target HP. GM reviews pending calculations and explicitly applies, ignores or resolves them. When the chosen encounter NPC is known, GM-approved damage updates that NPC's persistent HP and wounds. GURPS `pi+`/`pi++` damage-type parsing fixed.
9. **Trader system.** GM creates category/East/West/rarity/budget-based shops with finite stock, manual edits, resets, buy/sell multipliers, local character shop visibility, purchases and sales, including selling inventory goods not currently stocked by a trader. Catalog items lacking a price receive clearly labeled provisional price estimates. Money, stock and quantities update together; sales of gear with child items are blocked.
10. **GM tools.** NPC batch templates, distribution of physical items to individual local profiles, configurable campaign DT/plate-DP handling, GM funds editing, checkpoints and restore, JSON campaign export/import and transaction history. Legacy GM editor and events remain available.
11. **Navigation/compatibility.** Build 4.5 page/controller stays in place; seven new page IDs and updated role menus give access to integrated tools. Existing player and GM pages remain.
12. **Launch.** Original Electron one-click installer-builder is retained; optional `OPEN_IN_BROWSER.cmd` allows local testing without installing Node/Electron/Python.

## Limitations / not represented as complete

- **Multiplayer excluded**: the original Build 4.5 networking files were left in place but not expanded or secured. GM/Player switch in local browser mode is not cryptographic authentication.
- GURPS 4e combat has substantial existing calculations, but rare maneuvers, special hit locations, critical tables, all equipment/attribute/skill stacking cases, and house-rule edge cases still require GM adjudication. Automatic armor DP formula is a documented game default, not an agreed universal armor model.
- Separate arbitrary portable cases/belts do not yet expose a complete drag-and-drop nested grid like equipped rigs/backpacks; their contents are preserved and listed, but no full nested container hierarchy designer has been validated.
- Modifiers support computed weapon stats and source breakdowns; not every vanilla GURPS derived statistic or conditional skill rule is wired to the existing character sheet.
- Image binaries saved by the legacy asset database do **not** automatically travel inside the new JSON backup export. Retain associated assets and backups when moving machines.
- The local GM role is UI-based; no local password enforcement was added to the original project. For any future multiplayer, authoritative server permissions remain necessary.
- Neither the Windows installer-builder nor the built Electron executable were run under Windows in this environment; only structural Node/JS and emulated Chromium tests were performed.

## Source of implementation

User-supplied 19-section GURPS companion specification and accompanying updated armor DP requirements, with the user-supplied original Build 4.5 archive as the existing application source. Game mechanics are customizable/homebrew; where no exact custom rule was supplied, provisional defaults are identified as such.
