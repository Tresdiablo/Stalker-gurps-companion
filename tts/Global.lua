--[[
S.T.A.L.K.E.R. GURPS Companion — Tabletop Simulator bridge (optional)

Install: in TTS open Scripting > Global, paste this whole file (or merge it into your
existing Global script, e.g. OneWorld Recycled setups), Save & Play.
In the companion: GM Settings > Tabletop Simulator > Connect.

Uses TTS's External Editor API (localhost ports 39999/39998). Only the computer that hosts TTS
and the companion needs this. Close other TTS editor plugins (Atom / VS Code) while connected,
because they use the same port.

What it does
  * Right-click any object > "Companion: link to selected record" sends its GUID to the
    companion; the GM picks which NPC/character it represents there.
  * Right-click a linked token > "Companion: select" selects that character on the GM dashboard.
  * The companion can spawn black hex tokens for generated NPCs and push status text
    (name + "Wounded", "Down"...) to linked tokens. HP numbers are never written to tokens.
Movement, measuring, terrain and line of sight stay entirely in TTS.
]]

stalkerCompanion = stalkerCompanion or {}
local PREFIX = "STALKER_NPC_ID:"
local HEX_IMAGE = "" -- optional public URL of a black hex token image (players on other PCs need a public URL)

local function npcId(obj)
  if obj == nil or obj.getGMNotes == nil then return nil end
  local notes = obj.getGMNotes() or ""
  return notes:match(PREFIX .. "([%w_%-]+)")
end

local function send(tbl)
  sendExternalMessage(tbl)
end

local function addMenu(obj)
  if obj == nil or obj.addContextMenuItem == nil then return end
  obj.addContextMenuItem("Companion: select", function(_)
    send({ type = "select", guid = obj.getGUID(), name = obj.getName(), npcId = npcId(obj) })
  end, false)
  obj.addContextMenuItem("Companion: link to selected record", function(_)
    send({ type = "link", guid = obj.getGUID(), name = obj.getName(), npcId = npcId(obj) })
  end, false)
end

function stalkerCompanion.ping()
  send({ type = "log", text = "Tabletop Simulator bridge connected." })
end

-- Spawn hex tokens in a row. payload = { tokens = { {npcId, name, faction, image, description, index}, ... }, origin = {x,y,z} }
function stalkerCompanion.spawn(payload)
  local origin = payload.origin or { x = 0, y = 3, z = 0 }
  for _, t in ipairs(payload.tokens or {}) do
    local pos = { x = origin.x + (t.index or 0) * 2.2, y = origin.y, z = origin.z }
    local obj = spawnObject({ type = "Custom_Tile", position = pos, rotation = { 0, 180, 0 }, scale = { 0.9, 1, 0.9 } })
    local image = t.image or HEX_IMAGE
    if image ~= nil and image ~= "" then
      obj.setCustomObject({ image = image, type = 1, thickness = 0.2, stackable = false })
    else
      obj.setCustomObject({ type = 1, thickness = 0.2, stackable = false })
      obj.setColorTint({ 0.05, 0.05, 0.05 })
    end
    obj.setName(t.name or "NPC")
    obj.setDescription(t.description or "")
    obj.setGMNotes(PREFIX .. (t.npcId or ""))
    obj.reload()
    Wait.frames(function()
      local spawned = getObjectFromGUID(obj.getGUID())
      if spawned then
        addMenu(spawned)
        send({ type = "link", guid = spawned.getGUID(), name = t.name, npcId = t.npcId })
      end
    end, 30)
  end
end

-- Push approved status text. payload = { tokens = { {guid, name, description}, ... } }
function stalkerCompanion.status(payload)
  for _, t in ipairs(payload.tokens or {}) do
    local obj = getObjectFromGUID(t.guid)
    if obj then
      if t.name then obj.setName(t.name) end
      if t.description then obj.setDescription(t.description) end
    end
  end
end

function onLoad()
  for _, obj in pairs(getAllObjects()) do addMenu(obj) end
end

function onObjectSpawn(obj)
  Wait.frames(function() addMenu(obj) end, 2)
end
