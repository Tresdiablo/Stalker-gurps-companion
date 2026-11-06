# Beta 0.8 test report

## Checks completed in this environment
- JavaScript `node --check` passed for app.js, companion.js, navigation.js, integrated.js, ux08.js.
- Existing Node backend regression test: 1/1 passed.
- Chromium DOM smoke test: 14 GM pages and 6 Player pages routed individually; exactly one page visible each time, no page exceptions.
- The browser harness inlined local scripts and used an in-memory `localStorage` stand-in, because navigation to loopback/file URLs was blocked by the execution environment. Therefore it does not prove native Windows or file:// launch behavior.
- NPC/mutant template folders: changed filter to Mutant; created `Electrical` folder; created `Electro Dog` template under that folder and verified saved type/category.
- Inventory: spawned and selected an AK-74; its attached-part inventory panel rendered and displayed the item.
- GM attack against a player: selected encounter NPC and local player, rolled attack, confirmed player HP did not change while result was Calculated, then clicked Apply and verified the result became Applied and HP changed for a nonzero injury in the exercised run.
- GM-controlled player attack against NPC: rolled, created an un-applied combat record and preserved NPC HP.
- Existing NPC contextual menu on right-click: Edit, Duplicate, Generate Loadout, Assign Gear, Hex PNG, Delete displayed.
- GM Combat direction switch toggled the relevant attack interface and kept review visible.
- Advanced workbench group existed after visiting the editor.
- ZIP integrity and backed-up original archive checks performed during package creation.

## Not claimed
- No exhaustive audit of every button, toggle, or gameplay feature was performed; user requested that separately.
- Electron Windows installation and real Windows localStorage persistence were not tested here.
- Not a full GURPS rules-accuracy certification; underlying combat engine is carried over from Build 0.7.
- No multiplayer changes or tests beyond the existing regression test.
