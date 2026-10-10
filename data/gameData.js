// Catálogo del minijuego de expediciones. Nombres de objetos: data/arsenal.js y data/exclusive.js; de zonas: locales/*.js.
const arsenal = require('./arsenal');
const exclusive = require('./exclusive');
const { pickRandom } = require('../utils/helpers');

const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary']; // rarezas "normales", de menor a mayor
const SLOTS = ['weapon', 'armor', 'helmet'];

const RARITY_INFO = {
  common:    { emoji: '⚪', weight: 60, coinks: [10, 25],   color: 0x95a5a6 },
  uncommon:  { emoji: '🟢', weight: 25, coinks: [30, 75],   color: 0x2ecc71 },
  rare:      { emoji: '🔵', weight: 10, coinks: [100, 200], color: 0x3498db },
  epic:      { emoji: '🟣', weight: 4,  coinks: [300, 500], color: 0x9b59b6 },
  legendary: { emoji: '🟠', weight: 1,  coinks: [750, 1000], color: 0xe67e22 },
  event:     { emoji: '🌟', color: 0xe91e63 }, // rareza única de los objetos de evento (no entra en sorteos normales)
};

// ITEMS[id] = { type, rarity, bonus, source: 'normal'|'shop'|'event', maxUses: null|número, perk: null|{loot,revive}, sellable }
const ITEMS = {};
for (const i of arsenal.list) ITEMS[i.id] = { type: i.type, rarity: i.rarity, bonus: i.bonus, source: 'normal', maxUses: null, perk: null, sellable: true };
for (const i of exclusive.list) {
  if (ITEMS[i.id]) throw new Error(`Objeto duplicado: ${i.id}`);
  ITEMS[i.id] = { type: i.type, rarity: i.rarity, bonus: i.bonus, source: i.source, event: i.event, maxUses: exclusive.USES_BY_RARITY[i.rarity], perk: i.perk, sellable: false };
}

/**
 * Zonas. Recompensa estrictamente proporcional: rewardMult = (minutos / 10) × dificultad.
 *   gearEff : eficacia del equipo NORMAL en la zona (el equipo exclusivo siempre rinde al 100%).
 *             En las zonas largas el equipo normal rinde cada vez menos, así que hace falta el equipo de la tienda rotativa.
 */
const zone = (id, emoji, minutes, difficulty, baseSurvival, luck, gearEff, dropChance) => ({
  id, emoji, minutes, durationMs: minutes * 60_000, difficulty, baseSurvival, luck, gearEff, dropChance,
  rewardMult: Math.round((minutes / 10) * difficulty * 100) / 100,
});
const ZONES = {
  bosque: zone('bosque', '🌲', 10, 1.0, 0.70, 1.0, 1.0, 0.30),
  cueva:  zone('cueva',  '🕳️', 30, 1.15, 0.55, 1.2, 1.0, 0.32),
  volcan: zone('volcan', '🌋', 60, 1.3, 0.40, 1.5, 0.9, 0.35),
  ruinas: zone('ruinas', '🏛️', 240, 1.4, 0.25, 1.6, 0.7, 0.45),
  abismo: zone('abismo', '🌀', 720, 1.6, 0.12, 1.8, 0.5, 0.60),
  trono:  zone('trono',  '🐉', 1440, 1.8, 0.05, 2.0, 0.35, 0.80),
};

const DROP_SLOT_WEIGHTS = { weapon: 40, armor: 40, helmet: 20 };

// --- Venta (solo objetos normales) ---
const SELL_PRICE = { common: 8, uncommon: 25, rare: 80, epic: 250, legendary: 800 };

// --- Fusión (solo objetos normales) ---
const FUSION = {
  common:   { next: 'uncommon',  count: 3, distinct: 1, fee: 0,    chance: 1.0 },
  uncommon: { next: 'rare',      count: 4, distinct: 2, fee: 50,   chance: 0.9 },
  rare:     { next: 'epic',      count: 5, distinct: 3, fee: 300,  chance: 0.75 },
  epic:     { next: 'legendary', count: 6, distinct: 4, fee: 1500, chance: 0.6 },
};
const FUSION_CONSOLATION = 0.5;

// --- Cancelar una expedición: coste = feePerMult × rewardMult × (minFraction + resto × fracción de tiempo transcurrido) ---
// Cuanto antes cancelas (p. ej. porque olvidaste equipar algo), menos pagas; nunca baja de minFee.
const CANCEL = { feePerMult: 12, minFraction: 0.4, minFee: 5 };

const isNormal = (id) => ITEMS[id]?.source === 'normal';
/** Solo objetos NORMALES: los exclusivos nunca caen en expediciones, cajas ni fusiones. */
const itemsOf = (type, rarity) => Object.keys(ITEMS).filter((id) => isNormal(id) && ITEMS[id].type === type && ITEMS[id].rarity === rarity);
const requiredDistinct = (type, rarity) => Math.min(FUSION[rarity]?.distinct ?? 1, itemsOf(type, rarity).length);
const rollItemOfType = (type, rarity) => pickRandom(itemsOf(type, rarity));

function rollItemId(rarity) {
  const total = Object.values(DROP_SLOT_WEIGHTS).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  let slot = 'weapon';
  for (const [s, w] of Object.entries(DROP_SLOT_WEIGHTS)) {
    r -= w;
    if (r < 0) { slot = s; break; }
  }
  return rollItemOfType(slot, rarity);
}

/** Bonus de supervivencia del equipo en una zona: normal × eficacia de la zona + exclusivo al 100%. */
function gearBonus(zone, equipped) {
  let normal = 0;
  let exclusive = 0;
  for (const slot of SLOTS) {
    const it = ITEMS[equipped?.[slot]];
    if (!it) continue;
    if (it.source === 'normal') normal += it.bonus;
    else exclusive += it.bonus;
  }
  return normal * zone.gearEff + exclusive;
}

/** Perks sumados del equipo: { loot: +fracción de Coinks, revive: prob. de sobrevivir a la muerte (máx. 50%) }. */
function perksOf(equipped) {
  let loot = 0;
  let revive = 0;
  for (const slot of SLOTS) {
    const p = ITEMS[equipped?.[slot]]?.perk;
    if (p) { loot += p.loot || 0; revive += p.revive || 0; }
  }
  return { loot, revive: Math.min(revive, 0.5) };
}

module.exports = {
  RARITIES, SLOTS, RARITY_INFO, ITEMS, ZONES,
  SELL_PRICE, FUSION, FUSION_CONSOLATION, CANCEL, DROP_SLOT_WEIGHTS,
  isNormal, itemsOf, requiredDistinct, rollItemOfType, rollItemId, gearBonus, perksOf,
  SHOP_PRICE: exclusive.SHOP_PRICE, SHOP_STOCK: exclusive.SHOP_STOCK, USES_BY_RARITY: exclusive.USES_BY_RARITY,
  MAX_SURVIVAL: 0.95,
  ITEM_DROP_CHANCE: 0.3, // respaldo; cada zona define su propio dropChance
};
