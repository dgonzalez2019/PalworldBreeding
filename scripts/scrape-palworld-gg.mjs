#!/usr/bin/env node
// Refresh data/pals.json with live Palworld 1.0 data.
//
// Run this on YOUR machine (normal internet access required — the hosted dev
// sandbox that built this repo cannot reach game sites, which is why the repo
// ships with a pre-1.0 seed dataset).
//
//   node scripts/scrape-palworld-gg.mjs                  # try all sources
//   node scripts/scrape-palworld-gg.mjs --source paldb   # paldb.cc only
//   node scripts/scrape-palworld-gg.mjs --dump ./dump    # also save raw HTML for debugging
//
// Sources (same underlying game data):
//   - palworld.gg   (Next.js app; we mine embedded JSON payloads)
//   - paldb.cc      (server-rendered tables; CombiRank a.k.a. breeding power)
//
// Output: data/pals.json in "rank" mode — every pal gets a combiRank and the
// site computes children with the game's own formula:
//     child = breedable pal whose rank is closest to floor((rankA+rankB+1)/2)
// plus uniqueCombos overrides and uniqueOnly exclusions.
//
// Both sites occasionally sit behind Cloudflare. If plain fetch gets blocked
// and you have playwright installed (`npm i playwright && npx playwright
// install chromium`), the script automatically retries with a real browser.
//
// If a site redesign breaks extraction, run with --dump and adapt the two
// clearly-marked EXTRACTORS below — everything else is plumbing.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const SOURCE = opt('source', 'all'); // all | palworld.gg | paldb
const OUT = opt('out', new URL('../data/pals.json', import.meta.url).pathname);
const DUMP = opt('dump', null);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

let _browser = null;
async function fetchHtml(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
    if (res.ok) return await res.text();
    console.warn(`  fetch ${url} -> HTTP ${res.status}`);
  } catch (e) {
    console.warn(`  fetch ${url} -> ${e.message}`);
  }
  // Cloudflare fallback: real browser via playwright, if available
  try {
    if (!_browser) {
      const { chromium } = await import('playwright');
      _browser = await chromium.launch();
      console.log('  (falling back to headless Chromium via playwright)');
    }
    const page = await _browser.newPage({ userAgent: UA });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    const html = await page.content();
    await page.close();
    return html;
  } catch (e) {
    throw new Error(
      `Could not fetch ${url} (${e.message}). If this is a Cloudflare block, install playwright:\n` +
        '  npm i playwright && npx playwright install chromium'
    );
  }
}

function dump(name, content) {
  if (!DUMP) return;
  fs.mkdirSync(DUMP, { recursive: true });
  fs.writeFileSync(path.join(DUMP, name), content);
}

/* ================================================================== *
 *  EXTRACTOR 1: palworld.gg                                           *
 *  The site is a Next.js app; pal data rides inside embedded JSON     *
 *  (either a __NEXT_DATA__ script tag or streamed self.__next_f       *
 *  chunks). We scan every embedded JSON blob for objects that look    *
 *  like pals (name + breeding/work fields) rather than relying on     *
 *  exact prop paths, so minor site updates keep working.              *
 * ================================================================== */
