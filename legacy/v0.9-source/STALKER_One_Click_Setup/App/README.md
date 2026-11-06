# S.T.A.L.K.E.R. GURPS — Unified Windows desktop suite v0.9

**Start with `../START_HERE.txt`, `GCS_ALL_IN_ONE_STATUS.md`, and `CLAUDE_HANDOFF.md`.**
This source release combines the original STALKER desktop companion with the **complete official GCS native application in one Windows installer**, and links GCS character files to STALKER profiles for automatic one-way sync.
**GCS remains a separate native window**, not an in-process Electron tab. The original gameplay and desktop controls remain in place; the notes below describe the inherited Beta 0.8 base.

---

# S.T.A.L.K.E.R. GURPS Companion — Build 4.5 Integrated Beta 0.8

This build modifies the user's supplied Build 4.5 app in place. It keeps the original visual design and Electron one-click setup. No Python is needed to use the program.

## Launch

**Quick local test:** Unzip, open the `STALKER_One_Click_Setup` folder, and double-click `OPEN_IN_BROWSER.cmd` (Windows). Alternatively open `App/index.html` in a recent desktop browser. Your data is saved in the browser's local storage and image asset store for that exact origin.

**Desktop app:** Run `STALKER_One_Click_Setup/INSTALL_WINDOWS.cmd` to build/install with Electron. That process downloads Node/Electron on first use and needs internet; it is not a precompiled EXE. The actual Windows installer has not been executed in this environment.

## Desktop controls cleanup

See `DESKTOP_UX_CHANGE_REPORT.md`. The desktop UI now has a compact page bar, a Profile & saves menu, keyboard page selection (Ctrl+K), and removed duplicate inspection buttons. All original game-data and combat functions remain unchanged.

## Beta 0.8 usability changes

- Inventory now includes selected-item equipment inspection with actual installed optics, magazines, suppressors, and upgrade kits, computed statistics, and contextual guidance. Physical attachments still install by dragging their icon onto a compatible weapon and remove through its right-click menu; no separate player weapon or armor tab.
- GM Combat Control is one workspace with two selectable directions: NPC → Player and Player → NPC, plus inline calculated-injury review and Apply / Resolve / Ignore. The advanced maneuver, cover, hit-location, targeting, and armor inputs remain available in expandable sections; no automatic HP changes.
- NPCs and mutants use a folder-style template library with Human, Mutant, Other, custom category folders, search, counts, create / rename / delete folder actions, and folder-aware new-template defaults. Folders persist in the existing GM campaign save.
- Right-clicking empty inventory storage or loot areas opens useful actions; item and GM NPC right-click menus are preserved. Existing advanced editing controls are collapsed until opened (NPC editor, item editor, master equipment workbench, GM combat).
- Preserved all original Build 4.5 data storage keys and Build 0.7 combat and armor rules. No Python runtime needed for browser testing.

## Beta 0.7 changes

- Removed the separate Player Weapon & Armor and GM Armor Plate tabs and their interaction workflows.
- Reverted to ordinary, single-piece equipped armor DR plus optional campaign DT threshold. No removable plate slots, individual plate DP, or plate wear.
- Previously saved plate items are converted once to ordinary Misc loose items; their item names are retained but they offer no protection. Keep your old save and the included original ZIP backup before migrating.
- Drag an optic, suppressor, upgrade kit, or compatible magazine onto a weapon image in Inventory to install it. Incompatible combinations are rejected. Right-click the weapon to uninstall the optic, suppressor, or kit or eject its magazine. Installed attachments retain their own item instances.
- GM Combat Control offers a visible 'Attack Selected NPC' form with weapon, skill, range, and shots. It records calculated injury on the selected active-encounter NPC and requires explicit GM application before HP changes.
- NPC Attacks Player now resolves directly against an existing player character, produces a pending combat calculation, and does not change HP automatically.
- NPC and Mutant template categories support create, filter, rename and delete (category deletion preserves its templates as Uncategorized).
- Original Build 4.5 inventory, GCS import, encounter and NPC tools, catalog, traders, image editor, and backup routines remain.

## Damage rules

The base GURPS 4th Edition armor rule uses **DR**. This project's existing **DT** is a campaign house rule, not a standard published GURPS 4e statistic. When enabled, penetrating damage equal to or below the target's DT is stopped; larger penetrating damage proceeds to normal injury. The GM can enable or disable DT under **Combat Review & Backups**. There are no armor plate mechanics in this beta.

## Preserving saves

Keep your existing installation and exported saves unchanged until you've tested this build. This ZIP includes `BUILD_4_5_ORIGINAL_BACKUP.zip`. Data from previous builds can be imported using the existing app tools; plate information is migrated on first launch of an existing save and should be considered a compatibility change. Browser saves are origin-specific and may not automatically appear if opening the app from a new folder.

## Testing and limitations

See `App/BETA_0_7_TEST_REPORT.md` and `App/BETA_0_7_CHANGE_REPORT.md` for exact checks. Automated Chromium tests were run with scripts inlined and mocked localStorage because direct loopback HTTP access was restricted in the test browser. Native Windows Electron behavior has not been tested. This release is not a comprehensive button-by-button audit; that separate task is reserved until the user asks for it. Multiplayer was not extended.
