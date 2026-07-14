import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BreedingData, pairKey } from '../js/breeding.js';
import { findBreedingPlan } from '../js/pathfinder.js';

const raw = JSON.parse(fs.readFileSync(new URL('../data/pals.json', import.meta.url), 'utf8'));
const data = new BreedingData(raw);
const keyByName = new Map(raw.pals.map((p) => [p.name, p.key]));
const k = (name) => {
  const key = keyByName.get(name);
  assert.ok(key, `pal named ${name} exists`);
  return key;
};

// several tests assert exact values from the seed's datamined table; they are
// skipped automatically if the dataset was re-scraped into rank mode
const seedTable = { skip: data.mode !== 'table' && 'dataset is not the seed breeding table' };

test('dataset shape', seedTable, () => {
  assert.equal(data.mode, 'table');
  assert.ok(raw.pals.length >= 150);
  const breedable = raw.pals.filter((p) => p.breedable);
  // exhaustive table: one child for every unordered pair of breedable pals
  const n = breedable.length;
  assert.equal(data.allPairs().length, (n * (n + 1)) / 2);
  for (const p of breedable) {
    assert.ok(p.work, `${p.name} has work suitabilities`);
    assert.ok(p.stats.hp > 0 && p.stats.attack > 0 && p.stats.defense > 0);
  }
});

test('same species breeds itself', () => {
  for (const p of data.breedable) {
    assert.equal(data.childOf(p.key, p.key), p.key);
  }
});

test('childOf is symmetric and total over breedable pals', () => {
  const keys = data.breedable.map((p) => p.key);
  for (let i = 0; i < keys.length; i += 7) {
    for (let j = 0; j < keys.length; j += 11) {
      const c1 = data.childOf(keys[i], keys[j]);
      const c2 = data.childOf(keys[j], keys[i]);
      assert.equal(c1, c2);
      assert.ok(c1, `pair ${keys[i]}+${keys[j]} has a child`);
    }
  }
});

test('known combos (pre-1.0 datamined table)', seedTable, () => {
  assert.equal(data.childOf(k('Penking'), k('Bushi')), k('Anubis'));
  assert.equal(data.childOf(k('Relaxaurus'), k('Sparkit')), k('Relaxaurus Lux'));
  assert.equal(data.childOf(k('Mossanda'), k('Grizzbolt')), k('Mossanda Lux'));
  assert.equal(data.childOf(k('Grizzbolt'), k('Relaxaurus')), k('Orserk'));
  assert.equal(data.childOf(k('Frostallion'), k('Helzephyr')), k('Frostallion Noct'));
});

test('parentsOf inverts childOf', () => {
  const target = k('Anubis');
  const pairs = data.parentsOf(target);
  assert.ok(pairs.length > 0);
  for (const [a, b] of pairs) assert.equal(data.childOf(a, b), target);
  // and completeness: no other pair produces it
  let count = 0;
  for (const [, , child] of data.allPairs()) if (child === target) count++;
  assert.equal(count, pairs.length);
});

test('rank mode agrees with formula', () => {
  const rankRaw = {
    schema: 1,
    breedingMode: 'rank',
    pals: [
      { key: '1', paldex: 1, name: 'A', types: [], combiRank: 100, breedable: true, work: {}, stats: { hp: 1, attack: 1, defense: 1 } },
      { key: '2', paldex: 2, name: 'B', types: [], combiRank: 200, breedable: true, work: {}, stats: { hp: 1, attack: 1, defense: 1 } },
      { key: '3', paldex: 3, name: 'C', types: [], combiRank: 300, breedable: true, work: {}, stats: { hp: 1, attack: 1, defense: 1 } },
      { key: '4', paldex: 4, name: 'L', types: [], combiRank: 10, breedable: true, uniqueOnly: true, work: {}, stats: { hp: 1, attack: 1, defense: 1 } },
    ],
    uniqueCombos: [{ parents: ['1', '3'], child: '4' }],
  };
  const rd = new BreedingData(rankRaw);
  // floor((100+200+1)/2) = 150 -> equidistant from 100 and 200 -> lower rank wins
  assert.equal(rd.childOf('1', '2'), '1');
  // floor((200+300+1)/2) = 250 -> equidistant 200/300 -> lower rank wins
  assert.equal(rd.childOf('2', '3'), '2');
  // unique combo overrides rank math
  assert.equal(rd.childOf('1', '3'), '4');
  assert.equal(rd.childOf('3', '1'), '4');
  // same species
  assert.equal(rd.childOf('4', '4'), '4');
  // unique-only pal never appears as generic nearest-rank child
  assert.notEqual(rd.childOf('2', '2'), '4');
  // parentsOf works in rank mode
  const parents = rd.parentsOf('4');
  assert.deepEqual(parents.sort(), [['1', '3'], ['4', '4']].sort());
});

