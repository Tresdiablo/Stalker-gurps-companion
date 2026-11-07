# S.T.A.L.K.E.R. GURPS Companion

This is a Windows desktop campaign manager for a S.T.A.L.K.E.R.-themed **GURPS Fourth Edition** campaign. It includes:

* the official **GURPS Character Sheet (GCS)**, bundled and kept in sync,
* a **Tarkov-style grid inventory** with modular weapon artwork,
* real **magazines and ammunition**,
* GURPS combat calculations,
* a **Roll20-style GM dashboard** where the GM applies all damage by hand,
* NPCs, encounters, traders, crafting and jobs,
* an optional **Tabletop Simulator** bridge.

The app handles the bookkeeping. The GM keeps authority over every consequence.

> Version 1.0.0-beta.1 is a full rebuild of the earlier v0.9 / Build 4.5 code. The old source is kept unchanged in `legacy/`. Old saves can be migrated (see below).

## Install on Windows

1. Download or clone this repository.
2. Double-click **`INSTALL_WINDOWS.cmd`**. This needs an internet connection the first time. It:
   * uses Node.js 22+, or downloads a portable Node.js after checking its SHA-256,
   * downloads the official **GCS 5.58.1** Windows release from GitHub and checks it against the pinned SHA-256 `fb209e11…c91c`,
   * installs the dependencies and runs the automated tests,
   * builds `STALKER-GURPS-Companion-Setup-<version>.exe` with electron-builder and installs it for your Windows user. No administrator rights are needed.
3. Start **STALKER GURPS Companion** from the Start menu. The GM window opens.

**Updates are automatic** once set up: GitHub builds each new version and the installed app downloads it and offers to restart. See [`docs/UPDATES.md`](docs/UPDATES.md) for the one-time setup (a public releases repo plus one secret).

For a development run without an installer, use `RUN_DEV.cmd` or `npm install && npm start`.

### Running without Electron (GM server, Linux/macOS, testing)

```
npm install --omit=dev
node src/server/cli.cjs --data ./my-campaigns --port 7788
# open the printed GM link in Chrome/Edge/Firefox
```

## Main menu, GM password and turns

* **Main menu.** Every window opens on the main menu. Players click **Play** on a character card (enter the join code if the GM set one). A character someone is already playing shows 🔒 *In use* and cannot be picked. **⏏ Main menu** in the top bar frees the character and returns to the menu.
* **GM password.** *Enter as GM* asks for the GM password. The default is **`goyim`**; change it in **Settings → GM password**. The password is stored only as a salted scrypt hash in `host-config.json` in the data folder.
* **Turn cycle.** When an encounter runs, a bar under the navigation shows the round, whose turn it is and who is next. On a player's turn a **Your turn** pop-up (with a chime) appears on that player's screen: *Take my turn*, *Reload*, *End turn*. On an NPC's turn the GM gets an **NPC turn** pop-up naming the NPC and who is next: *Control*, *Skip turn*. Players end their own turn with **End my turn** or `E`; the GM uses **Next turn** or `N`. Downed combatants are skipped automatically (Settings).
* **In hands (1-second combat).** Each character has an **In hands** slot. Drag a weapon or item into it to ready it: that takes the turn (GURPS Ready maneuver) and the item is usable from the next turn. Right-click → *Fast-Draw* rolls the skill to ready it instantly. Reloading takes the weapon's reload time from its Shots entry (e.g. "30(3)" = 3 seconds); fitting an attachment takes 3 s. Weapons that are not in hands cannot attack (Settings → *Weapons must be readied*).
* **Breaks in the action.** Encounters → **⏸ Break in the action** (or **Break…** on the dashboard): give everyone *N* seconds. Nobody attacks; each player spends their seconds on readying (1 s), reloading (reload time), attachments (3 s), loading magazines (2 rounds/s), aiming (1 s, kept afterwards) or using items, then clicks **I'm done**. The GM sees each player's remaining seconds and ends the break: the clock advances *N* rounds, unfinished readying completes and the order restarts from the top.

## Quick start for the GM

0. **Start screen.** It opens first: continue the last campaign, open another, create a new or test campaign, import a package or migrate an old save. Click the logo in the title bar to return to it.
1. **Campaign → Players.** Add your players. A test campaign is created on first start, so you can experiment safely.
2. **Characters.** Create a character for each player and assign the player.
   * Open the character's sheet and use **Link .gcs file…**. From then on, whenever GCS saves the file, the companion imports it.
   * **Edit in GCS** opens the bundled GCS application.
