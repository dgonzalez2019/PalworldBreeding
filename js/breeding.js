// Core breeding engine. Works in two modes, selected by the data file:
//
//  - "rank" mode (current dataset, scraped from palworld.gg's own calculator):
//    each pal carries a combiRank ("breeding power") and combiPriority. The
//    child of a pair is resolved exactly like the game (and palworld.gg) does:
//      1. unique combos first — specific parent pairs, optionally gender-locked
//         (ga/gb = required gender of each parent), always win;
//      2. same species -> same species;
//      3. otherwise: the pal in the "generic pool" whose combiRank is closest
//         to floor((rankA + rankB + 1) / 2); on a distance tie the pal with the
//         HIGHER combiPriority wins. The generic pool excludes uniqueOnly pals
//         (unique-combo children and ignoreCombi pals like legendaries).
//
//  - "table" mode (legacy seed datasets): an explicit exhaustive
//    (parentA, parentB) -> child table; lookups are exact.
//
// parentsOf/allPairs return objects: {a, b, ga?, gb?} / {a, b, child, ga?, gb?}
// — ga/gb are present only when the result requires specific parent genders.

export class BreedingData {
  constructor(raw) {
    this.raw = raw;
    this.mode = raw.breedingMode || (raw.breedingTable ? 'table' : 'rank');
    this.pals = raw.pals;
    this.byKey = new Map(raw.pals.map((p) => [p.key, p]));

    // stable paldex ordering, used for display (crossover pals sort last)
    this.ordered = [...raw.pals].sort(
      (a, b) => (a.paldex ?? 10000) - (b.paldex ?? 10000) ||
        (a.suffix || '').localeCompare(b.suffix || '') ||
        a.name.localeCompare(b.name)
    );
    this.orderIndex = new Map(this.ordered.map((p, i) => [p.key, i]));

    this.breedable = this.ordered.filter((p) => p.breedable);

    if (this.mode === 'table') {
      this._pairChild = new Map();
      this._parentsByChild = new Map();
      for (const [child, pairs] of Object.entries(raw.breedingTable || {})) {
        this._parentsByChild.set(child, pairs);
        for (const [a, b] of pairs) this._pairChild.set(pairKey(a, b), child);
      }
    } else {
      // unique combos indexed by unordered parent pair, kept in file order
      this._combosByPair = new Map();
      for (const combo of raw.uniqueCombos || []) {
        const k = pairKey(combo.parents[0], combo.parents[1]);
        if (!this._combosByPair.has(k)) this._combosByPair.set(k, []);
        this._combosByPair.get(k).push(combo);
      }
      // generic child pool + nearest-rank lookup table (as palworld.gg builds it)
      const pool = this.breedable.filter((p) => !p.uniqueOnly && p.combiRank != null);
      const maxRank = Math.max(...this.breedable.map((p) => p.combiRank || 0)) + 1;
      this._Y = new Array(maxRank + 1).fill(null);
      for (let t = 0; t <= maxRank; t++) {
        let best = null, bestDist = Infinity;
        for (const p of pool) {
          const d = Math.abs(p.combiRank - t);
          if (d < bestDist || (d === bestDist && (p.combiPriority ?? 0) > (best.combiPriority ?? 0))) {
            best = p; bestDist = d;
          }
        }
        this._Y[t] = best;
      }
    }
  }

  get(key) {
    return this.byKey.get(key);
  }

  /**
   * Child pal key for a parent pair, or null if unknown/unbreedable.
   * In rank mode ga/gb are the genders of parents a/b (a few unique combos are
   * gender-locked); the default M/F matches palworld.gg's primary result.
   */
  childOf(aKey, bKey, ga = 'M', gb = 'F') {
    const a = this.byKey.get(aKey), b = this.byKey.get(bKey);
    if (!a || !b || !a.breedable || !b.breedable) return null;

    if (this.mode === 'table') {
      if (aKey === bKey) return aKey;
      return this._pairChild.get(pairKey(aKey, bKey)) ?? null;
    }

    const genderOk = (need, have) => !need || need === have;
    for (const c of this._combosByPair.get(pairKey(aKey, bKey)) || []) {
      const [pa, pb] = c.parents;
      if (
        (pa === aKey && pb === bKey && genderOk(c.ga, ga) && genderOk(c.gb, gb)) ||
        (pa === bKey && pb === aKey && genderOk(c.ga, gb) && genderOk(c.gb, ga))
      ) return c.child;
    }
    if (aKey === bKey) return aKey;
    return this._Y[(a.combiRank + b.combiRank + 1) >> 1]?.key ?? null;
  }

  /**
   * All distinct children of a pair across parent-gender assignments:
   * [{child, ga?, gb?}] — gender fields only when the pairing is gender-locked.
   */
  childrenOf(aKey, bKey) {
    const mf = this.childOf(aKey, bKey, 'M', 'F');
    if (!mf) return [];
    const fm = this.childOf(aKey, bKey, 'F', 'M');
    if (fm === mf) return [{ child: mf }];
    return [
      { child: mf, ga: 'M', gb: 'F' },
      { child: fm, ga: 'F', gb: 'M' },
    ];
  }

  /** All parent pairs producing the given child: [{a, b, ga?, gb?}] */
  parentsOf(childKey) {
    if (this.mode === 'table') {
      return (this._parentsByChild.get(childKey) || []).map(([a, b]) => ({ a, b }));
    }
    const out = [];
    const keys = this.breedable.map((p) => p.key);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i; j < keys.length; j++) {
        for (const r of this.childrenOf(keys[i], keys[j])) {
          if (r.child === childKey) out.push({ a: keys[i], b: keys[j], ga: r.ga, gb: r.gb });
        }
      }
    }
    return out;
  }

  /** Every breedable pairing with its child: [{a, b, child, ga?, gb?}] */
  allPairs() {
    const out = [];
    if (this.mode === 'table') {
      for (const [child, pairs] of this._parentsByChild) {
        for (const [a, b] of pairs) out.push({ a, b, child });
      }
      return out;
    }
    const keys = this.breedable.map((p) => p.key);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i; j < keys.length; j++) {
        for (const r of this.childrenOf(keys[i], keys[j])) {
          out.push({ a: keys[i], b: keys[j], child: r.child, ga: r.ga, gb: r.gb });
        }
      }
    }
    return out;
  }
}

export function pairKey(a, b) {
  return a < b ? a + '+' + b : b + '+' + a;
}
