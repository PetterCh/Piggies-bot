// ARSENAL: fuente única de armas, armaduras y cascos (id, tipo, rareza, bonus de supervivencia y nombres ES/EN).
// - Los objetos "legacy" son los de la v1/v2 y conservan EXACTAMENTE sus ids y bonus (los inventarios guardados los usan).
// - Cada tipo tiene 10 objetos por rareza (armas y armaduras). Los 9 nuevos reparten su bonus dentro de la banda de la rareza.
// - Para añadir un objeto: añade una fila [id, nombreES, nombreEN] a su grupo (id en ASCII, sin repetir).
const BANDS = { common: [0.02, 0.04], uncommon: [0.05, 0.07], rare: [0.08, 0.12], epic: [0.13, 0.17], legendary: [0.20, 0.25] };

// [tipo, rareza, id, bonus, es, en]
const LEGACY = [
  ['weapon', 'common', 'palo_astillado', 0.03, 'Palo Astillado', 'Splintered Stick'],
  ['weapon', 'uncommon', 'daga_de_trufa', 0.06, 'Daga de Trufa', 'Truffle Dagger'],
  ['weapon', 'rare', 'hacha_pezuna', 0.10, 'Hacha Pezuña', 'Hoof Axe'],
  ['weapon', 'epic', 'espada_de_jamon', 0.15, 'Espada de Jamón Curado', 'Cured Ham Sword'],
  ['weapon', 'legendary', 'colmillo_jabali_rey', 0.22, 'Colmillo del Jabalí Rey', "Boar King's Tusk"],
  ['armor', 'common', 'tapa_de_olla', 0.03, 'Tapa de Olla', 'Pot Lid'],
  ['armor', 'uncommon', 'chaleco_de_paja', 0.06, 'Chaleco de Paja', 'Straw Vest'],
  ['armor', 'rare', 'peto_de_barro', 0.10, 'Peto de Barro Cocido', 'Baked Clay Breastplate'],
  ['armor', 'epic', 'armadura_de_tocino', 0.15, 'Armadura de Tocino', 'Bacon Armor'],
  ['armor', 'legendary', 'coraza_cerdo_dragon', 0.22, 'Coraza del Cerdo Dragón', 'Dragon Pig Cuirass'],
  ['helmet', 'common', 'cacerola_con_orejas', 0.02, 'Cacerola con Orejas', 'Eared Saucepan'],
  ['helmet', 'uncommon', 'gorro_de_lana', 0.04, 'Gorro de Lana', 'Wool Cap'],
  ['helmet', 'rare', 'yelmo_de_hojalata', 0.07, 'Yelmo de Hojalata', 'Tin Helm'],
  ['helmet', 'epic', 'casco_de_chicharron', 0.10, 'Casco de Chicharrón', 'Pork Crackling Helmet'],
  ['helmet', 'legendary', 'corona_del_rey_cerdo', 0.15, 'Corona del Rey Cerdo', "Pig King's Crown"],
];

