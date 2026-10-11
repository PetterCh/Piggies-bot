// Inventario del cerdito: pantalla, venta y fusión (crafting) de objetos.
const crypto = require('node:crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const User = require('../models/User');
const { getUser, logLedger } = require('../utils/economy');
const { equipmentBonus, getOpenExpedition } = require('./expeditions');
const { t } = require('../utils/i18n');
const { fmt } = require('../utils/helpers');
const { ITEMS, SLOTS, RARITIES, RARITY_INFO, SELL_PRICE, FUSION, FUSION_CONSOLATION, requiredDistinct, rollItemOfType, isNormal, perksOf } = require('../data/gameData');
const { itemLabel, perkText } = require('../utils/itemText');

const isId = (s) => /^[a-f\d]{24}$/i.test(s);
const pct = (n) => `${Math.round(n * 100)}%`;
const rankOf = (id) => (ITEMS[id].rarity === 'event' ? RARITIES.length : RARITIES.indexOf(ITEMS[id].rarity)); // los únicos de evento van arriba

function countByItem(user) {
  const counts = {};
  for (const it of user.piggy.inventory) if (ITEMS[it.itemId]) counts[it.itemId] = (counts[it.itemId] || 0) + 1;
  return counts;
}

/** Pantalla de inventario con botones de venta y fusión. Devuelve el payload para reply(). */
async function renderInventory(interaction) {
  const L = interaction.lang;
  const user = await getUser(interaction.user.id);
  const eq = user.piggy.equipped;
  const uses = user.piggy.equippedUses || {};

  // Objetos normales: agrupados con cantidad. Exclusivos (usos limitados): uno por línea con sus usos restantes.
  const normal = {};
  const limited = [];
  for (const it of user.piggy.inventory) {
    if (!ITEMS[it.itemId]) continue;
    if (isNormal(it.itemId)) normal[it.itemId] = (normal[it.itemId] || 0) + 1;
    else limited.push(it);
  }
  const lines = [
    ...limited.sort((a, b) => rankOf(b.itemId) - rankOf(a.itemId)).map((it) => itemLabel(L, it.itemId, it.usesLeft)),
    ...Object.entries(normal).sort((a, b) => rankOf(b[0]) - rankOf(a[0])).map(([id, n]) => `${itemLabel(L, id)} x${n}`),
  ];
  const perks = perksOf(eq);
  const s = user.piggy.stats;
  const embed = new EmbedBuilder().setColor(0xe91e63).setTitle(`🐷 ${user.piggy.name}`).addFields(
    {
      name: t(L, 'inv.equipped'),
      value: SLOTS.map((sl) => `${t(L, `slot.${sl}`)}: ${itemLabel(L, eq?.[sl], uses[sl])}`).join('\n') +
        `\n${t(L, 'inv.bonus', { bonus: pct(equipmentBonus(eq)) })}` +
        (perks.loot || perks.revive ? `\n${t(L, 'inv.perks', { loot: Math.round(perks.loot * 100), revive: Math.round(perks.revive * 100) })}` : ''),
    },
    { name: t(L, 'inv.bag'), value: (lines.join('\n') || t(L, 'inv.empty')).slice(0, 1000) },
    { name: t(L, 'inv.stats'), value: t(L, 'inv.statsLine', { exp: s.expeditions, ok: s.survived, dead: s.deaths, loot: fmt(s.totalLoot) }) }
  );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('inv:sell').setStyle(ButtonStyle.Secondary).setEmoji('💰').setLabel(t(L, 'inv.btnSell')),
    new ButtonBuilder().setCustomId('inv:fuse').setStyle(ButtonStyle.Primary).setEmoji('⚗️').setLabel(t(L, 'inv.btnFuse'))
  );
  const components = [row];

  // Menú "Equipar": lo que llevas en la mochila (el mejor modelo de cada tipo primero). Máx. 25 opciones de Discord.
  const equipIds = [...new Set(user.piggy.inventory.map((it) => it.itemId).filter((id) => ITEMS[id]))].sort((a, b) => rankOf(b) - rankOf(a) || ITEMS[b].bonus - ITEMS[a].bonus).slice(0, 25);
  if (equipIds.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('inv:equipSel').setPlaceholder(t(L, 'inv.equipPlaceholder'))
        .addOptions(equipIds.map((id) => ({
          label: `${t(L, `item.${id}`)} (+${Math.round(ITEMS[id].bonus * 100)}%)`.slice(0, 100),
          description: `${t(L, `slot.${ITEMS[id].type}`)} · ${t(L, `rarity.${ITEMS[id].rarity}`)}`.slice(0, 100),
          value: id,
        })))
    ));
  }

  // Menú "Desequipar": solo las ranuras ocupadas, más "todo" si hay más de una.
  const filled = SLOTS.filter((sl) => eq?.[sl] && ITEMS[eq[sl]]);
  if (filled.length) {
    const options = filled.map((sl) => ({ label: `${t(L, `slot.${sl}`)}: ${t(L, `item.${eq[sl]}`)}`.slice(0, 100), value: sl }));
    if (filled.length > 1) options.push({ label: t(L, 'inv.unequipAll'), value: 'all' });
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('inv:unequipSel').setPlaceholder(t(L, 'inv.unequipPlaceholder')).addOptions(options)
    ));
  }
  return { embeds: [embed], components, flags: MessageFlags.Ephemeral };
}

