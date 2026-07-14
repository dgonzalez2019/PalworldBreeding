// Core breeding engine. Works in two modes, selected by the data file:
//
//  - "table" mode: the data file carries an explicit (parentA, parentB) -> child
//    table (exhaustive datamined dump). Lookups are exact.
//  - "rank" mode: each pal carries a combiRank ("breeding power"). The child of a
//    pair is the breedable pal whose rank is closest to floor((rankA+rankB+1)/2),
//    except: same-species pairs always give that species, unique combos override
//    everything, and unique-only pals (legendaries/variants) never appear as a
//    generic nearest-rank result. This is the algorithm Palworld itself uses
//    (unchanged in 1.0 — only the rank values and unique combos were revised).

export class BreedingData {
  constructor(raw) {
    this.raw = raw;
    this.mode = raw.breedingMode || (raw.breedingTable ? 'table' : 'rank');
    this.pals = raw.pals;
    this.byKey = new Map(raw.pals.map((p) => [p.key, p]));

    // stable paldex ordering, used for display and rank-mode tie-breaking
    this.ordered = [...raw.pals].sort(
      (a, b) => a.paldex - b.paldex || (a.suffix || '').localeCompare(b.suffix || '')
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
      this._uniqueByPair = new Map();
      this._uniqueChildren = new Set();
      for (const combo of raw.uniqueCombos || []) {
        this._uniqueByPair.set(pairKey(combo.parents[0], combo.parents[1]), combo.child);
        this._uniqueChildren.add(combo.child);
      }
      // generic pool: breedable pals that are not unique-only
      this._pool = this.breedable
        .filter((p) => !p.uniqueOnly && p.combiRank != null)
        .sort((a, b) => a.combiRank - b.combiRank || this.orderIndex.get(a.key) - this.orderIndex.get(b.key));
    }
  }

  get(key) {
    return this.byKey.get(key);
  }

  /** Child pal key for an (unordered) parent pair, or null if unknown/unbreedable. */
  childOf(aKey, bKey) {
    const a = this.byKey.get(aKey), b = this.byKey.get(bKey);
    if (!a || !b || !a.breedable || !b.breedable) return null;
    if (aKey === bKey) return aKey; // same species -> same species

    if (this.mode === 'table') {
      return this._pairChild.get(pairKey(aKey, bKey)) ?? null;
    }

    const unique = this._uniqueByPair.get(pairKey(aKey, bKey));
    if (unique) return unique;

    const target = Math.floor((a.combiRank + b.combiRank + 1) / 2);
    let best = null, bestDist = Infinity;
    for (const p of this._pool) {
      const d = Math.abs(p.combiRank - target);
      if (d < bestDist) { best = p; bestDist = d; }
      // pool is sorted by rank; once past the target and distance grows, stop
      else if (p.combiRank > target && d > bestDist) break;
    }
    return best ? best.key : null;
  }

  /** All unordered parent pairs [aKey, bKey] that produce the given child. */
  parentsOf(childKey) {
    if (this.mode === 'table') {
      return (this._parentsByChild.get(childKey) || []).map((p) => [...p]);
    }
    const out = [];
    const keys = this.breedable.map((p) => p.key);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i; j < keys.length; j++) {
        if (this.childOf(keys[i], keys[j]) === childKey) out.push([keys[i], keys[j]]);
      }
    }
    return out;
  }

  /** Every unordered breedable pair with its child: [[a, b, child], ...] */
  allPairs() {
    const out = [];
    if (this.mode === 'table') {
      for (const [child, pairs] of this._parentsByChild) {
        for (const [a, b] of pairs) out.push([a, b, child]);
      }
      return out;
    }
    const keys = this.breedable.map((p) => p.key);
    for (let i = 0; i < keys.length; i++) {
      for (let j = i; j < keys.length; j++) {
        const c = this.childOf(keys[i], keys[j]);
        if (c) out.push([keys[i], keys[j], c]);
      }
    }
    return out;
  }
}

export function pairKey(a, b) {
  return a < b ? a + '+' + b : b + '+' + a;
}
