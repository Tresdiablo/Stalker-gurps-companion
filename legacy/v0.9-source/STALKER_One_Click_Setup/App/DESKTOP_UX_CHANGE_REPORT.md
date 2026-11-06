# Desktop Controls Cleanup — Build 4.5 Integrated Beta 0.8

## Changes made

- Retained existing game data, calculation modules, existing input IDs, drag-and-drop, inventory instances, and save formats.
- Replaced always-expanded secondary page tabs with a compact **All pages** toggle. Three frequent player destinations and five frequent GM destinations remain visible, along with the existing page selector.
- Added **Ctrl+K** to focus the page selector and **Esc** to close the expanded page buttons.
- Moved existing profile management and save commands into one **Profile & saves** dropdown without replacing their click handlers. Undo and Redo remain directly accessible.
- Removed a redundant pair of Inventory inspection and ammo workbench buttons introduced by the beta 0.8 enhancement; the original inspection panel and its weapon ammunition link remain available.
- Removed the unused `safeText` helper from `ux08.js`.
- Removed obsolete **Weapon & Armor** and **Armor Plates** entries from the native Electron Pages menu; these pages had previously been retired and were absent from the supported navigation list.
- Updated the Electron window title to the current build and added the new desktop stylesheet to the Electron packaging manifest.

## Intentionally unchanged

Combat calculations, GURPS stats, trading, trader generation, NPC generation, attachment compatibility, asset storage, multiplayer, saves, and campaign state. This is a targeted controls cleanup, **not** a comprehensive architecture rewrite or a native compiled installer.

## Validation

- `node --check` succeeded for JavaScript, Electron and backend files.
- `npm run test:server` succeeded (1/1 backend tests).
- Browser DOM smoke test confirmed 3 player shortcuts, 5 GM shortcuts, the All pages toggle, GM catalog routing and Profile & saves controls.
- Browser smoke test is limited by sandboxed local-storage access and unavailable external image resources. Native Electron / Windows installer has not been run here.

## Source / basis

User-supplied `STALKER_GURPS_Build_4_5_Integrated_Beta_0_8(1).zip`, including its `README.md`, `navigation.js`, `ux08.js`, `desktop/main.cjs`, `package.json`, `companion.css` and original beta test notes. No external code was copied.
