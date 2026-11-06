# Beta 0.7 — Test results

## Passing checks

- JavaScript syntax (Node `--check`): `app.js`, `companion.js`, `navigation.js`, `integrated.js`.
- `python tests/regression_test.py`: existing Build 4.5 initial state, Tier 1 catalog, NPC editor, encounters, stashes, journal, navigation smoke check.
- `node --test backend/server.test.cjs`: 1/1 legacy server test passed.
- `python tests/beta_07_browser_test.py`: Chromium test passed each of these flows:
  - App startup without standalone equipment/plate pages; every GM/Player page accessible (20 routes).
  - Create and filter mutant template category; create mutant template in category.
  - Rename and delete category without deleting the stored mutant template.
  - Equipped armor DR and optional DT threshold damage calculation; no plate object.
  - Physical mouse drag from optic item to weapon icon, installing it.
  - Right-click weapon context menu uninstalling optic back into loose loot.
  - GM select encounter NPC, roll attack and log pending injury without reducing NPC HP; manually apply partial injury and verify HP changes once.
  - GM select NPC and roll against local player; pending calculation created with player HP unchanged.
  - No uncaught Chromium JavaScript errors.

## Not claimed

- Full button-by-button audit: **not performed** (awaiting separate user request).
- Fully exhaustive GURPS combat mechanics or all edge cases: **not performed**.
- Windows Electron GUI or installer builder: **not executed** in this Linux test environment.
- Real multiplayer: excluded from the requested work.
- Browser test is not a real multi-user/networked game: the script inlines local JS/CSS and mocks localStorage to work around local server restrictions.

## Source

The test suite and the altered source files included in the archive. Refer to user-supplied original backup for differences.
