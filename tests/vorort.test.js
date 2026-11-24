// Run from the repo root: node --test tests/vorort.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../js/vorort.js');

test('voFolderTree: root and every folder below it', () => {
  const f = [{ id: 'a' }, { id: 'a1', parent_id: 'a' }, { id: 'a11', parent_id: 'a1' }, { id: 'b' }, { id: 'b1', parent_id: 'b' }];
  assert.deepEqual(V.voFolderTree(f, 'a').sort(), ['a', 'a1', 'a11']);
  assert.deepEqual(V.voFolderTree([], 'x'), ['x']);
});

test('voSortPlans: setup/plan names first, then by name', () => {
  const s = V.voSortPlans([{ name: 'Overview.pdf' }, { name: 'IPM_Setup_Foyer.pdf' }, { name: 'Anfahrt.jpg' }, { name: 'Aufbauplan.pdf' }]);
  assert.deepEqual(s.map(x => x.name), ['Aufbauplan.pdf', 'IPM_Setup_Foyer.pdf', 'Anfahrt.jpg', 'Overview.pdf']);
});

test('voPickFolder: real cases from the live data (24.–28.11.2026)', () => {
  const folders = ['Estrel Hagebau', 'Estrel IPM FBF', 'Estrel Breko', 'ASM Weihnachtsmarkt', 'Estrel PE26 Estrel Saal', 'Estrel PE26 Showtheater',
    'Estrel Siemens Betriebsräte', 'Spreeküche Rotes Rathaus'].map((name, i) => ({ id: 'f' + i, name }));
  const row = i => ({ folder_id: 'f' + i, folder: { name: folders[i].name } });
  const loc = t => t.split('\n');
  // Championsgala: only "Estrel" in common with the Siemens folder → no folder (was: Siemens plans)
  assert.equal(V.voPickFolder([row(3), row(6)], { venue: 'Estrel', title: '1600 Estrelhusse weiß + Armlehne', location: loc('Sonnenallee 225\n12057 Berlin\nCH I\nChampionsgala') }, folders), '');
  // Siemens job on the same day still finds its folder
  assert.equal(V.voPickFolder([row(3), row(6)], { venue: 'Estrel', title: '41 Tischdeko', location: loc('Sonnenallee 225\n12057 Berlin\nCH II\nSiemens Betriebsräte') }, folders), 'f6');
  // Foyer Estrel Saal → PE26 Estrel Saal (via "Saal"), not Showtheater or IPM
  assert.equal(V.voPickFolder([row(1), row(4), row(5), row(6)], { venue: 'Estrel', title: 'Autoscout24', location: loc('Sonnenallee 225\n12057 Berlin\nFoyer Estrel Saal\nAudi Partnerverband') }, folders), 'f4');
  // Client name as venue: ASM → ASM Weihnachtsmarkt
  assert.equal(V.voPickFolder([row(3), row(6)], { venue: 'ASM', title: '8 Stehtisch Berlin', location: loc('Goßlerstraße 3\n14195 Berlin') }, folders), 'f3');
  // Spreeküche
  assert.equal(V.voPickFolder([row(7), row(5)], { venue: 'Spreeküche', title: '25 Tafel eckig + Molton', location: loc('Rotes Rathaus\nRathausstraße 15\n10178 Berlin') }, folders), 'f7');
  // Auditorium job without own folder: no guess
  assert.equal(V.voPickFolder([row(1), row(4), row(6)], { venue: 'Estrel', title: '2 STB weiß', location: loc('Sonnenallee 225\n12057 Berlin\nAuditorium\nLeadership Konferenz') }, folders), '');
});
