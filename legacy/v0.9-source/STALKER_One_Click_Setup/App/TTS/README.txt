CUSTOM HEX NPC TOKENS FOR TABLETOP SIMULATOR

1. Use hex_token_builder.py to convert a portrait PNG into a transparent 512x512
   hexagonal token, or upload any PNG to TTS and use a Custom Tile -> Hex.
2. In TTS, go to Objects > Components > Custom > Custom Tile.
   Set Type = Hex, Top Image = your PNG, and Stackable = false.
   Use a Steam Cloud image or reachable HTTPS image so all players see it.
3. Right-click the tile > GM Notes. Add STALKER_NPC_ID:<actor-id>
   where actor-id is the unique *encounter actor* ID, not an NPC template ID.
4. Paste Global.lua in TTS Global scripting for the optional right-click menu
   that selects a linked NPC in the GM-hosted companion app.
5. Start the desktop companion GM server on port 7788, or change the first
   'companionPort' variable in Global.lua. TTS host must be the same Windows PC
   as the companion GM server for the localhost HTTP bridge.
6. To dynamically create a token, call Global function spawnStalkerNPCHex with
   encounter actor ID, visible image URL, and world position.

TTS handles the map, movement, and token objects. The companion handles stats.
The bridge is local only and cannot be reached from another player's TTS client.

Source: https://api.tabletopsimulator.com/custom-game-objects/#custom-tile
Source: https://api.tabletopsimulator.com/webrequest/manager/