async function fromPalworldGG() {
  console.log('Trying palworld.gg …');
  const html = await fetchHtml('https://palworld.gg/pals');
  dump('palworld.gg-pals.html', html);

  const blobs = [];
  const nextData = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (nextData) blobs.push(nextData[1]);
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\)/g)) {
    try {
      blobs.push(JSON.parse('"' + m[1] + '"')); // unescape the streamed chunk
    } catch { /* skip malformed chunk */ }
  }

  // hunt for arrays of pal-like objects inside any parseable JSON substring
  const palArrays = [];
  const tryCollect = (node) => {
    if (Array.isArray(node)) {
      if (
        node.length > 50 &&
        node.every((x) => x && typeof x === 'object') &&
        node.some((x) => JSON.stringify(Object.keys(x)).toLowerCase().includes('name'))
      ) {
        palArrays.push(node);
      }
      node.forEach(tryCollect);
    } else if (node && typeof node === 'object') {
      Object.values(node).forEach(tryCollect);
    }
  };
  for (const blob of blobs) {
    // a chunk may be `key:JSON` or bare JSON; try progressively
    for (const candidate of [blob, blob.replace(/^[^[{]*/, '')]) {
      try { tryCollect(JSON.parse(candidate)); break; } catch { /* keep trying */ }
    }
  }
  if (!palArrays.length) throw new Error('no pal-shaped JSON found in palworld.gg payload (site layout changed?) — rerun with --dump and inspect');

  const arr = palArrays.sort((a, b) => b.length - a.length)[0];
  console.log(`  found candidate pal array with ${arr.length} entries`);
  const lower = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.toLowerCase(), v]));
  const pals = arr.map((raw) => {
    const o = lower(raw);
    const stats = lower(o.stats || o.status || {});
    const work = lower(o.work || o.worksuitability || o.suitability || {});
    return {
      name: o.name?.en || o.name,
      paldexRaw: o.zukanindex ?? o.paldex ?? o.index ?? o.no ?? o.number,
      suffix: o.zukanindexsuffix ?? o.suffix ?? null,
      types: (o.elements || o.types || o.element || []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean),
      combiRank: o.combirank ?? o.breedingpower ?? o.breedpower ?? null,
      stats,
      work,
    };
  }).filter((p) => p.name && p.paldexRaw != null);
  if (pals.length < 100) throw new Error(`only ${pals.length} usable pals extracted from palworld.gg — layout changed, rerun with --dump`);
  return { source: 'palworld.gg', pals };
}

/* ================================================================== *
 *  EXTRACTOR 2: paldb.cc                                              *
 *  Server-rendered. The breeding page carries every pal's CombiRank;  *
 *  each pal's detail page carries stats + work suitability. We parse  *
 *  tables generically: a row = pal link + numeric cells.              *
 * ================================================================== */
async function fromPaldb() {
  console.log('Trying paldb.cc …');
  const html = await fetchHtml('https://paldb.cc/en/Breeding_Farm');
  dump('paldb-breeding.html', html);

  // rows look like: <a href="/en/SomePal">Name</a> ... <td>1460</td>
  const pals = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  for (const row of html.matchAll(rowRe)) {
    const cells = row[1];
    const link = cells.match(/<a[^>]*href="\/en\/([^"]+)"[^>]*>([^<]{2,40})<\/a>/);
    const nums = [...cells.matchAll(/>\s*(\d{1,4})\s*</g)].map((m) => Number(m[1]));
    if (link && nums.length) {
      pals.push({ slug: link[1], name: link[2].trim(), combiRank: nums[nums.length - 1] });
    }
  }
  if (pals.length < 100) {
    throw new Error(`only ${pals.length} rows parsed from paldb.cc Breeding_Farm — layout changed, rerun with --dump`);
  }
  console.log(`  parsed ${pals.length} pals with combi ranks; fetching paldex/stats per pal (slow, ~1/s) …`);

  const out = [];
  for (const [i, p] of pals.entries()) {
    const page = await fetchHtml(`https://paldb.cc/en/${p.slug}`);
    if (i < 3) dump(`paldb-pal-${p.slug}.html`, page);
    const grab = (label) => {
      const m = page.match(new RegExp(label + '[\\s\\S]{0,200}?(\\d{1,4})', 'i'));
      return m ? Number(m[1]) : null;
    };
    out.push({
      name: p.name,
      paldexRaw: grab('ZukanIndex|Paldex|No\\.'),
      suffix: /ZukanIndexSuffix[\s\S]{0,80}?B/i.test(page) ? 'B' : null,
      types: [...page.matchAll(/Element[^<]*<[^>]*>([A-Za-z]+)/g)].map((m) => m[1]),
      combiRank: p.combiRank,
      stats: { hp: grab('HP'), attack: grab('(?:Shot )?Attack'), defense: grab('Defen[cs]e'), food: grab('Food') },
      work: {
        kindling: grab('Kindling'), watering: grab('Watering'), planting: grab('Planting'),
        electric: grab('Generating|Electricity'), handiwork: grab('Handiwork'), gathering: grab('Gathering'),
        lumbering: grab('Lumbering'), mining: grab('Mining'), medicine: grab('Medicine'),
        cooling: grab('Cooling'), transporting: grab('Transporting'), farming: grab('Farming'),
      },
    });
    await new Promise((r) => setTimeout(r, 1000)); // be polite
    if (i % 25 === 0) console.log(`  ${i}/${pals.length}`);
  }
  return { source: 'paldb.cc', pals: out };
}

