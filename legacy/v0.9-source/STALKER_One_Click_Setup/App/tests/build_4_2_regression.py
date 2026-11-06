"""Offline structural regression checks for Build 4.2; not browser E2E."""
from pathlib import Path
from bs4 import BeautifulSoup
p=Path(__file__).resolve().parents[1]
s=BeautifulSoup((p/'index.html').read_text(encoding='utf-8'),'html.parser')
j=(p/'companion.js').read_text(encoding='utf-8')
for x in ['profileDialog','profileDeleteDialog','profileDialogForm','profileNameInput','profileDeleteConfirm','npcEquippedWeapon','npcGearAdd','npcGearDraft','gmAttackingNpc','gmTargetPlayer','gmLoadCombatants','selectedEncounterTarget']:
 assert s.find(id=x),f'UI control missing: {x}'
for form_id in ['encounterForm','npcForm']:
 f=s.find(id=form_id)
 assert f is not None and f.find('input',{'name':'name'}),f'{form_id} missing name'
assert s.find(id='encounterForm').find('input',{'name':'location'})
assert "encounterName.value.trim()" in j and "encounterLocation.value.trim()" in j
assert 'npcGearDraft=clone(npc.loadout||[])' in j
assert 'npcWeaponStats(templateNpc)' in j
assert "function loadWeaponViaContext" in j
assert "loadMagazine(mag.id)" in j
assert "profileDialog.showModal()" in j
assert "$('profileDeleteDialog').showModal()" in j
assert 'gmLoadCombatants' in j and 'gmAttackingNpc' in j and 'gmTargetPlayer' in j
assert "btn('Target NPC'" in j and "btn('NPC Attacks Player'" in j
assert "if(!record.name)return toast('Enter encounter name')" in j
print('Build 4.2 structural checks passed.')
