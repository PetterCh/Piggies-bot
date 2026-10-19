// Objetos EXCLUSIVOS: no caen en expediciones normales, ni en cajas, ni se pueden fusionar ni vender.
//   source 'shop'  -> se compran en la Tienda de Expedición rotativa.
//   source 'event' -> solo caen durante un evento global (rareza única "event").
// Tienen USOS LIMITADOS (se gasta 1 por expedición completada; al llegar a 0 el objeto se rompe).
// perk: { loot: +fracción de Coinks, revive: probabilidad de sobrevivir a una muerte }.
// Usos máximos (rebalanceo v7.10): comunes 2, poco comunes 3, raros 4, épicos 4 (v7.11), legendarios 4, de evento 5.
const USES_BY_RARITY = { common: 2, uncommon: 3, rare: 4, epic: 4, legendary: 4, event: 5 }; // v7.11: épico 5 → 4
const SHOP_PRICE = { common: 650, uncommon: 1650, rare: 3300, epic: 4600, legendary: 6300 }; // Coinks
const SHOP_STOCK = { common: 8, uncommon: 6, rare: 4, epic: 2, legendary: 1 }; // unidades por rotación y servidor

// [tipo, rareza, id, bonus, es, en, perk?]
const SHOP = [
  ['weapon', 'common', 'machete_de_ruta', 0.04, 'Machete de Ruta', 'Trail Machete'],
  ['weapon', 'common', 'lanza_de_senderista', 0.05, 'Lanza de Senderista', "Hiker's Spear"],
  ['armor', 'common', 'chaleco_de_expedicion', 0.04, 'Chaleco de Expedición', 'Expedition Vest'],
  ['armor', 'common', 'capa_impermeable', 0.05, 'Capa Impermeable', 'Waterproof Cloak'],
  ['helmet', 'common', 'casco_de_minero', 0.03, 'Casco de Minero', "Miner's Helmet"],
  ['helmet', 'common', 'gorra_de_explorador', 0.04, 'Gorra de Explorador', "Explorer's Cap"],

  ['weapon', 'uncommon', 'ballesta_de_campana', 0.07, 'Ballesta de Campaña', 'Field Crossbow'],
  ['weapon', 'uncommon', 'sable_de_cazatesoros', 0.08, 'Sable de Cazatesoros', "Treasure Hunter's Saber"],
  ['armor', 'uncommon', 'coraza_reforzada_de_ruta', 0.07, 'Coraza Reforzada de Ruta', 'Reinforced Trail Cuirass'],
  ['armor', 'uncommon', 'manto_de_cazador', 0.08, 'Manto de Cazador', "Hunter's Mantle"],
  ['helmet', 'uncommon', 'yelmo_con_visera', 0.05, 'Yelmo con Visera', 'Visored Helm'],
  ['helmet', 'uncommon', 'capucha_de_sigilo', 0.06, 'Capucha de Sigilo', 'Stealth Hood'],

  ['weapon', 'rare', 'espada_rompecuevas', 0.10, 'Espada Rompecuevas', 'Cavebreaker Sword'],
  ['weapon', 'rare', 'arco_de_los_vientos', 0.11, 'Arco de los Vientos', 'Windbow', { loot: 0.05 }],
  ['armor', 'rare', 'armadura_de_vanguardia', 0.10, 'Armadura de Vanguardia', 'Vanguard Armor'],
  ['armor', 'rare', 'escudo_del_centinela', 0.11, 'Escudo del Centinela', "Sentinel's Shield", { revive: 0.05 }],
  ['helmet', 'rare', 'casco_del_vigia', 0.07, 'Casco del Vigía', "Lookout's Helm"],
  ['helmet', 'rare', 'yelmo_de_ojo_de_aguila', 0.08, 'Yelmo de Ojo de Águila', 'Eagle-Eye Helm', { loot: 0.05 }],

  ['weapon', 'epic', 'hacha_del_conquistador', 0.14, 'Hacha del Conquistador', "Conqueror's Axe", { loot: 0.08 }],
  ['weapon', 'epic', 'lanza_del_cazadragones', 0.15, 'Lanza del Cazadragones', 'Dragonslayer Spear'],
  ['armor', 'epic', 'armadura_del_conquistador', 0.14, 'Armadura del Conquistador', "Conqueror's Armor", { revive: 0.08 }],
  ['armor', 'epic', 'manto_del_cruzado_polar', 0.15, 'Manto del Cruzado Polar', "Polar Crusader's Mantle"],
  ['helmet', 'epic', 'yelmo_del_conquistador', 0.10, 'Yelmo del Conquistador', "Conqueror's Helm", { loot: 0.06 }],
  ['helmet', 'epic', 'casco_de_mil_batallas', 0.11, 'Casco de Mil Batallas', 'Helm of a Thousand Battles'],

  ['weapon', 'legendary', 'espada_del_abismo', 0.19, 'Espada del Abismo', 'Abyssal Blade', { loot: 0.12 }],
  ['weapon', 'legendary', 'colmillo_del_titan_porcino', 0.20, 'Colmillo del Titán Porcino', "Porcine Titan's Fang"],
  ['armor', 'legendary', 'coraza_del_abismo', 0.19, 'Coraza del Abismo', 'Abyssal Cuirass', { revive: 0.12 }],
  ['armor', 'legendary', 'egida_del_rey_dragon', 0.20, 'Égida del Rey Dragón', "Dragon King's Aegis"],
  ['helmet', 'legendary', 'corona_del_abismo', 0.15, 'Corona del Abismo', 'Abyssal Crown', { loot: 0.10 }],
  ['helmet', 'legendary', 'yelmo_del_eterno_cerdo', 0.16, 'Yelmo del Eterno Cerdo', 'Helm of the Eternal Pig', { revive: 0.08 }],
];

