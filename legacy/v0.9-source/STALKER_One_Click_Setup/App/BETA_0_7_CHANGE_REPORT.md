# Beta 0.7 — Change report

**Base:** User-uploaded STALKER GURPS One-Click Setup Build 4.5 Full Patch, previously extended as Beta 0.6. This release changes that codebase, rather than using the separate Python beta.

## Requested changes applied

1. **Armor:** Removed GM plate laboratory page, plate fields from creation, durability-point calculations, plate-install/remove and combat wear. Removed obsolete plate guards in inventory/item deletion. Existing imported plate items are migrated once to regular loose Misc items; weapon and armor protection remains directly on the equipped carrier/vest/helmet/mask. Retains the previous campaign DT threshold independently of standard GURPS DR.
2. **Navigation:** Removed the separate Player Weapon & Armor tab and GM Armor Plates tab. The player manages weapons, armor, and installed items in Inventory; GM item editing remains in Workbench/Catalog and appearance images in Weapon Variants.
3. **Weapon interaction:** Pointer-dragging optics, suppressors, upgrade kits, and magazines directly onto weapon icons installs compatible items. Occupied slots/incompatible configurations show invalid feedback. Right-click weapon to uninstall its optic/suppressor/kit, or remove its magazine using the existing magazine command. Attachment item instances survive uninstallation.
4. **GM player-vs-NPC combat:** New visible GM attack workspace inside Combat Control with weapon, skill, range, and shots. The existing combat engine is invoked using the selected encounter target. Every calculated result records the target actor ID. NPC HP does not change until GM applies the queued outcome.
5. **GM NPC-vs-player combat:** NPC and player dropdowns are usable in Combat Control, including a fallback for the current local player profile. Selected NPC's attack generates a pending calculation without directly changing the player's HP. Combat round restrictions remain.
6. **Template folders:** Human NPC, Mutant, and Other template categories are independently stored, with create, rename, filter, and delete. Category deletion does not delete the templates; they move to Uncategorized.
7. **Reliability cleanup:** Removed dormant armor-plate conditionals. Maintained original catalog, GCS import, existing NPC templates, encounters, trader screens, and Windows installer-builder.

## Developer notes

- This is a local/browser-mode testing release, not a replacement server implementation.
- GM and Player are UI roles locally; password authentication and authoritative controls require future multiplayer architecture.
- The `tests/beta_07_browser_test.py` test uses a mocked browser storage origin. Windows launch, all inventory gestures, and every button in the program have not been independently verified.
- The user has asked for a comprehensive inactive-button/feature audit in a later, separately requested pass. This report does **not** claim that audit is complete.
