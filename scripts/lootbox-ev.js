// Muestra probabilidades y retorno esperado (EV) de cada caja:  npm run lootbox:ev
const { BOXES } = require('../data/lootboxes');

for (const box of Object.values(BOXES)) {
  if (box.kind === 'set') { console.log(`\n${box.emoji} ${box.id} — precio ${box.price}: set completo épico/legendario con usos (mín. 1 legendaria; ${box.legendaryChance * 100}% por pieza). Ver el cálculo en npm run expedition:ev y en data/lootboxes.js`); continue; }
  const total = box.table.reduce((a, e) => a + e.weight, 0);
  let ev = 0;
  console.log(`\n${box.emoji} ${box.id} — precio ${box.price}`);
  for (const e of box.table) {
    const p = (e.weight / total) * 100;
    const mean = e.type === 'coinks' ? (e.range[0] + e.range[1]) / 2 : 0;
    ev += (e.weight / total) * mean;
    const label = [e.type, e.rarity, e.range ? `${e.range[0]}-${e.range[1]}` : ''].filter(Boolean).join(' ');
    console.log(`  ${p.toFixed(2).padStart(6)}%  ${label}`);
  }
  console.log(`  >> Coinks esperados por apertura: ${ev.toFixed(1)} (${((ev / box.price) * 100).toFixed(0)}% del precio; el resto del valor son accesorios/NFT)`);
}
