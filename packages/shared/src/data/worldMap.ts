import type { LinkKind, MapDef, TerritoryDef } from '../types.js';

/**
 * Modern Earth, 48 territories.
 *
 * lon/lat are real geographic centres — the client projects them (equirectangular)
 * so the same data drives the map at any resolution and a higher-fidelity map is a
 * data swap, not a code change.
 *
 * Design notes:
 *  - basePop is in thousands, compressed (not real population) so no single region
 *    dominates. Economy/pop spread is roughly 1:4 between the weakest and strongest.
 *  - Adjacency is authored as an undirected edge list so it cannot go asymmetric.
 */

const T = (
  id: string, name: string, continent: TerritoryDef['continent'],
  lon: number, lat: number, terrain: TerritoryDef['terrain'],
  basePop: number, baseEcon: number,
  resources: TerritoryDef['resources'], slots: number, coastal: boolean,
): TerritoryDef => ({ id, name, continent, lon, lat, terrain, basePop, baseEcon, resources, slots, coastal });

const territories: TerritoryDef[] = [
  // ── North America ───────────────────────────────────────────────────────
  T('alaska',        'Alaska',           'north_america', -152,  64, 'tundra',   120, 0.6, { oil: 1.8, materials: 1.0, food: 0.3 }, 3, true),
  T('west_canada',   'Western Canada',   'north_america', -115,  55, 'forest',   380, 1.0, { oil: 1.6, materials: 1.5, food: 0.8 }, 4, true),
  T('east_canada',   'Eastern Canada',   'north_america',  -75,  50, 'forest',   620, 1.2, { oil: 0.6, materials: 1.3, food: 0.9 }, 4, true),
  T('greenland',     'Greenland',        'north_america',  -42,  72, 'tundra',    40, 0.3, { oil: 0.9, materials: 1.1, food: 0.2 }, 2, true),
  T('west_usa',      'Western USA',      'north_america', -119,  38, 'city',     980, 1.9, { oil: 1.1, materials: 0.9, food: 1.0 }, 5, true),
  T('central_usa',   'Central USA',      'north_america',  -98,  40, 'plains',   760, 1.5, { oil: 1.4, materials: 1.0, food: 1.9 }, 5, false),
  T('east_usa',      'Eastern USA',      'north_america',  -78,  39, 'city',    1150, 2.1, { oil: 0.6, materials: 1.0, food: 1.0 }, 6, true),
  T('mexico',        'Mexico',           'north_america', -102,  23, 'desert',   720, 1.0, { oil: 1.7, materials: 1.1, food: 0.7 }, 4, true),
  T('central_america','Central America', 'north_america',  -86,  13, 'forest',   320, 0.7, { oil: 0.5, materials: 0.8, food: 1.3 }, 3, true),
  T('caribbean',     'Caribbean',        'north_america',  -73,  19, 'coast',    280, 0.8, { oil: 0.7, materials: 0.4, food: 1.0 }, 3, true),

  // ── South America ───────────────────────────────────────────────────────
  T('colombia',      'Gran Colombia',    'south_america',  -73,   5, 'forest',   520, 0.9, { oil: 1.6, materials: 0.9, food: 1.2 }, 4, true),
  T('peru',          'Andes',            'south_america',  -75, -10, 'mountain', 380, 0.7, { oil: 0.8, materials: 1.9, food: 0.6 }, 3, true),
  T('brazil_north',  'Northern Brazil',  'south_america',  -55,  -5, 'forest',   680, 1.1, { oil: 1.0, materials: 1.6, food: 1.4 }, 4, true),
  T('brazil_south',  'Southern Brazil',  'south_america',  -47, -22, 'city',     820, 1.4, { oil: 0.9, materials: 1.1, food: 1.5 }, 5, true),
  T('argentina',     'Argentina',        'south_america',  -64, -35, 'plains',   460, 1.0, { oil: 1.1, materials: 0.9, food: 1.9 }, 4, true),
  T('chile',         'Chile',            'south_america',  -71, -35, 'mountain', 300, 0.8, { oil: 0.4, materials: 2.0, food: 0.7 }, 3, true),

  // ── Europe ──────────────────────────────────────────────────────────────
  T('iceland',       'Iceland',          'europe',         -19,  65, 'tundra',    60, 0.5, { oil: 0.3, materials: 0.6, food: 0.8 }, 2, true),
  T('uk',            'British Isles',    'europe',          -3,  54, 'city',     720, 1.8, { oil: 0.8, materials: 0.7, food: 0.9 }, 5, true),
  T('scandinavia',   'Scandinavia',      'europe',          16,  62, 'forest',   420, 1.4, { oil: 1.5, materials: 1.5, food: 0.7 }, 4, true),
  T('france',        'France',           'europe',           2,  47, 'city',     680, 1.7, { oil: 0.4, materials: 0.9, food: 1.5 }, 5, true),
  T('iberia',        'Iberia',           'europe',          -4,  40, 'coast',    560, 1.2, { oil: 0.3, materials: 0.9, food: 1.3 }, 4, true),
  T('germany',       'Germany',          'europe',          10,  51, 'city',     820, 2.0, { oil: 0.4, materials: 1.4, food: 1.1 }, 6, true),
  T('italy',         'Italy',            'europe',          12,  43, 'coast',    600, 1.5, { oil: 0.3, materials: 0.8, food: 1.2 }, 4, true),
  T('poland',        'Poland & Baltics', 'europe',          20,  52, 'plains',   520, 1.1, { oil: 0.6, materials: 1.2, food: 1.4 }, 4, true),
  T('balkans',       'Balkans',          'europe',          22,  43, 'mountain', 440, 0.9, { oil: 0.5, materials: 1.3, food: 1.0 }, 4, true),
  T('ukraine',       'Ukraine',          'europe',          32,  49, 'plains',   480, 0.9, { oil: 0.7, materials: 1.3, food: 2.0 }, 4, true),
  T('west_russia',   'Western Russia',   'europe',          42,  57, 'forest',   760, 1.4, { oil: 2.0, materials: 1.6, food: 1.0 }, 5, true),

  // ── Africa ──────────────────────────────────────────────────────────────
  T('morocco',       'Maghreb',          'africa',          -6,  32, 'desert',   420, 0.7, { oil: 1.2, materials: 1.1, food: 0.6 }, 3, true),
  T('egypt',         'Egypt',            'africa',          30,  27, 'desert',   560, 0.9, { oil: 1.3, materials: 0.7, food: 0.7 }, 4, true),
  T('west_africa',   'West Africa',      'africa',           0,  10, 'forest',   740, 0.8, { oil: 1.9, materials: 1.2, food: 1.1 }, 4, true),
  T('central_africa','Central Africa',   'africa',          20,   0, 'forest',   520, 0.6, { oil: 1.4, materials: 2.0, food: 1.0 }, 4, false),
  T('horn_africa',   'Horn of Africa',   'africa',          43,   8, 'desert',   400, 0.5, { oil: 0.9, materials: 0.8, food: 0.5 }, 3, true),
  T('east_africa',   'East Africa',      'africa',          36,  -6, 'plains',   560, 0.7, { oil: 0.7, materials: 1.2, food: 1.3 }, 4, true),
  T('south_africa',  'Southern Africa',  'africa',          25, -28, 'plains',   480, 1.0, { oil: 0.6, materials: 2.0, food: 1.1 }, 4, true),

  // ── Middle East ─────────────────────────────────────────────────────────
  T('turkey',        'Anatolia',         'middle_east',     35,  39, 'mountain', 560, 1.1, { oil: 0.6, materials: 1.2, food: 1.1 }, 4, true),
  T('levant',        'Levant',           'middle_east',     37,  33, 'desert',   440, 0.9, { oil: 1.1, materials: 0.7, food: 0.6 }, 3, true),
  T('arabia',        'Arabia',           'middle_east',     45,  24, 'desert',   480, 1.3, { oil: 2.5, materials: 0.6, food: 0.3 }, 4, true),
  T('iran',          'Iran',             'middle_east',     53,  32, 'mountain', 600, 1.0, { oil: 2.2, materials: 1.2, food: 0.7 }, 4, true),

  // ── Asia ────────────────────────────────────────────────────────────────
  T('central_asia',  'Central Asia',     'asia',            65,  45, 'plains',   420, 0.8, { oil: 1.8, materials: 1.4, food: 1.0 }, 4, false),
  T('siberia',       'Siberia',          'asia',            95,  62, 'tundra',   260, 0.7, { oil: 2.2, materials: 1.8, food: 0.4 }, 4, true),
  T('india',         'India',            'asia',            78,  22, 'plains',  1200, 1.5, { oil: 0.7, materials: 1.2, food: 1.7 }, 6, true),
  T('china_west',    'Western China',    'asia',            90,  35, 'mountain', 620, 1.1, { oil: 1.4, materials: 1.9, food: 0.7 }, 5, false),
  T('china_east',    'Eastern China',    'asia',           117,  32, 'city',    1300, 2.1, { oil: 0.8, materials: 1.3, food: 1.4 }, 6, true),
  T('korea_japan',   'Korea & Japan',    'asia',           135,  37, 'city',     880, 2.0, { oil: 0.2, materials: 0.7, food: 0.8 }, 5, true),
  T('southeast_asia','Southeast Asia',   'asia',           103,  14, 'forest',   820, 1.2, { oil: 1.2, materials: 1.3, food: 1.6 }, 5, true),
  T('indonesia',     'Indonesia',        'asia',           113,  -3, 'coast',    760, 1.0, { oil: 1.6, materials: 1.4, food: 1.3 }, 4, true),

  // ── Oceania ─────────────────────────────────────────────────────────────
  T('australia',     'Australia',        'oceania',        134, -25, 'desert',   420, 1.3, { oil: 1.3, materials: 2.2, food: 1.0 }, 4, true),
  T('new_zealand',   'New Zealand',      'oceania',        172, -41, 'coast',    140, 0.7, { oil: 0.3, materials: 0.7, food: 1.4 }, 3, true),
];

