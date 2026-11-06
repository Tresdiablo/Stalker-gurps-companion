
'use strict';
const KEY='stalker-gurps-inventory-v1', COLS=10,ROWS=5;
const SLOT_TYPES={helmet:['Helmet'],mask:['Mask'],vest:['Vest'],armor:['Armor'],backpack:['Backpack'],hands:['Weapon','Magazine','Medical','Misc','Ammo','Artifact'],primary1:['Weapon'],primary2:['Weapon'],secondary:['Weapon'],pocket1:null,pocket2:null,pocket3:null,pocket4:null};
const DEFAULT={identity:{Name:'',Faction:'',Reputation:'',Rank:''},stats:{ST:10,DX:10,IQ:10,HT:10,HP:10,FP:10,'Basic Speed':5,Dodge:8},conditions:{Health:10,Fatigue:10,Radiation:0,Bleeding:0},catalog:[{id:'ak',name:'AK-74',category:'Weapon',w:5,h:2,weight:3.3,value:0,uses:0,storage:0,description:'Example weapon; add combat statistics separately.'},{id:'med',name:'Medkit',category:'Medical',w:2,h:2,weight:.5,value:0,uses:3,storage:0,description:'Example consumable.'},{id:'mag',name:'AK Magazine',category:'Magazine',w:1,h:2,weight:.25,value:0,uses:0,storage:0,description:'Example magazine.'}],items:[],slots:{},log:[]};
const clone=x=>JSON.parse(JSON.stringify(x));let state;let selected=null;let pendingCatalog=null;let rotated=false;let selectedTemplate=null;let editingTemplate=null;
function normalizeTier(t){const n=Number(String(t??1).replace(/[^0-9]/g,''));return Number.isInteger(n)&&n>=1&&n<=5?n:1}

// Built-in catalogue entry. Added to existing saved catalogues without changing inventories.
const AKM_TEMPLATE={id:'builtin-akm-76239',name:'AKM',category:'Weapon',tier:2,w:5,h:2,weight:4.3,value:0,uses:null,behavior:'equipment',image:'',description:'7.62×39mm Soviet assault rifle. Loaded weight approximately 4.3 kg. Grid dimensions and tier are custom campaign values. Combat statistics are provisional and should be verified against GURPS High-Tech.',gurps:{damage:'5d+1 pi',acc:'4',range:'500/2900',rof:'10',shots:'30+1',minST:'10',bulk:'-5',rcl:'2',dr:'',caliber:'7.62×39mm',capacity:'30',skill:'Guns (Rifle)',gurpsNotes:'Provisional GURPS 4e stats; 30-round detachable magazine. Ammo tracked separately, not as consumable uses.'},storageW:4,storageH:2,compartments:[]};
function ensureAkm(){if(!state.catalog.some(t=>t.id===AKM_TEMPLATE.id||t.name?.trim().toLowerCase()==='akm'&&t.category==='Weapon'))state.catalog.push(clone(AKM_TEMPLATE));}
function hasStorage(i){return !!i&&(i.category==='Vest'||i.category==='Backpack'||(i.category==='Armor'&&i.armorStorage===true))}
const EXAMPLE_GEAR=[
 {id:'sample-chest-rig',name:'Basic Chest Rig',category:'Vest',tier:1,w:3,h:2,weight:0.8,value:0,uses:null,behavior:'equipment',description:'Example chest rig with six 1×2 magazine pouches.',storageW:6,storageH:2,compartments:[{x:0,y:0,w:1,h:2},{x:1,y:0,w:1,h:2},{x:2,y:0,w:1,h:2},{x:3,y:0,w:1,h:2},{x:4,y:0,w:1,h:2},{x:5,y:0,w:1,h:2}],gurps:{}},
 {id:'sample-backpack',name:'Small Field Backpack',category:'Backpack',tier:1,w:3,h:3,weight:1.2,value:0,uses:null,behavior:'equipment',description:'Example backpack with a 5×5 storage grid.',storageW:5,storageH:5,compartments:[],gurps:{}},
 {id:'sample-helmet',name:'Basic Combat Helmet',category:'Helmet',tier:1,w:2,h:2,weight:1.5,value:0,uses:null,behavior:'equipment',description:'Example helmet. Set DR to match the specific helmet model.',gurps:{dr:''}},
 {id:'sample-mask',name:'Protective Respirator Mask',category:'Mask',tier:1,w:2,h:2,weight:0.6,value:0,uses:null,behavior:'equipment',description:'Example protective mask. Environmental protection requires campaign-specific rules.',gurps:{dr:''}},
 {id:'sample-armor-rig',name:'Basic Armored Carrier (No Storage)',category:'Armor',tier:2,w:3,h:3,weight:4.5,value:0,uses:null,behavior:'equipment',armorStorage:false,storageW:0,storageH:0,compartments:[],description:'Example armor carrier with no storage. Can be worn with a chest rig. Set DR for the armor model.',gurps:{dr:''}}
];

