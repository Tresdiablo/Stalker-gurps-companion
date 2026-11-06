## Build 4.5 — Navigation repair

The previous application could present only Inventory and Dashboard in some installed Windows environments. Build 4.5 includes an independent page controller and a **Pages** menu in the Windows application. Both the top tab row and **OPEN PAGE** selector open all available pages.

**Installing:** Close the running application, extract the entire updated ZIP to a fresh folder, then double-click `INSTALL_WINDOWS.cmd`. Check the on-screen label says **COMPANION BUILD 4.5**. If the older build appears, use the installed application's **Pages** menu and confirm which executable the installer launched in its setup log. Keep a backup of existing characters and campaigns; the patch does not intentionally remove saves.

**If errors continue:** Open **View → Toggle Developer Tools** in the Windows app, then send the Console errors and the Build 4.5 heading. This helps identify environment-specific failures without deleting saves.

### Finding all pages (Build 4.4)

At the top of the app, choose **PLAYER** or **GAME MASTER**, then use the always-visible **OPEN PAGE** dropdown. Player mode has Inventory, Character Sheet, Status, Actions & Combat, and Journal. Game Master mode has Dashboard, Players, NPCs & Mutants, Encounters, Combat Control, Loot & Items, Zone, Campaign, and Settings. You can also click the page tabs directly.

If the installed application still shows only Inventory and Dashboard, close it and reinstall from the newly extracted Build 4.4 package; check the title displays **COMPANION BUILD 4.4** to confirm the updated build actually launched. Character and GM data formats have not changed. Export saves before upgrading.

# S.T.A.L.K.E.R. GURPS Companion — Development Build 4.3

A companion to **Tabletop Simulator**. TTS handles terrain, movement, miniatures, and positioning; this application handles GURPS characters, inventory, ammunition, combat calculations, NPCs, encounters, and loot.

## IMPORTANT — BACK UP YOUR OLD CHARACTER FIRST

The older app was one `index.html` file, while Build 4 uses separate JavaScript and CSS modules plus images. A browser may store files opened at different paths under different storage origins. **In your old app, export your character JSON before moving to this version.** Then import that JSON using **Import Save**. Keep the old app and original pictures until you're satisfied with the migration.

GM campaigns are now saved separately from player character saves. Export them using **GM → Campaign → Export GM Campaign**.

## What works offline (browser preview or desktop source)

- Existing GURPS character sheet, GCS JSON import (partial), inventory grid, equipment, stack splitting, rotation with R, item catalogue, Tier 1 firearms/mags/ammo, advanced combat and conditions.
- Ammunition and magazines workbench now inside **Inventory**, not a separate top-level tab.
- Item hover cards for ammunition, uses, condition, healing, and storage properties.
- Contextual item actions, quick actions, favorites, catalogue search, encumbrance indicator, journal and text session summary.
- Automatic image cropping to visible alpha content, proportional resizing, optional white background removal, support for default/standard/extended/drum/no-mag weapon images.
- **Game Master** pages for Dashboard, Players, NPCs & Mutants, Encounters, Combat Control, Loot & Items, Zone, Campaign and Settings.
- NPC template creation/editing, GCS JSON NPC importing (partial), duplicate templates, simple randomized loadouts, manual gear assignment, 512×512 hex PNG token generator.
- Pre-built encounters with individual NPC actors and hidden/revealed stashes; downed NPCs are lootable. Player targeting integrates with the combat page, and Loot All transfers only what fits. GM checkpoints and event history.
- Ranged shots are limited by **actual rounds available** and weapon RoF, including a requested 6-shot burst with only 4 rounds loaded.

## One-click Windows setup (new)

From the enclosing `STALKER_One_Click_Setup` folder, **double-click
`INSTALL_WINDOWS.cmd`**. This automatically downloads a verified portable
Node.js LTS if needed, installs application build dependencies, builds a
Windows `.exe` installer on your own computer, runs that installer, and
launches the app. No manual `npm` commands are necessary.

