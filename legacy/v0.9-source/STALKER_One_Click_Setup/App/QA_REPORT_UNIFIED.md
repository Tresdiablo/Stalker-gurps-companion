# QA report — STALKER GURPS Unified Desktop 0.9

## Implemented in source

1. Replace old GCS launcher/import duplication with one **GCS Character Workspace** on the character sheet in desktop mode.
2. Package the complete official **GCS 5.58.0** Windows x64 archive at Windows setup time after SHA256 verification (`1bf69c17167b6c134ce5ac6ee427af90e093de17048f03b8832b182ffd2e67a8`).
3. Add per-profile `.gcs` links persisted in Electron userData; the source `.gcs` files remain untouched.
4. Detect external saves of linked characters and automatically import fresh GCS data into the active STALKER profile, with SHA-based no-op on unchanged data.
5. Preserve campaign HP/FP when updating a previously imported GCS character; GCS remains authoritative for base stats and skills.
6. Keep all original STALKER subsystems and the old browser-only GCS importer.
7. Remove a wrong fixed `0.4.5` package-version assertion from the Windows bootstrap.
8. Provide a source handoff, release/architecture notes, tests and third-party MPL license.

## Tests run in the Linux working environment

- `node --check` on application JavaScript, Electron IPC and new GCS module — **passed**.
- `node --test backend/server.test.cjs desktop/gcs-service.test.cjs` — **6/6 passed** (GM/network regression + 5 GCS tests).
- `python tests/unified_gcs_browser_test.py` — **passed** with mocked Electron IPC (link, import, file change, HP preservation, unlink; no page JS errors).
- `python tests/navigation_regression.py` — **passed** at 980px and 650px: 14 navigable page checks each; connected player GM lockout; navigation exception fallback.
- Source ZIP integrity inspection — performed when archiving.

## Not tested here

- No actual Windows NSIS installer build or runtime launch.
- No genuine GCS Windows executable executed, and no authentic v5.58.0 file imported in a native test.
- No full interaction audit of every inherited STALKER screen and script.
- No single-window GCS UI embedding.
- No bidirectional GCS file edits or automatic change to `.gcs` source files.

## Risk notes

- One .gcs per profile, with a distinct instance of runtime inventory/HP. Overlapping GCS files in different profiles are allowed but their STALKER runtime state remains separate.
- Existing GCS import parser is retained. GCS versions/settings can introduce calculated values that the STALKER importer does not interpret.
- File polling runs at roughly 1.2 s intervals while STALKER is running; import includes a short additional settle delay. It is not a cloud-sync or background service.
- The app retains original browser localStorage-based saves and origin constraints; back up before installing.
- If installer network downloads fail or a checksum differs, installation stops safely instead of silently omitting GCS.

## Source references

- Original user-supplied STALKER Build 4.5 Integrated Beta 0.8 source.
- https://github.com/richardwilkes/gcs/releases/tag/v5.58.0
- https://github.com/richardwilkes/gcs
- https://github.com/richardwilkes/unison
- `python tests/regression_test.py` — **passed**: core startup, Tier 1 catalogue/ammo, NPC editor, encounters, stash/loot, hover tooltip, targeting and journal (zero browser JS errors).
- `python tests/deep_qa.py` — **passed**: GM/player control isolation, GM combat, ammo-limited fire, image fallback and tab checks (zero browser JS errors).
