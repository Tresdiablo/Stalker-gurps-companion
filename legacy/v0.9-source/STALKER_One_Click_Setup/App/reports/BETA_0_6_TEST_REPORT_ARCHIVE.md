# Integrated Build 4.5 — Test Results

Tests run against the original Build 4.5 code with integration scripts inserted (not a Python app rebuild).

### Passed

- JavaScript syntax: `node --check app.js`, `companion.js`, `navigation.js`, `integrated.js`, `desktop/main.cjs`.
- Existing server test: `node --test backend/server.test.cjs` — 1 subtest passed.
- Headless Chromium scripted smoke/integration test: `python tests/integrated_browser_test.py` (test harness only; **not required to run the application**).
- 21 routes in GM/Player navigation opened without JavaScript page exceptions.
- GM workbench: physical armor plate and carrier definitions created and instantiated.
- Armor: correct installed plate ownership, separate DP values, front facing DR, broken plate no longer contributes DR, GM DP reductions.
- Item definitions remain independent from physical copies.
- Trader sale rejects carrier with installed plate; purchased quantity, stock and currency remain consistent; overselling rejected without balance loss.
- Existing container contents remain linked when equipped rig is removed and restored when re-equipped.
- Weapon optic mounting, modifier-derived accuracy, duplicate installation rejection, and safe removal.
- Original zero-priced catalog can produce a nonempty finite-stock generated trader using clearly marked estimates.
- GM can ignore a pending calculation without HP loss; manual NPC injury applies HP and configured plate DP wear once; duplicate apply rejected.
- Drag ghost renders only the picture, and rotated items rotate their ghost artwork.
- Browser JavaScript error list empty during scripted testing.
- Uploaded original backup verified by SHA-256; ZIP integrity checked after final packaging.

### Not verified

- Physical Windows Electron installation and portable shortcuts; custom Radmin VPN networking; production load with thousands of image assets; all complex inventory drag gestures in a live user session; exhaustive GURPS rule accuracy; native file picker and IndexedDB asset migration across Windows machines.

**Warning:** The Chromium script uses inline-embedded scripts and a mocked localStorage service to avoid restrictions on local web servers. Passing browser tests validates JavaScript execution and simulated local UI flows; it is not a full real-world Windows installation test.