Extract the ZIP first. Internet access is required for initial tool
downloads; an unsigned Windows installer may trigger Windows security
prompts. We could not compile or test an `.exe` in the provided Linux
environment. The setup log is stored in the Windows TEMP folder.

The manual method below remains available for developers and troubleshooting.

## Standalone Windows application — SOURCE INCLUDED, NOT A COMPILED INSTALLER

A desktop app configuration and Electron wrapper are included. This environment could not install Electron or build a Windows `.exe`, so there is **no compiled Windows installer in this ZIP**.

When you are at a Windows computer and can download dependencies:

1. Install Node.js (LTS), including npm: https://nodejs.org/
2. Extract this ZIP to a normal local folder.
3. Open Command Prompt in the folder containing `package.json`.
4. Run `npm install`.
5. Run `npm start` to launch the app in Electron.
6. To build an installable Windows `.exe`, run `npm run build:win`. If successful, find the installer in `dist/`.

The installer will be **unsigned** unless you supply a signing certificate. Windows may show a SmartScreen warning.

The desktop app keeps character data under Electron's application data directory; imported image files are copied into `item-assets` there. The web preview uses IndexedDB for imported artwork. Image assets are **not yet bundled with ordinary character JSON exports**. Keep the source image files for now.

### Optional browser preview

You can try `index.html` in an up-to-date browser. For dependable file storage, use a local web server (for example, `python -m http.server 8000` in this folder and navigate to `http://localhost:8000`). The browser version does not host multiplayer sessions.

## Multiplayer — DEVELOPMENT PROTOTYPE

The optional GM server lives in `backend/server.cjs` and uses the `ws` dependency installed with `npm install`. It supports GM session hosting, player joins, player character snapshots, visible encounter targets, pre-generated loot, authoritative loot transfers, basic remote NPC damage reports, GM health adjustments, reconnection, and campaign persistence with rolling backups.

1. All participants connect to the same Radmin VPN network (the companion does **not** configure Radmin VPN).
2. The GM runs the desktop app, opens **GM → Settings**, enters a password of at least eight characters, and clicks **Host Session**. Set a port such as 7788.
3. Players run the desktop app, open **GM → Settings** while offline, enter the GM's **Radmin VPN IP**, port, password, and a **unique player ID**, then select **Join Session**. The interface returns to Player view on connection.
4. Windows Firewall may need an inbound exception for the app port, restricted to the Radmin/private network. Do **not** forward this development port to the public Internet.
5. Host and players should keep separate backups. This prototype has **not been tested on real VPN connections or multiple Windows PCs**.

The server restricts GM data and hidden loot; players only receive currently visible targets, revealed stashes, and necessary loot templates. Server-authoritative loot prevents two players taking the same item. However, remote player attack reports are **not yet independently recalculated** by the GM server and client authorization remains oriented toward a trusted group.

On first hosting, if the server has no saved campaign, the GM's local campaign is uploaded. If both have differing campaigns, a confirmation asks which should win. Export backups before choosing.

## Custom NPC hex tokens for Tabletop Simulator

See `TTS/README.txt` and `TTS/Global.lua`. The companion can make a 512×512 hexagonal PNG from any chosen character portrait. It also provides a standalone Python utility in `TTS/hex_token_builder.py` (requires Pillow) and a sample hex PNG.

- In Tabletop Simulator, use **Custom Tile → Hex**, with the PNG uploaded to a visible/shared asset URL.
- Assign an *encounter actor ID* in the token's GM Notes as `STALKER_NPC_ID:<actor-id>`. Use the **Copy NPC ID** button in the GM Encounter page, not the NPC template identifier.
- Optionally paste `TTS/Global.lua` into Global scripting. It offers a right-click action to select the matching NPC in the GM companion through a localhost HTTP request.
- This local bridge requires TTS and the GM companion on the **same hosting computer** and its script hasn't been tested inside a live TTS session.


## Build 4.3 — Streamlined controls and GM-owned NPC combat