/* ================================================================== *
 *  normalize + write                                                  *
 * ================================================================== */
function buildDataFile({ source, pals }) {
  const WORK_KEYS = ['kindling','watering','planting','electric','handiwork','gathering','lumbering','mining','medicine','cooling','transporting','farming'];
  const norm = pals.map((p) => {
    const num = Number(String(p.paldexRaw).replace(/\D/g, ''));
    const suffix = p.suffix || (/B$/i.test(String(p.paldexRaw)) ? 'B' : null);
    const work = {};
    for (const k of WORK_KEYS) work[k] = Number(p.work?.[k] ?? 0) || 0;
    return {
      key: num + (suffix || ''),
      paldex: num,
      suffix,
      name: p.name,
      types: p.types?.length ? p.types : [],
      work,
      stats: {
        hp: p.stats?.hp ?? null, attack: p.stats?.attack ?? null, defense: p.stats?.defense ?? null,
        food: p.stats?.food ?? null, stamina: p.stats?.stamina ?? null,
        walkSpeed: null, runSpeed: p.stats?.runspeed ?? null, rideSpeed: p.stats?.ridespeed ?? null, transportSpeed: null,
      },
      combiRank: p.combiRank != null ? Number(p.combiRank) : null,
      breedable: p.combiRank != null,
      // pals that never appear as a generic nearest-rank child (legendaries,
      // elemental variants, raid pals). Heuristic: rank <= 60 or B-variant —
      // review data/uniqueCombos manually if a scraped source provides them.
      uniqueOnly: p.uniqueOnly ?? (suffix === 'B' || (p.combiRank != null && p.combiRank <= 60)),
      partial: p.combiRank == null,
    };
  }).filter((p) => p.paldex > 0 && p.name);

  // dedupe by key, keep the entry with more data
  const byKey = new Map();
  for (const p of norm) {
    const prev = byKey.get(p.key);
    if (!prev || (p.combiRank != null && prev.combiRank == null)) byKey.set(p.key, p);
  }
  const finalPals = [...byKey.values()].sort((a, b) => a.paldex - b.paldex || (a.suffix || '').localeCompare(b.suffix || ''));

  const withRank = finalPals.filter((p) => p.combiRank != null).length;
  console.log(`\nExtracted ${finalPals.length} pals (${withRank} with combi rank) from ${source}`);
  if (finalPals.length < 200) {
    console.warn('WARNING: fewer than 200 pals — Palworld 1.0 has 287. The extraction is probably incomplete; inspect with --dump before trusting this file.');
  }

  return {
    schema: 1,
    dataVersion: `scraped-${source}`,
    generatedAt: new Date().toISOString().slice(0, 10),
    notes: `Scraped from ${source}. Breeding uses combi-rank math; uniqueCombos below need manual review — ` +
      'add entries like {"parents":["11","72"],"child":"100"} for special combinations listed on the source site.',
    breedingMode: 'rank',
    pals: finalPals,
    uniqueCombos: [],
  };
}

/* ================================================================== */
try {
  let result = null;
  const attempts = [];
  if (SOURCE === 'all' || SOURCE === 'palworld.gg') attempts.push(fromPalworldGG);
  if (SOURCE === 'all' || SOURCE === 'paldb') attempts.push(fromPaldb);
  let lastErr = null;
  for (const fn of attempts) {
    try { result = await fn(); break; }
    catch (e) { lastErr = e; console.warn('  ' + e.message + '\n'); }
  }
  if (!result) throw lastErr || new Error('no source configured');
  const data = buildDataFile(result);
  fs.writeFileSync(OUT, JSON.stringify(data));
  console.log(`Wrote ${OUT} — open the site and check the footer says "mode: rank".`);
  console.log('Then eyeball a few known combos against the source site, and add uniqueCombos.');
} finally {
  if (_browser) await _browser.close();
}