/* Tier 1 weapon import from the user's 14x14 inventory reference. Note that GURPS conversions are provisional. */
const TIER1_CATALOG={"weapons":[{"id":"t1-weapon-sks","name":"SKS","category":"Weapon","tier":1,"w":5,"h":1,"weight":3.85,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-sks.webp","weaponType":"Rifle","magFamilies":["sks"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 5×1 cells · 7.62×39mm · standard capacity 10. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"7.62×39mm","capacity":"10","shots":"10","rof":"3","damage":"5d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-svt-40","name":"SVT-40","category":"Weapon","tier":1,"w":6,"h":1,"weight":4.0,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-svt-40.webp","weaponType":"Rifle","magFamilies":["svt40"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 6×1 cells · 7.62×54R · standard capacity 10. Detachable-magazine feed.","gurps":{"caliber":"7.62×54R","capacity":"10","shots":"10","rof":"3","damage":"7d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-pm","name":"PM","category":"Weapon","tier":1,"w":2,"h":1,"weight":0.73,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-pm.webp","weaponType":"Pistol","magFamilies":["makarov"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 2×1 cells · 9×18mm PM · standard capacity 8. Detachable-magazine feed.","gurps":{"caliber":"9×18mm PM","capacity":"8","shots":"8","rof":"3","damage":"2d pi","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-mp5k-n","name":"MP5K-N","category":"Weapon","tier":1,"w":1,"h":2,"weight":2.0,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-mp5k-n.webp","weaponType":"SMG","magFamilies":["mp5"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 1×2 cells · 9×19mm · standard capacity 20. Detachable-magazine feed.","gurps":{"caliber":"9×19mm","capacity":"20","shots":"20","rof":"13","damage":"2d+2 pi","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-pb","name":"PB","category":"Weapon","tier":1,"w":3,"h":1,"weight":0.97,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-pb.webp","weaponType":"Pistol","magFamilies":["makarov"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 3×1 cells · 9×18mm PM · standard capacity 8. Detachable-magazine feed.","gurps":{"caliber":"9×18mm PM","capacity":"8","shots":"8","rof":"3","damage":"2d pi","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-tt","name":"TT","category":"Weapon","tier":1,"w":2,"h":1,"weight":0.85,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-tt.webp","weaponType":"Pistol","magFamilies":["tt"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 2×1 cells · 7.62×25mm Tokarev · standard capacity 8. Detachable-magazine feed.","gurps":{"caliber":"7.62×25mm Tokarev","capacity":"8","shots":"8","rof":"3","damage":"3d pi-","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-aps","name":"APS","category":"Weapon","tier":1,"w":2,"h":1,"weight":1.02,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-aps.webp","weaponType":"Pistol","magFamilies":["stechkin"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 2×1 cells · 9×18mm PM · standard capacity 20. Detachable-magazine feed.","gurps":{"caliber":"9×18mm PM","capacity":"20","shots":"20","rof":"12","damage":"2d pi","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-apb","name":"APB","category":"Weapon","tier":1,"w":4,"h":1,"weight":1.25,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-apb.webp","weaponType":"Pistol","magFamilies":["stechkin"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 4×1 cells · 9×18mm PM · standard capacity 20. Detachable-magazine feed.","gurps":{"caliber":"9×18mm PM","capacity":"20","shots":"20","rof":"12","damage":"2d pi","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-m1911a1","name":"M1911A1","category":"Weapon","tier":1,"w":2,"h":1,"weight":1.1,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-m1911a1.webp","weaponType":"Pistol","magFamilies":["1911"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 2×1 cells · .45 ACP · standard capacity 7. Detachable-magazine feed.","gurps":{"caliber":".45 ACP","capacity":"7","shots":"7","rof":"3","damage":"2d pi+","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-cz-75b","name":"CZ 75B","category":"Weapon","tier":1,"w":2,"h":1,"weight":1.0,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-cz-75b.webp","weaponType":"Pistol","magFamilies":["cz75"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 2×1 cells · 9×19mm · standard capacity 16. Detachable-magazine feed.","gurps":{"caliber":"9×19mm","capacity":"16","shots":"16","rof":"3","damage":"2d+2 pi","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-c-9","name":"C-9","category":"Weapon","tier":1,"w":2,"h":1,"weight":0.85,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-c-9.webp","weaponType":"Pistol","magFamilies":["hi-point-c9"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 2×1 cells · 9×19mm · standard capacity 8. Detachable-magazine feed.","gurps":{"caliber":"9×19mm","capacity":"8","shots":"8","rof":"3","damage":"2d+2 pi","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-92fs","name":"92FS","category":"Weapon","tier":1,"w":2,"h":1,"weight":0.95,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-92fs.webp","weaponType":"Pistol","magFamilies":["beretta92"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Pistol · source artwork 2×1 cells · 9×19mm · standard capacity 15. Detachable-magazine feed.","gurps":{"caliber":"9×19mm","capacity":"15","shots":"15","rof":"3","damage":"2d+2 pi","skill":"Guns (Pistol)","acc":"2","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-mts-255-12","name":"MTs-255-12","category":"Weapon","tier":1,"w":5,"h":1,"weight":3.0,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-mts-255-12.webp","weaponType":"Shotgun","magFamilies":["mts255"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Shotgun · source artwork 5×1 cells · 12/70 · standard capacity 5. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"12/70","capacity":"5","shots":"5","rof":"3","damage":"4d pi++","skill":"Guns (Shotgun)","acc":"3","rcl":"3","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-pp-91-kedr","name":"PP-91 Kedr","category":"Weapon","tier":1,"w":2,"h":2,"weight":1.54,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-pp-91-kedr.webp","weaponType":"SMG","magFamilies":["kedr"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 2×2 cells · 9×18mm PM · standard capacity 30. Detachable-magazine feed.","gurps":{"caliber":"9×18mm PM","capacity":"30","shots":"30","rof":"13","damage":"2d pi","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-mp-133","name":"MP-133","category":"Weapon","tier":1,"w":5,"h":1,"weight":3.1,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-mp-133.webp","weaponType":"Shotgun","magFamilies":["mp133"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Shotgun · source artwork 5×1 cells · 12/70 · standard capacity 6. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"12/70","capacity":"6","shots":"6","rof":"2","damage":"4d pi++","skill":"Guns (Shotgun)","acc":"3","rcl":"3","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-mp-43-1c","name":"MP-43-1C","category":"Weapon","tier":1,"w":7,"h":1,"weight":3.3,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-mp-43-1c.webp","weaponType":"Shotgun","magFamilies":["mp43"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Shotgun · source artwork 7×1 cells · 12/70 · standard capacity 2. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"12/70","capacity":"2","shots":"2","rof":"2","damage":"4d pi++","skill":"Guns (Shotgun)","acc":"3","rcl":"3","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-mp-153","name":"MP-153","category":"Weapon","tier":1,"w":7,"h":1,"weight":3.3,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-mp-153.webp","weaponType":"Shotgun","magFamilies":["mp153"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Shotgun · source artwork 7×1 cells · 12/70 · standard capacity 4. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"12/70","capacity":"4","shots":"4","rof":"3","damage":"4d pi++","skill":"Guns (Shotgun)","acc":"3","rcl":"3","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-mp-18","name":"MP-18","category":"Weapon","tier":1,"w":5,"h":1,"weight":2.8,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-mp-18.webp","weaponType":"Rifle","magFamilies":["mp18"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 5×1 cells · 7.62×54R · standard capacity 1. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"7.62×54R","capacity":"1","shots":"1","rof":"1","damage":"7d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-adar-2-15","name":"ADAR 2-15","category":"Weapon","tier":1,"w":2,"h":6,"weight":3.1,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-adar-2-15.webp","weaponType":"Rifle","magFamilies":["stanag556"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 2×6 cells · 5.56×45mm · standard capacity 10. Detachable-magazine feed.","gurps":{"caliber":"5.56×45mm","capacity":"10","shots":"10","rof":"3","damage":"5d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-sawed-off","name":"Sawed-off","category":"Weapon","tier":1,"w":3,"h":1,"weight":2.4,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-sawed-off.webp","weaponType":"Shotgun","magFamilies":["sawed"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Shotgun · source artwork 3×1 cells · 12/70 · standard capacity 2. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"12/70","capacity":"2","shots":"2","rof":"2","damage":"3d pi++","skill":"Guns (Shotgun)","acc":"3","rcl":"3","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-auto-5","name":"Auto-5","category":"Weapon","tier":1,"w":7,"h":1,"weight":3.8,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-auto-5.webp","weaponType":"Shotgun","magFamilies":["auto5"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Shotgun · source artwork 7×1 cells · 12/70 · standard capacity 4. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"12/70","capacity":"4","shots":"4","rof":"3","damage":"4d pi++","skill":"Guns (Shotgun)","acc":"3","rcl":"3","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-pp-9-klin","name":"PP-9 Klin","category":"Weapon","tier":1,"w":2,"h":2,"weight":1.54,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-pp-9-klin.webp","weaponType":"SMG","magFamilies":["kedr"],"integralFeed":false,"supportsPMM":true,"description":"Tier 1 · SMG · source artwork 2×2 cells · 9×18mm PM · standard capacity 30. Detachable-magazine feed.","gurps":{"caliber":"9×18mm PMM","capacity":"30","shots":"30","rof":"16","damage":"2d pi","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-pp-91-01-kedr-b","name":"PP-91-01 Kedr-B","category":"Weapon","tier":1,"w":3,"h":2,"weight":1.7,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-pp-91-01-kedr-b.webp","weaponType":"SMG","magFamilies":["kedr"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 3×2 cells · 9×18mm PM · standard capacity 30. Detachable-magazine feed.","gurps":{"caliber":"9×18mm PM","capacity":"30","shots":"30","rof":"13","damage":"2d pi","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-saiga-9","name":"Saiga-9","category":"Weapon","tier":1,"w":3,"h":2,"weight":3.0,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-saiga-9.webp","weaponType":"SMG","magFamilies":["vityaz9"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 3×2 cells · 9×19mm · standard capacity 10. Detachable-magazine feed.","gurps":{"caliber":"9×19mm","capacity":"10","shots":"10","rof":"3","damage":"2d+2 pi","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-ppsh-41","name":"PPSh-41","category":"Weapon","tier":1,"w":4,"h":2,"weight":3.6,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-ppsh-41.webp","weaponType":"SMG","magFamilies":["ppsh"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 4×2 cells · 7.62×25mm Tokarev · standard capacity 35. Detachable-magazine feed.","gurps":{"caliber":"7.62×25mm Tokarev","capacity":"35","shots":"35","rof":"15","damage":"3d pi-","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-pp-2000","name":"PP-2000","category":"Weapon","tier":1,"w":2,"h":1,"weight":1.4,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-pp-2000.webp","weaponType":"SMG","magFamilies":["pp2000"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 2×1 cells · 9×19mm · standard capacity 20. Detachable-magazine feed.","gurps":{"caliber":"9×19mm","capacity":"20","shots":"20","rof":"11","damage":"2d+2 pi","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-usc","name":"USC","category":"Weapon","tier":1,"w":4,"h":2,"weight":2.9,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-usc.webp","weaponType":"Rifle","magFamilies":["hk-usc"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 4×2 cells · .45 ACP · standard capacity 10. Detachable-magazine feed.","gurps":{"caliber":".45 ACP","capacity":"10","shots":"10","rof":"3","damage":"2d pi+","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-m1928a1","name":"M1928A1","category":"Weapon","tier":1,"w":4,"h":2,"weight":4.9,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-m1928a1.webp","weaponType":"SMG","magFamilies":["thompson-drum","thompson-box"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 4×2 cells · .45 ACP · standard capacity 50. Detachable-magazine feed.","gurps":{"caliber":".45 ACP","capacity":"50","shots":"50","rof":"10","damage":"2d pi+","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-m1a1","name":"M1A1","category":"Weapon","tier":1,"w":4,"h":2,"weight":4.7,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-m1a1.webp","weaponType":"SMG","magFamilies":["thompson-box"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 4×2 cells · .45 ACP · standard capacity 30. Detachable-magazine feed.","gurps":{"caliber":".45 ACP","capacity":"30","shots":"30","rof":"12","damage":"2d pi+","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-vpo-101-vepr-hunter","name":"VPO-101 Vepr-Hunter","category":"Weapon","tier":1,"w":2,"h":4,"weight":3.5,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-vpo-101-vepr-hunter.webp","weaponType":"Rifle","magFamilies":["vpo101"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 2×4 cells · 7.62×51mm · standard capacity 5. Detachable-magazine feed.","gurps":{"caliber":"7.62×51mm","capacity":"5","shots":"5","rof":"3","damage":"7d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-mosin-sniper","name":"Mosin Sniper","category":"Weapon","tier":1,"w":6,"h":1,"weight":4.1,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-mosin-sniper.webp","weaponType":"Rifle","magFamilies":["mosin"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 6×1 cells · 7.62×54R · standard capacity 5. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"7.62×54R","capacity":"5","shots":"5","rof":"1","damage":"7d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-vpo-136-vepr-km","name":"VPO-136 Vepr-KM","category":"Weapon","tier":1,"w":6,"h":2,"weight":3.3,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-vpo-136-vepr-km.webp","weaponType":"Rifle","magFamilies":["ak762"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 6×2 cells · 7.62×39mm · standard capacity 10. Detachable-magazine feed.","gurps":{"caliber":"7.62×39mm","capacity":"10","shots":"10","rof":"3","damage":"5d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-mosin-infantry","name":"Mosin Infantry","category":"Weapon","tier":1,"w":6,"h":1,"weight":4.0,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-mosin-infantry.webp","weaponType":"Rifle","magFamilies":["mosin"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 6×1 cells · 7.62×54R · standard capacity 5. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":"7.62×54R","capacity":"5","shots":"5","rof":"1","damage":"7d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-vpo-215-gornostay","name":"VPO-215 Gornostay","category":"Weapon","tier":1,"w":5,"h":1,"weight":2.8,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-vpo-215-gornostay.webp","weaponType":"Rifle","magFamilies":["vpo215-custom"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 5×1 cells · 7.62×39mm · standard capacity 4. Detachable-magazine feed.","gurps":{"caliber":"7.62×39mm","capacity":"4","shots":"4","rof":"1","damage":"5d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. CUSTOM CAMPAIGN CONVERSION: 7.62×39 instead of the real VPO-215 .366 TKM; original factory magazine incompatible with this conversion."}},{"id":"t1-weapon-stg-44","name":"StG-44","category":"Weapon","tier":1,"w":5,"h":2,"weight":4.6,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-stg-44.webp","weaponType":"Rifle","magFamilies":["stg44"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 5×2 cells · 7.92×33mm Kurz · standard capacity 30. Detachable-magazine feed.","gurps":{"caliber":"7.92×33mm Kurz","capacity":"30","shots":"30","rof":"9","damage":"5d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-uzi","name":"UZI","category":"Weapon","tier":1,"w":2,"h":2,"weight":3.5,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-uzi.webp","weaponType":"SMG","magFamilies":["uzi9"],"integralFeed":false,"supportsPMM":false,"description":"Tier 1 · SMG · source artwork 2×2 cells · 9×19mm · standard capacity 32. Detachable-magazine feed.","gurps":{"caliber":"9×19mm","capacity":"32","shots":"32","rof":"10","damage":"2d+2 pi","skill":"Guns (SMG)","acc":"3","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}},{"id":"t1-weapon-henry-bbs","name":"Henry BBs","category":"Weapon","tier":1,"w":5,"h":1,"weight":2.8,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"image":"t1-henry-bbs.webp","weaponType":"Rifle","magFamilies":["henry357"],"integralFeed":true,"supportsPMM":false,"description":"Tier 1 · Rifle · source artwork 5×1 cells · .357 Magnum (9×33R) · standard capacity 10. Built-in fixed/tubular/cylinder feed.","gurps":{"caliber":".357 Magnum (9×33R)","capacity":"10","shots":"10","rof":"2","damage":"3d pi","skill":"Guns (Rifle)","acc":"4","rcl":"2","gurpsNotes":"PROVISIONAL HOMEBREW combat and weight values, not official GURPS tables. Gun size/capacity/caliber transcribed from player image. "}}],"magazines":[{"id":"t1-mag-sks-fixed-10-round-box","name":"SKS fixed 10-round box","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.16,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"sks","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected.","gurps":{"caliber":"7.62×39mm","capacity":"10","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-svt-40-10-round-magazine","name":"SVT-40 10-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.21,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"svt40","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"7.62×54R","capacity":"10","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-pm-pb-8-round-magazine","name":"PM / PB 8-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.08,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"makarov","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×18mm PM","capacity":"8","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-mp5-20-round-magazine","name":"MP5 20-round magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.19,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"mp5","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. Also fits other MP5-pattern guns.","gurps":{"caliber":"9×19mm","capacity":"20","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. Also fits other MP5-pattern guns."}},{"id":"t1-mag-tt-8-round-magazine","name":"TT 8-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.08,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"tt","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"7.62×25mm Tokarev","capacity":"8","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-aps-apb-20-round-magazine","name":"APS / APB 20-round magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.16,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"stechkin","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×18mm PM","capacity":"20","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-m1911-7-round-magazine","name":"M1911 7-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.08,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"1911","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":".45 ACP","capacity":"7","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-cz-75b-16-round-magazine","name":"CZ 75B 16-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.09,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"cz75","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×19mm","capacity":"16","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-hi-point-c-9-8-round-magazine","name":"Hi-Point C-9 8-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.09,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"hi-point-c9","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×19mm","capacity":"8","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-beretta-92-15-round-magazine","name":"Beretta 92 15-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.1,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"beretta92","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×19mm","capacity":"15","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-mts-255-12-5-shot-cylinder","name":"MTs-255-12 5-shot cylinder","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.05,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"mts255","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected.","gurps":{"caliber":"12/70","capacity":"5","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-kedr-kedr-b-klin-30-round-magazine","name":"Kedr / Kedr-B / Klin 30-round magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.13,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"kedr","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. PMM ammunition can be used only when attached to the Klin; regular Kedr variants cannot fire PMM safely.","gurps":{"caliber":"9×18mm PM","capacity":"30","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. PMM ammunition can be used only when attached to the Klin; regular Kedr variants cannot fire PMM safely."}},{"id":"t1-mag-mp-133-6-shot-tube","name":"MP-133 6-shot tube","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.15,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"mp133","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected.","gurps":{"caliber":"12/70","capacity":"6","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-mp-43-1c-2-chamber-breech","name":"MP-43-1C 2-chamber breech","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.02,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"mp43","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected.","gurps":{"caliber":"12/70","capacity":"2","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-mp-153-4-shot-tube","name":"MP-153 4-shot tube","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.12,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"mp153","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected.","gurps":{"caliber":"12/70","capacity":"4","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-mp-18-single-shot-breech","name":"MP-18 single-shot breech","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.01,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"mp18","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected.","gurps":{"caliber":"7.62×54R","capacity":"1","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-ar-15-stanag-10-round-magazine","name":"AR-15 STANAG 10-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.12,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"stanag556","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. Standard STANAG 5.56 magazine; compatible with other STANAG AR-15s.","gurps":{"caliber":"5.56×45mm","capacity":"10","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. Standard STANAG 5.56 magazine; compatible with other STANAG AR-15s."}},{"id":"t1-mag-sawed-off-2-chamber-breech","name":"Sawed-off 2-chamber breech","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.02,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"sawed","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected.","gurps":{"caliber":"12/70","capacity":"2","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-auto-5-4-shot-tube","name":"Auto-5 4-shot tube","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.11,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"auto5","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected.","gurps":{"caliber":"12/70","capacity":"4","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-saiga-9-vityaz-10-round-magazine","name":"Saiga-9 / Vityaz 10-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.11,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"vityaz9","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. 9mm Vityaz-pattern magazine; also for matching PP-19-01 variants.","gurps":{"caliber":"9×19mm","capacity":"10","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. 9mm Vityaz-pattern magazine; also for matching PP-19-01 variants."}},{"id":"t1-mag-ppsh-41-35-round-box-magazine","name":"PPSh-41 35-round box magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.21,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"ppsh","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"7.62×25mm Tokarev","capacity":"35","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-pp-2000-20-round-magazine","name":"PP-2000 20-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.13,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"pp2000","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×19mm","capacity":"20","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-hk-usc-10-round-magazine","name":"HK USC 10-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.13,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"hk-usc","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. USC civilian magazine does NOT interchange with unmodified UMP 45 magazines.","gurps":{"caliber":".45 ACP","capacity":"10","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. USC civilian magazine does NOT interchange with unmodified UMP 45 magazines."}},{"id":"t1-mag-thompson-m1928-50-round-drum","name":"Thompson M1928 50-round drum","category":"Magazine","tier":1,"w":2,"h":2,"weight":0.95,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"thompson-drum","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. Not compatible with the Thompson M1A1.","gurps":{"caliber":".45 ACP","capacity":"50","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. Not compatible with the Thompson M1A1."}},{"id":"t1-mag-thompson-30-round-stick-magazine","name":"Thompson 30-round stick magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.25,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"thompson-box","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. Compatible with the M1928A1 and M1A1.","gurps":{"caliber":".45 ACP","capacity":"30","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. Compatible with the M1928A1 and M1A1."}},{"id":"t1-mag-vpo-101-5-round-magazine","name":"VPO-101 5-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.12,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"vpo101","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"7.62×51mm","capacity":"5","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-mosin-5-round-fixed-magazine","name":"Mosin 5-round fixed magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.03,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"mosin","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected. Both Mosin Infantry and Mosin Sniper use a fixed magazine.","gurps":{"caliber":"7.62×54R","capacity":"5","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. Both Mosin Infantry and Mosin Sniper use a fixed magazine."}},{"id":"t1-mag-ak-7-62-39-10-round-magazine","name":"AK 7.62×39 10-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.18,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"ak762","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. Interchanges with the unmodified AKM and VPO-136 Vepr-KM magazine systems.","gurps":{"caliber":"7.62×39mm","capacity":"10","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. Interchanges with the unmodified AKM and VPO-136 Vepr-KM magazine systems."}},{"id":"t1-mag-vpo-215-custom-7-62-39-4-round-magazine","name":"VPO-215 custom 7.62×39 4-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.14,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"vpo215-custom","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. FICTIONAL CUSTOM CAMPAIGN CONVERSION. Real VPO-215 is .366 TKM; no claim that factory magazines support 7.62×39.","gurps":{"caliber":"7.62×39mm","capacity":"4","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. FICTIONAL CUSTOM CAMPAIGN CONVERSION. Real VPO-215 is .366 TKM; no claim that factory magazines support 7.62×39."}},{"id":"t1-mag-stg-44-30-round-magazine","name":"StG-44 30-round magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.28,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"stg44","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"7.92×33mm Kurz","capacity":"30","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-uzi-32-round-magazine","name":"UZI 32-round magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.19,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"uzi9","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family. Full-size UZI magazines, not MP5 or UZI PRO magazine patterns.","gurps":{"caliber":"9×19mm","capacity":"32","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. Full-size UZI magazines, not MP5 or UZI PRO magazine patterns."}},{"id":"t1-mag-henry-357-10-round-tube","name":"Henry .357 10-round tube","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.09,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"henry357","integralMagazine":true,"description":"Built-in feed system; automatically supplied with the corresponding weapon. Cannot be ejected. Model inferred from 9×33R (.357 Magnum) marking; cartridge naming is a campaign interpretation.","gurps":{"caliber":".357 Magnum (9×33R)","capacity":"10","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. Model inferred from 9×33R (.357 Magnum) marking; cartridge naming is a campaign interpretation."}},{"id":"t1-mag-mp5-30-round-magazine","name":"MP5 30-round magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.23,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"mp5","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×19mm","capacity":"30","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-kedr-20-round-magazine","name":"Kedr 20-round magazine","category":"Magazine","tier":1,"w":1,"h":1,"weight":0.1,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"kedr","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×18mm PM","capacity":"20","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}},{"id":"t1-mag-pp-19-01-vityaz-30-round-magazine","name":"PP-19-01 Vityaz 30-round magazine","category":"Magazine","tier":1,"w":1,"h":2,"weight":0.19,"value":0,"uses":null,"behavior":"equipment","stackSize":1,"magFamily":"vityaz9","integralMagazine":false,"description":"Detachable magazine; compatible guns use the same magazine family.","gurps":{"caliber":"9×19mm","capacity":"30","gurpsNotes":"Capacity based on supplied Tier 1 equipment image; see compatibility notes. "}}],"ammunition":[{"id":"t1-ammo-7-62-39mm-fmj","name":"7.62×39mm FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.016,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. VPO-215 use in this campaign is a fictional chamber conversion.","gurps":{"caliber":"7.62×39mm","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. VPO-215 use in this campaign is a fictional chamber conversion."}},{"id":"t1-ammo-7-62-39mm-hp","name":"7.62×39mm HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.016,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. VPO-215 use in this campaign is a fictional chamber conversion.","gurps":{"caliber":"7.62×39mm","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. VPO-215 use in this campaign is a fictional chamber conversion."}},{"id":"t1-ammo-7-62-54r-fmj","name":"7.62×54R FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.023,"value":0,"uses":null,"behavior":"ammo","stackSize":20,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"7.62×54R","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-7-62-54r-hp","name":"7.62×54R HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.023,"value":0,"uses":null,"behavior":"ammo","stackSize":20,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"7.62×54R","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-9-18mm-pm-fmj","name":"9×18mm PM FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.01,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"9×18mm PM","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-9-18mm-pm-hp","name":"9×18mm PM HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.01,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"9×18mm PM","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-9-18mm-pmm-fmj","name":"9×18mm PMM FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.01,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. Higher-pressure PMM: compatible with Klin only, not Kedr/Kedr-B/PM/PB/APS/APB.","gurps":{"caliber":"9×18mm PMM","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. Higher-pressure PMM: compatible with Klin only, not Kedr/Kedr-B/PM/PB/APS/APB."}},{"id":"t1-ammo-9-18mm-pmm-hp","name":"9×18mm PMM HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.01,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. Higher-pressure PMM: compatible with Klin only, not Kedr/Kedr-B/PM/PB/APS/APB.","gurps":{"caliber":"9×18mm PMM","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. Higher-pressure PMM: compatible with Klin only, not Kedr/Kedr-B/PM/PB/APS/APB."}},{"id":"t1-ammo-9-19mm-fmj","name":"9×19mm FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.012,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"9×19mm","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-9-19mm-hp","name":"9×19mm HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.012,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"9×19mm","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-7-62-25mm-tokarev-fmj","name":"7.62×25mm Tokarev FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.011,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"7.62×25mm Tokarev","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-7-62-25mm-tokarev-hp","name":"7.62×25mm Tokarev HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.011,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"7.62×25mm Tokarev","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-45-acp-fmj","name":".45 ACP FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.021,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":".45 ACP","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-45-acp-hp","name":".45 ACP HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.021,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":".45 ACP","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-12-70-slug","name":"12/70 Slug","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.043,"value":0,"uses":null,"behavior":"ammo","stackSize":20,"description":"Tier 1 basic Slug cartridges. Buckshot and slugs are shotgun load types; FMJ/HP are not the usual labels for shot shells.","gurps":{"caliber":"12/70","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. Buckshot and slugs are shotgun load types; FMJ/HP are not the usual labels for shot shells."}},{"id":"t1-ammo-12-70-buckshot","name":"12/70 Buckshot","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.043,"value":0,"uses":null,"behavior":"ammo","stackSize":20,"description":"Tier 1 basic Buckshot cartridges. Buckshot and slugs are shotgun load types; FMJ/HP are not the usual labels for shot shells.","gurps":{"caliber":"12/70","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. Buckshot and slugs are shotgun load types; FMJ/HP are not the usual labels for shot shells."}},{"id":"t1-ammo-5-56-45mm-fmj","name":"5.56×45mm FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.012,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"5.56×45mm","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-5-56-45mm-hp","name":"5.56×45mm HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.012,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"5.56×45mm","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-7-62-51mm-fmj","name":"7.62×51mm FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.024,"value":0,"uses":null,"behavior":"ammo","stackSize":20,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"7.62×51mm","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-7-62-51mm-hp","name":"7.62×51mm HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.024,"value":0,"uses":null,"behavior":"ammo","stackSize":20,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"7.62×51mm","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-357-magnum-9-33r-fmj","name":".357 Magnum (9×33R) FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.015,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":".357 Magnum (9×33R)","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-357-magnum-9-33r-hp","name":".357 Magnum (9×33R) HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.015,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":".357 Magnum (9×33R)","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-7-92-33mm-kurz-fmj","name":"7.92×33mm Kurz FMJ","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.017,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic FMJ cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication.","gurps":{"caliber":"7.92×33mm Kurz","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication."}},{"id":"t1-ammo-7-92-33mm-kurz-hp","name":"7.92×33mm Kurz HP","category":"Ammo","tier":1,"w":1,"h":1,"weight":0.017,"value":0,"uses":null,"behavior":"ammo","stackSize":30,"description":"Tier 1 basic HP cartridges. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. HP is a campaign-equivalent hunting load, not a claim of a widely available military StG-44 issue round.","gurps":{"caliber":"7.92×33mm Kurz","gurpsNotes":"Ammunition-type injury / armor effects are not automatically applied by current GURPS combat resolution. FMJ = ball/full metal jacket; HP = expanding/hollow point. Injury adjustments require GM adjudication. HP is a campaign-equivalent hunting load, not a claim of a widely available military StG-44 issue round."}}]};
function ensureTier1Catalog(){
  if(!state?.catalog)return;
  const existing=new Set(state.catalog.map(t=>t.id));
  for(const t of [...TIER1_CATALOG.weapons,...TIER1_CATALOG.magazines,...TIER1_CATALOG.ammunition]){
    if(!existing.has(t.id)){state.catalog.push(clone(t));existing.add(t.id);}
  }
  // Previous releases already included AKM and an example 30-round AK magazine.
  for(const t of [...state.catalog,...(state.items||[])]){
    if((t.id==='builtin-akm-76239'||t.templateId==='builtin-akm-76239')&&!t.magFamilies)t.magFamilies=['ak762'];
    if((t.id==='sample-akm-30-mag'||t.templateId==='sample-akm-30-mag')&&!t.magFamily)t.magFamily='ak762';
  }
}
function magazineFitsWeapon(m,w){
  if(!m||!w||m.category!=='Magazine'||w.category!=='Weapon')return false;
  if(!sameCaliber(m,w)&&!(w.supportsPMM&&normalizedCaliber(itemCaliber(m))==='9x18pm'))return false;
  if(m.integralMagazine)return false; // Integral feeds are created with their owner, not inserted by hand.
  const allowed=Array.isArray(w.magFamilies)?w.magFamilies:[w.magFamily].filter(Boolean);
  if(allowed.length||m.magFamily)return allowed.includes(m.magFamily);
  return true; // Legacy user-created items retain the old caliber-only behavior.
}
function ammoFitsMagazine(a,m){
  if(!a||!m||a.category!=='Ammo'||m.category!=='Magazine')return false;
  const ac=normalizedCaliber(itemCaliber(a)),mc=normalizedCaliber(itemCaliber(m));
  return ac===mc || (ac==='9x18pmm'&&mc==='9x18pm'&&m.magFamily==='kedr');
}
function magAmmoFitsWeapon(m,w){
  if(!m?.loadedRounds||!m.loadedAmmoType)return true;
  // The higher-pressure PMM cartridge must not fire in Kedr, Makarov or Stechkin platforms.
  const loaded=String(m.loadedAmmoType).toLowerCase();
  return !(/9\s*[x×]\s*18.*pmm/.test(loaded)&&!w.supportsPMM);
}
function createInternalFeedForWeapon(w){
  if(!w?.integralFeed||w.magazineId)return;
  const family=(w.magFamilies||[])[0];
  const original=TIER1_CATALOG.magazines.find(m=>m.magFamily===family&&m.integralMagazine);const t=original?(template(original.id)||original):null;
  if(!t)return;
  const magazine={...clone(t),id:uid(),templateId:t.id,location:'loaded',weaponId:w.id,loadedRounds:0,quantity:1,integralMagazine:true};
  state.items.push(magazine);w.magazineId=magazine.id;
}

function ensureExampleGear(){for(const t of EXAMPLE_GEAR)if(!state.catalog.some(i=>i.id===t.id))state.catalog.push(clone(t))}
const CONSUMABLE_CATEGORIES=new Set(['Medical']);
function isConsumable(item){return item?.behavior==='consumable'||(!item?.behavior&&CONSUMABLE_CATEGORIES.has(item?.category))}
function resolveUses(category,behavior,uses){return behavior==='consumable'||(!behavior&&CONSUMABLE_CATEGORIES.has(category))?Math.max(1,Math.floor(Number(uses)||1)):null}
function updateItemBehavior(){const form=document.getElementById('itemForm');const category=form.elements.namedItem('category').value;const behavior=form.elements.namedItem('behavior').value;const uses=behavior==='consumable'||(!behavior&&CONSUMABLE_CATEGORIES.has(category));document.querySelector('.uses-field').style.display=uses?'':'none';document.getElementById('usesHint').textContent=uses?'Consumable items have limited uses.':'This item has no use counter. Ammunition quantities and magazine rounds are separate properties.';document.querySelectorAll('.medical-field').forEach(el=>el.style.display=category==='Medical'?'':'none');const groups={Weapon:['damage','acc','range','rof','shots','minST','bulk','rcl','caliber','skill'],Magazine:['caliber','capacity'],Ammo:['caliber','damage'],Helmet:['dr'],Vest:['dr'],Armor:['dr'],Mask:['dr'],Backpack:[],Medical:[],Artifact:[],Misc:[]};const allowed=new Set([...(groups[category]||[]),'gurpsNotes']);document.querySelectorAll('.weapon-mag-field').forEach(el=>el.style.display=category==='Weapon'?'':'none');document.querySelectorAll('.mag-family-field').forEach(el=>el.style.display=category==='Magazine'?'':'none');document.querySelectorAll('.gurps-editor [name]').forEach(el=>{el.closest('label').style.display=allowed.has(el.name)?'':'none'});}
function load(){try{const raw=localStorage.getItem(KEY);state=raw?JSON.parse(raw):clone(DEFAULT);if(!state||!Array.isArray(state.items)||!Array.isArray(state.catalog)||!state.slots)throw Error('Invalid save');for(const t of state.catalog){t.tier=normalizeTier(t.tier);if(['Vest','Backpack'].includes(t.category)||t.category==='Armor'&&t.armorStorage===true){t.storageW=t.storageW||4;t.storageH=t.storageH||2;t.compartments=t.compartments||[]}}for(const i of state.items){if(['Vest','Backpack'].includes(i.category)||i.category==='Armor'&&i.armorStorage===true){i.storageW=i.storageW||4;i.storageH=i.storageH||2}if(i.location==='grid')i.location='loose'}ensureAkm();ensureExampleGear();ensureTier1Catalog();state.posture=state.posture||'Standing';state.statusFlags=state.statusFlags||{};state.conditions=state.conditions||clone(DEFAULT.conditions)}catch(e){state=clone(DEFAULT);ensureAkm();ensureExampleGear();ensureTier1Catalog();state.posture='Standing';state.statusFlags={}}}
function saveBase(){try{localStorage.setItem(KEY,JSON.stringify(state))}catch(e){notice('Save failed: browser storage may be full or disabled. Export a save file.')}}
function notice(s){document.getElementById('notice').textContent=s}
function log(s){state.log.unshift(new Date().toLocaleTimeString()+' — '+s);state.log=state.log.slice(0,200);renderLog();save()}
function uid(){return crypto?.randomUUID?.()||'i'+Date.now()+Math.random().toString(36).slice(2)}
function byId(id){return state.items.find(i=>i.id===id)}
function template(id){return state.catalog.find(i=>i.id===id)}
function dimensions(i){return {w:i.rotated?i.h:i.w,h:i.rotated?i.w:i.h}}
function containerFor(i){return i?.location==='vestGrid'?'vest':i?.location==='backpackGrid'?'backpack':null}
function chestContainer(){const chest=byId(state.slots.vest);return chest||((a)=>hasStorage(a)?a:null)(byId(state.slots.armor))}
function storageDims(slot){const i=slot==='vest'?chestContainer():byId(state.slots[slot]);return i&&hasStorage(i)?{w:Number(i.storageW)||4,h:Number(i.storageH)||2}:null}
function storageLocation(slot){return slot==='vest'?'vestGrid':'backpackGrid'}
function compartmentsFor(slot){const eq=slot==='vest'?chestContainer():byId(state.slots[slot]);const size=storageDims(slot);if(!size)return [];return Array.isArray(eq.compartments)&&eq.compartments.length?eq.compartments:[{x:0,y:0,w:size.w,h:size.h}]}
function canPlace(i,x,y,slot){if(i.id===(slot==='vest'?chestContainer()?.id:byId(state.slots.backpack)?.id))return false;if(hasStorage(i)&&i.id===(slot==='vest'?chestContainer()?.id:byId(state.slots.backpack)?.id))return false;if(i.category==='Armor'&&i.location==='slot'&&i.slot==='armor'&&hasStorage(i)&&state.items.some(o=>o.location==='vestGrid'))return false;const size=storageDims(slot);if(!size)return false;const d=dimensions(i);if(x<0||y<0||x+d.w>size.w||y+d.h>size.h)return false;if(!compartmentsFor(slot).some(c=>x>=c.x&&y>=c.y&&x+d.w<=c.x+c.w&&y+d.h<=c.y+c.h))return false;if(window.STALKER_EXT?.pouchAllows&&!window.STALKER_EXT.pouchAllows(i,x,y,slot))return false;for(const other of state.items){if(other.id===i.id||other.location!==storageLocation(slot))continue;const o=dimensions(other);if(x<other.x+o.w&&x+d.w>other.x&&y<other.y+o.h&&y+d.h>other.y)return false}return true}
function findFree(i,slot){const size=storageDims(slot);if(!size)return null;for(let y=0;y<size.h;y++)for(let x=0;x<size.w;x++)if(canPlace(i,x,y,slot))return {x,y};return null}
function showPage(page){for(const key of ['character','sheet','status','catalog']){document.getElementById(key+'Page').hidden=key!==page}document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false')})} 
function stackLimit(i){return hasStorage(i)?1:Math.max(1,Math.floor(Number(i.stackSize)||1))}
function itemQuantity(i){return Math.max(1,Math.floor(Number(i.quantity)||1))}
function isBulkSpawnItem(t){
 const category=String(t.category||'').trim().toLowerCase();
 const name=String(t.name||'').trim().toLowerCase();
 return category==='ammo'||category==='ammunition'||category==='rubles'||category==='roubles'||category==='currency'||/^(?:₽|rubles?|roubles?|ruble|rouble)(?:\s|$)/i.test(name);
}
function addItem(tid){
 const t=template(tid);if(!t)return;
 const field=document.querySelector(`[data-spawn-quantity="${tid}"]`);
 const total=Number(field?.value??1);
 const cap=isBulkSpawnItem(t)?10000:10;
 if(!Number.isSafeInteger(total)||total<1||total>cap){notice(`Enter a whole number from 1 to ${cap}.`);return}
 const max=stackLimit(t),stacks=Math.ceil(total/max);
 if(stacks>1000){notice('Too many separate stacks. Reduce the amount or increase the stack size.');return}
 let remaining=total;
 for(let n=0;n<stacks;n++){
  const qty=Math.min(remaining,max);
  const item={...clone(t),id:uid(),templateId:tid,quantity:qty,location:'loose',x:0,y:0,rotated:false};
  state.items.push(item);createInternalFeedForWeapon(item);remaining-=qty;
 }
 save();render();log(`Spawned ${total} × ${t.name} in ${stacks} stack(s) into Loose Loot`);
 notice(`Spawned ${total} × ${t.name}. Items are in Loose Loot on the Inventory page.`);
}
function openSplitStack(id){
 const item=byId(id);if(!item)return;
 selected=id;
 const qty=itemQuantity(item);
 if(qty<2){notice('This item has only one unit and cannot be split.');return}
 const dialog=document.getElementById('splitStackDialog');
 const amount=document.getElementById('splitAmount');
 document.getElementById('splitItemName').textContent=`${item.name} — ${qty} available`;
 amount.min='1';amount.max=String(qty-1);amount.value=String(Math.max(1,Math.floor(qty/2)));
 document.getElementById('splitMinus').onclick=()=>{amount.value=String(Math.max(1,Number(amount.value)-1))};
 document.getElementById('splitPlus').onclick=()=>{amount.value=String(Math.min(qty-1,Number(amount.value)+1))};
 document.getElementById('confirmSplit').onclick=()=>{
  const n=Number(amount.value);
  if(!Number.isSafeInteger(n)||n<1||n>=itemQuantity(item)){notice('Split amount must be between 1 and '+(itemQuantity(item)-1));return}
  const copy={...clone(item),id:uid(),quantity:n,location:'loose',rotated:!!item.rotated};
  delete copy.slot;delete copy.x;delete copy.y;
  // Pocket slots are reserved for one-cell items; otherwise try chest and backpack grids.
  let placed=false;
  const dims=dimensions(copy);
  if(dims.w===1&&dims.h===1){
   for(const slot of ['pocket1','pocket2','pocket3','pocket4']){
    if(!state.slots[slot]&&canEquip(copy,slot)){copy.location='slot';copy.slot=slot;state.slots[slot]=copy.id;placed=true;break}
   }
  }
  if(!placed){for(const slot of ['vest','backpack']){
   const spot=findFree(copy,slot);
   if(spot){copy.location=storageLocation(slot);copy.x=spot.x;copy.y=spot.y;placed=true;break}
  }}
  item.quantity=itemQuantity(item)-n;state.items.push(copy);
  save();render();dialog.close();
  notice(`Split ${n} × ${item.name} into ${placed?'available inventory storage':'Loose Loot'}.`);
 };
 dialog.showModal();
}
function openItemContextBase(e,id){
 e.preventDefault();e.stopPropagation();
 const item=byId(id);if(!item)return;
 const menu=document.getElementById('itemContextMenu');menu.replaceChildren();
 const inspect=document.createElement('button');inspect.textContent='Inspect';inspect.onclick=()=>{selected=id;render();menu.hidden=true};menu.append(inspect);
 const split=document.createElement('button');split.textContent='Split stack';split.disabled=itemQuantity(item)<2;split.onclick=()=>{menu.hidden=true;openSplitStack(id)};menu.append(split);
 menu.style.left=Math.min(e.clientX,innerWidth-180)+'px';menu.style.top=Math.min(e.clientY,innerHeight-110)+'px';menu.hidden=false;
}
document.addEventListener('pointerdown',e=>{const menu=document.getElementById('itemContextMenu');if(menu&&!menu.contains(e.target))menu.hidden=true});
document.addEventListener('keydown',e=>{if(e.key==='Escape')document.getElementById('itemContextMenu').hidden=true});
function moveGrid(id,x,y,slot){const i=byId(id);if(!i)return;if(i.id===(slot==='vest'?chestContainer()?.id:byId(state.slots.backpack)?.id)){notice('A container cannot be placed inside itself.');return}if(!canPlace(i,x,y,slot)){notice('Item does not fit in that space.');return}if(i.location==='slot'){stowContainerContents(i);delete state.slots[i.slot]}i.location=storageLocation(slot);delete i.slot;i.x=x;i.y=y;save();render();notice('Moved '+i.name+' into '+slot)}
function stowContainerContents(i){if(!i||!hasStorage(i)||i.location!=='slot')return;const slot=i.slot==='armor'?'vest':i.slot;if(!['vest','backpack'].includes(slot))return;for(const child of state.items.filter(x=>x.location===storageLocation(slot))){child.location='contained';child.containerId=i.id}}
function restoreContainerContents(i,slot){if(!i||!hasStorage(i))return;const into=slot==='armor'?'vest':slot;if(!['vest','backpack'].includes(into))return;for(const child of state.items.filter(x=>x.location==='contained'&&x.containerId===i.id)){child.location=storageLocation(into);child.containerId=i.id}}
function unequipToLoose(i){if(i.location==='slot'){stowContainerContents(i);delete state.slots[i.slot]}i.location='loose';delete i.slot;delete i.x;delete i.y}
function slotClick(slot){if(selected){const i=byId(selected);if(!i)return;if(!canEquip(i,slot)){notice('Cannot equip here. A storage armor rig and chest rig cannot be worn together, and occupied storage must be emptied first.');return}if((slot==='vest'||slot==='backpack'||slot==='armor')&&i.location==='slot'&&i.slot!==slot){notice('Invalid container slot.');return}const occupied=byId(state.slots[slot]);if(occupied&&occupied.id!==i.id){if((slot==='vest'||slot==='backpack'||(slot==='armor'&&hasStorage(occupied)))&&state.items.some(o=>o.location===storageLocation(slot==='armor'?'vest':slot))){notice('Empty the '+slot+' before replacing it.');return}unequipToLoose(occupied)}if(i.location==='slot'&&(i.slot==='vest'||i.slot==='backpack'||(i.slot==='armor'&&hasStorage(i)))&&state.items.some(o=>o.location===storageLocation(i.slot==='armor'?'vest':i.slot))){notice('Empty this container before moving it.');return}if(i.location==='slot')delete state.slots[i.slot];i.location='slot';i.slot=slot;state.slots[slot]=i.id;restoreContainerContents(i,slot);save();render();notice('Equipped '+i.name)}else if(state.slots[slot]){selected=state.slots[slot];render();notice('Selected '+byId(selected).name)}}
function rotate(){const i=byId(selected);if(!i){notice('Select an item first.');return}if(i.location==='slot'){notice('Unequip item before rotating.');return}i.rotated=!i.rotated;const slot=containerFor(i);if(slot&&!canPlace(i,i.x,i.y,slot)){i.rotated=!i.rotated;notice('Not enough space to rotate here.');return}save();render()}
function removeSelected(){const i=byId(selected);if(!i)return;if(hasStorage(i)&&i.location==='slot'&&state.items.some(o=>o.location===storageLocation(i.slot==='armor'?'vest':i.slot))){notice('Empty this container before removing it.');return}
 if(i.category==='Weapon'&&(i.opticId||i.suppressorId||i.kitId))return notice('Remove weapon attachments and upgrade kit before deleting the weapon.');
 if(i.location==='installed')return notice('Remove this item from its host before deleting.');
 if(state.items.some(x=>x.containerId===i.id))return notice('Empty this container before deleting it.');if(!confirm('Remove '+i.name+' from this character?'))return;if(i.location==='slot')delete state.slots[i.slot];if(i.category==='Weapon'){
  const mag=weaponMagazine(i);
  if(mag&&!mag.integralMagazine){delete i.magazineId;storeEjected(mag)}
 }
 state.items=state.items.filter(x=>x.id!==selected&&!(x.integralMagazine&&x.weaponId===selected));selected=null;save();render();log('Removed '+i.name)}
let draggingId=null;
// Pointer-driven dragging keeps keyboard input active; native HTML dragging suppresses keydown in browsers.
let carry=null;
function carryPreview(){
 if(!carry?.active)return;
 const item=byId(carry.id);if(!item)return;
 const d=dimensions(item),g=carry.ghost;
 g.style.width=(d.w*44)+'px';g.style.height=(d.h*44)+'px';
 const sprite=visibleImage(item)||'';
 if(g.dataset.imageKey!==String(sprite)+'|'+String(item.rotated)){
  g.replaceChildren();g.dataset.imageKey=String(sprite)+'|'+String(item.rotated);
  if(sprite){const img=document.createElement('img');img.src=imageSrc(sprite);img.alt='';img.className='carry-item-image';img.classList.toggle('rotated',!!item.rotated);g.append(img)}
  else {const placeholder=document.createElement('div');placeholder.className='carry-empty-image';g.append(placeholder)}
 }
 updateCarry(carry.x,carry.y);
}
function updateCarryBase(x,y){
 if(!carry?.active)return;
 carry.x=x;carry.y=y;
 carry.ghost.style.left=(x+16)+'px';carry.ghost.style.top=(y+16)+'px';
 document.querySelectorAll('.storage-grid').forEach(clearPlacementPreview);
 document.querySelectorAll('.slot.drop-valid,.slot.drop-invalid,.loose-items.drop-valid,.loose-items.drop-invalid').forEach(el=>el.classList.remove('drop-valid','drop-invalid'));
 const hit=document.elementFromPoint(x,y);const item=byId(carry.id);if(!hit||!item)return;
 const grid=hit.closest('.storage-grid');
 if(grid){
  const rect=grid.getBoundingClientRect(),css=getComputedStyle(grid),gap=parseFloat(css.columnGap)||0,cell=parseFloat(css.getPropertyValue('--cell'))||64;
  const gx=Math.floor((x-rect.left)/(cell+gap)),gy=Math.floor((y-rect.top)/(cell+gap));
  carry.target={type:'grid',slot:grid.dataset.storageSlot,x:gx,y:gy};
  previewPlacement(grid,item,gx,gy,grid.dataset.storageSlot);
  carry.valid=canPlace(item,gx,gy,grid.dataset.storageSlot);
 }else{
  const box=hit.closest('[data-equip-slot]');const loot=hit.closest('#looseItems');
  if(box){carry.target={type:'equip',slot:box.dataset.equipSlot};carry.valid=canEquip(item,box.dataset.equipSlot);box.classList.add(carry.valid?'drop-valid':'drop-invalid')}
  else if(loot){carry.target={type:'loot'};carry.valid=canReturnToLoot(item);loot.classList.add(carry.valid?'drop-valid':'drop-invalid')}
  else{carry.target=null;carry.valid=false}
 }
 carry.ghost.classList.toggle('invalid',!carry.valid);
}
let suppressLootClick=false;
function finishCarryBase(){
 if(!carry)return;
 const c=carry;carry=null;draggingId=null;
 c.ghost?.remove();document.querySelectorAll('.storage-grid').forEach(clearPlacementPreview);
 document.querySelectorAll('.drop-valid,.drop-invalid').forEach(el=>el.classList.remove('drop-valid','drop-invalid'));
 if(!c.active)return;
 suppressLootClick=true;setTimeout(()=>{suppressLootClick=false},0);
 if(!c.valid){notice('Item cannot be placed there.');render();return}
 if(window.STALKER_EXT?.finishGroupDrag?.(c))return;
 selected=c.id;
 if(c.target?.type==='grid')moveGrid(c.id,c.target.x,c.target.y,c.target.slot);
 else if(c.target?.type==='equip')slotClick(c.target.slot);
 else if(c.target?.type==='loot'){const i=byId(c.id);unequipToLoose(i);save();render();notice('Moved '+i.name+' to Loot')}
}
window.addEventListener('keydown',e=>{
 if(e.key.toLowerCase()!=='r'||e.repeat||e.ctrlKey||e.altKey||e.metaKey)return;
 if(!carry?.active)return;
 const item=byId(carry.id);if(!item)return;
 e.preventDefault();item.rotated=!item.rotated;carryPreview();
},true);
window.addEventListener('pointermove',e=>{
 if(!carry||e.pointerId!==carry.pointerId)return;
 if(!carry.active){if(Math.hypot(e.clientX-carry.startX,e.clientY-carry.startY)<5)return;
  carry.active=true;draggingId=carry.id;selected=carry.id;
  const ghost=document.createElement('div');ghost.className='carry-ghost';document.body.append(ghost);carry.ghost=ghost;
 }
 updateCarry(e.clientX,e.clientY);carryPreview();
},true);
window.addEventListener('pointerup',e=>{if(carry&&e.pointerId===carry.pointerId)finishCarry()},true);
window.addEventListener('pointercancel',()=>{if(carry){carry.ghost?.remove();carry=null;draggingId=null;render()}},true);
function makeDraggableBase(el,item){
 el.draggable=false;el.dataset.itemId=item.id;el.addEventListener('contextmenu',e=>openItemContext(e,item.id));
 el.addEventListener('pointerdown',e=>{
  if(e.button!==0||carry||e.shiftKey||e.target.closest('input,select,textarea')|| (e.target.closest('button')&&!e.target.closest('.loose-item')))return;
  carry={id:item.id,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,active:false,valid:false,target:null,ghost:null};
  e.preventDefault();
 });
}
function dragged(e){return byId(draggingId||e?.dataTransfer?.getData('text/plain'))}
function allowDrop(el,accept,perform){
  el.addEventListener('dragover',e=>{const i=dragged(e);if(!i)return;e.preventDefault();const valid=accept(i);e.dataTransfer.dropEffect=valid?'move':'none';el.classList.toggle('drop-valid',valid);el.classList.toggle('drop-invalid',!valid)});
  el.addEventListener('dragleave',e=>{if(!el.contains(e.relatedTarget))el.classList.remove('drop-valid','drop-invalid')});
  el.addEventListener('drop',e=>{e.preventDefault();e.stopPropagation();el.classList.remove('drop-valid','drop-invalid');const i=dragged(e);if(!i)return;if(!accept(i)){notice('Item does not fit or is not allowed here.');return}selected=i.id;perform(i)});
}
function isPistol(i){
  if(!i||i.category!=='Weapon')return false;
  const g=i.gurps||{};
  const description=[i.name,i.description,i.weaponType,i.subtype,g.skill,g.weaponType,g.type,g.notes].filter(Boolean).join(' ').toLowerCase();
  return /\b(pistol|handgun|revolver|sidearm)\b/.test(description)||/\b(glock|makarov|tokarev|beretta|m1911|1911|p226|p320|usp|cz-75|five-seven|fnx-45|desert eagle|mp-443|pl-15|aps|apb)\b/.test(description)||/\b(pm|tt-33|g17|g19|g45)\b/.test(description);
}
function slotAccepts(i,slot){
  const allowed=SLOT_TYPES[slot];
  if(allowed&&!allowed.includes(i.category))return false;
  if(slot.startsWith('pocket')){const d=dimensions(i);return d.w===1&&d.h===1;}
  if(slot==='primary1'||slot==='primary2')return i.category==='Weapon'&&!isPistol(i);
  if(slot==='secondary')return i.category==='Weapon'&&isPistol(i);
  return true;
}
function canEquip(i,slot){
  if(!slotAccepts(i,slot))return false;
  if(slot==='vest'&&hasStorage(byId(state.slots.armor)))return false;
  if(slot==='armor'&&hasStorage(i)&&byId(state.slots.vest))return false;
  if(i.location==='slot'&&i.slot==='armor'&&hasStorage(i)&&state.items.some(o=>o.location==='vestGrid')&&slot!=='armor')return false;
  if(slot==='armor'&&hasStorage(byId(state.slots.armor))&&state.items.some(o=>o.location==='vestGrid')&&state.slots.armor!==i.id)return false;
  const occupied=byId(state.slots[slot]);
  if(occupied&&occupied.id!==i.id&&(slot==='vest'||slot==='backpack'||(slot==='armor'&&hasStorage(occupied)))&&state.items.some(o=>o.location===storageLocation(slot==='armor'?'vest':slot)))return false;
  if(i.location==='slot'&&(i.slot==='vest'||i.slot==='backpack'||(i.slot==='armor'&&hasStorage(i)))&&i.slot!==slot&&state.items.some(o=>o.location===storageLocation(i.slot==='armor'?'vest':i.slot)))return false;
  return true;
}
function canReturnToLoot(i){return !!i&&i.location!=='loaded'&&i.location!=='installed'}
function setupDragTargets(){
  const loot=document.getElementById('looseItems');
  allowDrop(loot,canReturnToLoot,i=>{unequipToLoose(i);save();render();notice('Moved '+i.name+' to Loot')});
  document.querySelectorAll('[data-page]').forEach(btn=>{
    btn.addEventListener('dragover',e=>{if(!dragged(e))return;e.preventDefault();btn.classList.add('drop-tab');e.dataTransfer.dropEffect='move';});
    btn.addEventListener('dragleave',()=>btn.classList.remove('drop-tab'));
    btn.addEventListener('drop',e=>{const i=dragged(e);if(!i)return;e.preventDefault();btn.classList.remove('drop-tab');if(btn.dataset.page==='character'){if(canReturnToLoot(i)){unequipToLoose(i);save();render();notice('Moved '+i.name+' to Loot')}else notice('Empty this container before unequipping.')}showPage(btn.dataset.page)});
    let hover=null;
    btn.addEventListener('dragenter',e=>{if(!dragged(e))return;clearTimeout(hover);hover=setTimeout(()=>{if(draggingId)showPage(btn.dataset.page)},650)});
    btn.addEventListener('dragleave',()=>clearTimeout(hover));
    btn.addEventListener('drop',()=>clearTimeout(hover));
  });
}
function renderSlots(){const groups=[['gear',['helmet','mask','vest','armor','backpack']],['pockets',['pocket1','pocket2','pocket3','pocket4']],['hands',['hands']],['weapons',['primary1','primary2','secondary']]];for(const [root,slots] of groups){const el=document.getElementById(root);el.replaceChildren();for(const s of slots){const wrapper=document.createElement('div');if(root==='gear'||root==='weapons')wrapper.className='panel';if(root==='gear'||root==='weapons'){const h=document.createElement('h2');h.textContent=({primary1:'BACK SLOT 1',primary2:'BACK SLOT 2',secondary:'PISTOL'}[s]||(s==='vest'?'CHEST':s.toUpperCase()).replace(/(\d)/,' $1'));wrapper.append(h)}const box=document.createElement('div');box.className='slot';box.dataset.equipSlot=s;const item=byId(state.slots[s]);if(item)box.dataset.itemId=item.id;if(item&&visibleImage(item)){const img=document.createElement('img');img.className='item-art';img.src=imageSrc(visibleImage(item));img.alt='';box.append(img)}const span=document.createElement('span');span.textContent=item?item.name+(itemQuantity(item)>1?' ×'+itemQuantity(item):''):'+';if(!item)span.className='empty';box.append(span);if(item&&(item.id===selected||window.STALKER_EXT?.isSelected?.(item.id)))box.style.outline='2px solid #85c7ff';if(item)makeDraggable(box,item);allowDrop(box,i=>canEquip(i,s),i=>slotClick(s));box.onclick=()=>slotClick(s);box.title=item?`${item.category} | ${item.weight} kg${isConsumable(item)?` | ${item.uses} uses`:''}`:'Equip item';wrapper.append(box);el.append(wrapper)}}}
function clearPlacementPreview(grid){grid.querySelectorAll('.cell.preview-valid,.cell.preview-invalid').forEach(c=>c.classList.remove('preview-valid','preview-invalid'))}
function previewPlacement(grid,item,x,y,slot){
  clearPlacementPreview(grid);
  const d=dimensions(item);
  const valid=canPlace(item,x,y,slot);
  for(let yy=y;yy<y+d.h;yy++)for(let xx=x;xx<x+d.w;xx++){
    const cell=grid.querySelector(`.cell[data-x="${xx}"][data-y="${yy}"]`);
    if(cell)cell.classList.add(valid?'preview-valid':'preview-invalid');
  }
}
function renderStorage(slot){const root=document.getElementById(slot==='vest'?'vestStorage':'backpackStorage');root.replaceChildren();const equipped=slot==='vest'?chestContainer():byId(state.slots[slot]);if(!equipped){const msg=document.createElement('p');msg.className='hint';msg.textContent=slot==='vest'?'Equip a chest rig or a storage armor rig to show its grid.':'Equip a backpack to show its storage grid.';root.append(msg);return}const dims=storageDims(slot);const info=document.createElement('p');info.className='hint';info.textContent=`${equipped.name} — ${dims.w} × ${dims.h} cells · ${compartmentsFor(slot).length} compartment(s)`;root.append(info);const grid=document.createElement('div');grid.className='grid storage-grid';grid.dataset.storageSlot=slot;grid.style.gridTemplateColumns=`repeat(${dims.w}, var(--cell))`;grid.style.gridTemplateRows=`repeat(${dims.h}, var(--cell))`;for(let y=0;y<dims.h;y++)for(let x=0;x<dims.w;x++){const cell=document.createElement('div');cell.className='cell';cell.dataset.x=String(x);cell.dataset.y=String(y);const comp=compartmentsFor(slot).find(c=>x>=c.x&&y>=c.y&&x<c.x+c.w&&y<c.y+c.h);if(!comp){cell.classList.add('blocked');cell.title='Unavailable storage cell'}else{cell.dataset.compartment=String(compartmentsFor(slot).indexOf(comp));cell.title='Compartment '+(Number(cell.dataset.compartment)+1)}cell.style.gridColumn=String(x+1);cell.style.gridRow=String(y+1);allowDrop(cell,i=>!!comp&&canPlace(i,x,y,slot),i=>moveGrid(i.id,x,y,slot));cell.onclick=()=>{if(!comp){notice('This cell is not part of a storage compartment.');return}if(selected)moveGrid(selected,x,y,slot);else notice('Select a loose item or an item from another container.')};grid.append(cell)}for(const i of state.items.filter(i=>i.location===storageLocation(slot))){const d=dimensions(i),el=document.createElement('div');el.className='placed';el.dataset.itemId=i.id;el.dataset.quantity=itemQuantity(i)>1?'×'+itemQuantity(i):'';el.style.gridColumn=`${i.x+1}/span ${d.w}`;el.style.gridRow=`${i.y+1}/span ${d.h}`;if(selected===i.id||window.STALKER_EXT?.isSelected?.(i.id))el.style.outline='2px solid #85c7ff';if(visibleImage(i)){const img=document.createElement('img');img.className='item-art item-art-grid'+(i.rotated?' ext-art-rotated':'');img.src=imageSrc(visibleImage(i));img.alt='';el.append(img)}const name=document.createElement('span');name.textContent=i.name;el.append(name);el.title=`${i.name} — ${d.w}×${d.h} — ${i.weight} kg`;makeDraggable(el,i);allowDrop(el,other=>other.id!==i.id&&canPlace(other,i.x,i.y,slot),other=>moveGrid(other.id,i.x,i.y,slot));el.onclick=()=>{selected=i.id;render();notice('Selected '+i.name)};grid.append(el)}// Resolve the hovered square from the pointer rather than the event target.
// A placed item can cover cells and otherwise intercept their drop handlers.
function dropCellAt(e){
  const rect=grid.getBoundingClientRect();
  const styles=getComputedStyle(grid);
  const gap=parseFloat(styles.columnGap)||0;
  const cellSize=parseFloat(styles.getPropertyValue('--cell'))||64;
  const x=Math.floor((e.clientX-rect.left)/(cellSize+gap));
  const y=Math.floor((e.clientY-rect.top)/(cellSize+gap));
  if(x<0||y<0||x>=dims.w||y>=dims.h)return null;
  return {x,y};
}
grid.addEventListener('dragover',e=>{
  const item=dragged(e);if(!item)return;
  e.preventDefault();
  const pos=dropCellAt(e);
  if(!pos){clearPlacementPreview(grid);e.dataTransfer.dropEffect='none';return;}
  const valid=canPlace(item,pos.x,pos.y,slot);
  e.dataTransfer.dropEffect=valid?'move':'none';
  previewPlacement(grid,item,pos.x,pos.y,slot);
},true);
grid.addEventListener('dragleave',e=>{if(!grid.contains(e.relatedTarget))clearPlacementPreview(grid)});
grid.addEventListener('drop',e=>{
  const item=dragged(e);
  if(!item)return;
  e.preventDefault();e.stopPropagation();
  const pos=dropCellAt(e);
  clearPlacementPreview(grid);
  if(!pos||!canPlace(item,pos.x,pos.y,slot)){
    notice('Item does not fit in that backpack or compartment space.');return;
  }
  selected=item.id;
  moveGrid(item.id,pos.x,pos.y,slot);
},true);
const viewport=document.createElement('div');viewport.className='storage-viewport';viewport.append(grid);root.append(viewport)}
function renderLoose(){const root=document.getElementById('looseItems');root.replaceChildren();for(const i of state.items.filter(i=>i.location==='loose'||i.location==='grid')){const b=document.createElement('button');b.className='loose-item';b.dataset.itemId=i.id;if(i.id===selected||window.STALKER_EXT?.isSelected?.(i.id))b.style.outline='2px solid #85c7ff';if(visibleImage(i)){const img=document.createElement('img');img.src=imageSrc(visibleImage(i));img.alt='';b.append(img)}const span=document.createElement('span');span.textContent=`${i.name}${itemQuantity(i)>1?' ×'+itemQuantity(i):''} (${i.w}×${i.h})`;b.append(span);makeDraggable(b,i);b.onclick=()=>{if(suppressLootClick){suppressLootClick=false;return}selected=i.id;render();notice('Selected '+i.name)};root.append(b)}if(!root.children.length)root.textContent='No spawned loot. Go to Item Catalogue and click Spawn.'}
function labeledInput(parent,key,obj,type='text'){const row=document.createElement('label');row.className='row';const label=document.createElement('span');label.textContent=key+':';const input=document.createElement('input');input.type=type;input.value=obj[key]??'';if(type==='number')input.step='any';input.onchange=()=>{obj[key]=type==='number'?(Number(input.value)||0):input.value;save();renderWeight()};row.append(label,input);parent.append(row)}
function renderCharacter(){const identity=document.getElementById('identity'),stats=document.getElementById('stats'),conditions=document.getElementById('conditions');identity.replaceChildren();stats.replaceChildren();conditions.replaceChildren();for(const k of Object.keys(state.identity))labeledInput(identity,k,state.identity);for(const k of Object.keys(state.stats)){const label=document.createElement('label');label.className='stat';label.textContent=k;const inp=document.createElement('input');inp.type='number';inp.step=k==='Basic Speed'?'0.25':'1';inp.value=state.stats[k];inp.onchange=()=>{state.stats[k]=Number(inp.value)||0;save()};label.append(inp);stats.append(label)}for(const k of Object.keys(state.conditions))labeledInput(conditions,k,state.conditions,'number');renderWeight()}

function gcsArray(v){return Array.isArray(v)?v:[]}
function gcsFlatten(arr,out=[],depth=0){if(depth>12)return out;for(const item of gcsArray(arr)){if(!item||typeof item!=='object')continue;out.push(item);for(const key of ['children','items','features'])if(Array.isArray(item[key]))gcsFlatten(item[key],out,depth+1)}return out}
function gcsDisplayValue(v){if(v==null)return '';if(typeof v==='object')return JSON.stringify(v);return String(v)}
function gcsSection(title,entries,fmt){const root=document.getElementById('gcsDetails');const d=document.createElement('details');d.open=title==='Skills';const h=document.createElement('summary');h.textContent=title+' ('+entries.length+')';d.append(h);for(const x of entries){const row=document.createElement('div');row.className='gcs-entry';row.textContent=fmt(x);d.append(row)}root.append(d)}
function renderGcs(){const root=document.getElementById('gcsDetails');root.replaceChildren();const g=state.gcs;if(!g){root.textContent='Import a .gcs character file to populate these sections.';document.getElementById('gcsStatus').textContent='No GCS file imported';return}document.getElementById('gcsStatus').textContent=g.file||'GCS character loaded';const d=g.data;const attributes=d.attributes||{};gcsSection('Attributes',Object.entries(attributes),([k,v])=>k+': '+gcsDisplayValue(v));for(const [title,key] of [['Skills','skills'],['Spells','spells'],['Traits / Advantages / Disadvantages','traits'],['Equipment','equipment'],['Other Equipment','other_equipment'],['Notes','notes']]){const entries=gcsFlatten(d[key]);if(entries.length)gcsSection(title,entries,x=>[x.name||x.description||x.id||'Entry',x.level!=null?'Level '+x.level:'',x.points!=null?'['+x.points+' points]':'',x.quantity!=null?'Qty '+x.quantity:'',x.notes||''].filter(Boolean).join(' · '))}if(d.profile){gcsSection('Profile',Object.entries(d.profile),([k,v])=>k+': '+gcsDisplayValue(v))}}
function parseGcsStatsBase(data){const a=data.attributes||{};const read=(key)=>{const v=a[key]??a[key.toLowerCase()];if(v==null)return null;if(typeof v==='number')return v;if(typeof v==='object')return Number(v.value??v.current??v.base??v.maximum??NaN);return Number(v)};for(const key of ['ST','DX','IQ','HT','HP','FP']){const n=read(key);if(Number.isFinite(n))state.stats[key]=n}for(const [name,keys] of [['Basic Speed',['basic_speed','Basic Speed','speed']],['Dodge',['dodge','Dodge']]]){for(const key of keys){const n=read(key);if(Number.isFinite(n)){state.stats[name]=n;break}}}const profile=data.profile||{};const n=data.name||profile.name;if(typeof n==='string'&&n.trim())state.identity.Name=n;}
async function importGcsBase(file){const text=await file.text();let data;try{data=JSON.parse(text)}catch(e){throw Error('The selected file is not JSON-formatted .gcs. Export your character from a recent GCS version as JSON.')};if(!data||typeof data!=='object'||Array.isArray(data))throw Error('Invalid GCS character file');if(!data.attributes&&!data.skills&&!data.traits&&!data.profile)throw Error('This JSON does not appear to contain GCS character data');state.gcs={file:file.name,data};parseGcsStats(data);state.conditions.Health=Number(state.stats.HP)||10;state.conditions.Fatigue=Number(state.stats.FP)||10;save();renderCharacter();renderGcs();notice('Imported '+file.name+'. Review attributes and skills; derived values depend on GCS version.');}
function renderWeightBase(){const weight=state.items.reduce((sum,i)=>sum+(Number(i.weight)||0)*itemQuantity(i),0);const max=Number(state.stats.ST||0)**2/5*0.45359237;document.getElementById('weight').textContent=`${weight.toFixed(2)} kg carried | Basic Lift: ${max.toFixed(2)} kg (ST ${state.stats.ST})`;}
function imageSrc(value){if(!value)return '';const v=String(value).trim();if(v.startsWith('data:image/'))return v;const name=v.replace(/\\/g,'/').split('/').pop();return 'images/'+encodeURIComponent(name)}
function renderCatalog(){
 const root=document.getElementById('catalog');
 const opened=new Set([...root.querySelectorAll('details[open]')].map(el=>el.dataset.group));
 const firstRender=!root.dataset.initialized;
 root.replaceChildren();
 const categories=[...new Set([...Array.from(document.querySelector('#itemForm [name="category"]').options,o=>o.value),...state.catalog.map(t=>t.category)])];
 for(const category of categories){
  const matching=state.catalog.filter(t=>t.category===category);
  const group=document.createElement('details');group.className='catalog-group';group.dataset.group='category:'+category;
  group.open=firstRender?matching.length>0:opened.has(group.dataset.group);
  const summary=document.createElement('summary');summary.textContent=`${category} (${matching.length})`;group.append(summary);
  const items=matching.slice().sort((a,b)=>normalizeTier(a.tier)-normalizeTier(b.tier)||a.name.localeCompare(b.name));
  const body=document.createElement('div');body.className='catalog-tier-body';
  if(!items.length){const empty=document.createElement('div');empty.className='catalog-empty';empty.textContent='No items in this category.';body.append(empty)}
   for(const t of items){
    const row=document.createElement('div');row.className='catalog-row'+(selectedTemplate===t.id?' selected':'');
    row.onclick=()=>{selectedTemplate=t.id;renderCatalog()};
    const img=document.createElement('img');img.className='catalog-thumb';img.alt='';if(t.image)img.src=imageSrc(t.image);
    const details=document.createElement('div');details.className='catalog-details';
    const title=document.createElement('strong');title.textContent=t.name;
    const desc=document.createElement('span');desc.textContent=`Tier ${normalizeTier(t.tier)} · ${t.w}×${t.h} · ${t.weight} kg · ${t.value} ₽ · stack ${stackLimit(t)}${isConsumable(t)?' · '+t.uses+' uses':''}${['Vest','Armor','Backpack'].includes(t.category)?' · storage '+(t.storageW||4)+'×'+(t.storageH||2):''}${t.gurps?.damage?' · '+t.gurps.damage:''}${t.category==='Medical'&&t.hpHeal?' · heals '+t.hpHeal+' HP/use':''}${t.dr?' · DR '+t.dr:''}`;
    details.append(title,desc);
    const actions=document.createElement('div');actions.className='catalog-actions';
    const amount=document.createElement('input');amount.type='number';amount.min='1';amount.max=String(isBulkSpawnItem(t)?10000:10);amount.step='1';amount.value='1';amount.className='spawn-quantity';amount.dataset.spawnQuantity=t.id;amount.title='Quantity to spawn (maximum '+amount.max+')';amount.setAttribute('aria-label','Spawn quantity for '+t.name);amount.onclick=e=>e.stopPropagation();amount.onkeydown=e=>e.stopPropagation();
    const add=document.createElement('button');add.textContent='Spawn';add.onclick=e=>{e.stopPropagation();selectedTemplate=t.id;addItem(t.id)};
    actions.append(amount,add);row.append(img,details,actions);body.append(row);
   }
  group.append(body);
  root.append(group);
 }
 root.dataset.initialized='true';
}
let selectedImageData=null;function openItemEditorBase(id=null){selectedImageData=null;const form=document.getElementById('itemForm');form.reset();editingTemplate=id;const t=id?template(id):null;document.querySelector('#itemDialog h2').textContent=t?'EDIT ITEM':'CREATE ITEM';if(t){form.elements.namedItem('armorStorage').checked=t.category==='Armor'&&hasStorage(t);if(form.elements.namedItem('hpHeal'))form.elements.namedItem('hpHeal').value=t.hpHeal??0;if(form.elements.namedItem('stackSize'))form.elements.namedItem('stackSize').value=stackLimit(t);if(form.elements.namedItem('magFamilies'))form.elements.namedItem('magFamilies').value=(t.magFamilies||[]).join(', ');if(form.elements.namedItem('magFamily'))form.elements.namedItem('magFamily').value=t.magFamily||'';if(form.elements.namedItem('integralFeed'))form.elements.namedItem('integralFeed').checked=!!t.integralFeed;for(const [k,v] of Object.entries(t.gurps||{})){const f=form.elements.namedItem(k);if(f)f.value=v??''}form.elements.namedItem('compartments').value=(t.compartments||[]).map(c=>[c.x,c.y,c.w,c.h].join(',')).join('\n');for(const [k,v] of Object.entries(t)){const field=form.elements.namedItem(k);if(field&&typeof v!=='object')field.value=v??''}}else{form.elements.namedItem('image').value=''}updateStorageEditor();updateImagePreview();document.getElementById('itemDialog').showModal()}
function updateStorageEditor(){const form=document.getElementById('itemForm');const cat=form.elements.namedItem('category').value;const isContainer=['Vest','Backpack'].includes(cat)||(cat==='Armor'&&form.elements.namedItem('armorStorage').checked);document.querySelectorAll('.storage-field').forEach(el=>el.style.display=isContainer?'':'none');document.getElementById('storageLockNote').style.display=isContainer?'':'none';document.querySelectorAll('.armor-storage-field').forEach(el=>el.style.display=cat==='Armor'?'':'none');for(const k of ['storageW','storageH','compartments'])form.elements.namedItem(k).disabled=!!editingTemplate;form.elements.namedItem('armorStorage').disabled=!!editingTemplate;updateItemBehavior();}
function updateImagePreview(){const input=document.getElementById('itemForm').elements.namedItem('image');const preview=document.getElementById('imagePreview');preview.src=selectedImageData||(input.value.trim()?imageSrc(input.value.trim()):'')}
function deleteTemplate(){const t=template(selectedTemplate);if(!t){notice('Select a catalog item first.');return}const copies=state.items.filter(i=>i.templateId===t.id).length;if(!confirm(`Delete catalog template "${t.name}"? ${copies} existing inventory copies will remain.`))return;state.catalog=state.catalog.filter(i=>i.id!==t.id);selectedTemplate=null;save();render();notice('Deleted catalog template: '+t.name)}
function renderLog(){document.getElementById('log').textContent=state.log.join('\n')||'No actions yet.'}
function renderBase(){renderSelectedItem();renderStatus();renderSlots();renderStorage('vest');renderStorage('backpack');renderLoose();renderWeight();renderCatalog();renderLog();renderGcs()}
function showInfo(title,html){document.getElementById('infoTitle').textContent=title;document.getElementById('infoContent').textContent=html;document.getElementById('infoDialog').showModal()}
function actionBase(a){const i=byId(selected);if(a==='attack'){
const cfg=state.actionConfig||{};const skill=Number(cfg.attackSkill??12),mod=Number(cfg.attackModifier??0);
const dice=Array.from({length:3},()=>1+Math.floor(Math.random()*6));const total=dice.reduce((x,y)=>x+y,0);const target=skill+mod;
const criticalSuccess=total<=4||(total===5&&target>=15)||(total===6&&target>=16);
const criticalFailure=total===18||(total===17&&target<=15)||(total>=target+10);
const result=criticalSuccess?'CRITICAL SUCCESS':criticalFailure?'CRITICAL FAILURE':total<=target?'SUCCESS':'FAILURE';
log('Attack roll: '+dice.join('+')+' = '+total+' vs '+target+' ('+result+')');
showInfo('ATTACK ROLL',`3d6: ${dice.join(' + ')} = ${total}\nTarget: ${skill} + (${mod}) = ${target}\nResult: ${result}\n\nDamage, range, defenses and ammunition are handled separately.`);return}
if(a==='reload'){
if(!i||i.category!=='Weapon'){notice('Select a weapon to reload.');return}
const cap=Number(i.gurps?.capacity)||parseInt(String(i.gurps?.shots||''),10);
if(!Number.isFinite(cap)||cap<=0){notice('Set a valid magazine capacity in the weapon item statistics first.');return}
const current=Number.isFinite(Number(i.loadedRounds))&&i.loadedRounds!==undefined?Number(i.loadedRounds):0;
const answer=prompt(`Reload ${i.name} (capacity ${cap}). Enter loaded rounds after reloading:`,String(Math.min(cap,current)));
if(answer===null)return;const n=Number(answer);if(!Number.isInteger(n)||n<0||n>cap){notice('Enter a whole number between 0 and '+cap+'.');return}
i.loadedRounds=n;save();render();log('Reloaded '+i.name+': '+n+'/'+cap+' rounds (manual ammo tracking).');return}
if(a==='damage'){rollSelectedDamage();return}if(a==='use'){if(!i){notice('Select an item first.');return}if(!isConsumable(i)){notice(i.name+' is not a consumable item.');return}if(i.uses<=0){notice(i.name+' has no consumable uses available.');return}i.uses--;const healing=i.category==='Medical'?Math.max(0,Number(i.hpHeal)||0):0;const before=Number(state.conditions.Health)||0;const maxHP=Number(state.stats.HP)||10;if(healing)state.conditions.Health=Math.min(maxHP,before+healing);save();render();log('Used '+i.name+' ('+i.uses+' uses left)'+(healing?' — healed '+(state.conditions.Health-before)+' HP.':' — apply other effects manually.'));return}if(a==='rest'){const cfg=state.actionConfig||{};const fp=Math.max(0,Number(cfg.restFP??1));const hp=Math.max(0,Number(cfg.restHP??0));const maxFP=Number(state.stats.FP)||10,maxHP=Number(state.stats.HP)||10;state.conditions.Fatigue=Math.min(maxFP,Number(state.conditions.Fatigue||0)+fp);state.conditions.Health=Math.min(maxHP,Number(state.conditions.Health||0)+hp);save();render();log('Rest: restored up to '+fp+' FP and '+hp+' HP (campaign-configured).');return}if(a==='sheet'){showPage('sheet');return}if(a==='legacySheet'){showInfo('CHARACTER SHEET',JSON.stringify({character:state.identity,stats:state.stats,conditions:state.conditions,gcs:state.gcs?.data||null,equipped:Object.fromEntries(Object.entries(state.slots).map(([k,v])=>[k,byId(v)?.name||'']))},null,2));return}if(a==='stats'){showPage('status');return}if(a==='legacyStats'){showInfo('STATS',JSON.stringify({stats:state.stats,conditions:state.conditions,items:state.items.length,weightKg:state.items.reduce((s,i)=>s+i.weight,0)},null,2))}}

const POSTURE_HELP={
'Standing':'Normal upright posture. Apply ordinary GURPS combat modifiers.',
'Crouching':'Crouched posture. Check GURPS posture modifiers for attacks and defenses.',
'Kneeling':'Kneeling posture. Check GURPS posture modifiers for attacks and defenses.',
'Sitting':'Seated posture. Check GURPS posture modifiers for attacks and defenses.',
'Prone':'Prone posture. Check GURPS posture modifiers for attacks and defenses.',
'Crawling':'Moving low to the ground. Apply the relevant GURPS movement and posture rules.',
'Lying down':'Lying down. Check GURPS posture and movement rules.'};
const STATUS_FLAGS=['Stunned','Unconscious','Poisoned','Infected','Crippled limb','On fire','Encumbered','Other injury'];
function renderStatus(){
 const hp=Number(state.conditions.Health??state.stats.HP),fp=Number(state.conditions.Fatigue??state.stats.FP);
 const maxHP=Number(state.stats.HP)||10,maxFP=Number(state.stats.FP)||10;
 const root=document.getElementById('statusDashboard');root.replaceChildren();
 for(const [label,value,max] of [['HP',hp,maxHP],['FP',fp,maxFP],['Radiation',Number(state.conditions.Radiation)||0,null],['Bleeding',Number(state.conditions.Bleeding)||0,null]]){
  const card=document.createElement('div');card.className='status-meter'+(max!==null&&value<=0?' danger':max!==null&&value<=max/3?' warning':'');
  const strong=document.createElement('strong');strong.textContent=max===null?String(value):value+' / '+max;
  card.append(label,strong);root.append(card)
 }
 const posture=state.posture||'Standing';document.getElementById('postureCurrent').textContent=posture;document.getElementById('postureHelp').textContent=POSTURE_HELP[posture];document.querySelectorAll('[data-posture]').forEach(b=>{const active=b.dataset.posture===posture;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))});
 const flags=document.getElementById('statusFlags');flags.replaceChildren();
 for(const name of STATUS_FLAGS){const label=document.createElement('label');const box=document.createElement('input');box.type='checkbox';box.checked=!!state.statusFlags?.[name];box.onchange=()=>{state.statusFlags[name]=box.checked;save();renderStatus();log((box.checked?'Applied ':'Cleared ')+name)};label.append(box,document.createTextNode(name));flags.append(label)}
 document.getElementById('quickVitalsText').replaceChildren();const v=document.getElementById('quickVitalsText');for(const text of ['HP '+hp+'/'+maxHP,'FP '+fp+'/'+maxFP,state.posture||'Standing']){const span=document.createElement('span');span.className='vital-pill';span.textContent=text;v.append(span)}
}
function renderSelectedItemBase(){const root=document.getElementById('selectedItemDetails');root.replaceChildren();const i=byId(selected);if(!i){root.textContent='Select an equipped item, a storage item, or loose loot to inspect its stats and use its actions.';return}
 const title=document.createElement('div');title.className='item-detail-title';title.textContent=i.name+(itemQuantity(i)>1?' ×'+itemQuantity(i):'');root.append(title);
 const meta=document.createElement('div');meta.className='item-detail-meta';meta.textContent=i.category+' · Tier '+normalizeTier(i.tier)+' · '+i.w+'×'+i.h+' cells · '+i.weight+' kg';root.append(meta);
 const grid=document.createElement('div');grid.className='item-detail-grid';const fields=[];
 if(i.category==='Medical')fields.push(['HP / use',i.hpHeal??0]);if(isConsumable(i))fields.push(['Uses left',i.uses??0]);
 if(i.category==='Weapon'&&i.loadedRounds!==undefined)fields.push(['Loaded rounds',i.loadedRounds]);
 if(i.category==='Weapon'&&i.magFamilies?.length)fields.push(['Magazines',i.magFamilies.join(', ')]);if(i.category==='Magazine'&&i.magFamily)fields.push(['Magazine family',i.magFamily]);const labels={damage:'Damage',acc:'Acc',range:'Range',rof:'RoF',shots:'Shots',minST:'Min ST',bulk:'Bulk',rcl:'Rcl',dr:'DR',caliber:'Caliber',capacity:'Capacity',skill:'Skill'};
 for(const [k,label] of Object.entries(labels))if(i.gurps?.[k]!==undefined&&i.gurps[k]!=='')fields.push([label,i.gurps[k]]);
 for(const [label,val] of fields){const row=document.createElement('div');row.textContent=label+': '+val;grid.append(row)}root.append(grid);
 if(i.description||i.gurps?.gurpsNotes){const p=document.createElement('p');p.className='hint';p.textContent=[i.description,i.gurps?.gurpsNotes].filter(Boolean).join(' — ');root.append(p)}
 const actions=document.createElement('div');actions.className='item-detail-actions';
 if(i.category==='Weapon'){const b=document.createElement('button');b.textContent='Roll damage';b.onclick=()=>action('damage');actions.append(b)}
 if(isConsumable(i)){const b=document.createElement('button');b.textContent='Use item'+(i.category==='Medical'?' / Heal':'');b.onclick=()=>action('use');actions.append(b)}
 root.append(actions)
}
function rollSelectedDamage(){const i=byId(selected);if(!i||i.category!=='Weapon'){notice('Select a weapon first.');return}
 const raw=String(i.gurps?.damage||'').trim();const m=raw.match(/^(\d+)d(?:6)?\s*([+-]\s*\d+)?\s*(.*)$/i);
 if(!m){notice('Set weapon damage in Nd, Nd+N or Nd-N format, e.g. 5d+1 pi.');return}
 const count=Number(m[1]),bonus=Number((m[2]||'0').replace(/\s/g,''));if(count<1||count>50){notice('Damage dice count must be between 1 and 50.');return}
 const rolls=Array.from({length:count},()=>1+Math.floor(Math.random()*6));const total=rolls.reduce((a,b)=>a+b,0)+bonus;
 log(i.name+' damage: '+raw+' → '+total+' '+m[3]+' ('+rolls.join('+')+(bonus?' '+bonus:'')+').');
 showInfo('DAMAGE ROLL — '+i.name,'Damage: '+raw+'\nDice: '+rolls.join(' + ')+(bonus?' '+bonus:'')+'\nRolled: '+total+' '+m[3]+'\n\nApply DR, injury modifiers and hit location at the table. This roll does not automatically change target HP.')
}
function applyVitals(){const hp=Number(document.getElementById('hpDelta').value),fp=Number(document.getElementById('fpDelta').value);if(!Number.isFinite(hp)||!Number.isFinite(fp)){notice('Enter valid HP and FP changes.');return}
 const oldHP=Number(state.conditions.Health)||0,oldFP=Number(state.conditions.Fatigue)||0;
 state.conditions.Health=Math.min(Number(state.stats.HP)||10,oldHP+hp);state.conditions.Fatigue=Math.min(Number(state.stats.FP)||10,oldFP+fp);
 save();renderCharacter();render();log('Vitals adjusted: HP '+(state.conditions.Health-oldHP)+', FP '+(state.conditions.Fatigue-oldFP));
}

function download(name,contents){const blob=new Blob([contents],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
/* Expansion: persistent profiles, recoverable history, concise rule-assisted play. */
const PROFILE_INDEX_KEY='stalker-gurps-profiles-v2';
const PROFILE_DATA_PREFIX='stalker-gurps-profile-data-v2:';
const PROFILE_BACKUP_PREFIX='stalker-gurps-profile-backups-v2:';
let activeProfile='main';
let profileRecords=[{id:'main',name:'Main Character'}];
let undoHistory=[],historyIndex=-1,restoringHistory=false;
let selectedAmmoAction=null;
let lastCombatResult='';
function profileStorageKey(id){return PROFILE_DATA_PREFIX+id}
function profileBackupsKey(id){return PROFILE_BACKUP_PREFIX+id}
function setupProfileIndex(){
 try{const x=JSON.parse(localStorage.getItem(PROFILE_INDEX_KEY)||'null');if(x?.records?.length){profileRecords=x.records;activeProfile=x.active&&x.records.some(p=>p.id===x.active)?x.active:x.records[0].id}}catch(e){}
 if(!localStorage.getItem(PROFILE_INDEX_KEY)){localStorage.setItem(PROFILE_INDEX_KEY,JSON.stringify({records:profileRecords,active:activeProfile}))}
 const fromProfile=localStorage.getItem(profileStorageKey(activeProfile));
 if(fromProfile)localStorage.setItem(KEY,fromProfile);
}
function saveProfileIndex(){localStorage.setItem(PROFILE_INDEX_KEY,JSON.stringify({records:profileRecords,active:activeProfile}))}
function profileSnapshots(force=false){
 try{const k=profileBackupsKey(activeProfile);const records=JSON.parse(localStorage.getItem(k)||'[]');const now=Date.now();const value=JSON.stringify(state);
  if(!force&&records.length&&now-records[0].at<300000)return;
  records.unshift({at:now,data:value});localStorage.setItem(k,JSON.stringify(records.slice(0,6)));return true;
 }catch(e){notice('Backup could not be saved. Export a JSON save for safety.');return false}
}
function startUndoHistory(){undoHistory=[JSON.stringify(state)];historyIndex=0}
function save(){
 if(!state)return;
 state.statusFlags=state.statusFlags||{};state.wounds=state.wounds||[];state.rollLog=state.rollLog||[];state.log=Array.isArray(state.log)?state.log:[];
 const data=JSON.stringify(state);
 if(!restoringHistory){
  if(!undoHistory.length){undoHistory=[data];historyIndex=0}
  else if(undoHistory[historyIndex]!==data){undoHistory=undoHistory.slice(0,historyIndex+1);undoHistory.push(data);if(undoHistory.length>60)undoHistory.shift();historyIndex=undoHistory.length-1}
 }
 saveBase();try{localStorage.setItem(profileStorageKey(activeProfile),data)}catch(e){}
 updateHistoryButtons();
}
function updateHistoryButtons(){const a=document.getElementById('undoMove'),b=document.getElementById('redoMove');if(a)a.disabled=historyIndex<=0;if(b)b.disabled=historyIndex>=undoHistory.length-1}
function changeHistory(delta){const n=historyIndex+delta;if(n<0||n>=undoHistory.length)return;historyIndex=n;restoringHistory=true;try{state=JSON.parse(undoHistory[n]);saveBase();localStorage.setItem(profileStorageKey(activeProfile),JSON.stringify(state));selected=state.items.some(i=>i.id===selected)?selected:null;renderCharacter();render()}finally{restoringHistory=false}updateHistoryButtons();notice(delta<0?'Undid last change.':'Redid change.')}
function selectProfile(id){if(id===activeProfile)return;if(!profileRecords.some(p=>p.id===id))return;
 save();activeProfile=id;saveProfileIndex();const raw=localStorage.getItem(profileStorageKey(id));
 if(raw)localStorage.setItem(KEY,raw);else localStorage.removeItem(KEY);
 load();selected=null;selectedTemplate=null;startUndoHistory();renderCharacter();render();renderProfiles();notice('Switched to '+(profileRecords.find(p=>p.id===id)?.name||id))
}
function createProfile(){const name=prompt('Name for the new character:','New Stalker');if(!name?.trim())return;save();const id=uid();profileRecords.push({id,name:name.trim().slice(0,70)});activeProfile=id;saveProfileIndex();localStorage.removeItem(KEY);load();state.identity.Name=name.trim().slice(0,70);save();startUndoHistory();renderCharacter();render();renderProfiles();notice('New character created.')}
function renameProfile(){const p=profileRecords.find(p=>p.id===activeProfile);if(!p)return;const name=prompt('Rename character:',p.name);if(!name?.trim())return;p.name=name.trim().slice(0,70);saveProfileIndex();renderProfiles();notice('Profile renamed.')}
function deleteProfile(){if(profileRecords.length<=1){notice('Keep at least one character profile.');return}const p=profileRecords.find(p=>p.id===activeProfile);if(!confirm('Delete '+p.name+' and its local saves? This cannot be undone.'))return;localStorage.removeItem(profileStorageKey(activeProfile));localStorage.removeItem(profileBackupsKey(activeProfile));profileRecords=profileRecords.filter(x=>x.id!==activeProfile);activeProfile=profileRecords[0].id;saveProfileIndex();const raw=localStorage.getItem(profileStorageKey(activeProfile));if(raw)localStorage.setItem(KEY,raw);else localStorage.removeItem(KEY);load();selected=null;startUndoHistory();renderCharacter();render();renderProfiles();notice('Character removed.')}
function renderProfiles(){const root=document.getElementById('profileSelect');if(!root)return;root.replaceChildren();for(const p of profileRecords){const op=new Option(p.name,p.id);root.append(op)}root.value=activeProfile;updateHistoryButtons()}
function openBackups(){const root=document.getElementById('backupOptions');root.replaceChildren();const all=JSON.parse(localStorage.getItem(profileBackupsKey(activeProfile))||'[]');if(!all.length)root.textContent='No local backups exist for this character.';
 for(const b of all){const line=document.createElement('div');line.className='stack-item';const label=document.createElement('span');label.textContent=new Date(b.at).toLocaleString();const btn=document.createElement('button');btn.textContent='Restore';btn.onclick=()=>{if(!confirm('Restore this backup? Current changes will be replaced.'))return;try{state=JSON.parse(b.data);save();startUndoHistory();selected=null;renderCharacter();render();document.getElementById('backupDialog').close();notice('Local backup restored.')}catch(e){notice('Backup could not be read.')}};line.append(label,btn);root.append(line)}document.getElementById('backupDialog').showModal()}
function showPage(page){
 for(const key of ['character','sheet','status','combat','ammo','catalog']){const el=document.getElementById(key+'Page');if(el)el.hidden=key!==page}
 document.querySelectorAll('[data-page]').forEach(b=>{b.classList.toggle('active',b.dataset.page===page);b.setAttribute('aria-current',b.dataset.page===page?'page':'false')});
 if(page==='combat')renderCombat();if(page==='ammo')renderAmmo();if(page==='sheet')renderSkills();
}
function render(){renderBase();renderSkills();renderInjuries();renderAmmo();renderCombat();renderRollHistory();renderEncumbrance();renderProfiles();renderTraitsAndNotes()}
function currentCarriedItems(){return state.items.filter(i=>['slot','vestGrid','backpackGrid'].includes(i.location)||(i.location==='loaded'&&['slot','vestGrid','backpackGrid'].includes(byId(i.weaponId)?.location)))}
function repairOrphanedMagazines(){
 const valid=new Set(state.items.map(i=>i.id));let fixed=0;
 state.items=state.items.filter(i=>{if(i.integralMagazine&&!valid.has(i.weaponId)){fixed++;return false}return true});
 for(const i of state.items){if(i.category==='Magazine'&&i.location==='loaded'&&!i.integralMagazine&&!state.items.some(w=>w.id===i.weaponId&&w.magazineId===i.id)){
  i.location='loose';delete i.weaponId;delete i.x;delete i.y;fixed++;
 }}
 for(const w of state.items){if(w.category==='Weapon'&&w.magazineId&&!state.items.some(i=>i.id===w.magazineId)){delete w.magazineId;fixed++}}
 return fixed;
}
function encumbrance(){
 const st=Math.max(1,Number(state.stats.ST)||10),basicLiftKg=st*st/5*.45359237;
 const carried=currentCarriedItems().reduce((sum,i)=>sum+(Number(i.weight)||0)*itemQuantity(i)+(i.category==='Magazine'?Math.max(0,Number(i.loadedRounds)||0)*Math.max(0,Number(i.loadedAmmoWeight)||0):0),0);
 const levels=[['None',1,0,1],['Light',2,1,.8],['Medium',3,2,.6],['Heavy',6,3,.4],['Extra-heavy',10,4,.2]];
 const match=levels.find(([,mult])=>carried<=mult*basicLiftKg)||['Over limit',Infinity,4,.2];
 return {st,basicLiftKg,carried,name:match[0],dodgePenalty:match[2],moveFactor:match[3],overLimit:match[0]==='Over limit'}
}
function renderWeight(){const x=encumbrance();document.getElementById('weight').textContent=`${x.carried.toFixed(2)} kg carried / ${(x.basicLiftKg*10).toFixed(2)} kg limit`}
function renderEncumbrance(){const root=document.getElementById('encumbranceDetails');if(!root)return;const x=encumbrance(),dodge=Number(state.stats.Dodge)||8,move=Math.floor((Number(state.stats['Basic Speed'])||5)*x.moveFactor);
 root.classList.toggle('severe',x.overLimit||x.dodgePenalty>=3);
 root.textContent=`${x.name} encumbrance · Basic Lift ${x.basicLiftKg.toFixed(2)} kg · Dodge ${dodge-x.dodgePenalty} (−${x.dodgePenalty}) · Approx. Move ${Math.max(0,move)} · Loose Loot not carried.`}
function addDiceHistory(label,detail){state.rollLog=state.rollLog||[];state.rollLog.unshift({at:new Date().toLocaleTimeString(),label,detail});state.rollLog=state.rollLog.slice(0,200);save();renderRollHistory()}
function renderRollHistory(){const root=document.getElementById('rollHistory');if(!root)return;root.replaceChildren();for(const x of (state.rollLog||[])){const line=document.createElement('div');line.className='skill-line';const span=document.createElement('span');span.textContent=`${x.at}  ${x.label} — ${x.detail}`;line.append(span);root.append(line)}if(!root.children.length)root.textContent='No rolls yet.'}
function d6(){return 1+Math.floor(Math.random()*6)}
function roll3d6(target,label='Skill check'){
 const dice=[d6(),d6(),d6()],n=dice.reduce((a,b)=>a+b,0),skill=Number(target),criticalSuccess=n<=4||(n===5&&skill>=15)||(n===6&&skill>=16),criticalFailure=n===18||(n===17&&skill<=15)||(n>=skill+10);
 const result=criticalSuccess?'Critical success':criticalFailure?'Critical failure':n<=skill?'Success':'Failure';
 const r={dice,total:n,target:skill,margin:skill-n,success:criticalSuccess||(!criticalFailure&&n<=skill),criticalSuccess,criticalFailure,result};
 addDiceHistory(label,`${dice.join('+')} = ${n} vs ${skill} → ${result} (${r.margin>=0?'+':''}${r.margin})`);
 return r;
}
function rollExpression(raw){const m=String(raw).trim().match(/^(\d{1,2})d(?:6)?\s*([+-]\s*\d{1,3})?\s*(.*)$/i);if(!m)throw Error('Use Nd6, Nd+N, or Nd-N, for example 3d6 or 5d+1 pi.');const num=Number(m[1]);if(num<1||num>50)throw Error('Maximum 50 dice per roll.');const bonus=Number((m[2]||'0').replace(/\s/g,'')),dice=Array.from({length:num},d6),total=dice.reduce((a,b)=>a+b,0)+bonus;return {dice,total,bonus,type:m[3].trim(),raw}}
function renderTraitsAndNotes(){const notes=document.getElementById('characterNotes');if(!notes)return;if(document.activeElement!==notes)notes.value=state.characterNotes||'';
 const available=document.getElementById('availablePoints'),total=document.getElementById('totalPoints');if(document.activeElement!==available)available.value=state.availablePoints??0;if(document.activeElement!==total)total.value=state.totalPoints??state.gcs?.data?.total_points??0;
 const root=document.getElementById('traitsList');root.replaceChildren();for(const t of gcsFlatten(state.gcs?.data?.traits||[])){const line=document.createElement('div');line.className='skill-line';const s=document.createElement('span');s.textContent=[t.name||t.description||'Trait',t.points!=null?`[${t.points} points]`:''].filter(Boolean).join('  ');line.append(s);root.append(line)}if(!root.children.length)root.textContent='Import a GCS character for traits.';
}
function gcsSkillLevel(s){for(const candidate of [s.level,s.calc?.level?.value,s.calc?.level,s.calculated_level,s.effective_level,s.level_value,s.rsl]){if(typeof candidate==='number'&&Number.isFinite(candidate))return candidate;if(typeof candidate==='string'&&/^\d+(?:\.\d+)?$/.test(candidate))return Number(candidate)}return null}
function getAllSkills(){const gcs=gcsFlatten(state.gcs?.data?.skills||[]).filter(s=>s.name&&s.type!=='skill_container').map(s=>({id:s.id||s.name+(s.specialization||''),name:s.name,specialization:s.specialization||'',level:gcsSkillLevel(s),points:s.points??0}));return [...gcs,...(state.manualSkills||[]).map(s=>({...s,isManual:true}))]}
function renderSkills(){const root=document.getElementById('skillList');if(!root)return;root.replaceChildren();const q=(document.getElementById('skillSearch')?.value||'').toLowerCase();for(const s of getAllSkills().filter(s=>`${s.name} ${s.specialization||''}`.toLowerCase().includes(q))){const row=document.createElement('div');row.className='skill-line';const name=document.createElement('span');name.textContent=s.name+(s.specialization?' ('+s.specialization+')':'');const sub=document.createElement('div');sub.className='skill-sub';sub.textContent=s.level===null?'Level unavailable — enter a manual skill':`Level ${s.level}${s.points!=null?' · '+s.points+' pts':''}`;name.append(sub);row.append(name);const actions=document.createElement('div');actions.className='inline-fields';if(s.level!=null){const roll=document.createElement('button');roll.textContent='Roll';roll.onclick=()=>{const r=roll3d6(s.level,s.name+(s.specialization?' ('+s.specialization+')':''));showInfo('SKILL CHECK — '+s.name,`${r.dice.join(' + ')} = ${r.total}\nEffective skill ${s.level}\n${r.result} · margin ${r.margin}`)};actions.append(roll)}if(s.isManual){const edit=document.createElement('button');edit.textContent='Edit';edit.title='Change skill level and spend character points';edit.onclick=()=>editManualSkill(s.id);actions.append(edit);const del=document.createElement('button');del.textContent='×';del.title='Remove manual skill';del.onclick=()=>{state.manualSkills=state.manualSkills.filter(x=>x.id!==s.id);save();renderSkills()};actions.append(del)}row.append(actions);root.append(row)}if(!root.children.length)root.textContent='No matching skills. Import a GCS character or add a skill.'}
function renderInjuries(){const root=document.getElementById('injuryList');if(!root)return;root.replaceChildren();for(const w of state.wounds||[]){const line=document.createElement('div');line.className='injury-item';const text=document.createElement('span');text.textContent=`${w.location}: ${w.hpLoss} HP · ${w.note||'Injury'} · ${w.at||''}`;const btn=document.createElement('button');btn.textContent='Remove';btn.onclick=()=>{state.wounds=state.wounds.filter(x=>x.id!==w.id);save();renderInjuries();notice('Injury record removed. HP is unchanged; heal HP separately.')};line.append(text,btn);root.append(line)}if(!root.children.length)root.textContent='No injuries recorded.';
 const hp=Number(state.conditions.Health??state.stats.HP),max=Number(state.stats.HP)||10;
 let hint='';if(hp<=-max)hint='HP is at or below −HP: check for a death roll and continued survival.';else if(hp<=0)hint='HP is 0 or lower: check consciousness each turn as required by the GURPS rules.';else if(hp<=max/3)hint='HP is at or below one-third: reduced Move and Dodge may apply.';
 document.getElementById('injuryHints').textContent=hint||'Injuries are logged separately. Recording an injury here also reduces current HP.'
}
/* Inventory QoL: merge, quick-transfer, safe automatic placement, condition. */
function safeMoveToLoot(item){if(!item||item.location==='loaded')return false;if(!canReturnToLoot(item))return false;unequipToLoose(item);return true}
function mergeCompatible(src,dst){return !!src&&!!dst&&src.id!==dst.id&&!hasStorage(src)&&!hasStorage(dst)&&stackLimit(dst)>1&&itemQuantity(dst)<stackLimit(dst)&&src.category===dst.category&&(src.templateId&&dst.templateId?src.templateId===dst.templateId:src.name===dst.name)&&String(src.gurps?.caliber||'')===String(dst.gurps?.caliber||'')&&Number(src.uses??-1)===Number(dst.uses??-1)&&src.location!=='loaded'&&dst.location!=='loaded'&&Number(src.loadedRounds||0)===Number(dst.loadedRounds||0)&&String(src.loadedAmmoType||'')===String(dst.loadedAmmoType||'')&&Number(src.condition||0)===Number(dst.condition||0)}
function mergeInto(src,dst){if(!mergeCompatible(src,dst))return false;const amount=Math.min(itemQuantity(src),stackLimit(dst)-itemQuantity(dst));if(amount<1)return false;dst.quantity=itemQuantity(dst)+amount;src.quantity=itemQuantity(src)-amount;if(src.quantity===0){if(src.location==='slot')delete state.slots[src.slot];state.items=state.items.filter(x=>x.id!==src.id);if(selected===src.id)selected=dst.id;}save();render();notice(`Merged ${amount} × ${src.name} (${dst.quantity}/${stackLimit(dst)} in destination).`);return true}
function placeAutomatically(i){if(!i)return null;const d=dimensions(i);if(d.w===1&&d.h===1){for(const name of ['pocket1','pocket2','pocket3','pocket4'])if(!state.slots[name]&&canEquip(i,name)){if(i.location==='slot')delete state.slots[i.slot];i.location='slot';i.slot=name;state.slots[name]=i.id;delete i.x;delete i.y;return 'pocket'}}for(const name of ['vest','backpack']){const free=findFree(i,name);if(free){if(i.location==='slot')delete state.slots[i.slot];i.location=storageLocation(name);i.x=free.x;i.y=free.y;delete i.slot;return name}}return null}
function quickTransfer(id){const item=byId(id);if(!item)return;if(item.location==='loaded'){notice('Eject the magazine first.');return}
 if(item.location==='loose'){const into=placeAutomatically(item);if(!into){notice('No available space. Item stays in Loose Loot.');return}selected=item.id;save();render();notice(`Quick-moved ${item.name} into ${into}.`);return}
 if(safeMoveToLoot(item)){selected=item.id;save();render();notice(`Moved ${item.name} to Loose Loot.`)}else notice('Empty the container before moving it.')}
function mergeSelected(){const i=byId(selected);if(!i)return notice('Select a stack to merge first.');let count=0;for(const other of state.items){if(!byId(i.id))break;if(mergeCompatible(i,other)){const before=itemQuantity(i);mergeInto(i,other);count+=before-(byId(i.id)?itemQuantity(i):0)}}if(!count)notice('No matching partly filled stacks with free capacity.')}
function autoPackLoot(){let count=0;for(const item of state.items.filter(i=>i.location==='loose')){if(placeAutomatically(item))count++}if(count){save();render()}notice(count?`Automatically packed ${count} loose item stack(s).`:'No loose items fit available storage.')}
function makeDraggable(el,item){makeDraggableBase(el,item);el.addEventListener('click',e=>{if(e.shiftKey){e.preventDefault();e.stopImmediatePropagation();e.stopPropagation();window.STALKER_EXT?.toggleSelection?.(item.id)}},true);el.addEventListener('dblclick',e=>{e.preventDefault();e.stopImmediatePropagation();quickTransfer(item.id)},true)}
function openItemContext(e,id){
 e.preventDefault();e.stopPropagation();selected=id;
 const item=byId(id);if(!item)return;
 const menu=document.getElementById('itemContextMenu');menu.replaceChildren();
 const add=(text,handler,disabled=false)=>{const b=document.createElement('button');b.textContent=text;b.disabled=disabled;b.onclick=()=>{menu.hidden=true;handler()};menu.append(b)};
 add('Inspect',()=>{render();notice('Selected '+item.name)});
 add(item.location==='loose'?'Quick transfer to storage':'Move to Loose Loot',()=>quickTransfer(id),item.location==='loaded');
 add('Split stack',()=>openSplitStack(id),itemQuantity(item)<2);
 add('Merge matching stacks',()=>{selected=id;mergeSelected()},stackLimit(item)<=1);
 if(item.category==='Weapon'||item.category==='Magazine')add('Ammo & Magazines',()=>{selected=id;showPage('ammo')});
 if(item.durabilityMax>0)add('Adjust condition',()=>adjustCondition(id));
 menu.style.left=Math.max(5,Math.min(e.clientX,innerWidth-200))+'px';menu.style.top=Math.max(5,Math.min(e.clientY,innerHeight-240))+'px';menu.hidden=false;
}
function updateCarry(x,y){updateCarryBase(x,y);if(!carry?.active)return;const hit=document.elementFromPoint(x,y),hitItem=hit?.closest('[data-item-id]');const dst=byId(hitItem?.dataset.itemId),src=byId(carry.id);if(dst&&mergeCompatible(src,dst)){document.querySelectorAll('.dragged-merge').forEach(el=>el.classList.remove('dragged-merge'));hitItem.classList.add('dragged-merge');carry.target={type:'merge',id:dst.id};carry.valid=true;carry.ghost.classList.remove('invalid')}else document.querySelectorAll('.dragged-merge').forEach(el=>el.classList.remove('dragged-merge'))}
function finishCarry(){if(carry?.active&&carry.valid&&carry.target?.type==='merge'){
 const source=byId(carry.id),target=byId(carry.target.id);carry.ghost?.remove();carry=null;draggingId=null;
 document.querySelectorAll('.dragged-merge,.drop-valid,.drop-invalid').forEach(el=>el.classList.remove('dragged-merge','drop-valid','drop-invalid'));document.querySelectorAll('.storage-grid').forEach(clearPlacementPreview);
 suppressLootClick=true;setTimeout(()=>{suppressLootClick=false},0);mergeInto(source,target);return
 }document.querySelectorAll('.dragged-merge').forEach(el=>el.classList.remove('dragged-merge'));finishCarryBase()}
function adjustCondition(id){const i=byId(id);if(!i||!i.durabilityMax)return;const answer=prompt(`Set ${i.name} condition (0–${i.durabilityMax}):`,String(i.condition??i.durabilityMax));if(answer===null)return;const n=Number(answer);if(!Number.isFinite(n)||n<0||n>i.durabilityMax){notice('Invalid condition.');return}i.condition=n;save();render();log(`${i.name} condition updated to ${n}/${i.durabilityMax}`)}
function openItemEditor(id=null){openItemEditorBase(id);const f=document.getElementById('itemForm');if(f.elements.namedItem('durabilityMax'))f.elements.namedItem('durabilityMax').value=(id?template(id)?.durabilityMax:0)||0;for(const k of ['bleedHeal','radHeal','clearStatus']){const e=f.elements.namedItem(k);if(e)e.value=id?(template(id)?.[k]||''):''}}
function renderSelectedItemBaseExtension(){const i=byId(selected);if(!i)return;const root=document.getElementById('selectedItemDetails');
 if(i.durabilityMax>0){const p=document.createElement('div');p.className='item-detail-meta';p.textContent=`Condition: ${i.condition??i.durabilityMax}/${i.durabilityMax}`;root.append(p)}
 if(i.category==='Medical'&&(i.bleedHeal||i.radHeal||i.clearStatus)){const p=document.createElement('div');p.className='item-detail-meta';p.textContent=[i.bleedHeal?'Bleeding −'+i.bleedHeal:'',i.radHeal?'Radiation −'+i.radHeal:'',i.clearStatus?'Clears: '+i.clearStatus:''].filter(Boolean).join(' · ');root.append(p)}
 if(i.category==='Magazine'){const p=document.createElement('div');p.className='item-detail-meta';p.textContent=`Magazine rounds: ${i.loadedRounds||0}/${magCapacity(i)} · ${i.loadedAmmoType||'Unspecified ammunition'}`;root.append(p)}
 if(i.category==='Weapon'){const mag=byId(i.magazineId);const p=document.createElement('div');p.className='item-detail-meta';p.textContent=mag?`Magazine: ${mag.name} · ${mag.loadedRounds||0}/${magCapacity(mag)}`:`Loaded: ${i.loadedRounds??0} rounds (legacy/internal)`;root.append(p)}
 const tools=document.createElement('div');tools.className='item-detail-actions';
 const quick=document.createElement('button');quick.textContent=i.location==='loose'?'Quick Transfer':'To Loot';quick.onclick=()=>quickTransfer(i.id);tools.append(quick);
 if(i.category==='Weapon'||i.category==='Magazine'){const btn=document.createElement('button');btn.textContent='Ammunition';btn.onclick=()=>showPage('ammo');tools.append(btn)}
 if(i.durabilityMax>0){const btn=document.createElement('button');btn.textContent='Condition';btn.onclick=()=>adjustCondition(i.id);tools.append(btn)}
 root.append(tools)
}
function renderSelectedItem(){renderSelectedItemBase();renderSelectedItemBaseExtension()}
/* Physical magazine management: rounds are stored on magazines, not conjured by Reload. */
function normalizedCaliber(s){const v=String(s||'').toLowerCase().replace(/×/g,'x').replace(/\s+/g,'');if(/9x18.*pmm/.test(v))return '9x18pmm';if(/9x18/.test(v))return '9x18pm';if(/^(12\/70|12ga|12gauge|12g)/.test(v))return '12ga';if(/\.45acp|45acp|11\.?43x23/.test(v))return '45acp';if(/357mag|\.357|9x33r/.test(v))return '357mag';const m=v.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)/);return m?m[1].replace('.','')+'x'+m[2].replace('.',''):v.replace(/mm/g,'').replace(/[^0-9a-z]/g,'')}
function itemCaliber(i){return String(i?.gurps?.caliber||((i?.name||'').match(/\d+(?:\.\d+)?\s*[×xX]\s*\d+(?:\.\d+)?(?:\s*[a-z]+)?/)||[])[0]||'')}
function sameCaliber(a,b){return !!normalizedCaliber(itemCaliber(a))&&normalizedCaliber(itemCaliber(a))===normalizedCaliber(itemCaliber(b))}
function magCapacity(m){const cap=Number(m?.gurps?.capacity)||parseInt(String(m?.gurps?.shots||''),10);return Math.max(0,Math.floor(cap)||0)}
function weaponMagazine(w){return byId(w?.magazineId)}
function roundsInWeapon(w){const m=weaponMagazine(w);return m?Math.max(0,Number(m.loadedRounds)||0):Math.max(0,Number(w?.loadedRounds)||0)}
function ammoDialog(title,label,choices,onConfirm,amountMax=null){
 const d=document.getElementById('ammoDialog'),root=document.getElementById('ammoDialogBody');root.replaceChildren();
 document.getElementById('ammoDialogTitle').textContent=title;
 const p=document.createElement('p');p.textContent=label;root.append(p);
 const select=document.createElement('select');select.style.width='100%';
 for(const c of choices){const opt=document.createElement('option');opt.value=c.id;opt.textContent=c.label;select.append(opt)}root.append(select);
 let amount=null;if(amountMax!==null){const div=document.createElement('label');div.className='sheet-field';div.textContent='Rounds to load';amount=document.createElement('input');amount.type='number';amount.min='1';amount.step='1';amount.max=String(amountMax);amount.value=String(amountMax);div.append(amount);root.append(div)}
 document.getElementById('ammoDialogConfirm').onclick=()=>{const quantity=amount?Number(amount.value):null;if(amount&&(!Number.isSafeInteger(quantity)||quantity<1||quantity>amountMax))return notice('Invalid ammunition quantity.');const okay=onConfirm(select.value,quantity);if(okay!==false)d.close()};d.showModal()
}
function storeEjected(m){m.location='loose';delete m.weaponId;delete m.slot;delete m.x;delete m.y;return placeAutomatically(m)||'Loose Loot'}
function ejectMagazine(weaponId){const w=byId(weaponId),m=weaponMagazine(w);if(!m)return notice('This weapon has no inserted magazine.');if(m.integralMagazine)return notice('This weapon uses a fixed magazine or tube. Unload the rounds rather than ejecting it.');delete w.magazineId;const where=storeEjected(m);save();render();log(`Ejected ${m.name} from ${w.name} into ${where}.`)}
function insertMagazine(weaponId){const w=byId(weaponId);if(!w||w.category!=='Weapon')return;if(w.integralFeed)return notice('This weapon uses a fixed magazine, tube or cylinder. Load it directly in the Magazines list.');if(weaponMagazine(w))return notice('Eject the existing magazine first.');
 const choices=state.items.filter(x=>x.category==='Magazine'&&x.location!=='loaded'&&magazineFitsWeapon(x,w)&&magAmmoFitsWeapon(x,w)).map(x=>({id:x.id,label:`${x.name} (${x.loadedRounds||0}/${magCapacity(x)}) · ${x.location==='loose'?'Loose Loot':'carried'}`}));
 if(!choices.length)return notice(`No compatible ${itemCaliber(w)||'caliber'} magazine available. Spawn or load a magazine first.`);
 ammoDialog('INSERT MAGAZINE','Choose a compatible physical magazine:',choices,(id)=>{
 const m=byId(id);if(!magazineFitsWeapon(m,w)||!magAmmoFitsWeapon(m,w))return false;if(m.location==='slot')delete state.slots[m.slot];m.location='loaded';delete m.slot;delete m.x;delete m.y;m.weaponId=w.id;w.magazineId=m.id;delete w.loadedRounds;save();render();log(`Inserted ${m.name} into ${w.name} (${m.loadedRounds||0} rounds).`);return true
 });
}
function loadMagazine(id){const m=byId(id);if(!m||m.category!=='Magazine')return;const cap=magCapacity(m);if(!cap)return notice('Set the magazine capacity in its GURPS item statistics.');const loaded=Math.max(0,Number(m.loadedRounds)||0),room=cap-loaded;if(room<1)return notice('Magazine is full.');
 const options=state.items.filter(a=>a.category==='Ammo'&&itemQuantity(a)>0&&ammoFitsMagazine(a,m)&&(!loaded||!m.loadedAmmoType||m.loadedAmmoType===a.name)).map(a=>({id:a.id,label:`${a.name} · ${itemQuantity(a)} rounds (${a.location==='loose'?'Loot':'carried'})`}));
 if(!options.length)return notice('No matching ammo stack found, or the magazine already contains a different ammo type.');
 options.sort((a,b)=>itemQuantity(byId(b.id))-itemQuantity(byId(a.id)));const maximum=Math.min(room,Math.max(...options.map(x=>itemQuantity(byId(x.id)))));
 ammoDialog('LOAD MAGAZINE',`${m.name} · ${loaded}/${cap} rounds. Choose an ammo stack:`,options,(aId,quantity)=>{
 const ammo=byId(aId);if(!ammo||!ammoFitsMagazine(ammo,m)||((m.weaponId&&!magAmmoFitsWeapon({...m,loadedAmmoType:ammo.name,loadedRounds:1},byId(m.weaponId)))||false)||itemQuantity(ammo)<quantity||quantity>cap-(m.loadedRounds||0))return notice('Not enough compatible rounds.');
 if(m.loadedRounds>0&&m.loadedAmmoType&&m.loadedAmmoType!==ammo.name)return notice('Cannot mix different ammunition types in a magazine.');
 m.loadedAmmoType=ammo.name;m.loadedAmmoTemplateId=ammo.templateId||'';m.loadedAmmoWeight=Math.max(0,Number(ammo.weight)||0);m.loadedRounds=(Number(m.loadedRounds)||0)+quantity;
 ammo.quantity=itemQuantity(ammo)-quantity;if(ammo.quantity===0){if(ammo.location==='slot')delete state.slots[ammo.slot];state.items=state.items.filter(x=>x.id!==ammo.id);if(selected===ammo.id)selected=m.id}
 save();render();log(`Loaded ${quantity} × ${ammo.name} into ${m.name}.`);return true
 },maximum);
}
function unloadMagazine(id){const m=byId(id);if(!m||m.category!=='Magazine')return;const remaining=Math.max(0,Math.floor(Number(m.loadedRounds)||0));if(remaining<1)return notice('Magazine is empty.');
 let templateAmmo=state.catalog.find(t=>t.id===m.loadedAmmoTemplateId)||state.catalog.find(t=>t.category==='Ammo'&&t.name===m.loadedAmmoType);
 if(!templateAmmo){templateAmmo={id:'unloaded-ammo-'+normalizedCaliber(itemCaliber(m)),name:m.loadedAmmoType||`${itemCaliber(m)} Ammunition`,category:'Ammo',w:1,h:1,weight:0,value:0,stackSize:30,behavior:'ammo',gurps:{caliber:itemCaliber(m)}}}
 let n=remaining;while(n>0){const qty=Math.min(n,stackLimit(templateAmmo));const a={...clone(templateAmmo),id:uid(),templateId:templateAmmo.id,quantity:qty,location:'loose',rotated:false};state.items.push(a);placeAutomatically(a);n-=qty}
 m.loadedRounds=0;delete m.loadedAmmoType;delete m.loadedAmmoTemplateId;delete m.loadedAmmoWeight;save();render();log(`Unloaded ${remaining} rounds from ${m.name}.`)
}
function renderAmmo(){const weapons=document.getElementById('weaponAmmoList');if(!weapons)return;const mags=document.getElementById('magazineList'),ammo=document.getElementById('ammoSupplyList');for(const root of [weapons,mags,ammo])root.replaceChildren();
 const card=(root,title,meta,buttons)=>{const el=document.createElement('div');el.className='ammo-card';const h=document.createElement('strong');h.textContent=title;const p=document.createElement('div');p.className='ammo-meta';p.textContent=meta;const actions=document.createElement('div');actions.className='ammo-actions';for(const [txt,click,disabled] of buttons){const b=document.createElement('button');b.textContent=txt;b.disabled=!!disabled;b.onclick=click;actions.append(b)}el.append(h,p,actions);root.append(el)};
 for(const w of state.items.filter(x=>x.category==='Weapon')){const m=weaponMagazine(w);const rounds=roundsInWeapon(w),cap=m?magCapacity(m):magCapacity(w);card(weapons,w.name,`${w.location==='slot'?'Equipped':w.location==='loose'?'Loose Loot':'Stored'} · ${itemCaliber(w)||'Caliber not set'} · ${rounds}/${cap||'?'} rounds · ${m?m.name:'No inserted magazine'}`,[["Insert magazine",()=>insertMagazine(w.id),!!m],["Eject magazine",()=>ejectMagazine(w.id),!m||!!m.integralMagazine],["Select for combat",()=>{selected=w.id;showPage('combat');renderCombat()},false]])}
 for(const m of state.items.filter(x=>x.category==='Magazine')){const attached=byId(m.weaponId);card(mags,m.name,`${m.loadedRounds||0}/${magCapacity(m)||'?'} rounds · ${itemCaliber(m)||'No caliber'} · ${attached?'Inserted in '+attached.name:m.location==='loose'?'Loose Loot':'Carried'}`,[["Load rounds",()=>loadMagazine(m.id),magCapacity(m)<1||Number(m.loadedRounds)>=magCapacity(m)],["Unload rounds",()=>unloadMagazine(m.id),!m.loadedRounds]])}
 for(const a of state.items.filter(x=>x.category==='Ammo'))card(ammo,a.name,`${itemQuantity(a)} rounds · ${itemCaliber(a)||'No caliber'} · ${a.location==='loose'?'Loose Loot':'Carried'}`,[]);
 for(const root of [weapons,mags,ammo])if(!root.children.length){const p=document.createElement('div');p.className='ammo-empty';p.textContent=root===weapons?'No weapons spawned.':root===mags?'No magazines. Spawn one in the catalogue.':'No ammunition. Spawn ammo from the catalogue.';root.append(p)}
}
function ensureAmmoExamples(){
 const examples=[
 {id:'sample-akm-30-mag',name:'AKM 30-round magazine',category:'Magazine',tier:1,w:1,h:2,weight:.25,value:0,uses:null,behavior:'equipment',stackSize:1,description:'Example detachable 7.62×39mm AKM magazine; weight is an approximation.',gurps:{caliber:'7.62×39mm',capacity:30}},
 {id:'sample-76239-fmj-ammo',name:'7.62×39mm FMJ',category:'Ammo',tier:1,w:1,h:1,weight:.016,value:0,uses:null,behavior:'ammo',stackSize:30,description:'Example loose 7.62×39mm FMJ cartridges. Mass per cartridge is approximate.',gurps:{caliber:'7.62×39mm'}},
 {id:'sample-field-bandage',name:'Field Bandage',category:'Medical',tier:1,w:1,h:1,weight:.08,value:0,uses:1,behavior:'consumable',stackSize:1,hpHeal:2,description:'Example campaign-rule HP recovery: 2 HP per use (not an official GURPS First Aid value).',gurps:{gurpsNotes:'GM should set healing based on campaign medical rules.'}}
 ];
 let changed=false;for(const t of examples){if(!state.catalog.some(x=>x.id===t.id)){state.catalog.push(clone(t));changed=true}}if(changed)save()
}
/* GURPS 4e assisted combat: range, aim, RoF, recoil, active defense and injury. */
const HIT_LOCATION_PENALTIES={Torso:0,Vitals:-3,Skull:-7,Face:-5,Arm:-2,Leg:-2,Hand:-4,Foot:-4};
const RANGE_BREAKS=[[2,0],[3,-1],[5,-2],[7,-3],[10,-4],[15,-5],[20,-6],[30,-7],[50,-8],[70,-9],[100,-10],[150,-11],[200,-12],[300,-13],[500,-14],[700,-15],[1000,-16],[1500,-17],[2000,-18],[3000,-19],[5000,-20],[7000,-21],[10000,-22]];
function rangeModifier(yards){const yardsNum=Math.max(0,Number(yards)||0);for(const [limit,mod] of RANGE_BREAKS)if(yardsNum<=limit)return mod;return -22-2*Math.ceil(Math.log10(yardsNum/10000))}
function rapidFireBonus(shots){if(shots<5)return 0;for(const [upper,bonus] of [[8,1],[12,2],[16,3],[24,4],[49,5],[99,6],[199,7],[399,8],[799,9]])if(shots<=upper)return bonus;return 10}
function weaponSkillLevel(w){const string=String(w?.gurps?.skill||'').toLowerCase(),skills=getAllSkills();if(!string)return null;
 const m=string.match(/^(.*?)\s*\((.*?)\)/);const name=(m?m[1]:string).trim(),spec=(m?m[2]:'').trim();
 const found=skills.find(x=>x.name?.toLowerCase()===name&&(!spec||(x.specialization||'').toLowerCase()===spec)&&x.level!=null)||skills.find(x=>x.name?.toLowerCase()===name&&x.level!=null);
 return found?.level??null;
}
function renderCombat(){const el=document.getElementById('combatWeapon');if(!el)return;const old=el.value;const wSelected=byId(selected)?.category==='Weapon'?selected:null;
 el.replaceChildren();el.append(new Option('Unarmed / manual damage',''));
 for(const w of state.items.filter(i=>i.category==='Weapon'))el.append(new Option(`${w.name} · ${roundsInWeapon(w)} rounds (${w.location==='slot'?'equipped':w.location==='loose'?'loot':'stored'})`,w.id));
 el.value=(old&&state.items.some(w=>w.id===old&&w.category==='Weapon')?old:wSelected)||'';
 if(!el.value&&el.options.length>1)el.value=el.options[1].value;
 const max=document.getElementById('targetMaxHP'),hp=document.getElementById('targetHP');
 if(!document.getElementById('combatPanelInitialized')){const marker=document.createElement('i');marker.hidden=true;marker.id='combatPanelInitialized';el.after(marker);hp.value=String(state.targetHP??10);max.value=String(state.targetMaxHP??10);const gun=byId(el.value);if(gun){const level=weaponSkillLevel(gun);if(level)document.getElementById('combatSkill').value=String(level)}}
 const result=document.getElementById('combatResult');if(lastCombatResult&&document.activeElement!==result)result.textContent=lastCombatResult;
}
function weaponRof(w){const n=parseInt(String(w?.gurps?.rof||'1'),10);return Math.max(1,Number.isFinite(n)?n:1)}
function damageInjury(total,raw,dr,location){
 const divisorText=String(raw).match(/\((0\.5|1|2|3|5|10|100)\)/),armorDivisor=divisorText?Number(divisorText[1]):1;
 let effectiveDR=Math.floor(Math.max(0,Number(dr)||0)/armorDivisor);
 if(location==='Skull')effectiveDR+=2;
 const penetration=Math.max(0,total-effectiveDR);
 const typeMatch=String(raw).toLowerCase().match(/(pi\+\+|pi\+|pi-|pi|cut|imp|burn|cr|tox|fat)/),type=typeMatch?typeMatch[1]:'cr';
 let mult={"pi-":.5,pi:1,'pi+':1.5,'pi++':2,cut:1.5,imp:2,burn:1,cr:1,tox:1,fat:1}[type]??1;
 if(location==='Vitals'&&['pi-','pi','pi+','pi++','imp'].includes(type))mult=3;
 if(location==='Skull'&&penetration>0)mult=4;
 if((location==='Arm'||location==='Leg')&&['imp','pi++'].includes(type))mult=1;
 const injury=penetration>0?Math.max(1,Math.floor(penetration*mult)):0;
 return {effectiveDR,penetration,injury,type,mult,armorDivisor};
}
function fireAttack(){const weaponId=document.getElementById('combatWeapon').value,w=byId(weaponId),skill=Number(document.getElementById('combatSkill').value),other=Number(document.getElementById('combatModifier').value),range=Number(document.getElementById('combatRange').value),aim=Number(document.getElementById('combatAim').value),location=document.getElementById('combatLocation').value,dr=Number(document.getElementById('targetDR').value),shotsEntered=Number(document.getElementById('combatShots').value);
 if(!Number.isInteger(skill)||skill<3||skill>30||!Number.isFinite(other)||!Number.isFinite(range)||range<0||!Number.isFinite(dr)||dr<0||!Number.isSafeInteger(shotsEntered)||shotsEntered<1||shotsEntered>100){notice('Check skill, range, DR and shots (1–100).');return}
 const available=w?roundsInWeapon(w):100;const allowed=w?Math.min(weaponRof(w),available):100;if(w&&allowed<=0){notice(`${w.name} is empty. Use Ammo & Magazines to load it before firing.`);showPage('ammo');return}
 const shots=Math.min(shotsEntered,allowed),acc=w?(window.STALKER_EXT?.weaponStat?.(w,'acc')??(Number(w.gurps?.acc)||0)):0,aimBonus=aim>0?acc+Math.min(2,aim-1):0,rangePenalty=rangeModifier(range),hitPenalty=HIT_LOCATION_PENALTIES[location]||0,rofBonus=rapidFireBonus(shots),effectiveSkill=skill+other+rangePenalty+hitPenalty+aimBonus+rofBonus;
 if(!Number.isFinite(effectiveSkill))return notice('Invalid attack target.');
 // Consume ammunition whenever the trigger is pulled, independent of whether bullets hit.
 if(w){const mag=weaponMagazine(w);if(mag&&!magAmmoFitsWeapon(mag,w)){notice('Unsafe ammunition for this weapon. Unload the PMM rounds before firing.');return}if(mag)mag.loadedRounds=Math.max(0,Number(mag.loadedRounds)-shots);else w.loadedRounds=Math.max(0,Number(w.loadedRounds)-shots)}
 const roll=roll3d6(effectiveSkill,w?`${w.name} attack`:'Unarmed attack');let hits=roll.success?Math.min(shots,roll.criticalSuccess?Math.max(1,1+Math.floor(Math.max(0,roll.margin)/(Number(w?.gurps?.rcl)||2))):1+Math.floor(Math.max(0,roll.margin)/Math.max(1,Number(w?.gurps?.rcl)||2))):0;
 let defense=null;if(hits>0&&document.getElementById('targetDefense').value!=='none'&&!roll.criticalSuccess){const mode=document.getElementById('targetDefense').value;const targetValue=Number(document.getElementById('target'+mode[0].toUpperCase()+mode.slice(1)).value)||8;defense=roll3d6(targetValue,'Target '+mode);if(defense.success)hits=0}
 const raw=String((w&&window.STALKER_EXT?.weaponDamage?.(w))||w?.gurps?.damage||document.getElementById('combatDamage')?.value||'1d-2 cr').trim();let totalInjury=0;const results=[];
 if(hits>0){try{for(let n=0;n<hits;n++){const damage=rollExpression(raw),computed=damageInjury(Math.max(0,damage.total),raw,dr,location);totalInjury+=computed.injury;results.push(`Hit ${n+1}: ${damage.total} ${computed.type} − DR ${computed.effectiveDR} = ${computed.penetration} penetrating → ${computed.injury} HP`)} }catch(e){results.push('Damage could not be resolved: '+e.message)}}
 const hp=Number(document.getElementById('targetHP').value)||0;
 if(totalInjury){state.combatReview=state.combatReview||[];state.combatReview.unshift({id:uid(),at:new Date().toISOString(),kind:'player',actor:state.identity?.Name||'Player',target:document.getElementById('selectedEncounterTarget')?.textContent||'Target',weapon:w?.name||'Unarmed',shots,location,roll:roll.total,effectiveSkill,injury:totalInjury,status:'Calculated',detail:results.join(' | ')});state.combatReview=state.combatReview.slice(0,200)}
 const hint=totalInjury>(Number(document.getElementById('targetMaxHP').value)||10)/2?' Major wound: check knockdown/stunning.':'';
 lastCombatResult=`${w?w.name:'Unarmed'} · ${shots} shot(s) · ${location}\nAttack 3d6: ${roll.dice.join('+')} = ${roll.total} vs ${effectiveSkill} → ${roll.result} (margin ${roll.margin})\nModifiers: skill ${skill}, other ${other}, range ${rangePenalty}, location ${hitPenalty}, aim ${aimBonus}, rapid fire ${rofBonus}\n${defense?`Target defense: ${defense.total} vs ${defense.target} → ${defense.result}\n`:''}Hits after defense: ${hits}\n${results.join('\n')||'No damaging hits.'}\nTotal calculated injury: ${totalInjury} HP. Target HP unchanged: ${document.getElementById('targetHP').value}. Awaiting GM decision\n${hint}`;
 document.getElementById('combatResult').textContent=lastCombatResult;
 addDiceHistory('Combat result',`${w?.name||'Unarmed'}: ${roll.result}, ${hits} hit(s), ${totalInjury} HP injury`);
 save();renderAmmo();renderSelectedItem();notice(`Attack calculated: ${roll.result}; ${hits} hit(s); ${totalInjury} injury pending GM review.`)
}
function rollJustDamage(){const w=byId(document.getElementById('combatWeapon').value);const raw=w?.gurps?.damage||document.getElementById('combatDamage')?.value||'1d-2 cr';try{const r=rollExpression(raw);document.getElementById('combatResult').textContent=`Damage roll ${raw}: ${r.dice.join(' + ')} ${r.bonus?'+ '+r.bonus:''} = ${r.total} ${r.type}\nDamage is not applied to the target by this standalone roll.`;addDiceHistory('Damage '+(w?.name||''),`${r.total} ${r.type} (${raw})`)}catch(e){notice(e.message)}}
function adjustWoundStatus(){const location=document.getElementById('woundLocation').value,amount=Number(document.getElementById('woundDamage').value),note=document.getElementById('woundNote').value.trim();if(!Number.isSafeInteger(amount)||amount<0||amount>10000)return notice('Enter a valid nonnegative injury amount.');state.wounds=state.wounds||[];state.wounds.unshift({id:uid(),location,hpLoss:amount,note:note||'Injury',at:new Date().toLocaleTimeString()});state.conditions.Health=Number(state.conditions.Health??state.stats.HP)-amount;save();renderCharacter();render();log(`Injury: ${location} −${amount} HP${note?' ('+note+')':''}`)}
function action(a){
 if(a==='attack'){showPage('combat');const w=byId(selected);if(w?.category==='Weapon'){document.getElementById('combatWeapon').value=w.id;const level=weaponSkillLevel(w);if(level)document.getElementById('combatSkill').value=String(level)}return}
 if(a==='reload'){showPage('ammo');return}
 if(a==='use'){useSelectedItem();return}
 return actionBase(a)
}
/* All event handlers are attached only after every dialog and page has been parsed. */
function installEnhancements(){
 ensureAmmoExamples();startUndoHistory();render();
 const on=(id,evt,fn)=>{const el=document.getElementById(id);if(el)el.addEventListener(evt,fn)};
 on('profileSelect','change',e=>selectProfile(e.target.value));
 on('profileNew','click',createProfile);on('profileRename','click',renameProfile);on('profileDelete','click',deleteProfile);
 on('undoMove','click',()=>changeHistory(-1));on('redoMove','click',()=>changeHistory(1));
 on('manualBackup','click',()=>{if(profileSnapshots(true))notice('Local backup created. Export Save for an external copy.')});
 on('restoreBackup','click',openBackups);on('closeBackups','click',()=>document.getElementById('backupDialog').close());
 on('ammoDialogCancel','click',()=>document.getElementById('ammoDialog').close());
 on('quickMove','click',()=>quickTransfer(selected));on('mergeStack','click',mergeSelected);on('autoPack','click',autoPackLoot);on('sortChest','click',()=>sortStorage('vest'));on('sortBackpack','click',()=>sortStorage('backpack'));
 on('clearActivity','click',()=>{if(confirm('Clear this character’s activity log?')){state.log=[];save();renderLog()}});
 on('skillSearch','input',renderSkills);
 const statsRoot=document.getElementById('stats');if(statsRoot)statsRoot.addEventListener('change',()=>{renderWeight();renderEncumbrance();renderStatus()});const condRoot=document.getElementById('conditions');if(condRoot)condRoot.addEventListener('change',renderStatus);
 on('skillAdd','click',()=>{const name=prompt('Skill name (for example: Survival):');if(!name?.trim())return;const raw=prompt('Effective GURPS skill level (3–30):','12');if(raw===null)return;const level=Number(raw);if(!Number.isSafeInteger(level)||level<3||level>30)return notice('Use an effective skill level between 3 and 30.');state.manualSkills=state.manualSkills||[];state.manualSkills.push({id:uid(),name:name.trim().slice(0,100),level,points:0});save();renderSkills()});
 on('saveCharacterNotes','click',()=>{state.characterNotes=document.getElementById('characterNotes').value;state.availablePoints=Number(document.getElementById('availablePoints').value)||0;state.totalPoints=Number(document.getElementById('totalPoints').value)||0;save();notice('Notes and character points saved.')});
 on('addWound','click',adjustWoundStatus);
 on('rollCustomDice','click',()=>{try{const r=rollExpression(document.getElementById('diceExpression').value);document.getElementById('diceResult').textContent=`${r.raw}: ${r.dice.join(' + ')} ${r.bonus?r.bonus>0?'+ '+r.bonus:'− '+Math.abs(r.bonus):''} = ${r.total} ${r.type}`;addDiceHistory('Custom dice',`${r.raw} = ${r.total} ${r.type}`)}catch(err){notice(err.message)}});
 on('rollDefault3d6','click',()=>{document.getElementById('diceExpression').value='3d6';document.getElementById('rollCustomDice').click()});
 on('rollHT','click',()=>{const r=roll3d6(Number(state.stats.HT)||10,'HT check');document.getElementById('diceResult').textContent=`HT: ${r.dice.join(' + ')} = ${r.total} vs ${r.target} → ${r.result}`});
 on('rollWill','click',()=>{const r=roll3d6(Number(state.stats.Will||state.stats.IQ)||10,'Will check');document.getElementById('diceResult').textContent=`Will: ${r.dice.join(' + ')} = ${r.total} vs ${r.target} → ${r.result}`});
 on('clearRollHistory','click',()=>{if(confirm('Clear dice history?')){state.rollLog=[];save();renderRollHistory()}});
 on('performAttack','click',fireAttack);on('rollDmgOnly','click',rollJustDamage);
 on('rollDefense','click',()=>{const r=roll3d6(Number(document.getElementById('targetDodge').value)||8,'Target Dodge');document.getElementById('combatResult').textContent=`Target Dodge: ${r.dice.join(' + ')} = ${r.total} vs ${r.target} → ${r.result}`});
 on('resetCombatTarget','click',()=>{document.getElementById('targetHP').value=document.getElementById('targetMaxHP').value;state.targetHP=Number(document.getElementById('targetHP').value);save();notice('Target HP reset.')});
 on('targetHP','change',()=>{state.targetHP=Number(document.getElementById('targetHP').value);save()});
 on('targetMaxHP','change',()=>{state.targetMaxHP=Number(document.getElementById('targetMaxHP').value);save()});
 on('combatWeapon','change',()=>{const w=byId(document.getElementById('combatWeapon').value);if(w){const level=weaponSkillLevel(w);if(level!=null)document.getElementById('combatSkill').value=String(level);document.getElementById('combatShots').value=String(Math.min(weaponRof(w),Math.max(1,roundsInWeapon(w))))}});
 window.addEventListener('keydown',e=>{if(e.target?.closest?.('input,textarea,select,[contenteditable="true"]')||carry?.active)return;if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();changeHistory(-1)}else if((e.ctrlKey||e.metaKey)&&['y','z'].includes(e.key.toLowerCase())){e.preventDefault();changeHistory(1)}},true);
 // Automatic periodic snapshots while the page is in active use, also accessible via Backup.
 window.addEventListener('beforeunload',()=>{try{localStorage.setItem(profileStorageKey(activeProfile),JSON.stringify(state));profileSnapshots(false)}catch(e){}});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')profileSnapshots(false)});
 renderProfiles();notice('Ready. Shift+click = Quick Transfer · Drag = Move · Hold and press R = Rotate · Right-click = Item options.');
}
async function importGcs(file){await importGcsBase(file);if(state.gcs?.data?.total_points!=null)state.totalPoints=Number(state.gcs.data.total_points)||0;reapplyGcsCurrentPools(state.gcs?.data);save();renderCharacter();render();notice('Character imported. Review attributes and skill levels; unsupported GCS calculation fields remain visible in the import details.')}
function sortStorage(slot){const location=storageLocation(slot);const stored=state.items.filter(i=>i.location===location);if(!stored.length)return notice('Nothing to sort in '+slot+'.');const old=stored.map(i=>({id:i.id,x:i.x,y:i.y,rotated:i.rotated}));for(const item of stored)item.location='sorting';
 const ordered=stored.slice().sort((a,b)=>{const da=dimensions(a),db=dimensions(b);return db.w*db.h-da.w*da.h||db.h-da.h||a.name.localeCompare(b.name)});
 let okay=true;for(const i of ordered){const spot=findFree(i,slot);if(!spot){okay=false;break}i.location=location;i.x=spot.x;i.y=spot.y}
 if(!okay){for(const x of old){const i=byId(x.id);if(i){i.location=location;i.x=x.x;i.y=x.y;i.rotated=x.rotated}}return notice('Sorting could not fit every item. Original positions were restored.')}
 save();render();notice('Sorted '+stored.length+' item(s) in '+(slot==='vest'?'chest':'backpack')+' storage.')
}
function useSelectedItem(){const i=byId(selected);if(!i)return notice('Select a consumable item first.');if(!isConsumable(i))return notice(i.name+' has no uses.');if(Number(i.uses)<=0)return notice('This item is depleted.');
 i.uses=Math.max(0,Number(i.uses)-1);
 const before={hp:Number(state.conditions.Health??state.stats.HP),bleed:Number(state.conditions.Bleeding)||0,rad:Number(state.conditions.Radiation)||0};
 if(i.category==='Medical'){
  state.conditions.Health=Math.min(Number(state.stats.HP)||10,before.hp+Math.max(0,Number(i.hpHeal)||0));
  state.conditions.Bleeding=Math.max(0,before.bleed-Math.max(0,Number(i.bleedHeal)||0));
  state.conditions.Radiation=Math.max(0,before.rad-Math.max(0,Number(i.radHeal)||0));
  for(const flag of String(i.clearStatus||'').split(',').map(x=>x.trim()).filter(Boolean)){const key=STATUS_FLAGS.find(k=>k.toLowerCase()===flag.toLowerCase());if(key)state.statusFlags[key]=false}
 }
 // Each quantity unit owns its uses: advance to the next unit when one is depleted.
 if(i.uses<=0&&itemQuantity(i)>1){i.quantity=itemQuantity(i)-1;i.uses=Math.max(1,Number(template(i.templateId)?.uses)||1)}
 save();render();log(`Used ${i.name}: +${Number(state.conditions.Health)-before.hp} HP, −${before.bleed-Number(state.conditions.Bleeding)} bleeding, −${before.rad-Number(state.conditions.Radiation)} radiation (${i.uses} uses remain).`)
}
/* Native GCS v5 attribute sets have attr_id/adj and optional calculated values. */
function gcsAttributesMap(data){
 const raw=data?.attributes?.set||data?.attributes?.values||data?.attributes||{};
 if(Array.isArray(raw))return Object.fromEntries(raw.filter(v=>v&&typeof v==='object').map(v=>[String(v.attr_id||v.id||v.name||'').toLowerCase(),v]));
 const map={};for(const [k,v] of Object.entries(raw)){map[String(k).toLowerCase()]=v;if(v&&typeof v==='object'&&v.attr_id)map[String(v.attr_id).toLowerCase()]=v}return map
}
function gcsAttributeValue(v,fallback=null){if(v==null)return null;const candidates=typeof v==='object'?[v.calc?.value,v.calc?.current,v.calc?.maximum,v.calc?.level,v.value,v.current,v.maximum,v.base]:[v];for(const x of candidates){const n=Number(x);if(x!==undefined&&x!==null&&x!==''&&Number.isFinite(n))return n}if(fallback!==null&&typeof v==='object'){const adjustment=Number(v.adj);if(Number.isFinite(adjustment))return fallback+adjustment}return null}
function parseGcsStats(data){parseGcsStatsBase(data);const a=gcsAttributesMap(data);for(const [key,id,base] of [['ST','st',10],['DX','dx',10],['IQ','iq',10],['HT','ht',10]]){const v=gcsAttributeValue(a[id],base);if(v!==null)state.stats[key]=v}
 for(const [key,id,base] of [['HP','hp',state.stats.ST],['FP','fp',state.stats.HT],['Will','will',state.stats.IQ],['Per','per',state.stats.IQ],['Basic Speed','basic_speed',null],['Basic Move','basic_move',null],['Dodge','dodge',null]]){const v=gcsAttributeValue(a[id],base);if(v!==null)state.stats[key]=v}
 if(typeof data.profile?.name==='string')state.identity.Name=data.profile.name;
}
function reapplyGcsCurrentPools(data){const a=gcsAttributesMap(data);for(const [id,stat,condition] of [['hp','HP','Health'],['fp','FP','Fatigue']]){const v=a[id],damage=Number(v?.damage);if(v&&Number.isFinite(damage)&&damage>0)state.conditions[condition]=Number(state.stats[stat])-damage}}
/* Skill advancement uses the user's point cost, since GURPS skills have varying costs. */
function editManualSkill(id){const s=(state.manualSkills||[]).find(x=>x.id===id);if(!s)return;const text=prompt(`New effective level for ${s.name}:`,String(s.level));if(text===null)return;const lvl=Number(text);if(!Number.isSafeInteger(lvl)||lvl<3||lvl>30)return notice('Skill level must be 3–30.');const raw=prompt('Character points to spend (0 or more):','1');if(raw===null)return;const cost=Number(raw);if(!Number.isSafeInteger(cost)||cost<0)return notice('Point cost must be a nonnegative whole number.');if(cost>(Number(state.availablePoints)||0))return notice('Not enough available character points.');state.availablePoints=(Number(state.availablePoints)||0)-cost;s.level=lvl;s.points=(Number(s.points)||0)+cost;save();renderSkills();renderTraitsAndNotes();notice(`${s.name} updated to level ${lvl}; ${cost} points spent.`)}

setupProfileIndex();load();startUndoHistory();renderCharacter();document.getElementById('gcsImport').onclick=()=>document.getElementById('gcsFile').click();document.getElementById('gcsFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{await importGcs(file)}catch(err){alert('GCS import failed: '+err.message)}e.target.value=''};render();document.querySelectorAll('[data-posture]').forEach(b=>b.onclick=()=>{if(state.posture===b.dataset.posture)return;state.posture=b.dataset.posture;save();renderStatus();log('Posture: '+state.posture)});document.getElementById('applyVitals').onclick=applyVitals;setupDragTargets();document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));document.getElementById('catalogCreate').onclick=()=>openItemEditor();document.getElementById('catalogEdit').onclick=()=>{if(!template(selectedTemplate)){notice('Select a catalog item to edit.');return}openItemEditor(selectedTemplate)};document.getElementById('catalogDelete').onclick=deleteTemplate;document.getElementById('itemForm').elements.namedItem('category').onchange=updateStorageEditor;document.getElementById('itemForm').elements.namedItem('behavior').onchange=updateItemBehavior;document.getElementById('imagePicker').onchange=async e=>{const f=e.target.files[0];if(!f)return;if(!f.type.startsWith('image/')){notice('Choose an image file.');return}if(f.size>1500000){notice('Image is too large for browser storage. Use a smaller image (under 1.5 MB) or place it in images/ and enter its filename.');return}selectedImageData=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(f)});document.getElementById('itemForm').elements.namedItem('image').value=f.name;updateImagePreview()};document.getElementById('itemForm').elements.namedItem('image').oninput=()=>{selectedImageData=null;updateImagePreview()};document.getElementById('rotate').onclick=rotate;document.getElementById('toLoose').onclick=()=>{const i=byId(selected);if(!i)return;if(i.location==='slot'&&(['Vest','Armor','Backpack'].includes(i.category))&&state.items.some(o=>o.location===storageLocation(i.slot))){notice('Empty the container first.');return}unequipToLoose(i);save();render();notice('Moved '+i.name+' to Loot');showPage('character')};document.getElementById('remove').onclick=removeSelected;document.getElementById('cancelItem').onclick=()=>document.getElementById('itemDialog').close();document.getElementById('closeInfo').onclick=()=>document.getElementById('infoDialog').close();document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));document.getElementById('itemForm').elements.namedItem('armorStorage').addEventListener('change',updateStorageEditor);
document.getElementById('itemForm').onsubmit=e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const item={bleedHeal:d.category==="Medical"?Math.max(0,Number(d.bleedHeal)||0):0,radHeal:d.category==="Medical"?Math.max(0,Number(d.radHeal)||0):0,clearStatus:d.category==="Medical"?String(d.clearStatus||"").trim():"",durabilityMax:Math.max(0,Number(d.durabilityMax)||0),condition:Math.max(0,Number(d.durabilityMax)||0),stackSize:Math.max(1,Math.floor(Number(d.stackSize)||1)),magFamily:d.category==='Magazine'?String(d.magFamily||'').trim():'',magAppearance:d.category==='Magazine'?String(d.magAppearance||'standard'):'standard',appearanceVariants:d.category==='Weapon'?JSON.parse(String(d.appearanceVariants||'{}')):{},magFamilies:d.category==='Weapon'?String(d.magFamilies||'').split(',').map(x=>x.trim()).filter(Boolean):[],integralFeed:d.category==='Weapon'&&!!e.target.elements.namedItem('integralFeed').checked,hpHeal:d.category==='Medical'?Math.max(0,Number(d.hpHeal)||0):0,id:uid(),name:d.name.trim(),category:d.category,tier:normalizeTier(d.tier),w:Number(d.w),h:Number(d.h),weight:Number(d.weight),value:Number(d.value),uses:resolveUses(d.category,d.behavior,d.uses),behavior:d.behavior||'',gurps:Object.fromEntries(['damage','acc','range','rof','shots','minST','bulk','rcl','dr','caliber','capacity','skill','gurpsNotes'].map(k=>[k,String(d[k]??'').trim()])),armorStorage:d.category==='Armor'&&!!e.target.elements.namedItem('armorStorage').checked,storageW:d.category==='Armor'&&!e.target.elements.namedItem('armorStorage').checked?0:Number(d.storageW)||4,storageH:d.category==='Armor'&&!e.target.elements.namedItem('armorStorage').checked?0:Number(d.storageH)||2,description:d.description,compartments:[],image:selectedImageData||String(d.image||'').replace(/\\/g,'/').split('/').pop().trim()};if(!item.name||item.w<1||item.h<1)return;if(hasStorage(item)&&!editingTemplate){const raw=String(d.compartments||'').trim();if(raw){try{const rows=raw.split(/\n|;/).map(x=>x.trim()).filter(Boolean);item.compartments=rows.map(line=>{const parts=line.split(',').map(x=>Number(x.trim()));if(parts.length!==4||parts.some(n=>!Number.isInteger(n)))throw Error('Each compartment must contain four integers: x,y,width,height');const [x,y,w,h]=parts;if(x<0||y<0||w<1||h<1||x+w>item.storageW||y+h>item.storageH)throw Error('Compartment is outside the storage grid');return {x,y,w,h}});const occupied=new Set();for(const c of item.compartments)for(let yy=c.y;yy<c.y+c.h;yy++)for(let xx=c.x;xx<c.x+c.w;xx++){const k=xx+','+yy;if(occupied.has(k))throw Error('Compartments cannot overlap');occupied.add(k)}}catch(err){alert('Invalid compartments: '+err.message);return}}}if(hasStorage(item)&&(!editingTemplate)&&(!Number(d.storageW)||!Number(d.storageH))){notice('Container grid dimensions are required.');return}if(editingTemplate){const old=template(editingTemplate);if(!old)return;item.id=old.id;item.storageW=old.storageW??4;item.storageH=old.storageH??2;item.armorStorage=old.armorStorage??false;item.compartments=clone(old.compartments||[]);Object.assign(old,item);for(const copy of state.items.filter(i=>i.templateId===old.id)){const fields=['name','category','weight','value','description','image','tier','behavior','gurps','armorStorage','stackSize','durabilityMax','hpHeal','bleedHeal','radHeal','clearStatus','magFamilies','magFamily','magAppearance','appearanceVariants','integralFeed'];for(const k of fields)copy[k]=item[k]}selectedTemplate=old.id}else{state.catalog.push(item);selectedTemplate=item.id}save();render();e.target.reset();document.getElementById('itemDialog').close();notice((editingTemplate?'Updated':'Created')+' item template: '+item.name);editingTemplate=null};document.getElementById('export').onclick=()=>download('stalker-gurps-save.json',JSON.stringify(state,null,2));document.getElementById('import').onclick=()=>document.getElementById('fileInput').click();document.getElementById('fileInput').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.items)||!Array.isArray(data.catalog)||!data.slots||!data.identity||!data.stats||!data.conditions)throw Error('Invalid save structure');state=data;for(const t of state.catalog){t.tier=normalizeTier(t.tier);if(['Vest','Backpack'].includes(t.category)||t.category==='Armor'&&t.armorStorage===true){t.storageW=t.storageW||4;t.storageH=t.storageH||2;t.compartments=t.compartments||[]}}for(const i of state.items){if(i.location==='grid')i.location='loose';if(['Vest','Backpack'].includes(i.category)||i.category==='Armor'&&i.armorStorage===true){i.storageW=i.storageW||4;i.storageH=i.storageH||2;i.compartments=i.compartments||[]}}ensureAkm();ensureExampleGear();ensureTier1Catalog();selected=null;save();renderCharacter();render();notice('Save imported.')}catch(err){alert('Could not import save: '+err.message)}e.target.value=''};document.getElementById('reset').onclick=()=>{if(confirm('Erase this character and all custom items? Export first if you want a backup.')){state=clone(DEFAULT);ensureAkm();ensureExampleGear();ensureTier1Catalog();selected=null;save();renderCharacter();render();notice('Reset complete.')}};

const actionConfigDialog=document.getElementById('actionConfigDialog');
document.getElementById('configureActions').addEventListener('click',()=>{const cfg=state.actionConfig||{};const f=actionConfigDialog.querySelector('form');for(const k of ['attackSkill','attackModifier','restFP','restHP'])f.elements[k].value=cfg[k]??({attackSkill:12,attackModifier:0,restFP:1,restHP:0}[k]);actionConfigDialog.showModal()});
document.getElementById('saveActionConfig').addEventListener('click',()=>{const f=actionConfigDialog.querySelector('form');const cfg={};for(const k of ['attackSkill','attackModifier','restFP','restHP']){const n=Number(f.elements[k].value);if(!Number.isFinite(n)){notice('Invalid action configuration.');return}cfg[k]=n}state.actionConfig=cfg;save();actionConfigDialog.close();notice('Action settings saved.')});

installEnhancements();
/* Assisted GURPS 4e combat. Rules not automated are explicitly flagged for the GM. */
const ADV_LOCATIONS=['Torso','Vitals','Skull','Face','Arm','Leg','Hand','Foot'];
const ADV_POSTURE_DEF={Standing:0,Crouching:0,Kneeling:-2,Prone:-3,Sitting:-2,Crawling:-3};
const ADV_POSTURE_TARGET={Standing:0,Crouching:-2,Kneeling:-2,Prone:-2,Sitting:-2,Crawling:-2};
const ADV_RANGED_MANEUVERS=['Attack','All-Out Attack (Determined)','All-Out Attack (Strong)','Move and Attack'];
function advEl(id){return document.getElementById(id)}
function advNumber(id,def=0){const n=Number(advEl(id)?.value);return Number.isFinite(n)?n:def}
function advSet(id,value){const node=advEl(id);if(node)node.value=String(value)}
function advCombat(){if(!state.advancedCombat||typeof state.advancedCombat!=='object')state.advancedCombat={round:1,actor:'Player',target:{stunned:false,unconscious:false,dead:false,crippled:[],wounds:[],shock:0,deathChecks:[],notes:[]},aimTurns:0,playerShock:0};
 const c=state.advancedCombat;c.target=c.target||{};c.target.crippled=c.target.crippled||[];c.target.wounds=c.target.wounds||[];c.target.deathChecks=c.target.deathChecks||[];c.target.notes=c.target.notes||[];return c}
function advArmorDR(location){const name=advEl('combatArmorLocation')?.value;const loc=name&&name!=='auto'?name:location;const entry=advEl('advDR'+loc);const base=Math.max(0,advNumber('targetDR'));return entry?.value?.trim()!==''?Math.max(0,Number(entry.value)||0):base}
function advAmmoSpecial(w){const override=advEl('combatAmmoEffect').value;if(override!=='auto')return override;const mag=w?weaponMagazine(w):null;const loaded=String(mag?.loadedAmmoType||w?.loadedAmmoType||'').toLowerCase();return /\b(hp|hollow|expanding)\b/.test(loaded)?'hp':/\b(ap|armor.piercing|armour.piercing)\b/.test(loaded)?'ap':'standard'}
function advDamageRoll(raw,dr,location,w){const r=rollExpression(raw);const type=(r.type.match(/(pi\+\+|pi\+|pi-|pi|cut|imp|burn|cr|tox|fat)/i)||[])[1]||'cr';const special=advAmmoSpecial(w);const override=advEl('combatArmorDivisor')?.value||'auto';const inline=String(raw).match(/\((0\.5|1|2|3|5|10|100)\)/);const divisor=override!=='auto'?Number(override):inline?Number(inline[1]):special==='ap'?2:special==='hp'?0.5:1;
 // Campaign-only HP modifier: +1 piercing category, with reduced penetration (armor divisor 0.5).
 const piercing=['pi-','pi','pi+','pi++'];let effectiveType=type.toLowerCase();if(special==='hp'&&piercing.includes(effectiveType))effectiveType=piercing[Math.min(3,piercing.indexOf(effectiveType)+1)];
 const baseDR=Math.max(0,Number(dr)||0);const effectiveDR=Math.floor(baseDR/divisor)+(location==='Skull'?2:0);const penetrating=Math.max(0,r.total-effectiveDR);
 let multiplier={'pi-':.5,pi:1,'pi+':1.5,'pi++':2,cut:1.5,imp:2,burn:1,cr:1,tox:1,fat:1}[effectiveType]??1;
 if(location==='Vitals'&&['pi-','pi','pi+','pi++','imp'].includes(effectiveType))multiplier=3;
 if(location==='Skull'&&penetrating>0)multiplier=4;
 if(['Arm','Leg'].includes(location)&&['imp','pi++'].includes(effectiveType))multiplier=1;
 let injury=penetrating>0?Math.max(1,Math.floor(penetrating*multiplier)):0;
 const maxHP=Math.max(1,advNumber('targetMaxHP',10));let crippled=false;
 if(['Arm','Leg','Hand','Foot'].includes(location)){
  const limit=['Hand','Foot'].includes(location)?Math.floor(maxHP/3)+1:Math.floor(maxHP/2)+1;
  if(injury>=limit){crippled=true;injury=Math.min(injury,limit)}
 }
 const dt=window.STALKER_EXT?.dtEnabled?.()?Math.max(0,advNumber('targetDT')):0;
 if(penetrating<=dt&&dt>0){injury=0;crippled=false;}
 return {roll:r,baseDR,effectiveDR,divisor,penetrating,dt,injury,type:effectiveType,crippled,special};}
function advModifiers(w){const maneuver=advEl('combatManeuver').value,posture=advEl('combatTargetPosture').value;
 const targetSpeed=Math.max(0,advNumber('combatTargetSpeed')),range=Math.max(0,advNumber('combatRange'));const rangePenalty=rangeModifier(range+targetSpeed);
 const shotsRequested=Math.max(1,Math.floor(advNumber('combatShots',1)));const shots=w?Math.min(shotsRequested,weaponRof(w),roundsInWeapon(w)):1;
 const aim=Math.max(0,Math.floor(advNumber('combatAim'))),acc=w?(window.STALKER_EXT?.weaponStat?.(w,'acc')??(Number(w.gurps?.acc)||0)):0;
 const aimBonus=aim>0?acc+Math.min(2,aim-1):0;const hitLoc=advEl('combatLocation').value;
 const posturePenalty=['Torso','Vitals','Leg','Foot'].includes(hitLoc)?ADV_POSTURE_TARGET[posture]??0:0;
 const maneuverBonus=maneuver==='All-Out Attack (Determined)'?1:0;
 const movePenalty=maneuver==='Move and Attack'?-2:0;
 const aimApplied=maneuver==='Move and Attack'?0:aimBonus;
 const vis=Math.max(-10,Math.min(0,advNumber('combatVisibility')));
 const cover=advNumber('combatCover');const other=advNumber('combatModifier');const skill=advNumber('combatSkill',12);
 const locPen=HIT_LOCATION_PENALTIES[hitLoc]||0;
 const rf=rapidFireBonus(Math.max(1,shots));
 const shock=state.advancedCombat?.playerShock||0;
 const effective=skill+other+rangePenalty+locPen+aimApplied+rf+vis+cover+posturePenalty+maneuverBonus+movePenalty-shock;
 return {maneuver,posture,shots,shotsRequested,rangePenalty,aimApplied,rf,vis,cover,other,skill,locPen,posturePenalty,maneuverBonus,movePenalty,shock,effective,hitLoc};
}
function advPreview(){const e=advEl('combatModifiersPreview');if(!e)return;const w=byId(advEl('combatWeapon')?.value),m=advModifiers(w);
 e.textContent=`Effective attack skill ${m.effective} · range/speed ${m.rangePenalty} · hit location ${m.locPen} · aim +${m.aimApplied} · rapid fire +${m.rf} · visibility ${m.vis} · cover ${m.cover} · posture ${m.posturePenalty} · maneuver ${m.maneuverBonus+m.movePenalty} · shock −${m.shock}.`;
}
function advRenderTarget(){const c=advCombat(),t=c.target;advEl('combatRoundLabel').textContent=`ROUND ${c.round} · ${c.actor.toUpperCase()} TURN`;
 advEl('advancedTargetOverview').replaceChildren();const hp=advNumber('targetHP',10),max=advNumber('targetMaxHP',10);
 for(const val of [`HP ${hp} / ${max}`,`HT ${advNumber('combatTargetHT',10)}`,t.stunned?'STUNNED':'Not stunned',t.unconscious?'UNCONSCIOUS':'Conscious',t.dead?'DEAD':'Alive',t.shock?'Shock −'+t.shock:'No shock',t.bleeding?'Bleeding '+t.bleeding:'No bleeding']){const el=document.createElement('span');el.textContent=val;advEl('advancedTargetOverview').append(el)}
 const out=advEl('advancedTargetWounds');out.replaceChildren();for(const wound of t.wounds.slice(0,25)){const row=document.createElement('div');row.textContent=`Round ${wound.round} · ${wound.location}: ${wound.injury} injury (${wound.type})${wound.crippled?' · CRIPPLED':''}${wound.major?' · major wound':''}`;out.append(row)}if(!out.children.length)out.textContent='No recorded target wounds.';
 advPreview();}
function advCheckConsciousness(tag){const c=advCombat(),t=c.target,ht=Math.max(3,advNumber('combatTargetHT',10)),hp=advNumber('targetHP'),max=Math.max(1,advNumber('targetMaxHP',10));if(t.dead)return `${tag}: target is dead.`;
 if(hp>0)return `${tag}: HP above zero; consciousness check not required.`;
 const r=roll3d6(ht,tag);if(!r.success)t.unconscious=true;return `${tag}: ${r.total} vs HT ${ht} → ${r.result}${!r.success?' · UNCONSCIOUS':''}`;
}
function advRollDeathChecks(before,after){const c=advCombat(),t=c.target,ht=Math.max(3,advNumber('combatTargetHT',10)),max=Math.max(1,advNumber('targetMaxHP',10)),notes=[];
 if(after<=-5*max){t.dead=true;notes.push('Automatic death at −5×HP.');return notes}
 for(let threshold=1;threshold<=4;threshold++){
  const crossing=-threshold*max;
  if(before>crossing&&after<=crossing&&!t.deathChecks.includes(threshold)){
   t.deathChecks.push(threshold);const r=roll3d6(ht,`Death check −${threshold}×HP`);
   if(!r.success)t.dead=true;
   notes.push(`Death check −${threshold}×HP: ${r.total} vs HT ${ht} → ${r.result}${!r.success?' (DEAD)':''}`);
  }
 }return notes;
}
function advInjuryEffects(before,damage,location,type,crippled){const c=advCombat(),t=c.target,max=Math.max(1,advNumber('targetMaxHP',10));const notes=[];const after=before-damage;
 t.shock=Math.max(t.shock,Math.min(4,damage));
 const major=damage>max/2||crippled;
 if(crippled&&!t.crippled.includes(location))t.crippled.push(location);
 t.wounds.unshift({id:uid(),round:c.round,location,injury:damage,type,major,crippled});t.wounds=t.wounds.slice(0,100);
 if(major){const ht=advNumber('combatTargetHT',10);const modifier=location==='Face'||location==='Vitals'?-5:location==='Skull'?-10:0;
  const roll=roll3d6(ht+modifier,'Major wound: knockdown/stun');notes.push(`Knockdown/stun HT ${ht+modifier}: ${roll.total} → ${roll.result}`);
  if(!roll.success){t.stunned=true;if(roll.margin<=-5||roll.criticalFailure)t.unconscious=true;notes.push(t.unconscious?'Target knocked unconscious.':'Target stunned and knocked down.');advSet('combatTargetPosture','Prone')}
 }
 if(crippled)notes.push(`${location} crippled; subsequent effects require GM adjudication.`);
 if(after<=max/3&&before>max/3)notes.push('HP ≤ 1/3: reduced Move/Dodge.');
 if(after<=0&&before>0)notes.push('HP ≤ 0: roll HT for consciousness each turn.');
 notes.push(...advRollDeathChecks(before,after));
 return notes;
}
function advDefense(hits,w,critical){const mode=advEl('targetDefense').value;if(mode==='none'||critical||hits<=0)return {hits,detail:critical?'Critical hit: no normal active defense.':'No active defense.'};
 const t=advCombat().target;if(t.unconscious||t.dead)return {hits,detail:'Target unable to defend.'};
 const base=advNumber('target'+mode[0].toUpperCase()+mode.slice(1),8),special=advEl('combatRetreat').value;
 const retreat=special==='retreat'?(mode==='dodge'?3:1):special==='aod'?2:0;
 const stunned=t.stunned?-4:0;const posture=ADV_POSTURE_DEF[advEl('combatTargetPosture').value]||0;
 const injured=advNumber('targetHP')<=advNumber('targetMaxHP')/3?-Math.ceil(base/2):0; // target threshold: Dodge/movement only, not Parry/Block
 const halving=mode==='dodge'?injured:0;
 const effective=Math.max(3,base+retreat+stunned+posture+halving);
 const roll=roll3d6(effective,'Target '+mode+' defense');
 const mitigated=roll.success?Math.min(hits,1+Math.floor(Math.max(0,roll.margin)/Math.max(1,Number(w?.gurps?.rcl)||2))):0;
 return {hits:hits-mitigated,detail:`${mode.toUpperCase()}: ${roll.total} vs ${effective} → ${roll.result}; avoided ${mitigated} hit(s) of ${hits}${retreat?' · defense bonus +'+retreat:''}.`};
}
function advCriticalFailure(w){const roll=d6()+d6()+d6();let note=`Critical failure: 3d6 = ${roll}. GM should apply the appropriate GURPS critical miss result.`;
 // In the absence of item-specific malfunction rules, NEVER auto-jam every gun on every critical failure.
 if(w){w.criticalMissPending=true;note+=' Weapon marked for GM critical-miss review (not automatically jammed).'}return note;
}
function advAttack(){const c=advCombat(),weapon=byId(advEl('combatWeapon').value),m=advModifiers(weapon),t=c.target;
 if(c.actedThisTurn)return notice('Attack already resolved this turn. Select End Turn to continue.');
 if(state.statusFlags?.Unconscious||state.statusFlags?.Dead)return notice('This character cannot attack while unconscious or dead.');
 if(state.statusFlags?.Stunned)return notice('Character is stunned. Resolve recovery before attacking.');
 if(t.dead)return notice('The target is dead. Reset or choose a new target.');
 if(c.actor!=='Player')return notice('It is the target turn. End Turn to return to the player.');
 if(!ADV_RANGED_MANEUVERS.includes(m.maneuver))return notice('Choose Attack, All-Out Attack or Move and Attack to make an attack; other maneuvers use End Turn.');
 if(!Number.isInteger(m.skill)||m.skill<3||m.skill>30||m.shotsRequested<1||m.shotsRequested>100||m.shotsRequested!==Math.floor(m.shotsRequested))return notice('Check skill and shot count.');
 if(weapon&&m.shots<1)return notice('Weapon is empty or not ready. Load ammunition first.');
 const loadedMag=weapon?weaponMagazine(weapon):null;const ammoEntry=state.catalog.find(a=>a.id===loadedMag?.loadedAmmoTemplateId)||state.catalog.find(a=>a.category==='Ammo'&&a.name===loadedMag?.loadedAmmoType);const raw=String(ammoEntry?.gurps?.damage||(weapon&&window.STALKER_EXT?.weaponDamage?.(weapon))||weapon?.gurps?.damage||advEl('combatDamage').value||'1d-2 cr');
 try{rollExpressionCheck(raw)}catch(e){return notice('Damage expression invalid: '+e.message)}
 if(weapon){const mag=weaponMagazine(weapon);if(mag&&!magAmmoFitsWeapon(mag,weapon))return notice('Incompatible ammo loaded: unload before firing.');if(weapon.malfunctionPending)return notice('Weapon malfunction: resolve it before firing.');if(mag)mag.loadedRounds=Math.max(0,Number(mag.loadedRounds)-m.shots);else weapon.loadedRounds=Math.max(0,Number(weapon.loadedRounds)-m.shots)}
 const roll=roll3d6(m.effective,`${weapon?.name||'Unarmed'} attack`);
 const rcl=Math.max(1,Number((weapon&&window.STALKER_EXT?.weaponStat?.(weapon,'rcl'))??weapon?.gurps?.rcl)||2);
 let hits=roll.success?Math.min(m.shots,1+Math.floor(Math.max(0,roll.margin)/rcl)):0;
 let details=[`${weapon?.name||'Unarmed'} · ${m.maneuver} · ${m.hitLoc} · Round ${c.round}`,`Attack ${roll.dice.join('+')} = ${roll.total} vs ${m.effective} → ${roll.result}. Shots: ${m.shots}; hits before defense: ${hits}.`];
 if(roll.criticalFailure)details.push(advCriticalFailure(weapon));
 if(roll.criticalSuccess)details.push('Critical hit: roll on the appropriate critical-hit table (GM adjudicates additional effects).');
 const defense=advDefense(hits,weapon,roll.criticalSuccess);hits=defense.hits;details.push(defense.detail);
 let total=0;
 if(hits){const dr=advArmorDR(m.hitLoc);details.push(`Armor: location ${advEl('combatArmorLocation').value==='auto'?m.hitLoc:advEl('combatArmorLocation').value} · DR ${dr}.`);
  for(let j=0;j<hits;j++){
   const dmg=advDamageRoll(raw,dr,m.hitLoc,weapon),before=advNumber('targetHP',10);total+=dmg.injury;
   let text=`Hit ${j+1}: ${dmg.roll.total} ${dmg.type} (rolled ${dmg.roll.dice.join('+')}) − DR ${dmg.effectiveDR} (÷${dmg.divisor}) = ${dmg.penetrating} penetration → ${dmg.injury} HP injury.`;
   if(dmg.special==='hp'||dmg.special==='ap')text+=` ${dmg.special.toUpperCase()} campaign modifier applied.`;
   details.push(text);
   if(dmg.injury>0)details.push('GM must apply injury manually; target HP unchanged.');
  }
 }
 if(!hits)details.push('No injury: attack missed or was defended.');
 state.combatReview=state.combatReview||[];
 state.combatReview.unshift({id:uid(),at:new Date().toISOString(),kind:'player',actor:state.identity?.Name||'Player',target:'GM target',weapon:weapon?.name||'Unarmed',shots:m.shots,location:m.hitLoc,roll:roll.total,effectiveSkill:m.effective,injury:total,status:'Calculated',detail:details.join('\n')});
 state.combatReview=state.combatReview.slice(0,200);
 if(weapon){weapon.lastFiredRound=c.round}
 c.actedThisTurn=true;
 advSet('combatAim',0); // Aiming bonus expires after the attack.
 c.playerShock=0;
 state.targetHP=advNumber('targetHP');state.targetMaxHP=advNumber('targetMaxHP',10);c.targetHT=advNumber('combatTargetHT',10);
 lastCombatResult=details.join('\n');advEl('combatResult').textContent=lastCombatResult;
 addDiceHistory('Advanced combat',`${weapon?.name||'Unarmed'} · ${roll.result} · ${hits} final hit(s) · ${total} HP injury · target HP ${state.targetHP}`);
 save();renderAmmo();renderSelectedItem();advRenderTarget();notice(`Combat: ${roll.result} · ${hits} hit(s) · ${total} calculated injury; GM review pending.`);
}
function rollExpressionCheck(raw){if(!/^\s*\d{1,2}d(?:6)?\s*(?:[+-]\s*\d{1,3})?\s*[\w+\-(). ]*$/i.test(raw))throw Error('Use a dice expression such as 5d+1 pi.');}
function advEndTurn(){const c=advCombat(),current=c.actor;
 if(current==='Player')c.actor='Target';else{c.actor='Player';c.round+=1;c.playerShock=0;c.target.shock=0}
 c.actedThisTurn=false;
 if(current==='Player'&&state.statusFlags?.Stunned&&!state.statusFlags?.Unconscious){const r=roll3d6(Number(state.stats.HT)||10,'Player end-turn stun recovery');if(r.success)state.statusFlags.Stunned=false}
 if(current==='Player'&&Number(state.conditions.Health)<=0&&!state.statusFlags?.Unconscious&&!state.statusFlags?.Dead){const r=roll3d6(Number(state.stats.HT)||10,'Player end-turn consciousness');if(!r.success)state.statusFlags.Unconscious=true}
 if(current==='Target'&&c.target.stunned&&!c.target.unconscious){const r=roll3d6(advNumber('combatTargetHT',10),'Recover from stun (turn end)');if(r.success)c.target.stunned=false}
 if(current==='Target'&&advNumber('targetHP')<=0&&!c.target.unconscious&&!c.target.dead){const msg=advCheckConsciousness('Zero HP turn check');advEl('combatResult').textContent=msg;lastCombatResult=msg}
 save();renderStatus();advRenderTarget();}
function advRestoreTarget(){const c=advCombat();c.target={stunned:false,unconscious:false,dead:false,crippled:[],wounds:[],shock:0,deathChecks:[],notes:[]};save();advRenderTarget()}
function advRecover(){const c=advCombat();if(!c.target.stunned)return notice('Target is not stunned.');const r=roll3d6(advNumber('combatTargetHT',10),'HT recover from stun');if(r.success)c.target.stunned=false;advEl('combatResult').textContent=`Recover from stun: ${r.total} vs HT ${r.target} → ${r.result}`;save();advRenderTarget()}
function advResolveTurnManeuver(){const c=advCombat(),man=advEl('combatManeuver').value;
 if(c.actedThisTurn){advEndTurn();return;}
 if(man==='Aim'&&c.actor==='Player'){
  advSet('combatAim',Math.min(3,advNumber('combatAim')+1));notice('Aim accumulated. Weapon Acc will apply to the next attack.');
 }else if(man==='Ready'){notice('Ready/reload: use Ammo & Magazines for physical loading. Turn advanced.');}
 else if(man==='Change Posture'){notice('Change posture using the posture buttons on the inventory page. Turn advanced.');}
 if(man!=='Aim'&&man!=='Evaluate')advSet('combatAim',0);advEndTurn();}
function advInit(){const armor=advEl('advancedArmorInputs');if(!armor)return;
 for(const loc of ADV_LOCATIONS){const label=document.createElement('label');label.textContent=loc;const field=document.createElement('input');field.id='advDR'+loc;field.type='number';field.min=0;field.max=1000;field.placeholder='Use base DR';field.value=String(advCombat().drByLocation?.[loc]??'');field.addEventListener('change',()=>{const v=field.value.trim();const c=advCombat();c.drByLocation=c.drByLocation||{};if(v==='')delete c.drByLocation[loc];else c.drByLocation[loc]=Math.max(0,Number(v)||0);save();advPreview()});label.append(field);armor.append(label)}
 for(const id of ['combatManeuver','combatTargetPosture','combatTargetSpeed','combatVisibility','combatCover','combatArmorLocation','combatArmorDivisor','combatTargetHT','combatRetreat','combatAmmoEffect','combatWeapon','combatRange','combatAim','combatShots','combatLocation','combatModifier','combatSkill','targetDR'])advEl(id)?.addEventListener('input',advPreview);
 advEl('performAttack').addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();advAttack()},true);
 advEl('rollDefense').addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();const d=advDefense(1,byId(advEl('combatWeapon').value),false);lastCombatResult=d.detail;advEl('combatResult').textContent=d.detail;save();advRenderTarget()},true);
 advEl('resetCombatTarget').addEventListener('click',()=>{advRestoreTarget()},false);
 advEl('advanceCombatTurn').addEventListener('click',advResolveTurnManeuver);
 advEl('resetCombatRounds').addEventListener('click',()=>{const c=advCombat();c.round=1;c.actor='Player';c.playerShock=0;c.actedThisTurn=false;advSet('combatAim',0);save();advRenderTarget()});
 advEl('advancedRollRecovery').addEventListener('click',advRecover);
 advEl('advancedConsciousness').addEventListener('click',()=>{const msg=advCheckConsciousness('Consciousness check');advEl('combatResult').textContent=msg;save();advRenderTarget()});
 advEl('advancedClearTarget').addEventListener('click',advRestoreTarget);
 advEl('combatManeuver').addEventListener('change',()=>{const m=advEl('combatManeuver').value;advEl('performAttack').disabled=!ADV_RANGED_MANEUVERS.includes(m);advEl('performAttack').textContent=ADV_RANGED_MANEUVERS.includes(m)?'Roll Attack & Resolve':'Select an attack maneuver';advPreview()});
 advEl('targetHP').addEventListener('change',advRenderTarget);advEl('targetMaxHP').addEventListener('change',advRenderTarget);
 const clear=document.createElement('button');clear.type='button';clear.id='advClearJam';clear.textContent='Clear Jam / GM Resolve';clear.addEventListener('click',()=>{const w=byId(advEl('combatWeapon').value);if(!w)return notice('Select a weapon.');w.malfunctionPending=false;w.criticalMissPending=false;save();renderCombat();notice(`GM cleared weapon malfunction/critical-miss review for ${w.name}.`)});advEl('advancedTargetPanel').querySelector('.combat-tool-strip').append(clear);
 advSet('combatTargetHT',advCombat().targetHT||10);advRenderTarget();
}
advInit();
if(!STATUS_FLAGS.includes('Dead'))STATUS_FLAGS.push('Dead');
/* NPC attacks and player injury integration */
function advPlayerArmor(location){const entered=advEl('playerDROverride').value.trim();if(entered!=='')return Math.max(0,Number(entered)||0);if(window.STALKER_EXT?.armorFor)return window.STALKER_EXT.armorFor(state,location,'front').dr;
 const items=[state.slots.armor,state.slots.vest,state.slots.helmet,state.slots.mask].map(byId).filter(Boolean);
 let total=0;for(const i of items){
  const loc=location==='Skull'?'head':location==='Face'?'face':location==='Torso'||location==='Vitals'?'torso':'limb';
  const covers=i.category==='Helmet'&&loc==='head'||i.category==='Mask'&&loc==='face'||['Vest','Armor'].includes(i.category)&&loc==='torso';
  if(covers)total+=Math.max(0,Number(i.gurps?.dr)||0)
 }return total;
}
function advNPCDamage(raw,dr,location){const roll=rollExpression(raw);const type=(raw.toLowerCase().match(/(pi\+\+|pi\+|pi-|pi|cut|imp|burn|cr|tox|fat)/)||[])[1]||'cr';
 const num=String(raw).match(/\((0\.5|1|2|3|5|10)\)/);const divisor=num?Number(num[1]):1;
 const effectiveDR=Math.floor(Math.max(0,dr)/divisor)+(location==='Skull'?2:0),pen=Math.max(0,roll.total-effectiveDR);
 let mult={'pi-':.5,pi:1,'pi+':1.5,'pi++':2,cut:1.5,imp:2,burn:1,cr:1,tox:1,fat:1}[type]??1;
 if(location==='Vitals'&&['pi-','pi','pi+','pi++','imp'].includes(type))mult=3;
 if(location==='Skull'&&pen>0)mult=4;
 if(['Arm','Leg'].includes(location)&&['imp','pi++'].includes(type))mult=1;
 let injury=pen>0?Math.max(1,Math.floor(pen*mult)):0;
 const hp=Math.max(1,Number(state.stats.HP)||10);const crippleLimit=['Hand','Foot'].includes(location)?Math.floor(hp/3)+1:['Arm','Leg'].includes(location)?Math.floor(hp/2)+1:null;
 const crippled=crippleLimit!==null&&injury>=crippleLimit;
 if(crippled)injury=Math.min(injury,crippleLimit);
 return {roll,type,effectiveDR,pen,injury,crippled};
}
function advApplyPlayerDamage(hit,location){const c=advCombat(),max=Math.max(1,Number(state.stats.HP)||10),ht=Number(state.stats.HT)||10;
 const before=Number(state.conditions.Health??max),after=before-hit.injury;
 state.conditions.Health=after;
 state.wounds=state.wounds||[];
 const major=hit.injury>max/2||hit.crippled;
 state.wounds.unshift({id:uid(),location,hpLoss:hit.injury,note:`Combat round ${c.round}: ${hit.type}${major?' · major wound':''}${hit.crippled?' · crippled':''}`,at:new Date().toLocaleTimeString()});
 c.playerShock=Math.max(c.playerShock,Math.min(4,hit.injury));
 const notes=[];if(hit.crippled){state.statusFlags['Crippled limb']=true;notes.push(`${location} crippled.`)}
 if(major){const mod=location==='Face'||location==='Vitals'?-5:location==='Skull'?-10:0;const roll=roll3d6(ht+mod,'Player knockdown/stun');
  notes.push(`Player major wound HT ${ht+mod}: rolled ${roll.total} → ${roll.result}`);
  if(!roll.success){state.statusFlags.Stunned=true;state.posture='Prone';notes.push('Stunned, knocked down (prone).');if(roll.margin<=-5||roll.criticalFailure){state.statusFlags.Unconscious=true;notes.push('Unconscious.')}}
 }
 if(after<=0&&before>0)notes.push('HP at/below 0: HT consciousness check each turn.');
 c.playerDeathChecks=c.playerDeathChecks||[];
 for(let mark=1;mark<=4;mark++)if(before>-mark*max&&after<=-mark*max&&!c.playerDeathChecks.includes(mark)){
  c.playerDeathChecks.push(mark);const roll=roll3d6(ht,`Player death check −${mark}×HP`);
  notes.push(`Death check −${mark}×HP: ${roll.total} vs ${ht} → ${roll.result}${!roll.success?' · fatal unless GM intervention':''}`);
  if(!roll.success){state.statusFlags.Unconscious=true;state.statusFlags.Dead=true;}
 }
 if(after<=-5*max){state.statusFlags.Dead=true;notes.push('Automatic death threshold −5×HP reached.');}
 return notes;
}
function advNPCDefense(hits,rcl){const mode=advEl('playerDefense').value;if(hits<=0)return {hits:0,detail:'Attack missed; no defense needed.'};if(mode==='none')return {hits,detail:'Player elected no defense.'};
 if(state.statusFlags?.Unconscious)return {hits,detail:'Player unconscious and unable to defend.'};
 const basic=mode==='dodge'?(Number(state.stats.Dodge)||8)-encumbrance().dodgePenalty:advNumber('playerManualDefense',9);
 const posture=ADV_POSTURE_DEF[state.posture]||0,stun=state.statusFlags?.Stunned?-4:0;
 const injury=mode==='dodge'&&Number(state.conditions.Health)<=Number(state.stats.HP)/3?-Math.floor(basic/2):0;
 const skill=Math.max(3,basic+posture+stun+injury);const roll=roll3d6(skill,`Player ${mode}`);
 const avoided=roll.success?Math.min(hits,1+Math.floor(Math.max(0,roll.margin)/rcl)):0;
 return {hits:hits-avoided,detail:`Player ${mode}: ${roll.total} vs ${skill} (${roll.result}); avoided ${avoided}/${hits} hit(s).`};
}
function advNPCAttack(){const c=advCombat();if(c.actor!=='Target')return notice('Advance to TARGET TURN before the NPC attacks.');if(c.actedThisTurn)return notice('NPC has already attacked this turn. End Turn to continue.');if(c.target.dead||c.target.unconscious||c.target.stunned)return notice('The target cannot attack while dead, unconscious, or stunned.');
 const skill=advNumber('npcAttackSkill',12),shots=advNumber('npcShots',1),rcl=Math.max(1,advNumber('npcRcl',2)),location=advEl('npcHitLocation').value,raw=advEl('npcAttackDamage').value;
 if(!Number.isInteger(skill)||skill<3||skill>30||!Number.isInteger(shots)||shots<1||shots>100)return notice('NPC skill 3–30 and shots 1–100 required.');
 try{rollExpressionCheck(raw)}catch(e){return notice(e.message)}
 const effective=skill+advNumber('npcAttackModifier')+rapidFireBonus(shots)-Math.max(0,c.target.shock||0)+(HIT_LOCATION_PENALTIES[location]||0);
 const attack=roll3d6(effective,'NPC attack'),initial=attack.success?Math.min(shots,1+Math.floor(Math.max(0,attack.margin)/rcl)):0;
 const defense=attack.criticalSuccess?{hits:initial,detail:'NPC critical hit: normal defense unavailable.'}:advNPCDefense(initial,rcl);
 const details=[`NPC attacks player · Round ${c.round} · ${location}`,`Attack ${attack.total} vs ${effective}: ${attack.result}; ${initial} hit(s) before defense.`,defense.detail];
 if(attack.criticalFailure)details.push('NPC critical failure: GM to resolve mishap.');
 if(attack.criticalSuccess)details.push('NPC critical success: GM to resolve critical hit table.');
 const dr=advPlayerArmor(location);let injury=0;
 for(let n=0;n<defense.hits;n++){
  const hit=advNPCDamage(raw,dr,location);injury+=hit.injury;
  details.push(`Hit ${n+1}: ${hit.roll.total} ${hit.type}, effective DR ${hit.effectiveDR}, penetration ${hit.pen} → ${hit.injury} HP.`);
  if(hit.injury>0)details.push('Calculated only — player HP is unchanged until manually recorded.');
 }
 if(defense.hits===0)details.push('No player injury.');
 details.push(`Player HP unchanged: ${state.conditions.Health} / ${state.stats.HP} · Armor DR ${dr}.`);
 state.combatReview=state.combatReview||[];
 state.combatReview.unshift({id:uid(),at:new Date().toISOString(),kind:'npc',actor:'NPC (manual)',target:state.identity?.Name||'Player',location,injury,status:'Calculated',detail:details.join('\n')});
 state.combatReview=state.combatReview.slice(0,200);
 c.actedThisTurn=true;
 lastCombatResult=details.join('\n');advEl('combatResult').textContent=lastCombatResult;
 addDiceHistory('NPC attack',`${attack.result}, ${defense.hits} hits, ${injury} HP injury to player`);
 save();renderCharacter();renderStatus();renderInjuries();advRenderTarget();notice(`NPC attack calculated: ${injury} HP. Player must record authorized HP changes.`)
}
function advPlayerRecovery(){if(!state.statusFlags?.Stunned)return notice('Player is not stunned.');const roll=roll3d6(Number(state.stats.HT)||10,'Player recover from stun');if(roll.success)state.statusFlags.Stunned=false;save();renderStatus();notice(`Player stun recovery: ${roll.result}`)}
advEl('performNpcAttack').addEventListener('click',advNPCAttack);
advEl('npcReloadHelp').addEventListener('click',()=>showInfo('NPC RELOAD','Select the Ready maneuver and advance the NPC turn. NPC ammunition is currently represented by the GM; use a full weapon inventory for detailed magazine tracking.'));
const recover=document.createElement('button');recover.type='button';recover.textContent='Player HT: Recover Stun';recover.addEventListener('click',advPlayerRecovery);advEl('npcAttackPanel').querySelector('.combat-tool-strip').append(recover);

/* Profile-local advanced combat control values. */
const ADV_SETTING_IDS=['combatManeuver','combatTargetPosture','combatTargetSpeed','combatVisibility','combatCover','combatArmorLocation','combatArmorDivisor','combatTargetHT','combatRetreat','combatAmmoEffect','combatRange','combatAim','combatShots','combatLocation','combatModifier','combatSkill','targetDR','targetDT','targetParry','targetBlock','targetDodge','targetDefense','npcAttackSkill','npcAttackDamage','npcShots','npcRcl','npcHitLocation','playerDefense','playerManualDefense','playerDROverride','npcAttackModifier'];
function advRememberFields(){const c=advCombat();c.settings=c.settings||{};for(const id of ADV_SETTING_IDS){const el=advEl(id);if(el)c.settings[id]=el.value}save()}
function advRestoreFields(){const c=advCombat();for(const id of ADV_SETTING_IDS){const el=advEl(id);if(el&&c.settings&&Object.prototype.hasOwnProperty.call(c.settings,id))el.value=c.settings[id]}
 advSet('targetHP',state.targetHP??10);advSet('targetMaxHP',state.targetMaxHP??10);
 for(const loc of ADV_LOCATIONS)advSet('advDR'+loc,c.drByLocation?.[loc]??'');
 const man=advEl('combatManeuver');if(man)man.dispatchEvent(new Event('change'));
 advRenderTarget();}
for(const id of ADV_SETTING_IDS)advEl(id)?.addEventListener('change',advRememberFields);
advRestoreFields();
const advOriginalLoad=load;
load=function(){advOriginalLoad();const repaired=repairOrphanedMagazines();if(repaired)saveBase()};
repairOrphanedMagazines();
const advOldProfileSelect=selectProfile;
selectProfile=function(id){if(id===activeProfile)return;advOldProfileSelect(id);advRestoreFields();};
const advOldCreateProfile=createProfile;
createProfile=function(){const before=activeProfile;advOldCreateProfile();if(before!==activeProfile)advRestoreFields();};
const advOldDeleteProfile=deleteProfile;
deleteProfile=function(){const before=activeProfile;advOldDeleteProfile();if(before!==activeProfile)advRestoreFields();};

/* GM-assisted bleeding; no invented per-second damage. */
function advBleedingSide(){return advEl('advTreatSide').value}
function advBleedingValue(){const c=advCombat();return advBleedingSide()==='player'?Math.max(0,Number(state.conditions.Bleeding)||0):Math.max(0,Number(c.target.bleeding)||0)}
function advChangeBleeding(n){if(advBleedingSide()==='player')state.conditions.Bleeding=Math.max(0,n);else advCombat().target.bleeding=Math.max(0,n);save();renderStatus();advRenderTarget()}
function advBleedNotice(text){advEl('advBleedingStatus').textContent=text;addDiceHistory('Wound treatment',text)}
function advSetBleeding(){const n=Math.max(0,Math.floor(advNumber('advBleedSeverity',1)));advChangeBleeding(n);advBleedNotice(`${advBleedingSide()==='player'?'Player':'NPC'} bleeding severity set to ${n}.`)}
function advCheckBleeding(){const level=advBleedingValue();if(!level)return notice('No bleeding is currently recorded for that character.');const player=advBleedingSide()==='player';const ht=player?Number(state.stats.HT)||10:advNumber('combatTargetHT',10);
 const roll=roll3d6(ht-level,`${player?'Player':'NPC'} 1-minute bleeding check`);
 if(!roll.success){if(player){state.conditions.Health=Number(state.conditions.Health??state.stats.HP)-1;state.wounds.unshift({id:uid(),location:'Bleeding',hpLoss:1,note:'1-minute bleeding check',at:new Date().toLocaleTimeString()})}
 else{const prev=advNumber('targetHP');advSet('targetHP',prev-1);state.targetHP=prev-1;advCombat().target.wounds.unshift({id:uid(),round:advCombat().round,location:'Bleeding',injury:1,type:'bleeding',major:false,crippled:false});advRollDeathChecks(prev,prev-1)}
 }
 advBleedNotice(`${player?'Player':'NPC'} bleeding check: ${roll.total} vs HT ${ht-level} → ${roll.result}${roll.success?' · no HP lost':' · 1 HP lost'}. Optional campaign bleeding procedure.`);
 save();renderCharacter();renderStatus();renderInjuries();advRenderTarget()}
function advTreatBleeding(){const n=advBleedingValue();if(n<=0)return notice('No bleeding to treat.');const skill=advNumber('advFirstAidSkill',12);if(skill<3||skill>30)return notice('First Aid skill must be 3–30.');
 const roll=roll3d6(skill,`First Aid: ${advBleedingSide()}`);if(roll.success)advChangeBleeding(0);
 advBleedNotice(`First Aid ${roll.total} vs ${skill} → ${roll.result}. ${roll.success?'Bleeding stopped.':'Bleeding persists; GM determines time/material cost.'}`);
 save()}
advEl('advStartBleeding').addEventListener('click',advSetBleeding);
advEl('advBleedingMinute').addEventListener('click',advCheckBleeding);
advEl('advFirstAid').addEventListener('click',advTreatBleeding);

