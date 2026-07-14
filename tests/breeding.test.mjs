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

// the shipped dataset is palworld.gg 1.0 data in rank mode; these tests assert
// exact 1.0 values and skip automatically on a table-mode (legacy seed) file
const rankData = { skip: data.mode !== 'rank' && 'dataset is not in rank mode' };

test('dataset shape (palworld.gg 1.0)', rankData, () => {
  assert.ok(raw.pals.length >= 280, `1.0 roster present (got ${raw.pals.length})`);
  assert.ok(raw.uniqueCombos.length >= 200, 'unique combos present');
  for (const p of raw.pals.filter((x) => x.breedable)) {
    assert.ok(p.combiRank > 0 && p.combiRank !== 9999, `${p.name} has a usable combiRank`);
    assert.ok(p.work, `${p.name} has work suitabilities`);
    assert.ok(p.stats.hp > 0, `${p.name} has stats`);
  }
});

test('same species breeds itself', () => {
  for (const p of data.breedable) {
    assert.equal(data.childOf(p.key, p.key), p.key);
  }
});

test('childrenOf is symmetric in the parents', () => {
  const keys = data.breedable.map((p) => p.key);
  const set = (r) => JSON.stringify(r.map((x) => x.child).sort());
  for (let i = 0; i < keys.length; i += 7) {
    for (let j = 0; j < keys.length; j += 11) {
      assert.equal(set(data.childrenOf(keys[i], keys[j])), set(data.childrenOf(keys[j], keys[i])));
    }
  }
});