- Ammo items have blue quantity badges in their tile corner; badges update immediately on transfers, split, magazine load/unload, and inventory rerender.
- Right-click a **magazine** to load available compatible loose ammo directly, check its capacity, unload it, or insert it in a compatible weapon. This does not open a second loading dialog.
- Right-click a **weapon** to equip/unequip, insert/eject an appropriate physical magazine, fill the installed magazine from matching ammo, unload, or inspect.
- Right-click **loose ammo** to load into a matching magazine, split/merge stacks, or transfer it. Split amounts still use an explicit small amount dialog.
- Inventory's seldom-used buttons are grouped under *Other inventory actions*. The legacy separate ammunition workbench remains in the source for backward compatibility, but is hidden from the main workflow.
- NPC selection/attack controls are restricted to GM view. NPC targets must be assigned to connected players by the GM; the host sends the selected target's needed combat values but not the full hidden NPC database.
- The GM Combat Control page now resolves NPC attacks against local and connected characters, records wounds and ammo usage, and limits each NPC to one attack per encounter round. NPC reload uses ammunition present in the NPC's assigned loot.
- Character profile creation, rename and delete still use in-app dialogs. The remaining primary controls are compact and consistent.

**Important:** Offline role tabs provide an editing convenience, not a security boundary. Connected players are authenticated by the GM server, which controls target assignment and NPC data visibility. Connected attack damage reports are still trusted within bounded checks, not independently recomputed server-side.

**Compatibility:** Keep an export of your character JSON and GM campaign before upgrading. Windows one-click build runs on your PC and has not been tested on actual Windows hardware here.

## Testing results and remaining gaps

See `TEST_REPORT.md` for exact checks. Browser interface flows passed automated headless Chromium tests. Server rules passed an isolated mock-WebSocket transport test. **No native Windows executable, Electron runtime, real WebSocket server, Radmin VPN group, or actual Tabletop Simulator bridge has been tested here.**

**Not yet complete:** full native `.gcs` import/export, official GURPS critical event tables and exhaustive combat modifiers, client-independent server combat resolution, secure image transfers to other machines, image-inclusive exported backups, real-time two-way token sync, hardened public-Internet security, and comprehensive Windows/device QA.

## Sources and developer references

- GURPS 4e: https://www.sjgames.com/gurps/books/basic/
- GCS: https://github.com/richardwilkes/gcs
- Electron docs: https://www.electronjs.org/docs/latest/
- Electron security: https://www.electronjs.org/docs/latest/tutorial/security
- Electron-builder: https://www.electron.build/
- IndexedDB: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API
- WebSockets: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- TTS Custom Tile: https://api.tabletopsimulator.com/custom-game-objects/#custom-tile
- TTS WebRequest: https://api.tabletopsimulator.com/webrequest/manager/
- Radmin VPN: https://www.radmin-vpn.com/

This is an independently developed fan tool and does not include or replace official GURPS rules publications.

### Build 4.2 controls
- **Encounter details:** GM → Encounters → edit the Name and Location fields directly on an encounter and press **Save Name / Location**. The **Edit** button still opens the full encounter editor.
- **NPC equipment:** GM → NPCs & Mutants → Create NPC or Edit → choose an **Equipped weapon** from the existing weapon catalogue, then add extra gear using the gear picker and quantity field. The selected weapon supplies its damage and RoF; it is also part of the NPC's loadout.
- **Player attacks NPC:** Activate an encounter; use **Target NPC** on an encounter actor or select its card on the Actions & Combat page. Use **Roll Attack & Resolve** as usual.
- **NPC attacks player:** GM → Encounters → **NPC Attacks Player** or GM → Combat Control. Choose the NPC and a **local character profile**, click **Use selected NPC and player**, advance combat to the Target turn, and resolve the NPC's attack. Connected remote player targeting is not yet fully synchronized.
- **Ammo loading:** Right-click a firearm → **Load magazine / ammo** to insert a compatible magazine or load its installed magazine. Right-click a magazine → **Load mag** to choose compatible loose rounds. The Ammunition & Magazines panel in Inventory provides the same controls.
- **Characters:** Use **+ New**, **Rename**, and **Delete** above the inventory. All three now use in-app confirmation dialogs, avoiding Windows desktop prompt incompatibilities.
