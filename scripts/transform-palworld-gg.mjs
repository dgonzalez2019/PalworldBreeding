// Transforms palworld.gg's pal database (the object exported by its bundled
// data chunk, e.g. /_nuxt/CK2A4_hG.js for "../data/pals/en.json") into this
// site's data/pals.json shape. Used by scrape-palworld-gg.mjs and reusable
// against a manually saved chunk.

const ELEMENT_NAMES = {
  Normal: 'Neutral', Leaf: 'Grass', Water: 'Water', Fire: 'Fire',
  Electricity: 'Electric', Dark: 'Dark', Earth: 'Ground', Ice: 'Ice', Dragon: 'Dragon',
};

const WORK_NAMES = {
  EmitFlame: 'kindling', Watering: 'watering', Seeding: 'planting',
  GenerateElectricity: 'electric', Handcraft: 'handiwork', Collection: 'gathering',
  Deforest: 'lumbering', Mining: 'mining', ProductMedicine: 'medicine',
  Cool: 'cooling', Transport: 'transporting', MonsterFarm: 'farming',
};

export function transformPalworldGG(db, { source = 'palworld.gg' } = {}) {
  const entries = Object.values(db).filter((p) => p && typeof p === 'object' && p.name);

  // mirror the site's own parent-pool filter (from its breeding-calculator code):
  // name && icon && !isBoss && combiRank && combiRank != 9999 && !(ignoreCombi && no combos)
  const isBreedable = (p) =>
    !!(p.name && p.icon && !p.isBoss && p.combiRank && p.combiRank !== 9999 &&
       !(p.ignoreCombi && !(p.combos || []).length));

  // global unique-combo list (each combo is duplicated onto every pal involved)
  const comboMap = new Map();
  for (const p of entries) {
    for (const c of p.combos || []) {
      const key = [c.a, c.b, c.child, c.ga || '', c.gb || ''].join('|');
      if (!comboMap.has(key)) {
        comboMap.set(key, {
          parents: [c.a, c.b],
          child: c.child,
          ...(c.ga ? { ga: c.ga } : {}),
          ...(c.gb ? { gb: c.gb } : {}),
        });
      }
    }
  }
  const uniqueCombos = [...comboMap.values()];
  const comboChildren = new Set(uniqueCombos.map((c) => c.child));

  const pals = entries
    .map((p) => ({
      key: p.id,
      paldex: p.index > 0 ? p.index : null, // crossover pals (Terraria) have index -1
      suffix: p.suffix || null,
      name: p.name,
      types: (p.elements || []).map((e) => ELEMENT_NAMES[e] || e),
      work: Object.fromEntries(
        Object.values(WORK_NAMES).map((k) => [k, 0])
      ),
      stats: Object.fromEntries(
        Object.entries({
          hp: p.stats?.hp, melee: p.stats?.melee, attack: p.stats?.shot,
          defense: p.stats?.defense, support: p.stats?.support,
          craftSpeed: p.stats?.craftSpeed, runSpeed: p.stats?.runSpeed,
          rideSpeed: p.stats?.rideSprintSpeed, price: p.stats?.price,
          stamina: p.stats?.stamina,
          // the game uses negative sentinels (e.g. rideSprintSpeed -1 = not rideable)
        }).map(([k, v]) => [k, v == null || v < 0 ? null : v])
      ),
      rarity: p.rarity ?? null,
      combiRank: p.combiRank ?? null,
      combiPriority: p.combiPriority ?? null,
      breedable: isBreedable(p),
      // never a generic nearest-rank child (only via unique combo / same species)
      uniqueOnly: !!(p.ignoreCombi || comboChildren.has(p.id)),
      partial: false,
      icon: p.icon || null, // source icon name; local copy lives at images/pals/{key}.png
      description: (p.description || '').replace(/\r\n/g, '\n'),
      partnerSkill: p.partnerSkill?.name
        ? { name: p.partnerSkill.name, desc: (p.partnerSkill.desc || '').replace(/\r\n/g, '\n') }
        : null,
      actives: (p.actives || []).map((a) => ({
        level: a.level, name: a.name, element: ELEMENT_NAMES[a.element] || a.element,
        power: a.power, cooldown: a.cooldown,
        desc: (a.desc || '').replace(/\r?\n/g, ' '),
      })),
      passives: (p.passives || []).map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean),
      drops: (p.drops || []).map((dr) => ({ name: dr.name, min: dr.min, max: dr.max, rate: dr.rate })),
    }))
    .map((out, i) => {
      const raw = entries[i];
      for (const [internal, mine] of Object.entries(WORK_NAMES)) {
        if (raw.work?.[internal]) out.work[mine] = raw.work[internal];
      }
      return out;
    })
    .sort((a, b) => (a.paldex ?? 9999) - (b.paldex ?? 9999) ||
      (a.suffix || '').localeCompare(b.suffix || '') || a.name.localeCompare(b.name));

  return {
    schema: 1,
    dataVersion: `${source} 1.0`,
    generatedAt: new Date().toISOString().slice(0, 10),
    notes: `Palworld 1.0 data extracted from ${source} (bundled game database, breeding algorithm ` +
      'mirrored from the site\'s own calculator: nearest combiRank to floor((a+b+1)/2), ' +
      'ties to higher combiPriority, unique combos with optional gender locks, ' +
      'uniqueOnly pals excluded from the generic pool).',
    breedingMode: 'rank',
    pals,
    uniqueCombos,
  };
}
