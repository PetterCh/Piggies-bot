// Cajas misteriosas. Cada caja tiene una tabla de premios con PESOS (no hace falta que sumen 100;
// la probabilidad real es peso / suma de pesos). Ejecuta `npm run lootbox:ev` para ver probabilidades
// y el retorno esperado en Coinks de cada caja antes de publicarla (retorno < 100% = la caja "quema" Coinks).
//
// Tipos de premio:
//   nothing                         -> no gana nada (el bot se burla)
//   coinks { rarity, range:[a,b] }  -> Coinks aleatorios entre a y b
//   gear   { rarity }               -> un accesorio al azar de esa rareza (arma, armadura o casco)
//   nft                             -> un NFT real de los cargados con /lootbox-admin nft-agregar
//                                      (solo sale si el usuario tiene wallet vinculada y queda stock)
const BOXES = {
  basica: {
    id: 'basica', emoji: '📦', price: 100,
    table: [
      { type: 'nothing', weight: 38 },
      { type: 'coinks', rarity: 'common',   weight: 27, range: [20, 60] },
      { type: 'coinks', rarity: 'uncommon', weight: 9,  range: [80, 150] },
      { type: 'coinks', rarity: 'rare',     weight: 3,  range: [250, 400] },
      { type: 'coinks', rarity: 'epic',     weight: 0.4, range: [800, 1200] },
      { type: 'gear',   rarity: 'common',    weight: 12 },
      { type: 'gear',   rarity: 'uncommon',  weight: 6 },
      { type: 'gear',   rarity: 'rare',      weight: 2.5 },
      { type: 'gear',   rarity: 'epic',      weight: 0.9 },
      { type: 'gear',   rarity: 'legendary', weight: 0.2 },
      { type: 'nft', weight: 0.05 },
    ],
  },
  premium: {
    id: 'premium', emoji: '🎁', price: 500,
    table: [
      { type: 'nothing', weight: 30 },
      { type: 'coinks', rarity: 'common',   weight: 25, range: [100, 250] },
      { type: 'coinks', rarity: 'uncommon', weight: 14, range: [300, 600] },
      { type: 'coinks', rarity: 'rare',     weight: 5,  range: [800, 1500] },
      { type: 'coinks', rarity: 'epic',     weight: 0.8, range: [3000, 5000] },
      { type: 'gear',   rarity: 'uncommon',  weight: 9 },
      { type: 'gear',   rarity: 'rare',      weight: 8 },
      { type: 'gear',   rarity: 'epic',      weight: 4 },
      { type: 'gear',   rarity: 'legendary', weight: 1.5 },
      { type: 'nft', weight: 0.4 },
    ],
  },
  legendaria: {
    id: 'legendaria', emoji: '👑', price: 2000,
    table: [
      { type: 'nothing', weight: 22 },
      { type: 'coinks', rarity: 'uncommon',  weight: 25, range: [600, 1200] },
      { type: 'coinks', rarity: 'rare',      weight: 14, range: [2000, 3500] },
      { type: 'coinks', rarity: 'epic',      weight: 4,  range: [6000, 10000] },
      { type: 'coinks', rarity: 'legendary', weight: 0.5, range: [20000, 30000] },
      { type: 'gear',   rarity: 'rare',      weight: 14 },
      { type: 'gear',   rarity: 'epic',      weight: 14 },
      { type: 'gear',   rarity: 'legendary', weight: 6 },
      { type: 'nft', weight: 2 },
    ],
  },
  // Caja MÍTICA (v7.12): un SET COMPLETO (arma + armadura + casco) de equipo exclusivo con usos. Cada pieza sale épica o legendaria
  // (`legendaryChance` por pieza); si ninguna sale legendaria, una al azar se mejora (mínimo 1 legendaria asegurada).
  // Cálculo (npm run lootbox:ev): valor medio ≈ 1.24 legendarias + 1.76 épicas ≈ 15,900 Coinks al precio de la tienda; usadas al máximo
  // en el Trono rinden ≈ 19,600 en 4 expediciones → a 20,000 es break-even en el mejor caso y un gasto real en la práctica.
  mitica: {
    id: 'mitica', emoji: '💎', price: 20000, kind: 'set', legendaryChance: 0.30,
    table: [],
  },
};

module.exports = { BOXES };
