// Balance de expediciones:  npm run expedition:ev
// Por zona: probabilidad de éxito con distintos equipos, Coinks esperados por expedición (ya con bonus ADITIVOS y el techo de
// MAX_COINKS_PER_EXPEDITION), pérdida esperada por el robo del jefe, neto por hora y coste de cancelar. Más el coste por uso del equipo.
const { ZONES, ITEMS, SLOTS, RARITIES, RARITY_INFO, SHOP_PRICE, USES_BY_RARITY, gearBonus, perksOf, survivalOf, effectiveRevive, CANCEL, MAX_COINKS_PER_EXPEDITION, BOSS } = require('../data/gameData');
const { EVENTS } = require('../data/events');
const MAX_SURVIVAL = require('../data/gameData').MAX_SURVIVAL;

const best = (source, rarity) => Object.fromEntries(SLOTS.map((s) => [s, Object.keys(ITEMS).filter((id) => ITEMS[id].source === source && ITEMS[id].type === s && ITEMS[id].rarity === rarity).sort((a, b) => ITEMS[b].bonus - ITEMS[a].bonus)[0] || null]));
const sets = { 'sin equipo': {}, 'normal legendario': best('normal', 'legendary'), 'tienda épico': best('shop', 'epic'), 'tienda legendario': best('shop', 'legendary') };
const surv = (z, eq, ev) => survivalOf(z, eq, ev); // incluye el techo por zona (zone.maxSurvival)

/** Coinks esperados de una expedición EXITOSA (con tope por expedición, calculado rareza a rareza con el rango completo). */
function lootEV(z, bonus) {
  const w = RARITIES.map((r, i) => RARITY_INFO[r].weight * Math.pow(z.luck, i));
  const tot = w.reduce((a, b) => a + b, 0);
  return RARITIES.reduce((s, r, i) => {
    const [lo, hi] = RARITY_INFO[r].coinks;
    let avg = 0;
    for (let c = lo; c <= hi; c++) avg += Math.min(MAX_COINKS_PER_EXPEDITION, Math.round(c * z.rewardMult * (1 + bonus)));
    return s + (w[i] / tot) * (avg / (hi - lo + 1));
  }, 0);
}

const pad = (s, n) => String(s).padEnd(n);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const legend = sets['tienda legendario'];
const loot = perksOf(legend).loot;
console.log(`Techo por expedición: ${fmt(MAX_COINKS_PER_EXPEDITION)} · Jefe: ${BOSS.chance * 100}% de robar ${BOSS.stealPct * 100}% (máx. ${fmt(BOSS.maxSteal)}) al FRACASAR en zonas altas\n`);
console.log(pad('zona', 8), pad('dur', 6), pad('x', 6), ...Object.keys(sets).map((k) => pad(k, 18)), pad('EV/exp', 9), pad('máx cobro', 10), pad('robo/fallo*', 12), pad('neto/hora', 10), 'cancelar');
for (const z of Object.values(ZONES)) {
  const cols = Object.entries(sets).map(([, eq]) => pad(`${(surv(z, eq) * 100).toFixed(0)}%`, 18));
  const p = surv(z, legend);
  const ev = p * lootEV(z, loot);
  const stolen = z.boss ? (1 - p) * BOSS.chance * BOSS.maxSteal : 0; // cota alta: asume cartera >= 200k
  const cancel0 = Math.max(CANCEL.minFee, Math.round(CANCEL.feePerMult * z.rewardMult * CANCEL.minFraction));
  console.log(pad(z.id, 8), pad(z.minutes >= 60 ? `${z.minutes / 60}h` : `${z.minutes}m`, 6), pad(z.rewardMult, 6), ...cols, pad(fmt(ev), 9), pad(fmt(Math.min(MAX_COINKS_PER_EXPEDITION, 1000 * z.rewardMult * (1 + loot))), 10), pad(z.boss ? `-${fmt(stolen)}` : '0', 12), pad(fmt((ev - stolen) / (z.minutes / 60)), 10), `${cancel0}+`);
}
console.log('* pérdida esperada máxima por expedición (si tienes ≥200,000 en la cartera); con menos Coinks el robo es el 5% de lo que tengas.');
console.log('\nCoste por uso del equipo exclusivo:');
for (const r of RARITIES) console.log(`  ${pad(r, 10)} precio ${pad(SHOP_PRICE[r], 6)} / ${USES_BY_RARITY[r]} usos = ${fmt(SHOP_PRICE[r] / USES_BY_RARITY[r])} Coinks por uso (y por objeto equipado)`);
console.log('\nEventos (bonus ADITIVO de Coinks; máx. +50%):', Object.values(EVENTS).map((e) => `${e.id} ${e.survivalDelta >= 0 ? '+' : ''}${Math.round(e.survivalDelta * 100)}% supervivencia / +${Math.round(e.coinBonus * 100)}% Coinks`).join(' | '));

// ---- Rentabilidad del equipo de tienda: valor esperado EXTRA frente a ir sin equipo, menos lo que cuesta por expedición ----
// EV = p·loot + (1-p)·revive·loot·0.5 (el perk de revivir paga la mitad y también respeta el techo de éxito de la zona).
const evRun = (z, eq) => { const p = surv(z, eq); const pk = perksOf(eq); const rv = effectiveRevive(z, p, pk.revive); const l = lootEV(z, pk.loot); return p * l + (1 - p) * rv * l * 0.5; };
const combos = (rar) => { const by = SLOTS.map((sl) => Object.keys(ITEMS).filter((i) => ITEMS[i].source === 'shop' && ITEMS[i].type === sl && ITEMS[i].rarity === rar)); const o = []; for (const a of by[0]) for (const b of by[1]) for (const c of by[2]) o.push({ weapon: a, armor: b, helmet: c }); return o; };
console.log('\nRentabilidad de un set completo de tienda (media de todas las combinaciones): EV extra por expedición y % neto sobre su coste');
console.log(pad('rareza', 11), pad('coste/exp', 10), ...Object.values(ZONES).map((z) => pad(z.id, 17)));
for (const r of RARITIES) {
  const cost = 3 * SHOP_PRICE[r] / USES_BY_RARITY[r];
  const cs = combos(r);
  console.log(pad(r, 11), pad(fmt(cost), 10), ...Object.values(ZONES).map((z) => { const inc = cs.reduce((a, e) => a + evRun(z, e) - evRun(z, {}), 0) / cs.length; return pad(`${fmt(inc)} (${inc / cost - 1 >= 0 ? '+' : ''}${((inc / cost - 1) * 100).toFixed(0)}%)`, 17); }));
}
console.log('Techo de éxito por zona:', Object.values(ZONES).map((z) => `${z.id} ${Math.round(Math.min(z.maxSurvival, MAX_SURVIVAL) * 100)}%`).join(' · '));
