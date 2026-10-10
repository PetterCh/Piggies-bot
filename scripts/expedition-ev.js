// Balance de expediciones:  npm run expedition:ev
// Muestra, por zona: recompensa (x), probabilidad de sobrevivir con distintos equipos, EV de Coinks por expedición y por hora,
// coste de cancelar y cuánto cuesta cada uso del equipo exclusivo.
const { ZONES, ITEMS, SLOTS, RARITIES, RARITY_INFO, SHOP_PRICE, USES_BY_RARITY, gearBonus, perksOf, CANCEL, MAX_SURVIVAL } = require('../data/gameData');
const { EVENTS } = require('../data/events');

const best = (source, rarity) => Object.fromEntries(SLOTS.map((s) => [s, Object.keys(ITEMS).filter((id) => ITEMS[id].source === source && ITEMS[id].type === s && ITEMS[id].rarity === rarity).sort((a, b) => ITEMS[b].bonus - ITEMS[a].bonus)[0] || null]));
const sets = { 'sin equipo': {}, 'normal legendario': best('normal', 'legendary'), 'tienda épico': best('shop', 'epic'), 'tienda legendario': best('shop', 'legendary') };
const surv = (z, eq, ev) => Math.max(0.01, Math.min(MAX_SURVIVAL, z.baseSurvival + gearBonus(z, eq) + (ev?.survivalDelta || 0)));

function lootEV(z) {
  const w = RARITIES.map((r, i) => RARITY_INFO[r].weight * Math.pow(z.luck, i));
  const tot = w.reduce((a, b) => a + b, 0);
  return RARITIES.reduce((s, r, i) => s + (w[i] / tot) * ((RARITY_INFO[r].coinks[0] + RARITY_INFO[r].coinks[1]) / 2), 0) * z.rewardMult;
}

const pad = (s, n) => String(s).padEnd(n);
console.log(pad('zona', 8), pad('dur', 7), pad('x', 7), ...Object.keys(sets).map((k) => pad(k, 19)), 'EV/exp (legend. tienda)', ' EV/hora', ' cancelar');
for (const z of Object.values(ZONES)) {
  const cols = Object.entries(sets).map(([, eq]) => pad(`${(surv(z, eq) * 100).toFixed(0)}%`, 19));
  const evRun = surv(z, sets['tienda legendario']) * lootEV(z) * (1 + perksOf(sets['tienda legendario']).loot);
  const cancel0 = Math.max(CANCEL.minFee, Math.round(CANCEL.feePerMult * z.rewardMult * CANCEL.minFraction));
  console.log(pad(z.id, 8), pad(z.minutes >= 60 ? `${z.minutes / 60}h` : `${z.minutes}m`, 7), pad(z.rewardMult, 7), ...cols, pad(Math.round(evRun).toLocaleString('en-US'), 23), pad(Math.round(evRun / (z.minutes / 60)).toLocaleString('en-US'), 8), ` ${cancel0}+`);
}
console.log('\nCoste por uso del equipo exclusivo:');
for (const r of RARITIES) console.log(`  ${pad(r, 10)} precio ${pad(SHOP_PRICE[r], 6)} / ${USES_BY_RARITY[r]} usos = ${Math.round(SHOP_PRICE[r] / USES_BY_RARITY[r])} Coinks por uso`);
console.log('\nEventos (modifican la supervivencia mostrada arriba):', Object.values(EVENTS).map((e) => `${e.id} ${e.survivalDelta >= 0 ? '+' : ''}${Math.round(e.survivalDelta * 100)}% / Coinks x${e.coinMult}`).join(' | '));
