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

For a development run without an installer, use `RUN_DEV.cmd` or `npm install && npm start`.

### Running without Electron (GM server, Linux/macOS, testing)

```
npm install --omit=dev
node src/server/cli.cjs --data ./my-campaigns --port 7788
# open the printed GM link in Chrome/Edge/Firefox
```

## Quick start for the GM

1. **Campaign → Players.** Add your players. A test campaign is created on first start, so you can experiment safely.
2. **Characters.** Create a character for each player and assign the player.
   * Open the character's sheet and use **Link .gcs file…**. From then on, whenever GCS saves the file, the companion imports it.
   * **Edit in GCS** opens the bundled GCS application.
3. **Item Catalog.** The Tier 1 weapons, magazines and ammunition from your earlier build are already included. So are armor, medical supplies, artifacts, attachments and containers.
   * Edit prices and statistics here.
   * Import PNG artwork.
   * Place attachment anchors with the anchor editor.
4. **Encounters.** Create an encounter, add the PCs, then generate NPCs (for example 6 Bandits). Use **Start & open dashboard**.
5. **GM Dashboard.** Player rolls appear instantly.
   * Resolve the NPC's defense.
   * Review the calculated injury.
   * Click **Apply calculated**, or enter a custom amount, ignore it, notify the player, or undo.
6. **Single computer:** use *Open player window* (Campaign → Players, or the Windows menu).
7. **Other computers (LAN / Radmin VPN):**
   * Enable hosting under **Settings → Multiplayer hosting**.
   * Set a join code per player.
   * Players open `http://<GM address>:7788` and sign in.

### Keyboard

| Key | Action |
| --- | --- |
| `1`–`9` | Switch page |
| `Ctrl+S` | Save |
| `N` | Next turn |
| `A` | Apply the focused or first pending injury |
| `J` / `K` | Move through the pending queue |
| `R` | Rotate the selected item, also while dragging |
| `Q` | Quick-load a magazine |
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
npm test                 # 38 unit/integration tests (rules, combat pipeline, inventory, traders,
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
