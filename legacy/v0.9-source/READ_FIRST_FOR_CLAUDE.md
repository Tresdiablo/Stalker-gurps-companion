# STALKER GURPS — Unified Windows Desktop Source v0.9

This source ZIP is intended to be extracted and given to Claude for final work. **Start with `STALKER_One_Click_Setup/App/CLAUDE_HANDOFF.md`.**

## User's goal
Full original GURPS Character Sheet functionality + STALKER GURPS inventory, NPCs, weapons, armor, traders, GURPS combat and TTS companion in a single Windows desktop suite. Maintain existing player/GM workflows and saved data.

## Current actual state
One Windows installation is set up to bundle official **GCS 5.58.0** with the STALKER Electron desktop app (full GCS installed, runs in its **own** native window); STALKER automatically imports linked GCS character files after GCS saves. Character links are per-profile. Imported character data is one-way and the source `.gcs` files are NEVER overwritten by STALKER. Legacy systems preserved. This is **not a true single-window UI merge**.

## Most important files
- `STALKER_One_Click_Setup/INSTALL_WINDOWS.cmd` – Windows setup entry.
- `STALKER_One_Click_Setup/tools/install-windows.ps1` – downloaded binary verification / GCS packaging / Electron builder.
- `STALKER_One_Click_Setup/App/CLAUDE_HANDOFF.md` – comprehensive implementation and next-step notes.
- `STALKER_One_Click_Setup/App/QA_REPORT_UNIFIED.md` – tested vs untested.
- `STALKER_One_Click_Setup/App/desktop/gcs-service.cjs` – GCS service, source validation and polling.
- `STALKER_One_Click_Setup/App/gcs-desktop.js` – native character workspace/synchronization UI.
- `PREVIEWS/GCS_Character_Workspace.png` – screenshot with mocked example character; not a real GCS UI capture.
- `BACKUPS/` – unchanged user-provided original and preceding integration build for rollback.

## Important limitations
- The source ZIP does not contain a Windows EXE. Windows setup downloads Node/Electron and the SHA-verified official Windows GCS archive, then builds an installer. Build/runtime has not been validated on a native Windows machine here.
- Authentic current-format `.gcs` files and all GCS calculations still need native validation.
- All-in-one **single window** would require substantially more source-level UI integration than this release.

## Sources
- https://github.com/richardwilkes/gcs (MPL-2.0)
- https://github.com/richardwilkes/gcs/releases/tag/v5.58.0
- https://github.com/richardwilkes/unison
- Original user-supplied STALKER source and prior integration build included in BACKUPS.
