import { BreedingData } from './breeding.js';
import { findBreedingPlan, MAX_REQUIRED } from './pathfinder.js';

const WORK_KEYS = [
  ['kindling', '🔥', 'Kindling'],
  ['watering', '💧', 'Watering'],
  ['planting', '🌱', 'Planting'],
  ['electric', '⚡', 'Generating Electricity'],
  ['handiwork', '🔨', 'Handiwork'],
  ['gathering', '🧺', 'Gathering'],
  ['lumbering', '🪓', 'Lumbering'],
  ['mining', '⛏️', 'Mining'],
  ['medicine', '💊', 'Medicine Production'],
  ['cooling', '❄️', 'Cooling'],
  ['transporting', '📦', 'Transporting'],
  ['farming', '🐄', 'Farming'],
];

let data;

async function main() {
  let raw;
  try {
    raw = await (await fetch('data/pals.json')).json();
  } catch (e) {
    document.querySelector('main').innerHTML =
      '<div class="card error-card">Could not load <code>data/pals.json</code>. ' +
      'If you opened this file directly, serve the folder instead: <code>npm run serve</code> ' +
      '(browsers block fetch() on file:// pages).</div>';
    return;
  }
  data = new BreedingData(raw);

  const banner = document.getElementById('data-banner');
  if (raw.dataVersion?.startsWith('seed')) {
    banner.hidden = false;
    banner.innerHTML =
      `⚠️ <strong>Dataset: pre-1.0 seed</strong> — exact datamined base-game breeding table (paldex #1–111 + variants). ` +
      `Palworld 1.0 revised breeding combos and added pals up to #287. ` +
      `Run <code>npm run scrape</code> on your own machine to refresh from palworld.gg / paldb.cc (see README).`;
  }
  document.getElementById('footer-version').textContent =
    `Dataset: ${raw.dataVersion} (${raw.generatedAt}) · ${raw.pals.length} pals · mode: ${data.mode}`;

  setupTabs();
  setupDetailModal();
  setupBreedTab();
  setupParentsTab();
  setupPathTab();
  setupIndexTab();
}

/* ---------------- shared helpers ---------------- */

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dexLabel = (p) => (p.paldex ? '#' + String(p.paldex).padStart(3, '0') + (p.suffix || '') : '✦');
const gmark = (g) => (g === 'M' ? ' <span title="must be male">♂</span>' : g === 'F' ? ' <span title="must be female">♀</span>' : '');
const palImg = (key, size) =>
  `<img class="pimg" src="images/pals/${key}.png" width="${size}" height="${size}" alt="" loading="lazy" onerror="this.remove()">`;
const typeBadges = (p) => p.types.map((t) => `<span class="type ${t}">${t}</span>`).join(' ');
const palInline = (key) => {
  const p = data.get(key);
  return `<span class="pal-ref" data-pal="${key}" title="Click for details">${palImg(key, 28)} ` +
    `<span class="dexno">${dexLabel(p)}</span> <strong>${esc(p.name)}</strong> ${typeBadges(p)}</span>`;
};
const workSummary = (p) => {
  if (!p.work) return '<em>work data not in seed dataset</em>';
  const parts = WORK_KEYS.filter(([k]) => p.work[k] > 0).map(([k, icon]) => `${icon} Lv${p.work[k]}`);
  return parts.length ? parts.join(' · ') : 'no work suitability';
};

function palPicker(container, { placeholder = 'Type a pal name…', breedableOnly = false, onChange = () => {} } = {}) {
  const root = document.createElement('div');
  root.className = 'picker';
  root.innerHTML = `<input type="text" placeholder="${placeholder}" autocomplete="off"><div class="drop" hidden></div>`;
  container.appendChild(root);
  const input = root.querySelector('input');
  const drop = root.querySelector('.drop');
  let value = null;
  let hl = -1;
  let opts = [];

  const pool = () => (breedableOnly ? data.breedable : data.ordered);
  const render = (q) => {
    const needle = q.trim().toLowerCase();
    opts = pool().filter((p) => !needle || p.name.toLowerCase().includes(needle) || dexLabel(p).includes(needle));
    hl = -1;
    drop.innerHTML = opts.slice(0, 400).map((p, i) =>
      `<div class="opt" data-i="${i}">${palImg(p.key, 24)}<span class="dex">${dexLabel(p)}</span><span>${esc(p.name)}</span>${typeBadges(p)}</div>`
    ).join('') || '<div class="opt">no match</div>';
    drop.hidden = false;
  };
  const pick = (p) => {
    value = p ? p.key : null;
    input.value = p ? p.name : '';
    drop.hidden = true;
    onChange(value);
  };
  input.addEventListener('focus', () => render(input.value));
  input.addEventListener('input', () => { value = null; render(input.value); onChange(null); });
  input.addEventListener('keydown', (e) => {
    if (drop.hidden) return;
    const items = drop.querySelectorAll('.opt[data-i]');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      hl = Math.max(0, Math.min(items.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((el, i) => el.classList.toggle('hl', i === hl));
      items[hl]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(opts[hl >= 0 ? hl : 0]);
    } else if (e.key === 'Escape') { drop.hidden = true; }
  });
  drop.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.opt[data-i]');
    if (el) { e.preventDefault(); pick(opts[Number(el.dataset.i)]); }
  });
  document.addEventListener('mousedown', (e) => { if (!root.contains(e.target)) drop.hidden = true; });

  return {
    get value() { return value; },
    set(key) { pick(key ? data.get(key) : null); },
  };
}