3. **Item Catalog.** New campaigns start with an **empty catalog**.
   * Create items with **+ New**, import a catalog JSON, or click **Load starter catalog** (the Tier 1 weapons, magazines and ammunition from your earlier build, plus armor, medical supplies, artifacts, attachments, containers, recipes and NPC gear).
   * **Remove unused items** deletes every item nobody owns.
   * Edit prices and statistics here.
   * Import PNG artwork.
   * Place attachment anchors with the anchor editor.
4. **Encounters.** Create an encounter, add the PCs, then generate NPCs (for example 6 Bandits). Use **Start & open dashboard**.
5. **GM Dashboard.** Player rolls appear instantly.
   * Resolve the NPC's defense.
   * Review the calculated injury.
   * Click **Apply calculated**, or enter a custom amount, ignore it, notify the player, or undo.
   * **NPC control bar** (top of the dashboard): runs an NPC's turn. When it becomes an NPC's turn it is selected automatically, with the nearest player character preselected as the target. Pick the weapon and target, then use **Attack**, **Reload**, **Aim**, another maneuver or posture, and **Next turn ▶**. Tick *Secret roll* to hide the roll from players.
   * **Give items anywhere:** press **`G`** (or **+ Give item**) to open a searchable catalog picker aimed at the selected character. In the Item Catalog, set **Spawn into** once, then click **+** or double-click any item; right-click for amounts or another receiver.
6. **Single computer:** use *Open player window* (Campaign → Players, or the Windows menu).
7. **Other computers (LAN / Radmin VPN):**
   * Enable hosting under **Settings → Multiplayer hosting**.
   * Set a join code per player.
   * Players open `http://<GM address>:7788` and sign in.
   * **Up to 8 people can be connected at once**: the GM plus 7 players. Several windows of one person count once. The 👥 counter in the top bar shows who is online; a 9th person sees "Session full" and gets in when someone leaves.

### Keyboard

| Key | Action |
| --- | --- |
| `1`–`9` | Switch page |
| `Ctrl+S` | Save |
| `N` | Next turn (GM) |
| `E` | End my turn (player) |
| `A` | Apply the focused or first pending injury |
| `J` / `K` | Move through the pending queue |
| `R` | Rotate the selected item, also while dragging |
| `Q` | Quick-load a magazine |
| `G` | GM: spawn an item into the selected character (searchable picker) |
| Ctrl+click | Quick-move an item between the character and the open storage |
| `Del` | Delete the selected item (GM) |
| Right-click | Opens the context actions everywhere |

## Migrating saves from earlier builds

Go to **Campaign → Campaigns & backups → Migrate from an earlier build**.

On the same computer, the previous build's desktop save (`%APPDATA%\STALKER GURPS Companion\character-data\profiles.json`) is found automatically. You can also choose a save file by hand.

The migration builds a **new** campaign and never modifies the old save. It moves over:

* profiles, as player characters,
* stats or GCS data,
* HP/FP, money and conditions,
* equipped slots, rig and backpack grids,
* loaded magazines and their ammunition,
* integral feeds,
* custom catalog items and your prices,
* item images from `item-assets`,
* NPC templates,
* encounters (archived) with their stashes,
* traders,
* campaign notes and GM history.

It also reports precisely what could not be transferred. One example: images stored in the browser's IndexedDB cannot be read.

## Tests

```
npm test                 # 41 unit/integration tests (rules, combat pipeline, inventory, traders,
                         # crafting, permissions, views, storage & crash recovery, host, GCS, TTS, migration)
node tests/e2e/run-e2e.cjs  # browser end-to-end: the three required combat demonstrations,
                            # drag-and-drop, context menus and a trader purchase (needs Playwright + Chromium)
```

## Documentation

* [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) explains how the code is organized and the data model.
* [`docs/STATUS.md`](docs/STATUS.md) lists what is completed, what is partial, the known limitations, the tests and the files.
* [`tts/Global.lua`](tts/Global.lua) is the Tabletop Simulator script. Its install notes are at the top of the file.

## Licences and intellectual property

* **GCS** (GURPS Character Sheet) © Richard A. Wilkes is distributed unmodified under the **Mozilla Public License 2.0** (`vendor/gcs/LICENSE-GCS-MPL-2.0.txt`). Source: <https://github.com/richardwilkes/gcs>.
* **htm/preact standalone** (MIT) is in `src/ui/vendor/` and **ws** (MIT) is installed from npm.
* *GURPS* is a trademark of Steve Jackson Games. This is an unofficial fan tool. It contains no rulebook text, only page references such as "B379".
* *S.T.A.L.K.E.R.* belongs to GSC Game World. The Tier 1 artwork comes from the GM's own campaign material.
* Many item statistics and all prices are **provisional campaign values**, and are marked that way in the catalog.
