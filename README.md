# 🥚 Palworld Breeding Lab

A static website for planning Palworld breeding and comparing pals:

- **Breed Two Pals** — pick two parents, see the child. Pick just one parent to see its child with *every* possible partner.
- **Find Parents** — pick a target pal and list every parent combination that produces it, with an optional "must include this pal" filter.
- **Breeding Path** — select the pals you own (saved in your browser), pick a target, and get a step-by-step breeding tree. You can also require up to 4 specific pals to be used as parents somewhere along the way.
- **Pal Index** — every pal in one table, sortable high→low by any combat stat or any of the 12 work suitabilities, with name search and type filter.

No build step, no framework — plain HTML/CSS/JS.

## Running it

```bash
npm run serve        # http://localhost:8080
```

(or any static file server, or GitHub Pages — `fetch()` needs http://, so don't open `index.html` directly from disk.)

```bash
npm test             # engine + pathfinder test suite (Node 20+)
```

## About the data

`data/pals.json` carries **live Palworld 1.0 data from palworld.gg** — 299 pals (the full renumbered 1.0 paldeck including B-variants and the Terraria crossover pals) with breeding power (`combiRank`/`combiPriority`), all 250 unique combos (including the two gender-locked Katress/Wixen combos), combat stats, and the 12 work suitabilities. It's the same bundled game database palworld.gg's own breeding calculator runs on, and the breeding engine here mirrors that calculator's algorithm exactly:

1. **unique combos** win (specific parent pairs, some gender-locked);
2. **same species → same species**;
3. otherwise the child is the generic-pool pal whose `combiRank` is closest to `floor((rankA + rankB + 1) / 2)` — ties go to the higher `combiPriority`, and `uniqueOnly` pals (unique-combo children, legendaries and other `ignoreCombi` pals) never appear as generic results.

The test suite cross-checks the engine against an independent re-implementation of that algorithm over 2,000+ pairings, plus pinned 1.0 facts (e.g. Penking + Bushi now gives Sibelyx, not Anubis).

### Refreshing the data after a game patch

```bash
npm run scrape                    # regenerates data/pals.json from palworld.gg
npm run scrape -- --dump ./dump   # keep the fetched files for debugging
npm test                          # validate the regenerated file
```

The scraper finds palworld.gg's bundled pal-database chunk via the site's own import map, imports it, and transforms it with `scripts/transform-palworld-gg.mjs`. It uses plain `fetch` and falls back to `curl` when running behind an `HTTPS_PROXY`. If the site's bundling ever changes, the error messages say exactly where to look, and `--dump` saves everything fetched.

### Data file format

`data/pals.json` — the site auto-detects the mode (footer shows which is active):

```jsonc
{
  "breedingMode": "rank",           // or "table" (legacy: explicit pair->child map)
  "pals": [{
    "key": "penguin",               // palworld.gg internal id
    "paldex": 18, "suffix": null,   // 1.0 paldeck number; null = crossover pal
    "name": "Penking", "types": ["Water", "Ice"],
    "work": { "kindling": 0, "watering": 2, /* … 12 keys … */ },
    "stats": { "hp": 95, "attack": 95, "melee": 95, "defense": 95, "support": 100, /* … */ },
    "combiRank": 1160, "combiPriority": 116000,
    "breedable": true,
    "uniqueOnly": false,            // never a generic nearest-rank child
    "rarity": 6
  }],
  "uniqueCombos": [
    { "parents": ["lazycatfish", "eleccat"], "child": "lazycatfish_electric" },
    { "parents": ["catmage", "foxmage"], "child": "foxmage_dark", "ga": "M", "gb": "F" }
  ]
}
```

If you'd rather import data from another community dump, just produce this shape — the site auto-detects rank vs. table mode.

## How the breeding path search works

Breeding never consumes the parents, so owned and bred pals stay available. The search relaxes `cost(child) ≤ cost(parentA) + cost(parentB) + 1` over every pair until stable and reconstructs the cheapest tree (shared intermediates are bred once and counted once). Required pals use a small bitmask DP — state = (pal, subset of required pals already used as parents) — so the plan is minimal among plans that use all of them. Fun 1.0 consequence the tests pin down: variant unique combos output far lower breeding power than their parents, so unlike pre-1.0 you *can* ladder from starter pals all the way down to rares — the pathfinder happily finds the 59-step ladder from {Lamball, Cattiva, Chikipi} to Anubis.
