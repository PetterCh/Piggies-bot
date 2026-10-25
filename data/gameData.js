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
  legendary: { emoji: '🟡', weight: 1,  coinks: [750, 1000], color: 0xe67e22 },
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
 * Zonas (rebalanceo v7.10). El multiplicador de Coinks ya NO sale de minutos × dificultad: se fija a mano para controlar la inflación.
 *   baseSurvival : probabilidad base de volver con vida (el equipo la sube, tope MAX_SURVIVAL)
 *   rewardMult   : multiplicador de Coinks de la zona
 *   gearEff      : eficacia del equipo NORMAL en la zona (el equipo exclusivo siempre rinde al 100%)
 *   maxSurvival  : techo de la probabilidad TOTAL de éxito (equipo + evento + perk revivir): zonas bajas 80-85%, así siempre hay riesgo
 *   boss         : zona alta con jefe: si la expedición FRACASA puede robarte Coinks (ver BOSS)
 */
const zone = (id, emoji, minutes, baseSurvival, rewardMult, luck, gearEff, dropChance, boss = false, maxSurvival = 0.95) => ({
  id, emoji, minutes, durationMs: minutes * 60_000, baseSurvival, rewardMult, luck, gearEff, dropChance, boss, maxSurvival,
});
const ZONES = {
  bosque: zone('bosque', '🌲', 10,   0.75, 1.1,  1.0, 1.0,  0.30, false, 0.85),
  cueva:  zone('cueva',  '🕳️', 30,   0.60, 5,  1.2, 1.0,  0.32, false, 0.82),
  volcan: zone('volcan', '🌋', 60,   0.45, 10.0,  1.5, 0.9,  0.35, false, 0.80),
  ruinas: zone('ruinas', '🏛️', 240,  0.35, 20.0, 1.6, 0.7,  0.45, true),
  abismo: zone('abismo', '🌀', 720,  0.25, 45.0, 1.8, 0.5,  0.60, true),
  trono:  zone('trono',  '🐉', 1440, 0.15, 90.0, 2.0, 0.35, 0.80, true),
};

// Techo estricto de Coinks que puede dar UNA expedición, pase lo que pase (zona, equipo, evento, perks...).
const MAX_COINKS_PER_EXPEDITION = 100_000;
const MAX_SURVIVAL = 0.90; // techo global; cada zona puede tener uno más bajo (zone.maxSurvival)

// Robo del jefe: solo en zonas altas (zone.boss). Si la expedición fracasa, `chance` de que el jefe le quite `stealPct` de los
// Coinks que tenga en la cartera en ese momento, con un máximo de `maxSteal` por derrota. En zonas bajas fracasar solo da 0.
const BOSS = { chance: 0.30, stealPct: 0.05, maxSteal: 10_000 };

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

/** Probabilidad de sobrevivir (equipo + evento), recortada al techo de la zona. */
function survivalOf(zone, equipped, eventDef = null) {
  const p = zone.baseSurvival + gearBonus(zone, equipped) + (eventDef?.survivalDelta || 0);
  return Math.max(0.01, Math.min(MAX_SURVIVAL, zone.maxSurvival, p));
}

/** Probabilidad de "revivir" efectiva: se recorta para que éxito total (p + (1-p)·revive) no pase del techo de la zona. */
function effectiveRevive(zone, p, revive) {
  const room = Math.max(0, (Math.min(MAX_SURVIVAL, zone.maxSurvival) - p) / (1 - p));
  return Math.min(revive, room);
}

module.exports = {
  survivalOf, effectiveRevive,
  RARITIES, SLOTS, RARITY_INFO, ITEMS, ZONES,
  SELL_PRICE, FUSION, FUSION_CONSOLATION, CANCEL, DROP_SLOT_WEIGHTS,
  isNormal, itemsOf, requiredDistinct, rollItemOfType, rollItemId, gearBonus, perksOf,
  SHOP_PRICE: exclusive.SHOP_PRICE, SHOP_STOCK: exclusive.SHOP_STOCK, USES_BY_RARITY: exclusive.USES_BY_RARITY,
  MAX_SURVIVAL, MAX_COINKS_PER_EXPEDITION, BOSS,
  ITEM_DROP_CHANCE: 0.3, // respaldo; cada zona define su propio dropChance
};
