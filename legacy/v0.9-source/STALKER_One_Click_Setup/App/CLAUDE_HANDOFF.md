# STALKER GURPS + Complete GCS — Claude source handoff

This is the user's supplied STALKER GURPS Build 4.5, after a desktop navigation cleanup and a v0.9 unified desktop integration pass. **Do not replace the entire application with an empty prototype.** Preserve the existing inventory, combat, NPC, trader, save and Tabletop Simulator systems.

## User requirements / hard decisions

- **Windows desktop first**. The iPhone preview was only for earlier UI feedback; production is desktop.
- Include the **complete official GURPS Character Sheet (GCS) application**, including its native editor, library explorer, character creation, calculators and future upstream feature releases. GCS is **not** merely a character JSON viewer.
- One desktop installation/launcher. GCS is a native **Unison (Go)** application and STALKER is **Electron/JavaScript**. This source packages both in one installer but uses two native windows. Single-window embedding is explicitly **not implemented**; never claim otherwise.
- GCS owns original `.gcs` files and all of its native libraries. STALKER owns inventory instance state, magazines/rounds, weapon attachments, campaign HP/FP, trader stock, NPC state, combat review, and TTS integration. The sync direction is **GCS character -> STALKER gameplay state only**.
- No automatic damage application. GM retains authority to apply pending injuries manually.
- No reimplementation or silent alteration of core GURPS calculations. Imported derived values require verification in GCS.
- Avoid obsolete duplicate controls; player inventory and GM combat UI must remain concise and context-driven.
- Do not delete/migrate the user's original save files without an explicit, backed-up migration.

## File map

- `desktop/gcs-service.cjs`: single native integration service. Finds bundled `gcs.exe`, stores profile-to-file links, polls original GCS files, validates JSON, refuses to write back to `.gcs`.
- `desktop/gcs-service.test.cjs`: independent Node tests for links, validation, original-file safety, bundled path and immediate-save watcher.
- `desktop/main.cjs`: Electron main process and IPC; adds GCS workflows, *preserves* image asset and network/backend IPC.
- `desktop/preload.cjs`: secure, narrow GCS IPC surface. Node remains disabled in the renderer; context isolation and sandbox enabled.
- `gcs-desktop.js`: desktop character workspace. It calls the existing `importGcs()` from `app.js` rather than duplicating the GURPS import implementation; keeps injuries and fatigue on reimport.
- `app.js`: existing STALKER gameplay engine, persistent local profiles, GCS parser and GURPS mechanics. **Major refactoring here is risky and requires full regression tests.**
- `companion.js`, `integrated.js`, `ux08.js`: additional GM, equipment and QA features.
- `navigation.js`, `desktop-clean.css`: simplified desktop navigation and GCS workspace styling.
- `tools/install-windows.ps1`: one-click installer bootstrap. Downloads the official **GCS v5.58.0 Windows AMD64** ZIP and verifies its pinned SHA-256 before bundling it with Electron via `extraResources`.
- `vendor/gcs/GCS_MPL_2.0_LICENSE.txt`: Mozilla Public License 2.0, shipped in the bundled installer.
- `tests/unified_gcs_browser_test.py`: Chromium interaction test with Electron IPC mocked. **Not a native Windows test.**
- `GCS_ALL_IN_ONE_STATUS.md`, `QA_REPORT_UNIFIED.md`, `START_HERE.txt`: user documentation, status, QA.

## Setup and verification

Run `INSTALL_WINDOWS.cmd` on Windows with internet. Script uses bundled verified GCS archive and `npm install` / `electron-builder` to create and install `STALKER-GURPS-Companion-Setup-0.9.0.exe`. **This source ZIP is not a built installer**. GCS does not have to be installed separately if this script finishes successfully. You can also build with Node/npm from `App/`, but then you must first populate `App/vendor/gcs/` with the *complete* upstream Windows GCS release (not just the EXE).

Development tests from `App/`:
```
node --test desktop/gcs-service.test.cjs backend/server.test.cjs
python tests/unified_gcs_browser_test.py
python tests/navigation_regression.py
```
The Playwright tests have a Linux path `/usr/bin/chromium`; update executable path on Windows. A native Windows test must also launch both applications, load Master/User Library contents, save a real `.gcs` character, confirm a successful auto-import, and verify persistence across restarts.

## Critical technical boundaries / unresolved work

1. **Single native window**: not accomplished. Do not try `SetParent` or embed an unmanaged foreign window without testing focus, DPI, input, drag-and-drop, accessibility and GCS updates. A true one-window UI would require porting GCS's full interface (significant upstream work) or running another UI host capable of supporting all GCS widgets.
2. **Authentic GCS v5.58 character files**: test the importer with real current .gcs samples. `app.js` has existing v5 attribute-map support but does not reproduce all calculated stats (especially skill bonuses, martial techniques, scripted features and nonstandard settings).
3. **Sync conflicts**: the current implementation intentionally imports only from GCS and leaves STALKER-local current vitals untouched after the first import. Add a clear conflict UI before ever introducing reverse writes. Avoid a loop that overwrites character originals.
4. **Save model**: app.js uses localStorage for several game subsystems. Large campaigns or GCS sheets may exceed storage limits. Consider an atomic, versioned, filesystem database with schema migration, snapshot/rollback and tests. Do not replace storage in-place without migration.
5. **Native smoke test**: Windows, GCS zip hierarchy, Electron builder's `extraResources`, program launch, file watcher atomic save, and archive licensing. The installer script has not been run on Windows.
6. **Attachment image renderer**: user has requested a modular PNG weapon editor with mount anchors for optics, magazines, suppressors, grips etc. Existing equipment attachments and weapon variants are preserved, but a full coordinate-anchor visual rendering editor was **not implemented** in this v0.9 pass.
7. **Prevent redundant UI**: Legacy import panel is hidden only in Electron mode. Browser preview keeps old importer. Remove old browser-only controls only when users have a working replacement.
8. **Performance & code**: existing global script architecture may contain overlapping helpers across `app.js`, `integrated.js` and `companion.js`; investigate and refactor in focused, tested increments rather than rewriting all at once.
9. **Windows installer**: the old bootstrap's incorrect package version check was removed. If changes are made to packaging or productName, update its installer path search and preserve appId for save continuity.

## External upstream references

- GCS repository & licensing: https://github.com/richardwilkes/gcs (MPL-2.0)
- Pinned official release: https://github.com/richardwilkes/gcs/releases/tag/v5.58.0
- Unison UI toolkit: https://github.com/richardwilkes/unison
- Electron `extraResources`: https://www.electron.build/configuration/contents

This release is a real code change with reproducible tests, **not a claim that the whole GCS source/UI has been rewritten into Electron**.
