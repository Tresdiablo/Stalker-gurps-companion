# Beta 0.8 — In-place UX integration into Build 4.5

## Inventory as equipment hub
- Expanded selected-item inspection directly on Inventory: dimensions, weight, condition, installed parts, weapon modifier summaries, ammunition shortcut.
- Physical optic, magazine, suppressor, and kit installation still uses drag-on-weapon; uninstallation remains in weapon right-click menu.
- Added context actions for empty chest/backpack storage and empty Loose Loot area (sort, auto-pack, rotate, move group, merge). Original item-specific menu is preserved.
- Routine quick actions are visible; destructive and less-frequent actions remain in existing overflow controls.

## One GM combat workspace
- Added direction switching between NPC attacking a player and player attacking an NPC while preserving original attack-calculation handlers.
- Included recent pending combat results below attack controls with injury edit and Apply, Resolve-without-HP, Ignore actions.
- Review uses the existing authoritative pending results; attack rolls do not automatically reduce HP.
- Moved advanced defensive, armor and maneuver fields into expandable groups, but they retain their existing IDs and handler connections.
- Removed forced reset of GM maneuver to Attack, allowing advanced attack settings to persist until modified.
- Kept the full combat-review history and backups accessible as a separate admin tool, not a prerequisite to applying damage.

## Folder-style NPC and mutant library
- Added left sidebar with All, NPCs, Mutants, Other, custom persistent categories, Uncategorized, and per-folder template counts.
- Selecting a folder drives the original type/category filters; creation defaults to the chosen type/category.
- Existing category creation, rename, and delete routines are reused; deleting a folder does not delete templates.
- Existing right-click / ellipsis template actions are preserved.

## Less interface clutter
- Converted the advanced NPC editor statistics, equipment, and advanced item-editor properties into collapsible sections.
- Grouped specialist master-catalog fields behind an advanced editor section.
- Retained accessible secondary GM tools and full player panels.

## Compatibility
- Original Build 4.5 ZIP preserved unchanged in `BUILD_4_5_ORIGINAL_BACKUP.zip`.
- Build 0.7 features retained, including single-piece DR, optional campaign DT, and no armor plate system.
- No campaign save schema replacement and no Python dependency.
- Multiplayer left unchanged; not a focus of this build.
- The previous beta is not overwritten.