const S: LinkKind = 'sea';

const edges: Array<[string, string, LinkKind?]> = [
  // North America
  ['alaska', 'west_canada'], ['alaska', 'siberia', S],
  ['west_canada', 'east_canada'], ['west_canada', 'west_usa'], ['west_canada', 'central_usa'],
  ['east_canada', 'east_usa'], ['east_canada', 'central_usa'], ['east_canada', 'greenland', S],
  ['west_usa', 'central_usa'], ['central_usa', 'east_usa'],
  ['west_usa', 'mexico'], ['central_usa', 'mexico'],
  ['mexico', 'central_america'], ['central_america', 'caribbean', S],
  ['caribbean', 'east_usa', S], ['greenland', 'iceland', S],
  // North Pacific crossing: Alaska is the gateway to eastern Asia (in addition to
  // the Siberia link).
  ['alaska', 'korea_japan', S],

  // South America
  ['central_america', 'colombia'], ['colombia', 'peru'], ['colombia', 'brazil_north'],
  ['peru', 'brazil_north'], ['peru', 'brazil_south'], ['peru', 'chile'],
  ['brazil_north', 'brazil_south'], ['brazil_south', 'argentina'], ['argentina', 'chile'],
  ['brazil_north', 'west_africa', S], ['argentina', 'south_africa', S],
  // South Pacific crossing: Chile is the Americas' window onto Oceania.
  ['chile', 'new_zealand', S],

  // Europe
  ['iceland', 'uk', S], ['uk', 'france', S], ['uk', 'scandinavia', S], ['uk', 'east_canada', S],
  ['scandinavia', 'germany'], ['scandinavia', 'poland', S], ['scandinavia', 'west_russia'],
  ['france', 'iberia'], ['france', 'germany'], ['france', 'italy'],
  ['germany', 'poland'], ['germany', 'italy'],
  ['italy', 'balkans', S], ['italy', 'iberia', S],
  ['poland', 'ukraine'], ['poland', 'balkans'],
  ['balkans', 'ukraine'], ['balkans', 'turkey'],
  ['ukraine', 'west_russia'], ['ukraine', 'turkey', S],
  ['iberia', 'morocco', S], ['italy', 'egypt', S],

  // Africa
  ['morocco', 'west_africa'], ['morocco', 'egypt'],
  ['west_africa', 'central_africa'], ['central_africa', 'east_africa'],
  ['central_africa', 'south_africa'], ['east_africa', 'south_africa'],
  ['east_africa', 'horn_africa'], ['horn_africa', 'egypt'], ['egypt', 'levant'],
  ['east_africa', 'central_africa'],

  // Middle East
  ['turkey', 'levant'], ['turkey', 'iran'], ['levant', 'arabia'],
  ['arabia', 'iran'], ['arabia', 'horn_africa', S], ['arabia', 'india', S],
  ['iran', 'central_asia'], ['iran', 'india'],

  // Asia
  ['central_asia', 'west_russia'], ['central_asia', 'siberia'], ['central_asia', 'china_west'],
  ['siberia', 'china_east'], ['siberia', 'west_russia'], ['siberia', 'korea_japan', S],
  ['china_west', 'china_east'], ['china_west', 'india'],
  ['china_east', 'korea_japan', S], ['china_east', 'southeast_asia'],
  ['india', 'southeast_asia'], ['southeast_asia', 'indonesia', S],

  // Oceania
  ['indonesia', 'australia', S], ['australia', 'new_zealand', S],
];