// ---------------- EQUIPAR / DESEQUIPAR ----------------
/**
 * Equipa un objeto de la mochila (la copia con más usos). Devuelve { ok, reason?, itemId, usesLeft, previous }.
 * reason: unknown | locked | missing | fail.  Lo que llevabas puesto en esa ranura vuelve a la mochila.
 */
async function equipItem(discordId, itemId) {
  const item = ITEMS[itemId];
  if (!item) return { ok: false, reason: 'unknown' };
  // El equipo se bloquea mientras el cerdito está fuera (así los usos y el equipo del resultado son los que salieron).
  if (await getOpenExpedition(discordId)) return { ok: false, reason: 'locked' };

  const user = await getUser(discordId);
  const copies = user.piggy.inventory.filter((i) => i.itemId === itemId);
  if (!copies.length) return { ok: false, reason: 'missing' };
  const copy = copies.reduce((best, c) => ((c.usesLeft ?? Infinity) > (best.usesLeft ?? Infinity) ? c : best));

  // Atómico: saca esa copia de la mochila, la equipa con sus usos y devuelve el documento ANTERIOR para recuperar lo que llevaba puesto.
  const before = await User.findOneAndUpdate(
    { discordId, 'piggy.inventory._id': copy._id },
    { $pull: { 'piggy.inventory': { _id: copy._id } }, $set: { [`piggy.equipped.${item.type}`]: itemId, [`piggy.equippedUses.${item.type}`]: copy.usesLeft ?? null } },
    { new: false }
  );
  if (!before) return { ok: false, reason: 'fail' };
  const previous = before.piggy.equipped?.[item.type] || null;
  if (previous) {
    const prevUses = before.piggy.equippedUses?.[item.type] ?? ITEMS[previous]?.maxUses ?? null;
    await User.updateOne({ discordId }, { $push: { 'piggy.inventory': { itemId: previous, usesLeft: prevUses } } });
  }
  return { ok: true, itemId, usesLeft: copy.usesLeft ?? undefined, previous };
}

/**
 * Quita el objeto de una ranura (o de todas con 'all') y lo devuelve a la mochila CON sus usos restantes.
 * Cada ranura es UNA sola operación atómica (quitar de la ranura + meter en la mochila), así que nunca se pierde un objeto.
 * Devuelve { ok, reason?, removed: [itemId...] }. reason: locked | nothing | unknown.
 */
async function unequip(discordId, slot) {
  const slots = slot === 'all' ? SLOTS : SLOTS.includes(slot) ? [slot] : null;
  if (!slots) return { ok: false, reason: 'unknown' };
  if (await getOpenExpedition(discordId)) return { ok: false, reason: 'locked' };

  const removed = [];
  for (let attempt = 0; attempt < 2 && removed.length < slots.length; attempt++) {
    const user = await getUser(discordId);
    for (const sl of slots) {
      if (removed.some((r) => r.slot === sl)) continue;
      const itemId = user.piggy.equipped?.[sl];
      if (!itemId) continue;
      const usesLeft = user.piggy.equippedUses?.[sl] ?? (ITEMS[itemId]?.maxUses ?? null);
      // El filtro exige que la ranura SIGA teniendo ese objeto: si cambió entre la lectura y la escritura, no se toca nada.
      const res = await User.updateOne(
        { discordId, [`piggy.equipped.${sl}`]: itemId },
        { $set: { [`piggy.equipped.${sl}`]: null, [`piggy.equippedUses.${sl}`]: null }, $push: { 'piggy.inventory': { itemId, usesLeft } } }
      );
      if (res.modifiedCount) removed.push({ slot: sl, itemId });
    }
    if (!removed.length) break; // nada equipado: no reintentar
  }
  if (!removed.length) return { ok: false, reason: 'nothing' };
  return { ok: true, removed: removed.map((r) => r.itemId) };
}

// ---------------- VENTA ----------------
/** Vende `qty` ('all' o número) copias de un objeto. Atómico: el filtro exige que TODAS las copias sigan en la mochila. */
async function sellItems(discordId, itemId, qty) {
  const item = ITEMS[itemId];
  if (!item || item.sellable === false) return { ok: false }; // los objetos exclusivos no se venden
  const user = await User.findOne({ discordId });
  const copies = (user?.piggy.inventory || []).filter((i) => i.itemId === itemId);
  const n = qty === 'all' ? copies.length : Math.min(Number(qty) || 0, copies.length);
  if (n <= 0) return { ok: false };
  const ids = copies.slice(0, n).map((c) => c._id);
  const total = SELL_PRICE[item.rarity] * n;
  const res = await User.findOneAndUpdate(
    { discordId, 'piggy.inventory._id': { $all: ids } },
    { $pull: { 'piggy.inventory': { _id: { $in: ids } } }, $inc: { coinks: total } },
    { new: true }
  );
  if (!res) return { ok: false }; // alguien vendió/equipó esas copias a la vez
  logLedger({ type: 'item_sell', toId: discordId, amount: total, reason: `${itemId} x${n}` });
  return { ok: true, n, total, balance: res.coinks };
}

