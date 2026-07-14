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

## About the data — important

**The shipped dataset is a pre-1.0 seed, not 1.0 data.** This repo was built in a sandboxed environment whose network policy blocks game-data sites (palworld.gg, paldb.cc, the wiki — everything except package registries), and Palworld 1.0 shipped on July 10, 2026 with 72 new pals (287 total) and *revised* breeding combinations, so no offline source could provide it.

What the seed *is*: the exact datamined base-game breeding table — all 9,591 parent-pair→child results for paldex #1–111 plus 27 variants (from the `palworld-data` npm package's game-data dump), with work suitabilities, combat stats, and food values. Pals #112–126 are included with partial data (name/types/HP/ATK/DEF only, from the `palworld-pal-editor` dump; 5 missing table pairs were inferred from rank-neighborhood similarity). Everything the site shows for base-game pals is real datamined data, but **1.0 changed some combos and added pals this file doesn't have.**

### Refreshing to 1.0 data

On your own machine (normal internet):

```bash
npm run scrape                    # tries palworld.gg, falls back to paldb.cc
npm run scrape -- --dump ./dump   # keep raw HTML if extraction fails
npm test                          # sanity-check the regenerated file
```

The scraper writes `data/pals.json` in **rank mode**: each pal gets its `combiRank` (breeding power) and the site computes children with the game's own formula — child = the breedable pal whose rank is closest to `floor((rankA + rankB + 1) / 2)`, with same-species pairs, `uniqueCombos` overrides, and `uniqueOnly` exclusions (legendaries/variants that only come from special combos or same-species pairs). The 1.0 update kept this algorithm and only revised the rank values/special combos.

Notes:

- Both sites sit behind Cloudflare at times. If plain fetching is blocked, install playwright first (`npm i playwright && npx playwright install chromium`) — the script falls back to a real browser automatically.
- The script was written blind against those sites (they were unreachable from the build sandbox), so extraction is defensive and may need small tweaks after a site redesign — the two extractor functions are clearly marked at the top of `scripts/scrape-palworld-gg.mjs`, and `--dump` saves the raw HTML to adapt against.
- After scraping, review `uniqueCombos` in `data/pals.json`: special combinations (e.g. Relaxaurus + Sparkit → Relaxaurus Lux) are listed on the source sites and should be entered as `{"parents": ["85", "7"], "child": "85B"}` (keys are paldex number + optional `B` suffix). The seed's exhaustive table doesn't need them; rank mode does.

### Data file format

`data/pals.json` — the site auto-detects the mode (footer shows which is active):

```jsonc
{
  "breedingMode": "table",          // or "rank"
  "pals": [{
    "key": "11",                    // paldex number + optional "B" variant suffix
    "paldex": 11, "suffix": null,
    "name": "Penking", "types": ["Water", "Ice"],
    "work": { "kindling": 0, "watering": 2, /* … 12 keys … */ },
    "stats": { "hp": 95, "attack": 95, "defense": 95, "food": 8, /* … */ },
    "combiRank": null,              // set in rank mode
    "breedable": true,
    "uniqueOnly": false,            // rank mode: never a generic nearest-rank child
    "partial": false                // true = stats-only entry
  }],
  "breedingTable": { "childKey": [["parentA", "parentB"], …] },  // table mode
  "uniqueCombos": [{ "parents": ["85", "7"], "child": "85B" }]   // rank mode
}
```

If you'd rather import data from any other community dump than scrape, just produce this shape.

## How the breeding path search works

Breeding never consumes the parents, so owned and bred pals stay available. The search relaxes `cost(child) ≤ cost(parentA) + cost(parentB) + 1` over every pair until stable and reconstructs the cheapest tree (shared intermediates are bred once and counted once). Required pals use a small bitmask DP — state = (pal, subset of required pals already used as parents) — so the plan is minimal among plans that use all of them. One real-game consequence the tests pin down: a child's breeding power always lies between its parents', so you can never breed anything rarer than the rarest pal you own.