/**
 * Starting territories, ordered so that the first N picks are always well spread —
 * a 2-player match starts on opposite sides of the world, an 8-player match fills
 * every continent before doubling up.
 */
const starts = [
  'east_usa', 'china_east', 'germany', 'brazil_south',
  'india', 'south_africa', 'west_russia', 'australia',
  'mexico', 'uk',
];

export const EARTH_MODERN: MapDef = {
  id: 'earth_modern',
  name: 'Modern Earth',
  territories,
  edges,
  starts,
};

// ── derived lookups (built once at module load) ─────────────────────────────

export const TERRITORY_DEFS: Record<string, TerritoryDef> = Object.fromEntries(
  territories.map((t) => [t.id, t]),
);

export interface Link {
  to: string;
  kind: LinkKind;
  /** Great-circle-ish distance in map units, used to scale travel time. */
  distance: number;
}

function haversineish(a: TerritoryDef, b: TerritoryDef): number {
  // Cheap equirectangular approximation — good enough for travel-time scaling and
  // far cheaper than a real haversine in the hot path.
  const dLon = Math.abs(a.lon - b.lon) > 180 ? 360 - Math.abs(a.lon - b.lon) : a.lon - b.lon;
  const x = dLon * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = a.lat - b.lat;
  return Math.sqrt(x * x + y * y);
}