// ---------------- FUSIÓN ----------------
/** Recetas disponibles: [{ type, rarity, recipe, copies }] según lo que tenga el usuario. */
function availableRecipes(user) {
  const out = [];
  for (const type of SLOTS) {
    for (const rarity of Object.keys(FUSION)) {
      const copies = user.piggy.inventory.filter((i) => isNormal(i.itemId) && ITEMS[i.itemId].type === type && ITEMS[i.itemId].rarity === rarity);
      const distinct = new Set(copies.map((c) => c.itemId)).size;
      if (copies.length >= FUSION[rarity].count && distinct >= requiredDistinct(type, rarity)) out.push({ type, rarity, recipe: FUSION[rarity], copies });
    }
  }
  return out;
}

/** Copias a mostrar en el menú: una de cada modelo primero (para poder cumplir la variedad) y luego las repetidas. Máx. 25. */
function pickDisplayCopies(copies) {
  const groups = new Map();
  for (const c of copies) {
    if (!groups.has(c.itemId)) groups.set(c.itemId, []);
    groups.get(c.itemId).push(c);
  }
  const out = [];
  for (let round = 0; out.length < 25; round++) {
    let added = false;
    for (const g of groups.values()) if (g[round] && out.length < 25) { out.push(g[round]); added = true; }
    if (!added) break;
  }
  return out;
}

/**
 * Valida y (si no es dryRun) ejecuta una fusión. `idStrings` = _id de las copias elegidas.
 * Paso atómico único: consume las copias + cobra la tarifa (+ devuelve el consuelo si falla).
 * Después, si hubo éxito, añade el objeto nuevo.
 */
async function fuse(discordId, idStrings, type, rarity, { dryRun = false } = {}) {
  const recipe = FUSION[rarity];
  if (!recipe || !SLOTS.includes(type)) return { ok: false, reason: 'recipe' };
  const ids = [...new Set(idStrings)];
  if (ids.length !== recipe.count || !ids.every(isId)) return { ok: false, reason: 'count' };

  const user = await User.findOne({ discordId });
  if (!user) return { ok: false, reason: 'items' };
  const copies = ids.map((id) => user.piggy.inventory.id(id));
  if (copies.some((c) => !c)) return { ok: false, reason: 'items' };
  if (copies.some((c) => !isNormal(c.itemId) || ITEMS[c.itemId].type !== type || ITEMS[c.itemId].rarity !== rarity)) return { ok: false, reason: 'type' };
  if (new Set(copies.map((c) => c.itemId)).size < requiredDistinct(type, rarity)) return { ok: false, reason: 'distinct' };
  if (user.coinks < recipe.fee) return { ok: false, reason: 'funds' };
  if (dryRun) return { ok: true };

  const success = Math.random() < recipe.chance;
  const consolation = success ? 0 : Math.floor(SELL_PRICE[rarity] * copies.length * FUSION_CONSOLATION);
  const objIds = copies.map((c) => c._id);

  const consumed = await User.findOneAndUpdate(
    { discordId, coinks: { $gte: recipe.fee }, 'piggy.inventory._id': { $all: objIds } },
    { $pull: { 'piggy.inventory': { _id: { $in: objIds } } }, $inc: { coinks: consolation - recipe.fee } },
    { new: true }
  );
  if (!consumed) return { ok: false, reason: 'changed' };
  if (recipe.fee > 0) logLedger({ type: 'fusion_fee', fromId: discordId, amount: recipe.fee, reason: `${type} ${rarity}` });
  if (consolation > 0) logLedger({ type: 'fusion_consolation', toId: discordId, amount: consolation, reason: `${type} ${rarity}` });

  if (!success) return { ok: true, success: false, consolation, fee: recipe.fee };

  const newId = rollItemOfType(type, recipe.next);
  try {
    await User.updateOne({ discordId }, { $push: { 'piggy.inventory': { itemId: newId } } });
  } catch (err) {
    console.error('[fusión] ERROR añadiendo el resultado, reintentando', discordId, newId, err);
    await User.updateOne({ discordId }, { $push: { 'piggy.inventory': { itemId: newId } } }); // si vuelve a fallar, lo gestiona el router
  }
  return { ok: true, success: true, itemId: newId, fee: recipe.fee };
}

// Selecciones pendientes de confirmar (viven 2 min en memoria; si el bot reinicia, basta con repetir).
const pending = new Map();
function putPending(data) {
  const token = crypto.randomBytes(4).toString('hex');
  pending.set(token, { ...data, expires: Date.now() + 120_000 });
  for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
  return token;
}
function takePending(token, userId) {
  const p = pending.get(token);
  pending.delete(token);
  return p && p.expires > Date.now() && p.userId === userId ? p : null;
}

module.exports = { renderInventory, equipItem, unequip, itemLabel, perkText, countByItem, sellItems, availableRecipes, pickDisplayCopies, fuse, putPending, takePending, rankOf };
