-- S.T.A.L.K.E.R. GURPS Companion: token lookup bridge for Tabletop Simulator.
-- Paste this script into TTS Global scripting. The GM must host both TTS and the companion server.
-- This is optional. Ordinary TTS movement and line of sight remain in TTS.
local companionPort = 7788
local PREFIX = "STALKER_NPC_ID:"

local function npcIdFromObject(obj)
    if obj == nil or obj.getGMNotes == nil then return nil end
    local notes = obj.getGMNotes() or ""
    local id = notes:match("STALKER_NPC_ID:([%w%-]+)")
    return id
end

local function selectInCompanion(npcId)
    if npcId == nil then return end
    local url = "http://127.0.0.1:" .. tostring(companionPort) .. "/tts/select"
    WebRequest.post(url, {actorId = npcId}, function(result)
        if result.is_error then
            print("Companion not reachable: " .. tostring(result.error))
        else
            print("NPC target linked: " .. npcId)
        end
    end)
end

local function registerNPCToken(obj)
    local id = npcIdFromObject(obj)
    if id == nil then return end
    obj.addContextMenuItem("Select in GURPS Companion", function(playerColor)
        selectInCompanion(id)
    end, false)
end

function onLoad()
    for _, obj in pairs(getAllObjects()) do registerNPCToken(obj) end
end

function onObjectSpawn(obj)
    Wait.frames(function() registerNPCToken(obj) end, 2)
end

-- Example: spawn a custom HEX tile associated with an encounter NPC.
-- PNG must have a URL TTS can load; use TTS Cloud Manager or accessible HTTPS hosting.
-- Replace npcId with the ID shown in the companion NPC encounter record.
function spawnStalkerNPCHex(npcId, imageURL, worldPosition)
    if npcId == nil or imageURL == nil then
        print("Usage: spawnStalkerNPCHex(npcId, imageURL, {x=0,y=2,z=0})")
        return
    end
    local position = worldPosition or {x=0,y=2,z=0}
    local obj = spawnObject({type="Custom_Tile", position=position, rotation={0,0,0}})
    obj.setCustomObject({image=imageURL, type=1, thickness=0.15, stackable=false})
    obj.setName("NPC " .. npcId)
    obj.setGMNotes(PREFIX .. npcId)
    obj.reload()
end