test('engine matches the reference algorithm (palworld.gg calculator)', rankData, () => {
  // independent re-implementation of the site's K() straight from the raw file
  const byKey = new Map(raw.pals.map((p) => [p.key, p]));
  const comboChildren = new Set(raw.uniqueCombos.map((c) => c.child));
  const pool = raw.pals.filter((p) => p.breedable && !p.uniqueOnly);
  const U = (need, have) => !need || need === have;
  const reference = (aK, bK, ga, gb) => {
    for (const c of raw.uniqueCombos) {
      const [pa, pb] = c.parents;
      if ((pa === aK && pb === bK && U(c.ga, ga) && U(c.gb, gb)) ||
          (pa === bK && pb === aK && U(c.ga, gb) && U(c.gb, ga))) return c.child;
    }
    if (aK === bK) return aK;
    const t = (byKey.get(aK).combiRank + byKey.get(bK).combiRank + 1) >> 1;
    let best = null, bd = Infinity;
    for (const p of pool) {
      const d = Math.abs(p.combiRank - t);
      if (d < bd || (d === bd && p.combiPriority > best.combiPriority)) { best = p; bd = d; }
    }
    return best.key;
  };
  assert.ok(comboChildren.size > 0);
  const keys = data.breedable.map((p) => p.key);
  let checked = 0;
  for (let i = 0; i < keys.length; i += 5) {
    for (let j = i; j < keys.length; j += 9) {
      for (const [ga, gb] of [['M', 'F'], ['F', 'M']]) {
        assert.equal(
          data.childOf(keys[i], keys[j], ga, gb),
          reference(keys[i], keys[j], ga, gb),
          `pair ${keys[i]}+${keys[j]} (${ga}${gb})`
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 2000, `checked ${checked} pairings`);
});

test('known 1.0 results', rankData, () => {
  // 1.0 removed the old Penking+Bushi -> Anubis shortcut (now Sibelyx)
  assert.equal(data.childOf(k('Penking'), k('Bushi')), k('Sibelyx'));
  assert.notEqual(data.childOf(k('Penking'), k('Bushi')), k('Anubis'));
  // unique combos still work
  assert.equal(data.childOf(k('Relaxaurus'), k('Sparkit')), k('Relaxaurus Lux'));
  // gender-locked combo: Katress + Wixen depends on which parent is male
  const res = data.childrenOf(k('Katress'), k('Wixen'));
  assert.deepEqual(
    res.map((r) => data.get(r.child).name).sort(),
    ['Katress Ignis', 'Wixen Noct']
  );
  // legendaries breed only with themselves
  assert.equal(data.childOf(k('Jetragon'), k('Jetragon')), k('Jetragon'));
  assert.equal(data.parentsOf(k('Jetragon')).length, 1);
});

test('parentsOf inverts childrenOf', rankData, () => {
  const target = k('Anubis');
  const pairs = data.parentsOf(target);
  assert.ok(pairs.length > 0);
  for (const { a, b, ga, gb } of pairs) {
    assert.equal(data.childOf(a, b, ga || 'M', gb || 'F'), target);
  }
  let count = 0;
  for (const { child } of data.allPairs()) if (child === target) count++;
  assert.equal(count, pairs.length);
});

test('rank mode agrees with formula (synthetic)', () => {
  const mk = (key, rank, prio, extra = {}) => ({
    key, paldex: Number(key), name: 'P' + key, types: [], combiRank: rank, combiPriority: prio,
    breedable: true, work: {}, stats: { hp: 1 }, ...extra,
  });
  const rd = new BreedingData({
    schema: 1,
    breedingMode: 'rank',
    pals: [
      mk('1', 100, 400), mk('2', 200, 300), mk('3', 300, 200),
      mk('4', 10, 100, { uniqueOnly: true }),
    ],
    uniqueCombos: [{ parents: ['1', '3'], child: '4' }],
  });
  // floor((100+200+1)/2) = 150 -> equidistant from 100 and 200 -> higher combiPriority wins
  assert.equal(rd.childOf('1', '2'), '1');
  // floor((200+300+1)/2) = 250 -> equidistant 200/300 -> higher priority wins
  assert.equal(rd.childOf('2', '3'), '2');
  // unique combo overrides rank math, in either order
  assert.equal(rd.childOf('1', '3'), '4');
  assert.equal(rd.childOf('3', '1'), '4');
  // same species
  assert.equal(rd.childOf('4', '4'), '4');
  // unique-only pal never appears as generic nearest-rank child
  assert.notEqual(rd.childOf('2', '2'), '4');
  const parents = rd.parentsOf('4').map(({ a, b }) => [a, b]);
  assert.deepEqual(parents.sort(), [['1', '3'], ['4', '4']].sort());
});

test('pairKey is order independent', () => {
  assert.equal(pairKey('11', '72'), pairKey('72', '11'));
});

test('pathfinder: trivial and direct paths', rankData, () => {
  const already = findBreedingPlan(data, [k('Lamball')], k('Lamball'));
  assert.ok(already.ok);
  assert.equal(already.steps, 0);

  const { a, b } = data.parentsOf(k('Anubis')).find((p) => !p.ga) || {};
  const direct = findBreedingPlan(data, [a, b], k('Anubis'));
  assert.ok(direct.ok);
  assert.equal(direct.steps, 1);
});

test('pathfinder: 1.0 variant combos allow breeding down from starters', rankData, () => {
  // pre-1.0, a child's rank always sat between its parents', so starters could
  // never reach rares. 1.0's variant unique combos output much lower ranks than
  // their parents, so a long ladder from starters to Anubis now exists.
  const plan = findBreedingPlan(data, [k('Lamball'), k('Cattiva'), k('Chikipi')], k('Anubis'));
  assert.ok(plan.ok);
  assert.ok(plan.steps > 10, `long ladder expected (got ${plan.steps})`);
});

test('pathfinder: unreachable target reports failure', rankData, () => {
  // legendaries only breed from themselves — unreachable without owning one
  const plan = findBreedingPlan(data, [k('Lamball'), k('Cattiva'), k('Chikipi')], k('Jetragon'));
  assert.equal(plan.ok, false);
  assert.ok(plan.reason);
});

test('pathfinder: multi-step path is valid', rankData, () => {
  // build a guaranteed 2-level derivation from the data itself:
  // Anubis <- (p, q); p <- (r, s); owned = {q, r, s}
  const target = k('Anubis');
  let owned = null;
  outer: for (const { a: p, b: q, ga } of data.parentsOf(target)) {
    if (ga || p === q || p === target || q === target) continue;
    for (const { a: r, b: s, ga: g2 } of data.parentsOf(p)) {
      if (g2 || r === p || s === p || r === q || s === q) continue;
      owned = [q, r, s];
      break outer;
    }
  }
  assert.ok(owned, 'found a 2-level derivation');
  const plan = findBreedingPlan(data, owned, target);
  assert.ok(plan.ok, 'path to Anubis exists');
  assert.ok(plan.steps >= 1 && plan.steps <= 2);
  const have = new Set(owned);
  for (const s of plan.stepList) {
    assert.ok(have.has(s.a), `step ${s.step}: parent available`);
    assert.ok(have.has(s.b), `step ${s.step}: parent available`);
    const children = data.childrenOf(s.a, s.b).map((r) => r.child);
    assert.ok(children.includes(s.child), `step ${s.step} is a real combo`);
    have.add(s.child);
  }
  assert.equal(plan.stepList.at(-1).child, target);
});

test('pathfinder: required pals are used as parents', rankData, () => {
  const anubisPair = data.parentsOf(k('Anubis')).find((p) => !p.ga);
  const owned = [anubisPair.a, anubisPair.b, k('Lamball'), k('Vixy')];
  const plan = findBreedingPlan(data, owned, k('Anubis'), [k('Lamball')]);
  assert.ok(plan.ok, 'constrained plan exists: ' + (plan.reason || ''));
  const used = new Set(plan.stepList.flatMap((s) => [s.a, s.b]));
  assert.ok(used.has(k('Lamball')), 'Lamball used as a parent');
  for (const s of plan.stepList) {
    assert.ok(data.childrenOf(s.a, s.b).some((r) => r.child === s.child));
  }
});

test('pathfinder: rejects too many required pals', () => {
  const req = [k('Cattiva'), k('Chikipi'), k('Foxparks'), k('Pengullet'), k('Penking')];
  const plan = findBreedingPlan(data, [k('Lamball')], k('Anubis'), req);
  assert.equal(plan.ok, false);
});