/* ---------------- pal detail modal ---------------- */

function setupDetailModal() {
  const overlay = document.getElementById('detail-overlay');
  const card = document.getElementById('detail-card');
  const close = () => { overlay.hidden = true; };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !overlay.hidden) close(); });
  document.addEventListener('click', (e) => {
    const el = e.target.closest('.pal-ref');
    if (el?.dataset.pal) openDetail(el.dataset.pal);
    if (e.target.closest('.detail-close')) close();
  });

  function openDetail(key) {
    const p = data.get(key);
    if (!p) return;
    const stat = (label, v, suffix = '') =>
      v == null ? '' : `<div class="stat-cell">${label}<b>${v}${suffix}</b></div>`;
    const workCells = WORK_KEYS.map(([k, icon, label]) => {
      const v = p.work?.[k] ?? 0;
      return `<div class="work-cell ${v ? '' : 'off'}">${icon} ${label}<b>${v ? 'Lv ' + v : '—'}</b></div>`;
    }).join('');
    const moves = (p.actives || []).map((m) =>
      `<tr><td class="num">${m.level}</td><td><strong>${esc(m.name)}</strong><div class="move-desc">${esc(m.desc || '')}</div></td>` +
      `<td><span class="type ${m.element}">${m.element}</span></td><td class="num">${m.power ?? '—'}</td><td class="num">${m.cooldown ?? '—'}s</td></tr>`
    ).join('');
    const drops = (p.drops || []).map((d) =>
      `<span class="drop-chip"><b>${esc(d.name)}</b> ×${d.min === d.max ? d.min : d.min + '–' + d.max}${d.rate < 100 ? ` · ${d.rate}%` : ''}</span>`
    ).join('');
    card.innerHTML =
      `<div class="detail-head">
        ${palImg(key, 110)}
        <div class="detail-title">
          <h2>${esc(p.name)}</h2>
          <div>${typeBadges(p)}</div>
          <div class="detail-meta">
            <span>${p.paldex ? 'Paldeck ' + dexLabel(p) : 'Crossover pal'}</span>
            ${p.rarity ? `<span>Rarity ${p.rarity}</span>` : ''}
            ${p.combiRank ? `<span>Breeding power ${p.combiRank}</span>` : ''}
            ${p.uniqueOnly ? '<span>⭐ only from unique combos / same species</span>' : ''}
          </div>
        </div>
        <button class="detail-close" title="Close (Esc)">✕</button>
      </div>` +
      (p.description ? `<div class="detail-desc">${esc(p.description)}</div>` : '') +
      (p.partnerSkill ? `<div class="detail-sec"><h3>Partner skill</h3><div class="partner-skill"><b>${esc(p.partnerSkill.name)}</b><p>${esc(p.partnerSkill.desc)}</p></div></div>` : '') +
      (p.passives?.length ? `<div class="detail-sec"><h3>Innate passives</h3><div class="drops-line">${p.passives.map((x) => `<span class="drop-chip"><b>${esc(x)}</b></span>`).join('')}</div></div>` : '') +
      `<div class="detail-sec"><h3>Stats</h3><div class="stat-grid">` +
        stat('HP', p.stats?.hp) + stat('Attack', p.stats?.attack) + stat('Melee', p.stats?.melee) +
        stat('Defense', p.stats?.defense) + stat('Support', p.stats?.support) + stat('Craft speed', p.stats?.craftSpeed) +
        stat('Run speed', p.stats?.runSpeed) + stat('Ride sprint', p.stats?.rideSpeed) + stat('Stamina', p.stats?.stamina) +
        stat('Price', p.stats?.price) +
      `</div></div>` +
      `<div class="detail-sec"><h3>Work suitability</h3><div class="work-grid">${workCells}</div></div>` +
      (moves ? `<div class="detail-sec"><h3>Moves (learned by level)</h3><div style="overflow-x:auto"><table class="moves-table">
        <thead><tr><th>Lv</th><th>Move</th><th>Element</th><th>Power</th><th>CT</th></tr></thead><tbody>${moves}</tbody></table></div></div>` : '') +
      (drops ? `<div class="detail-sec"><h3>Drops</h3><div class="drops-line">${drops}</div></div>` : '');
    overlay.hidden = false;
    card.scrollTop = 0;
    overlay.scrollTop = 0;
  }
}

