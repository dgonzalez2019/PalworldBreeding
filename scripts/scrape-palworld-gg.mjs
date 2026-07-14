#!/usr/bin/env node
// Refresh data/pals.json with live Palworld data from palworld.gg.
//
//   node scripts/scrape-palworld-gg.mjs                # writes data/pals.json
//   node scripts/scrape-palworld-gg.mjs --dump ./dump  # also keep fetched files
//
// How it works (verified against the live site, July 2026): palworld.gg is a
// Nuxt app whose entire pal database ships as a bundled JS chunk (the module
// for "../data/pals/en.json"). We fetch a page, walk its /_nuxt/*.js scripts
// to find the import map entry for en.json, fetch that chunk, import it, and
// transform it with scripts/transform-palworld-gg.mjs. The chunk contains
// every pal's combiRank/combiPriority (breeding power), the full unique-combo
// list (including gender-locked combos), stats, and work suitabilities —
// the same data the site's own breeding calculator runs on.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { transformPalworldGG } from './transform-palworld-gg.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = opt('out', new URL('../data/pals.json', import.meta.url).pathname);
const DUMP = opt('dump', null);
const BASE = 'https://palworld.gg';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function get(url) {
  let text = null;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) text = await res.text();
    else if (!process.env.HTTPS_PROXY) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  } catch (e) {
    if (!process.env.HTTPS_PROXY) throw e;
  }
  if (text == null) {
    // Node's fetch ignores HTTPS_PROXY; in proxied environments fall back to curl,
    // which honors the proxy and CA environment configuration.
    const r = spawnSync('curl', ['-sS', '--fail', '--compressed', '-A', UA, url],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`GET ${url} failed (fetch and curl): ${r.stderr || r.error}`);
    text = r.stdout;
  }
  if (DUMP) {
    fs.mkdirSync(DUMP, { recursive: true });
    fs.writeFileSync(path.join(DUMP, url.split('/').pop().replace(/[^\w.-]/g, '_') || 'index.html'), text);
  }
  return text;
}

console.log('Fetching palworld.gg …');
const html = await get(BASE + '/pals');
const scripts = [...new Set([...html.matchAll(/\/_nuxt\/[\w.-]+\.js/g)].map((m) => m[0]))];
if (!scripts.length) throw new Error('no /_nuxt/*.js scripts found on ' + BASE + '/pals — site layout changed?');
console.log(`  scanning ${scripts.length} script chunks for the pal database import map …`);

let dataChunk = null;
for (const s of scripts) {
  const js = await get(BASE + s);
  const m = js.match(/"\.\.\/data\/pals\/en\.json":\(\)=>\w+\(\(\)=>import\("\.\/([\w.-]+\.js)"\)/);
  if (m) { dataChunk = m[1]; break; }
}
if (!dataChunk) {
  throw new Error(
    'could not locate the en.json data chunk in any script. The site bundling changed — ' +
    'rerun with --dump and look for the chunk that starts with pal objects (id/combiRank/…).'
  );
}
console.log(`  pal database chunk: /_nuxt/${dataChunk}`);

const chunkSrc = await get(BASE + '/_nuxt/' + dataChunk);
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'palgg-')), 'pals-en.mjs');
fs.writeFileSync(tmp, chunkSrc);
const db = (await import(pathToFileURL(tmp).href)).default;
if (!db || typeof db !== 'object') throw new Error('data chunk did not export a pal database object');

const out = transformPalworldGG(db, { source: 'palworld.gg' });
const breedable = out.pals.filter((p) => p.breedable).length;
console.log(`  extracted ${out.pals.length} pals (${breedable} breedable, ${out.uniqueCombos.length} unique combos)`);
if (out.pals.length < 250) {
  console.warn('WARNING: fewer pals than expected for 1.0 (287+); inspect with --dump before trusting this file.');
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${OUT}`);

// pal icons -> images/pals/{key}.png (only the ones we don't have yet)
if (!args.includes('--no-images')) {
  const imgDir = new URL('../images/pals/', import.meta.url).pathname;
  fs.mkdirSync(imgDir, { recursive: true });
  const missing = out.pals.filter((p) => p.icon && !fs.existsSync(path.join(imgDir, p.key + '.png')));
  console.log(`Downloading ${missing.length} pal images …`);
  let done = 0, failed = 0;
  for (const p of missing) {
    const url = `${BASE}/images/full_palicon/${p.icon}.png`;
    try {
      let buf = null;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (res.ok) buf = Buffer.from(await res.arrayBuffer());
      } catch { /* fall through to curl */ }
      if (!buf && process.env.HTTPS_PROXY) {
        const r = spawnSync('curl', ['-sS', '--fail', '-A', UA, url],
          { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
        if (r.status === 0) buf = r.stdout;
      }
      if (!buf || buf.length < 100) throw new Error('empty response');
      fs.writeFileSync(path.join(imgDir, p.key + '.png'), buf);
      done++;
      if (done % 50 === 0) console.log(`  ${done}/${missing.length}`);
    } catch (e) {
      failed++;
      console.warn(`  image failed for ${p.name}: ${e.message}`);
    }
  }
  console.log(`Images: ${done} downloaded, ${failed} failed, ${out.pals.length - missing.length} already present.`);
}
console.log('Run `npm test` to validate, then reload the site.');