// 9 objetos nuevos por (tipo, rareza)
const EXTRA = {
  'weapon:common': [
    ['cuchara_de_madera', 'Cuchara de Madera', 'Wooden Spoon'],
    ['rama_puntiaguda', 'Rama Puntiaguda', 'Pointy Branch'],
    ['tenedor_oxidado', 'Tenedor Oxidado', 'Rusty Fork'],
    ['piedra_afilada', 'Piedra Afilada', 'Sharpened Stone'],
    ['rodillo_de_cocina', 'Rodillo de Cocina', 'Rolling Pin'],
    ['sarten_abollada', 'Sartén Abollada', 'Dented Frying Pan'],
    ['cuchillo_de_mantequilla', 'Cuchillo de Mantequilla', 'Butter Knife'],
    ['hueso_de_pollo', 'Hueso de Pollo', 'Chicken Bone'],
    ['tirachinas_casero', 'Tirachinas Casero', 'Homemade Slingshot'],
  ],
  'armor:common': [
    ['delantal_de_cocina', 'Delantal de Cocina', 'Kitchen Apron'],
    ['cesta_de_mimbre', 'Cesta de Mimbre', 'Wicker Basket'],
    ['bolsa_de_arpillera', 'Bolsa de Arpillera', 'Burlap Sack'],
    ['cubo_de_hojalata', 'Cubo de Hojalata', 'Tin Bucket'],
    ['manta_remendada', 'Manta Remendada', 'Patched Blanket'],
    ['caja_de_carton', 'Caja de Cartón', 'Cardboard Box'],
    ['abrigo_de_hojas', 'Abrigo de Hojas', 'Leaf Coat'],
    ['barril_viejo', 'Barril Viejo', 'Old Barrel'],
    ['pijama_acolchado', 'Pijama Acolchado', 'Quilted Pajamas'],
  ],
  'weapon:uncommon': [
    ['lanza_de_zanahoria', 'Lanza de Zanahoria', 'Carrot Spear'],
    ['maza_de_nabo', 'Maza de Nabo', 'Turnip Mace'],
    ['cuchilla_de_carnicero', 'Cuchilla de Carnicero', "Butcher's Cleaver"],
    ['arco_de_cana', 'Arco de Caña', 'Reed Bow'],
    ['honda_de_cuero', 'Honda de Cuero', 'Leather Sling'],
    ['hoz_de_granjero', 'Hoz de Granjero', "Farmer's Sickle"],
    ['tridente_de_heno', 'Tridente de Heno', 'Hay Pitchfork'],
    ['espada_de_hierro_basto', 'Espada de Hierro Basto', 'Crude Iron Sword'],
    ['martillo_de_herrero', 'Martillo de Herrero', "Blacksmith's Hammer"],
  ],
  'armor:uncommon': [
    ['coraza_de_cuero', 'Coraza de Cuero', 'Leather Cuirass'],
    ['escudo_de_madera', 'Escudo de Madera', 'Wooden Shield'],
    ['cota_de_anillas', 'Cota de Anillas', 'Ring Mail'],
    ['capa_de_lana', 'Capa de Lana', 'Wool Cape'],
    ['peto_de_corcho', 'Peto de Corcho', 'Cork Breastplate'],
    ['jubon_acolchado', 'Jubón Acolchado', 'Padded Jerkin'],
    ['brazales_de_cuero', 'Brazales de Cuero', 'Leather Bracers'],
    ['tabardo_del_granjero', 'Tabardo del Granjero', "Farmer's Tabard"],
    ['armadura_de_escamas_de_pez', 'Armadura de Escamas de Pez', 'Fish-Scale Armor'],
  ],
  'weapon:rare': [
    ['espada_de_acero_porcino', 'Espada de Acero Porcino', 'Porcine Steel Sword'],
    ['ballesta_del_cazador', 'Ballesta del Cazador', "Hunter's Crossbow"],
    ['lanza_del_jabali', 'Lanza del Jabalí', 'Boar Spear'],
    ['maza_de_hierro_estrellado', 'Maza de Hierro Estrellado', 'Star-Iron Mace'],
    ['estoque_de_trufa_negra', 'Estoque de Trufa Negra', 'Black Truffle Rapier'],
    ['martillo_de_guerra', 'Martillo de Guerra', 'War Hammer'],
    ['arco_de_cuerno', 'Arco de Cuerno', 'Horn Bow'],
    ['cimitarra_del_desierto', 'Cimitarra del Desierto', 'Desert Scimitar'],
    ['guadana_del_granjero_oscuro', 'Guadaña del Granjero Oscuro', "Dark Farmer's Scythe"],
  ],
  'armor:rare': [
    ['cota_de_malla_reforzada', 'Cota de Malla Reforzada', 'Reinforced Chainmail'],
    ['escudo_de_roble', 'Escudo de Roble', 'Oak Shield'],
    ['armadura_de_placas_ligera', 'Armadura de Placas Ligera', 'Light Plate Armor'],
    ['capa_del_explorador', 'Capa del Explorador', "Explorer's Cloak"],
    ['coraza_de_caparazon', 'Coraza de Caparazón', 'Shell Cuirass'],
    ['peto_de_bronce', 'Peto de Bronce', 'Bronze Breastplate'],
    ['jubon_de_cuero_tachonado', 'Jubón de Cuero Tachonado', 'Studded Leather Jerkin'],
    ['manto_de_la_niebla', 'Manto de la Niebla', 'Mist Mantle'],
    ['escudo_torre_del_establo', 'Escudo Torre del Establo', 'Stable Tower Shield'],
  ],
  'weapon:epic': [
    ['hacha_de_guerra_carbonizada', 'Hacha de Guerra Carbonizada', 'Charred War Axe'],
    ['lanza_de_relampago', 'Lanza de Relámpago', 'Lightning Spear'],
    ['espada_de_obsidiana', 'Espada de Obsidiana', 'Obsidian Sword'],
    ['arco_de_tormenta', 'Arco de Tormenta', 'Storm Bow'],
    ['martillo_del_trueno_porcino', 'Martillo del Trueno Porcino', 'Porcine Thunder Hammer'],
    ['katana_de_chorizo_ardiente', 'Katana de Chorizo Ardiente', 'Blazing Chorizo Katana'],
    ['baston_del_hechicero_grunon', 'Bastón del Hechicero Gruñón', "Grunting Sorcerer's Staff"],
    ['guadana_de_las_sombras', 'Guadaña de las Sombras', 'Shadow Scythe'],
    ['tridente_del_pantano_negro', 'Tridente del Pantano Negro', 'Black Swamp Trident'],
  ],
  'armor:epic': [
    ['armadura_de_obsidiana', 'Armadura de Obsidiana', 'Obsidian Armor'],
    ['coraza_de_escamas_de_dragon', 'Coraza de Escamas de Dragón', 'Dragon Scale Cuirass'],
    ['escudo_de_trueno', 'Escudo de Trueno', 'Thunder Shield'],
    ['manto_de_las_sombras', 'Manto de las Sombras', 'Shadow Mantle'],
    ['armadura_de_placas_pesada', 'Armadura de Placas Pesada', 'Heavy Plate Armor'],
    ['peto_de_jamon_iberico', 'Peto de Jamón Ibérico', 'Iberian Ham Breastplate'],
    ['capa_de_lava_solidificada', 'Capa de Lava Solidificada', 'Solidified Lava Cloak'],
    ['coraza_del_guardian_porcino', 'Coraza del Guardián Porcino', 'Porcine Guardian Cuirass'],
    ['escudo_espejo_de_cristal', 'Escudo Espejo de Cristal', 'Crystal Mirror Shield'],
  ],
  'weapon:legendary': [
    ['espada_del_cerdo_celestial', 'Espada del Cerdo Celestial', 'Celestial Pig Sword'],
    ['hacha_del_apocalipsis_porcino', 'Hacha del Apocalipsis Porcino', 'Porcine Apocalypse Axe'],
    ['lanza_del_dragon_dorado', 'Lanza del Dragón Dorado', 'Golden Dragon Lance'],
    ['arco_de_las_estrellas', 'Arco de las Estrellas', 'Starlight Bow'],
    ['martillo_del_titan_de_barro', 'Martillo del Titán de Barro', "Mud Titan's Hammer"],
    ['katana_del_amanecer', 'Katana del Amanecer', 'Dawn Katana'],
    ['baston_del_archimago_cerdito', 'Bastón del Archimago Cerdito', "Piglet Archmage's Staff"],
    ['guadana_del_fin_de_los_tiempos', 'Guadaña del Fin de los Tiempos', 'Scythe of the End of Time'],
    ['trinchante_del_gran_banquete', 'Trinchante del Gran Banquete', 'Carver of the Great Feast'],
  ],
  'armor:legendary': [
    ['armadura_del_rey_jabali', 'Armadura del Rey Jabalí', "Boar King's Armor"],
    ['coraza_del_fenix_porcino', 'Coraza del Fénix Porcino', 'Porcine Phoenix Cuirass'],
    ['escudo_de_la_aurora', 'Escudo de la Aurora', 'Aurora Shield'],
    ['manto_del_vacio_estelar', 'Manto del Vacío Estelar', 'Starvoid Mantle'],
    ['armadura_de_los_antiguos_titanes', 'Armadura de los Antiguos Titanes', "Ancient Titans' Armor"],
    ['peto_de_oro_macizo', 'Peto de Oro Macizo', 'Solid Gold Breastplate'],
    ['coraza_de_cristal_eterno', 'Coraza de Cristal Eterno', 'Eternal Crystal Cuirass'],
    ['capa_del_guardian_del_volcan', 'Capa del Guardián del Volcán', "Volcano Guardian's Cloak"],
    ['escudo_del_cerdo_inmortal', 'Escudo del Cerdo Inmortal', 'Shield of the Immortal Pig'],
  ],
};

const list = LEGACY.map(([type, rarity, id, bonus, es, en]) => ({ type, rarity, id, bonus, es, en }));
for (const [key, rows] of Object.entries(EXTRA)) {
  const [type, rarity] = key.split(':');
  const [lo, hi] = BANDS[rarity];
  rows.forEach(([id, es, en], i) => {
    list.push({ type, rarity, id, es, en, bonus: Math.round((lo + ((hi - lo) * i) / (rows.length - 1)) * 1000) / 1000 });
  });
}

const ids = new Set();
for (const it of list) {
  if (ids.has(it.id)) throw new Error(`Objeto duplicado en arsenal: ${it.id}`);
  ids.add(it.id);
}

const names = { es: {}, en: {} };
for (const it of list) {
  names.es[it.id] = it.es;
  names.en[it.id] = it.en;
}

module.exports = { list, names, BANDS };
