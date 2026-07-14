// Breeding-path search: given the pals you own, find the cheapest breeding tree
// that produces a target pal — optionally forcing specific pals to be used as a
// parent somewhere along the way.
//
// Breeding in Palworld does not consume the parents, so once a pal is obtained it
// stays available. Cost of a plan = number of breeding steps. We relax over all
// parent pairs (cost(child) <= cost(a) + cost(b) + 1) until a fixpoint; when the
// same intermediate appears in several branches the renderer counts it once, so
// the reported step count is the number of distinct pals bred.
//
// Required pals use a bitmask DP: state (pal, mask) = cheapest way to obtain pal
// such that every required pal in `mask` has been used as a parent in its
// ancestry. Capped at MAX_REQUIRED to keep the state space tiny.

export const MAX_REQUIRED = 4;

export function findBreedingPlan(data, ownedKeys, targetKey, requiredKeys = []) {
  const required = [...new Set(requiredKeys)].filter((k) => k !== targetKey);
  if (required.length > MAX_REQUIRED) {
    return { ok: false, reason: `At most ${MAX_REQUIRED} required pals are supported.` };
  }
  const owned = new Set(ownedKeys);
  const K = required.length;
  const FULL = (1 << K) - 1;
  const bitOf = new Map(required.map((k, i) => [k, 1 << i]));

  // cost[palKey] = array over masks; via[palKey] = array over masks of [a, maskA, b, maskB]
  const cost = new Map();
  const via = new Map();
  const getCosts = (k) => {
    let c = cost.get(k);
    if (!c) { c = new Array(FULL + 1).fill(Infinity); cost.set(k, c); via.set(k, new Array(FULL + 1).fill(null)); }
    return c;
  };

  for (const k of owned) {
    if (data.get(k)?.breedable) getCosts(k)[0] = 0;
  }
  if (owned.has(targetKey) && K === 0) {
    return { ok: true, steps: 0, tree: { key: targetKey, owned: true }, stepList: [] };
  }

  const pairs = data.allPairs();
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 64) {
    changed = false;
    for (const { a, b, child } of pairs) {
      const ca = cost.get(a), cb = cost.get(b);
      if (!ca || !cb) continue;
      const useBits = (bitOf.get(a) || 0) | (bitOf.get(b) || 0);
      let cc = null;
      for (let ma = 0; ma <= FULL; ma++) {
        if (ca[ma] === Infinity) continue;
        for (let mb = 0; mb <= FULL; mb++) {
          if (cb[mb] === Infinity) continue;
          const m = ma | mb | useBits;
          const c = ca[ma] + cb[mb] + 1;
          cc ??= getCosts(child);
          if (c < cc[m]) {
            cc[m] = c;
            via.get(child)[m] = [a, ma, b, mb];
            changed = true;
          }
        }
      }
    }
  }

  const targetCosts = cost.get(targetKey);
  if (!targetCosts || targetCosts[FULL] === Infinity) {
    const reason = K
      ? 'No breeding path found that uses every required pal. Try removing a required pal, or add more owned pals.'
      : 'No breeding path found from your owned pals to this target.';
    return { ok: false, reason };
  }

  // reconstruct tree; dedupe shared sub-breeds into a step list
  const stepIndex = new Map(); // "key@mask" -> step number
  const stepList = [];
  const build = (key, mask) => {
    const v = via.get(key)?.[mask];
    if (!v || cost.get(key)[mask] === 0) return { key, owned: true };
    const id = key + '@' + mask;
    if (stepIndex.has(id)) return { key, ref: stepIndex.get(id) };
    const [a, ma, b, mb] = v;
    const node = { key, parents: [build(a, ma), build(b, mb)] };
    node.step = stepList.length + 1;
    stepIndex.set(id, node.step);
    stepList.push({ step: node.step, a, b, child: key });
    return node;
  };
  const tree = build(targetKey, FULL);
  return { ok: true, steps: stepList.length, tree, stepList };
}
