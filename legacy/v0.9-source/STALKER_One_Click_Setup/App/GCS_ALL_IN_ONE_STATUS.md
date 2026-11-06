# Unified STALKER + GCS Windows workspace — v0.9 source release

## Implemented
- One Windows setup path bundles the **official, complete, unmodified GCS 5.58.0 Windows x64 release** into the same STALKER Electron installer. Official archive is SHA256-verified before packaging. No separate GCS installation is needed when setup succeeds.
- GCS opens in its complete **native window**, preserving its entire character editor and original Master/User library functionality. STALKER opens in its Electron desktop window.
- Each STALKER character profile can link to a distinct original `.gcs` file. Linked file paths are saved in `%APPDATA%` Electron user data under `gcs-workspace.json`.
- File changes trigger one-way import of character data into STALKER. The importer reuses the existing application parser and stats/skills rendering; it does not create a competing GURPS engine.
- Inventory, ammunition, NPC tools, shop, combat, GM pending damage, and STALKER-owned HP/FP tracking remain in the original application.
- The link service never writes to the GCS character documents. Saving the GCS character does not reset companion injuries when an existing GCS character was already imported.
- GCS file sync includes SHA256 deduplication, per-profile link association, and validation of file shape and size.
- In desktop mode, the duplicate manual import panel is hidden; browser-only mode still has the old .gcs file importer.
- No new third-party runtime libraries required by the integration. Existing STALKER app functionality is preserved.

## Important uncompleted items
- **NOT a single-window in-process port of GCS**: upstream GCS/Unison and Electron cannot be merged by simple embedding. The complete editor remains a separate native window within a single installed desktop suite.
- Sync is **one way (GCS to STALKER)**; edits to STALKER character attributes do not modify the original `.gcs` file. This is intentional to prevent source corruption.
- GCS's calculations remain upstream; the STALKER importer does not calculate every GCS rules feature. Check combat values in the native editor before play.
- Native Windows installer / full GCS launch are **not tested** in this environment. The release must be built and smoke-tested on Windows.
- Existing app code beyond the GCS integration has not been fully refactored or audited. Prior archived builds are included separately.

## Sources and redistribution
- GCS upstream: https://github.com/richardwilkes/gcs
- Release pinned: https://github.com/richardwilkes/gcs/releases/tag/v5.58.0
- MPL-2.0: https://www.mozilla.org/en-US/MPL/2.0/
- UI toolkit: https://github.com/richardwilkes/unison
- User-supplied STALKER GURPS Build 4.5 Integrated Beta 0.8 and prior desktop cleanup.

See `CLAUDE_HANDOFF.md` and `QA_REPORT_UNIFIED.md`.