test('pairKey is order independent', () => {
  assert.equal(pairKey('11', '72'), pairKey('72', '11'));
});

test('pathfinder: trivial and direct paths', seedTable, () => {
  const lam = k('Lamball');
  const owned = [k('Penking'), k('Bushi')];
  const direct = findBreedingPlan(data, owned, k('Anubis'));
  assert.ok(direct.ok);
  assert.equal(direct.steps, 1);
  assert.deepEqual([direct.stepList[0].a, direct.stepList[0].b].sort(), owned.sort());

  const already = findBreedingPlan(data, [lam], lam);
  assert.ok(already.ok);
  assert.equal(already.steps, 0);
});

test('pathfinder: breeding cannot reach rarer pals than you own', seedTable, () => {
  // child rank is the average of parent ranks, so a starter-only box can
  // never breed its way down to a rare pal like Anubis
  const owned = [k('Lamball'), k('Cattiva'), k('Chikipi'), k('Foxparks'), k('Pengullet')];
  const plan = findBreedingPlan(data, owned, k('Anubis'));
  assert.equal(plan.ok, false);
});

test('pathfinder: multi-step path is valid', seedTable, () => {
  // build a guaranteed 2-level derivation from the table itself:
  // Anubis <- (p, q); p <- (r, s); owned = {q, r, s}
  const target = k('Anubis');
  let owned = null;
  outer: for (const [p, q] of data.parentsOf(target)) {
    if (p === q || p === target || q === target) continue;
    for (const [r, s] of data.parentsOf(p)) {
      if (r === p || s === p || r === q || s === q) continue;
      owned = [q, r, s];
      break outer;
    }
  }
  assert.ok(owned, 'found a 2-level derivation in the table');
  const plan = findBreedingPlan(data, owned, k('Anubis'));
  assert.ok(plan.ok, 'path to Anubis exists');
  assert.ok(plan.steps >= 1 && plan.steps <= 2);
  const have = new Set(owned);
  for (const s of plan.stepList) {
    assert.ok(have.has(s.a), `step ${s.step}: parent ${s.a} already available`);
    assert.ok(have.has(s.b), `step ${s.step}: parent ${s.b} already available`);
    assert.equal(data.childOf(s.a, s.b), s.child, `step ${s.step} is a real combo`);
    have.add(s.child);
  }
  assert.equal(plan.stepList.at(-1).child, k('Anubis'));
});

test('pathfinder: unreachable target reports failure', seedTable, () => {
  // Jetragon can only come from Jetragon + Jetragon in the table
  const plan = findBreedingPlan(data, [k('Lamball'), k('Cattiva')], k('Jetragon'));
  assert.equal(plan.ok, false);
  assert.ok(plan.reason);
});

test('pathfinder: required pals are used as parents', seedTable, () => {
  const owned = [k('Lamball'), k('Cattiva'), k('Chikipi'), k('Foxparks'), k('Pengullet'), k('Penking'), k('Bushi')];
  const required = [k('Penking')];
  const plan = findBreedingPlan(data, owned, k('Anubis'), required);
  assert.ok(plan.ok);
  const parentsUsed = new Set(plan.stepList.flatMap((s) => [s.a, s.b]));
  assert.ok(parentsUsed.has(k('Penking')), 'Penking used as a parent');

  // requiring a pal changes the plan when the cheap route would skip it
  const required2 = [k('Foxparks')];
  const plan2 = findBreedingPlan(data, owned, k('Anubis'), required2);
  assert.ok(plan2.ok);
  const used2 = new Set(plan2.stepList.flatMap((s) => [s.a, s.b]));
  assert.ok(used2.has(k('Foxparks')), 'Foxparks used as a parent');
  for (const s of plan2.stepList) assert.equal(data.childOf(s.a, s.b), s.child);
});

test('pathfinder: rejects too many required pals', () => {
  const owned = [k('Lamball')];
  const req = [k('Cattiva'), k('Chikipi'), k('Foxparks'), k('Pengullet'), k('Penking')];
  const plan = findBreedingPlan(data, owned, k('Anubis'), req);
  assert.equal(plan.ok, false);
});