function buildAdjacency(map: MapDef): Record<string, Link[]> {
  const adj: Record<string, Link[]> = {};
  for (const t of map.territories) adj[t.id] = [];
  for (const [a, b, kind] of map.edges) {
    const da = TERRITORY_DEFS[a];
    const db = TERRITORY_DEFS[b];
    if (!da || !db) throw new Error(`Map edge references unknown territory: ${a} <-> ${b}`);
    const distance = haversineish(da, db);
    adj[a]!.push({ to: b, kind: kind ?? 'land', distance });
    adj[b]!.push({ to: a, kind: kind ?? 'land', distance });
  }
  return adj;
}

export const ADJACENCY: Record<string, Link[]> = buildAdjacency(EARTH_MODERN);

export function areAdjacent(a: string, b: string): boolean {
  return (ADJACENCY[a] ?? []).some((l) => l.to === b);
}

export function linkBetween(a: string, b: string): Link | undefined {
  return (ADJACENCY[a] ?? []).find((l) => l.to === b);
}

/** Median link distance — used to normalise unit speed so 1.0 speed ≈ 1 link/minute. */
export const AVERAGE_LINK_DISTANCE = (() => {
  const all = Object.values(ADJACENCY).flat().map((l) => l.distance);
  return all.reduce((s, d) => s + d, 0) / Math.max(1, all.length);
})();
