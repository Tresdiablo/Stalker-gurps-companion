# Build 4.5 — Navigation and Windows startup patch

## Verified in automated Chromium tests

- All five Player page routes and all nine GM page routes open (14 navigation targets, 13 page containers because GM Combat shares Combat).
- Both dropdown selection and individual navigation tab clicks work.
- Saved GM mode is restored correctly on startup.
- At 980-pixel and 650-pixel window widths, navigation still opens every page.
- Connected player sessions cannot switch into GM pages.
- Simulated errors in both legacy `showPage` and `setMode` do not prevent the requested page from opening; the error is recorded in navigation diagnostics.
- Existing character, NPC, encounter, hidden/revealed stash, looting, image tooltip, and journal browser regression test passed.
- GM/player combat isolation, four rounds available from a six-round attack request, and image fallback browser test passed.
- Node server test passed (GM/player permissions, loot validation, attack report duplicate prevention and reconnection).
- JavaScript syntax checks passed for `app.js`, `companion.js`, `navigation.js`, `desktop/main.cjs`, `desktop/preload.cjs` and the backend.

## Windows changes not directly verifiable here

- The Electron desktop app provides a native **Pages** menu as a fallback even if HTML page buttons stop working.
- At startup Electron checks the presence of all 13 physical content page containers; a missing page triggers a diagnostic error.
- The Windows setup now checks that `navigation.js` and version 0.4.5 are present, and launches the newest installed executable it finds.
- **Windows `.exe` installation and the actual reported Windows-only symptom could not be reproduced or tested on Windows in this environment.** A real installation remains necessary to confirm resolution.

## If the installed app still differs

Look at the app heading; it must read `COMPANION BUILD 4.5`. Close any previous process and run setup from a newly extracted ZIP. Use the Windows **Pages** menu to open a page. If this fails, open **View → Toggle Developer Tools** and copy the Console errors. Include the installer log under `%TEMP%\STALKER_GURPS_Setup_*.log` if setup reported a failure.

## Data safety

Export existing character and GM campaign saves before upgrading. Build 4.5 preserves the existing file structure and saved-game schema. Do not delete the old app or its data until the updated version has been checked.

## Sources

- Existing application source and automated test results.
- Electron BrowserWindow and Menu documentation: https://www.electronjs.org/docs/latest/api/browser-window ; https://www.electronjs.org/docs/latest/api/menu
- HTML hidden attribute: https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/hidden

## Build 4.4 — Navigation regression checks

- Clean Chromium navigation: all **5 Player pages** and **9 GM pages** opened through the new OPEN PAGE selector.
- Verified at viewport widths 1500 px, 920 px (minimum desktop window), and 650 px (narrow window).
- Clicking individual page tabs kept the selector synchronized; GM combat page mapped to the shared Combat page.
- No browser JavaScript errors in navigation tests.
- Existing inventory / magazine / character profile / GM encounter browser regression tests passed.
- Node server test passed, covering GM privacy, authoritative loot, attack report handling, duplicate reporting, and saved character restoration.
- JavaScript syntax checks passed for app.js, companion.js, and backend/server.cjs.

Limitations: The originally reported Windows-only symptom could not be reproduced in the clean browser run. This release adds an always-visible direct page selector and reorganized navigation as a practical repair. Windows installation and a live installed Electron session were not tested in this Linux environment. If the issue persists, verify the window title reads COMPANION BUILD 4.4 and provide a screenshot or installation log.

# Development Build 4.3 — Testing Report

## Checks passed in this environment

- Syntax: `node --check app.js`, `companion.js`, `backend/server.cjs`, `backend/server.test.cjs`, `desktop/main.cjs`, `desktop/preload.cjs`.
- `node --test backend/server.test.cjs`: GM/player authentication flow, public encounter privacy, GM target assignment, idempotent attacks, loot permissions and source quantities, profile reconnect, and GM character updates.
- Headless Chromium smoke test: boots without uncaught errors; 7.62×39 FMJ ammo shows blue `45` badge, loading a compatible AK 10-round magazine leaves `35`, no ammo dialog opens, inserting that magazine into the AKM yields 10 loaded rounds.
- Headless Chromium workflow test: right-clicking loose ammo offers direct 'Load into' compatible magazine; loading/unloading preserves a total of 60 loose rounds; splitting into 13 and remainder preserves total count; context menu closes; creating, renaming, and deleting profiles succeeds.
- GM UX browser test: right-click NPC includes relevant GM controls, GM target remains in GM workspace, Player mode hides NPC controls, NPC attack deducts rounds and refuses a second attack in the same round.
- Browser test suite reports no uncaught JavaScript exceptions.

## Limits and known gaps

- Electron app and one-click installer scripts are **not compiled or executed on Windows** in this environment. Initial installation still downloads Electron and build dependencies.
- Real Radmin VPN/multi-PC WebSocket synchronization, simultaneous interactions from multiple connected clients, and the TTS bridge still require real-world testing.
- Offline GM and Player tabs are visual modes, not local authentication. Connected role permissions are enforced by the server.
- Player-submitted attack damage reports are checked for target assignment and numeric bounds but not independently recalculated by the GM host. Use only with trusted players on a private VPN.
- Full native GCS schema, exhaustive GURPS combat rules, advanced NPC physical magazine inventory, image transfers between clients, and complete import/save compatibility across old versions are not verified.
- Native image storage/File APIs, arbitrary long sessions, and every inventory edge case are not covered by automated tests.
- Export both character JSON and GM campaigns before upgrade.

## Sources

- MDN contextmenu event: https://developer.mozilla.org/en-US/docs/Web/API/Element/contextmenu_event
- MDN Pointer Events: https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events
- GURPS Basic Set: https://www.sjgames.com/gurps/books/basic/
- Electron docs: https://www.electronjs.org/docs/latest/