/* ---------------- tabs ---------------- */

function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach((t) =>
    t.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.toggle('active', x === t));
      document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + t.dataset.tab));
    })
  );
}

/* ---------------- tab 1: breed two pals ---------------- */

function setupBreedTab() {
  const result = document.getElementById('breed-result');
  const allBox = document.getElementById('breed-all');
  const update = () => {
    const a = pickA.value, b = pickB.value;
    result.innerHTML = '';
    allBox.innerHTML = '';
    if (a && b) {
      const results = data.childrenOf(a, b);
      if (!results.length) {
        result.innerHTML = `<div class="card error-card">No breeding result known for this pair.</div>`;
        return;
      }
      result.innerHTML = results.map(({ child, ga, gb }) => {
        const cp = data.get(child);
        return `<div class="card child-card">${palInline(a)}${gmark(ga)} <span class="arrow">＋</span> ${palInline(b)}${gmark(gb)} <span class="arrow">→</span>` +
          `<span class="pal-ref" data-pal="${child}" title="Click for details">${palImg(child, 72)}</span>` +
          `<div><div class="pal-big pal-ref" data-pal="${child}" title="Click for details">${esc(cp.name)} <span class="dexno">${dexLabel(cp)}</span> ${typeBadges(cp)}</div>` +
          `<div class="works-line">${workSummary(cp)}</div></div></div>`;
      }).join('');
    }
    const solo = a && !b ? a : b && !a ? b : null;
    if (solo) {
      const rows = data.breedable.flatMap((p) =>
        data.childrenOf(solo, p.key).map(({ child, ga, gb }) =>
          `<div class="pair-row"><span>${palInline(p.key)}${gmark(gb)}</span><span class="x">→</span><span>${palInline(child)}</span></div>`
        )
      );
      allBox.innerHTML =
        `<div class="count-line">${esc(data.get(solo).name)} × every partner (${rows.length} combos):</div>` +
        `<div class="pair-list">${rows.join('')}</div>`;
    }
  };
  const pickA = palPicker(document.getElementById('breed-a'), { breedableOnly: true, onChange: update });
  const pickB = palPicker(document.getElementById('breed-b'), { breedableOnly: true, onChange: update });
}

/* ---------------- tab 2: find parents ---------------- */

function setupParentsTab() {
  const result = document.getElementById('parents-result');
  let showAll = false;
  const update = () => {
    result.innerHTML = '';
    const target = pickT.value;
    if (!target) return;
    let pairs = data.parentsOf(target);
    const inc = pickF.value;
    if (inc) pairs = pairs.filter(({ a, b }) => a === inc || b === inc);
    if (!pairs.length) {
      result.innerHTML = `<div class="card">No parent combination produces ${esc(data.get(target).name)}${inc ? ' together with ' + esc(data.get(inc).name) : ''}.</div>`;
      return;
    }
    const LIMIT = 150;
    const shown = showAll ? pairs : pairs.slice(0, LIMIT);
    result.innerHTML =
      `<div class="count-line">${pairs.length} combination${pairs.length === 1 ? '' : 's'} produce${pairs.length === 1 ? 's' : ''} ${palInline(target)}:</div>` +
      `<div class="pair-list">${shown.map(({ a, b, ga, gb }) => `<div class="pair-row"><span>${palInline(a)}${gmark(ga)}</span><span class="x">＋</span><span>${palInline(b)}${gmark(gb)}</span></div>`).join('')}</div>` +
      (pairs.length > shown.length ? `<p><button class="more" id="parents-more">Show all ${pairs.length}</button></p>` : '');
    document.getElementById('parents-more')?.addEventListener('click', () => { showAll = true; update(); });
  };
  const pickT = palPicker(document.getElementById('parents-target'), { breedableOnly: true, onChange: () => { showAll = false; update(); } });
  const pickF = palPicker(document.getElementById('parents-filter'), { breedableOnly: true, onChange: () => { showAll = false; update(); } });
}

