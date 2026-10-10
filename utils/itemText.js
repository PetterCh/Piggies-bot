// Textos de objetos compartidos por inventario, tiendas y anuncios.
const { ITEMS, RARITY_INFO } = require('../data/gameData');
const { t } = require('./i18n');

/** "+25% Coinks · 15% de sobrevivir a la muerte" (vacío si el objeto no tiene perks). */
function perkText(L, id) {
  const p = ITEMS[id]?.perk;
  if (!p) return '';
  const parts = [];
  if (p.loot) parts.push(t(L, 'perk.loot', { pct: Math.round(p.loot * 100) }));
  if (p.revive) parts.push(t(L, 'perk.revive', { pct: Math.round(p.revive * 100) }));
  return parts.join(' · ');
}

/** "🟣 Hacha del Conquistador (+22%) ✨ 🔁7/9" — ✨ = tiene perks, 🔁 = usos restantes/máximos. */
function itemLabel(L, id, usesLeft) {
  const it = ITEMS[id];
  if (!it) return t(L, 'inv.none');
  let s = `${RARITY_INFO[it.rarity].emoji} ${t(L, `item.${id}`)} (+${Math.round(it.bonus * 100)}%)`;
  if (it.perk) s += ' ✨';
  if (it.maxUses) s += ` 🔁${usesLeft ?? it.maxUses}/${it.maxUses}`;
  return s;
}

module.exports = { perkText, itemLabel };