// Objetos de evento (rareza única): [tipo, evento, id, bonus, es, en, perk]
const EVENT = [
  ['weapon', 'tormenta_de_sangre', 'colmillo_carmesi', 0.20, 'Colmillo Carmesí', 'Crimson Fang', { loot: 0.25 }],
  ['armor', 'tormenta_de_sangre', 'coraza_de_sangre_coagulada', 0.20, 'Coraza de Sangre Coagulada', 'Clotted Blood Cuirass', { revive: 0.15 }],
  ['helmet', 'tormenta_de_sangre', 'yelmo_sediento', 0.15, 'Yelmo Sediento', 'Thirsty Helm', { loot: 0.10 }],

  ['weapon', 'lluvia_de_estrellas', 'lanza_estelar', 0.20, 'Lanza Estelar', 'Stellar Spear', { loot: 0.20 }],
  ['armor', 'lluvia_de_estrellas', 'manto_de_polvo_de_estrellas', 0.20, 'Manto de Polvo de Estrellas', 'Stardust Mantle', { revive: 0.20 }],
  ['helmet', 'lluvia_de_estrellas', 'diadema_fugaz', 0.15, 'Diadema Fugaz', 'Shooting Star Diadem', { loot: 0.15 }],

  ['weapon', 'fiebre_del_oro', 'pico_de_oro_macizo', 0.20, 'Pico de Oro Macizo', 'Solid Gold Pickaxe', { loot: 0.35 }],
  ['armor', 'fiebre_del_oro', 'armadura_de_lingotes', 0.20, 'Armadura de Lingotes', 'Ingot Armor', { loot: 0.15 }],
  ['helmet', 'fiebre_del_oro', 'casco_del_rey_midas', 0.15, 'Casco del Rey Midas', "King Midas' Helm", { loot: 0.20 }],

  ['weapon', 'niebla_espectral', 'guadana_fantasmal', 0.20, 'Guadaña Fantasmal', 'Ghostly Scythe', { revive: 0.10, loot: 0.10 }],
  ['armor', 'niebla_espectral', 'sudario_espectral', 0.20, 'Sudario Espectral', 'Spectral Shroud', { revive: 0.25 }],
  ['helmet', 'niebla_espectral', 'capucha_del_mas_alla', 0.15, 'Capucha del Más Allá', 'Hood of the Beyond', { revive: 0.10 }],
];

const list = [
  ...SHOP.map(([type, rarity, id, bonus, es, en, perk]) => ({ type, rarity, id, bonus, es, en, perk: perk || null, source: 'shop', event: null })),
  ...EVENT.map(([type, event, id, bonus, es, en, perk]) => ({ type, rarity: 'event', id, bonus, es, en, perk, source: 'event', event })),
];
const names = { es: {}, en: {} };
for (const it of list) {
  names.es[it.id] = it.es;
  names.en[it.id] = it.en;
}

module.exports = { list, names, USES_BY_RARITY, SHOP_PRICE, SHOP_STOCK };