/* ---------------- tab 3: breeding path ---------------- */

function setupPathTab() {
  const listEl = document.getElementById('owned-list');
  const countEl = document.getElementById('owned-count');
  const resultEl = document.getElementById('path-result');
  const chipsEl = document.getElementById('required-chips');
  const owned = new Set(JSON.parse(localStorage.getItem('pb-owned') || '[]').filter((k) => data.get(k)));
  const required = [];

  const save = () => localStorage.setItem('pb-owned', JSON.stringify([...owned]));
  const renderOwned = (q = '') => {
    const needle = q.trim().toLowerCase();
    countEl.textContent = owned.size;
    listEl.innerHTML = data.breedable
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .map((p) => `<span class="pal-chip ${owned.has(p.key) ? 'on' : ''}" data-k="${p.key}">${esc(p.name)}</span>`)
      .join('');
  };
  listEl.addEventListener('click', (e) => {
    const el = e.target.closest('.pal-chip');
    if (!el) return;
    const k = el.dataset.k;
    owned.has(k) ? owned.delete(k) : owned.add(k);
    el.classList.toggle('on');
    countEl.textContent = owned.size;
    save();
  });
  document.getElementById('owned-search').addEventListener('input', (e) => renderOwned(e.target.value));
  document.getElementById('owned-clear').addEventListener('click', () => { owned.clear(); save(); renderOwned(document.getElementById('owned-search').value); });

  const renderChips = () => {
    chipsEl.innerHTML = required.map((k, i) => `<span class="chip" data-i="${i}" title="click to remove">${esc(data.get(k).name)}</span>`).join('');
  };
  chipsEl.addEventListener('click', (e) => {
    const el = e.target.closest('.chip');
    if (el) { required.splice(Number(el.dataset.i), 1); renderChips(); }
  });
  const pickReq = palPicker(document.getElementById('path-required'), {
    breedableOnly: true,
    placeholder: 'Add a required pal…',
    onChange: (k) => {
      if (!k) return;
      if (required.length >= MAX_REQUIRED) return;
      if (!required.includes(k)) required.push(k);
      renderChips();
      pickReq.set(null);
    },
  });
  const pickTarget = palPicker(document.getElementById('path-target'), { breedableOnly: true, placeholder: 'Pal you want to breed…' });

  document.getElementById('path-go').addEventListener('click', () => {
    const target = pickTarget.value;
    if (!target) { resultEl.innerHTML = '<div class="card error-card">Pick a target pal first.</div>'; return; }
    if (!owned.size) { resultEl.innerHTML = '<div class="card error-card">Select at least one owned pal.</div>'; return; }
    const plan = findBreedingPlan(data, [...owned], target, required);
    if (!plan.ok) {
      resultEl.innerHTML =
        `<div class="card error-card">${esc(plan.reason)}<br><span style="color:var(--muted)">Tip: legendaries and some special pals can only be bred ` +
        `from themselves or from specific unique combos — you may need to catch one (or a required parent) in the wild first.</span></div>`;
      return;
    }
    if (!plan.steps) {
      resultEl.innerHTML = `<div class="card">You already own ${palInline(target)} — no breeding needed.</div>`;
      return;
    }
    const reqSet = new Set(required);
    const steps = plan.stepList.map((s) =>
      `<li><span class="stepno">${s.step}</span> ${palInline(s.a)} <span class="x">＋</span> ${palInline(s.b)} <span class="x">→</span> ${palInline(s.child)}` +
      (reqSet.has(s.a) || reqSet.has(s.b) ? ' <span class="req-mark">★ uses required pal</span>' : '') + '</li>'
    ).join('');
    resultEl.innerHTML =
      `<div class="count-line">${plan.steps} breeding step${plan.steps === 1 ? '' : 's'}:</div>` +
      `<ol class="step-list">${steps}</ol>` +
      `<div class="card"><strong>Breeding tree</strong><div class="tree">${renderTree(plan.tree)}</div></div>`;
  });

  renderOwned();
}

function renderTree(node) {
  const li = (n) => {
    if (n.owned) return `<li>${palInline(n.key)} <span class="tag owned">owned</span></li>`;
    if (n.ref) return `<li>${palInline(n.key)} <span class="tag ref">bred in step ${n.ref}</span></li>`;
    return `<li>${palInline(n.key)} <span class="tag bred">step ${n.step}</span><ul>${n.parents.map(li).join('')}</ul></li>`;
  };
  return `<ul>${li(node)}</ul>`;
}

/* ---------------- tab 4: pal index ---------------- */

function setupIndexTab() {
  const table = document.getElementById('index-table');
  const search = document.getElementById('index-search');
  const typeSel = document.getElementById('index-type');
  const modeSeg = document.getElementById('index-mode');
  let mode = 'stats';
  let sortKey = 'paldex';
  let sortDir = 1; // 1 asc, -1 desc

  const types = [...new Set(data.ordered.flatMap((p) => p.types))].sort();
  typeSel.innerHTML += types.map((t) => `<option>${t}</option>`).join('');

  const STAT_COLS = [
    ['hp', 'HP'], ['attack', 'Attack'], ['melee', 'Melee'], ['defense', 'Defense'],
    ['support', 'Support'], ['craftSpeed', 'Craft'], ['runSpeed', 'Run'], ['rideSpeed', 'Ride Sprint'],
    ['stamina', 'Stamina'], ['price', 'Price'], ['rarity', 'Rarity'],
  ];

  const getVal = (p, key) => {
    if (key === 'paldex') return p.paldex == null ? null : p.paldex + (p.suffix ? 0.5 : 0);
    if (key === 'name') return p.name;
    if (key === 'rarity') return p.rarity ?? null;
    if (key.startsWith('w:')) return p.work ? p.work[key.slice(2)] ?? null : null;
    return p.stats[key] ?? null;
  };

  const render = () => {
    const needle = search.value.trim().toLowerCase();
    const type = typeSel.value;
    let rows = data.ordered.filter(
      (p) => (!needle || p.name.toLowerCase().includes(needle)) && (!type || p.types.includes(type))
    );
    const dex = (p) => p.paldex ?? 10000;
    rows.sort((a, b) => {
      const va = getVal(a, sortKey), vb = getVal(b, sortKey);
      if (va == null && vb == null) return dex(a) - dex(b);
      if (va == null) return 1; // unknown values always sink to the bottom
      if (vb == null) return -1;
      const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
      return cmp * sortDir || dex(a) - dex(b);
    });

    const cols = [['paldex', '#'], ['name', 'Name'], ['types', 'Types']];
    if (mode === 'stats') cols.push(...STAT_COLS);
    else cols.push(...WORK_KEYS.map(([k, icon, label]) => ['w:' + k, `${icon}<br>${label.split(' ')[0]}`]));

    table.innerHTML =
      '<thead><tr><th></th>' +
      cols.map(([k, label]) =>
        `<th data-k="${k}" class="${k === sortKey ? 'sorted' : ''}" title="click to sort">${label}${k === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : ''}</th>`
      ).join('') +
      '</tr></thead><tbody>' +
      rows.map((p) => {
        let tds = `<td>${palImg(p.key, 36)}</td><td class="num">${dexLabel(p)}</td>` +
          `<td><strong>${esc(p.name)}</strong>${p.partial ? ' <span class="dexno">(partial data)</span>' : ''}</td><td>${typeBadges(p)}</td>`;
        for (const [k] of cols.slice(3)) {
          const v = getVal(p, k);
          if (v == null) tds += '<td class="num partial">—</td>';
          else if (k.startsWith('w:')) tds += `<td class="num ${v === 0 ? 'zero' : ''}">${v > 0 ? `<span class="wk wk${Math.min(v, 4)}">${v}</span>` : '·'}</td>`;
          else tds += `<td class="num">${v}</td>`;
        }
        return `<tr class="pal-ref" data-pal="${p.key}" title="Click for details">${tds}</tr>`;
      }).join('') +
      '</tbody>';

    table.querySelectorAll('th').forEach((th) =>
      th.addEventListener('click', () => {
        const k = th.dataset.k;
        if (!k || k === 'types') return;
        if (sortKey === k) sortDir *= -1;
        else { sortKey = k; sortDir = k === 'name' || k === 'paldex' ? 1 : -1; } // numeric cols: high→low first
        render();
      })
    );
  };

  search.addEventListener('input', render);
  typeSel.addEventListener('change', render);
  modeSeg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    mode = b.dataset.mode;
    modeSeg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    if (sortKey.startsWith('w:') && mode === 'stats') { sortKey = 'paldex'; sortDir = 1; }
    if (STAT_COLS.some(([k]) => k === sortKey) && mode === 'work') { sortKey = 'paldex'; sortDir = 1; }
    render();
  });

  render();
}

main();
