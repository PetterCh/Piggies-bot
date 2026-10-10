// Tienda de Expedición rotativa: ~10 objetos exclusivos con stock limitado que rotan solos (por defecto cada 12 h = 2 veces al día).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ExpShopRotation = require('../models/ExpShopRotation');
const GuildConfig = require('../models/GuildConfig');
const User = require('../models/User');
const { ITEMS, RARITY_INFO, SHOP_PRICE, SHOP_STOCK } = require('../data/gameData');
const { getGuildConfig } = require('../utils/guildConfig');
const { t, langForGuild } = require('../utils/i18n');
const { itemLabel, perkText } = require('../utils/itemText');
const { withMedia } = require('../utils/media');
const { removeCoinks, addCoinks, getUser, InsufficientFundsError, logLedger } = require('../utils/economy');
const { askConfirmation } = require('../utils/confirm');
const { logPurchase } = require('./purchaseLog');
const { shuffle, sleep, fmt } = require('../utils/helpers');
const config = require('../config');

const ROT_MS = config.expShop.rotationHours * 3600_000;
// Composición de cada escaparate (10 objetos): variedad de rarezas; tipos (arma/armadura/casco) al azar.
const COMPOSITION = [['common', 2], ['uncommon', 2], ['rare', 3], ['epic', 2], ['legendary', 1]];
const SHOP_IDS = Object.keys(ITEMS).filter((id) => ITEMS[id].source === 'shop');
const currentSlot = () => Math.floor(Date.now() / ROT_MS);

/** Elige los objetos del escaparate evitando repetir los de la rotación anterior mientras haya alternativas. */
function pickItems(prevIds = []) {
  const out = [];
  for (const [rarity, n] of COMPOSITION) {
    const pool = SHOP_IDS.filter((id) => ITEMS[id].rarity === rarity);
    const ordered = [...shuffle(pool.filter((id) => !prevIds.includes(id))), ...shuffle(pool.filter((id) => prevIds.includes(id)))];
    for (const itemId of ordered.slice(0, n)) out.push({ itemId, price: SHOP_PRICE[rarity], stock: SHOP_STOCK[rarity], total: SHOP_STOCK[rarity] });
  }
  return out;
}

// ---------------- Tarjetas ----------------
function buildHeader(L, rot) {
  const embed = new EmbedBuilder().setColor(0x16a085).setTitle(t(L, 'expShop.title'))
    .setDescription(t(L, 'expShop.intro', { when: `<t:${Math.floor(rot.endsAt.getTime() / 1000)}:R>` }))
    .setFooter({ text: t(L, 'expShop.rotationN', { n: rot.slot }) });
  const { files } = withMedia(embed, ['expshop.header']);
  return { embeds: [embed], files };
}

function buildCard(L, rot, it) {
  const item = ITEMS[it.itemId];
  const r = RARITY_INFO[item.rarity];
  const soldOut = it.stock <= 0;
  const stats = [`+${Math.round(item.bonus * 100)}% ${t(L, 'expShop.survival')}`, perkText(L, it.itemId)].filter(Boolean).join('\n');
  const embed = new EmbedBuilder().setColor(soldOut ? 0x7f8c8d : r.color)
    .setTitle(`${r.emoji} ${t(L, `item.${it.itemId}`)}`)
    .setDescription(t(L, 'expShop.slotLine', { slot: t(L, `slot.${item.type}`), rarity: t(L, `rarity.${item.rarity}`) }))
    .addFields(
      { name: t(L, 'expShop.fStats'), value: stats, inline: true },
      { name: t(L, 'expShop.fUses'), value: `🔁 ${item.maxUses}`, inline: true },
      { name: t(L, 'expShop.fPrice'), value: `🪙 **${fmt(it.price)}**`, inline: true },
      { name: t(L, 'expShop.fStock'), value: soldOut ? t(L, 'store.soldOut') : `${it.stock}/${it.total}`, inline: true }
    )
    .setFooter({ text: t(L, 'expShop.onePerPerson') });
  const { files } = withMedia(embed, [`expshop.item.${it.itemId}`, `expshop.rarity.${item.rarity}`]);
  const button = new ButtonBuilder().setCustomId(`xshop:buy:${rot._id}:${it.itemId}`).setStyle(ButtonStyle.Success).setEmoji('🛒')
    .setLabel(t(L, soldOut ? 'store.soldOut' : 'store.buy')).setDisabled(soldOut);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)], files };
}

// ---------------- Publicación ----------------
const locks = new Set(); // evita publicar dos veces el mismo panel si coinciden el temporizador y un comando
async function withLock(guildId, fn) {
  if (locks.has(guildId)) return null;
  locks.add(guildId);
  try { return await fn(); } finally { locks.delete(guildId); }
}

async function deleteMessages(client, channelId, ids) {
  const ch = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  if (!ch) return;
  for (const id of ids.filter(Boolean)) await ch.messages.delete(id).catch(() => {});
}

/** Borra los mensajes de TODAS las rotaciones publicadas del servidor (rotación nueva o cambio de canal). */
async function clearPanels(client, guildId) {
  for (const rot of await ExpShopRotation.find({ guildId, published: true })) {
    await deleteMessages(client, rot.channelId, [rot.headerMessageId, ...rot.items.map((i) => i.messageId)]);
    rot.items.forEach((i) => { i.messageId = null; });
    rot.published = false;
    rot.headerMessageId = null;
    rot.channelId = null;
    await rot.save();
  }
}

async function publishPanel(client, rotId, { announce = false } = {}) {
  let rot = await ExpShopRotation.findById(rotId);
  const cfg = await getGuildConfig(rot.guildId);
  const channel = cfg.expShopChannelId ? await client.channels.fetch(cfg.expShopChannelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return rot;
  const L = langForGuild(client.guilds.cache.get(rot.guildId));

  await clearPanels(client, rot.guildId);
  rot = await ExpShopRotation.findById(rotId);
  // Rotación nueva (automática): menciona al rol de novedades de la tienda (/set-ping-role tipo:tienda).
  const ping = announce && cfg.shopRoleId ? { content: t(L, 'expShop.newRotation', { role: `<@&${cfg.shopRoleId}>` }), allowedMentions: { roles: [cfg.shopRoleId] } } : {};
  const header = await channel.send({ ...buildHeader(L, rot), ...ping });
  rot.headerMessageId = header.id;
  const sorted = [...rot.items].sort((a, b) => a.price - b.price);
  for (const it of sorted) {
    const msg = await channel.send(buildCard(L, rot, it));
    rot.items.find((x) => x.itemId === it.itemId).messageId = msg.id;
    await sleep(350); // respeta los límites de velocidad de Discord
  }
  rot.published = true;
  rot.channelId = channel.id;
  await rot.save();
  return rot;
}

/** Garantiza que exista la rotación de la franja actual (y, si hay canal configurado, que esté publicada). */
async function ensureRotation(client, guildId, { publish = true, force = false, announce = false } = {}) {
  const slot = currentSlot();
  let rot = await ExpShopRotation.findOne({ guildId, slot });
  if (!rot) {
    const prev = await ExpShopRotation.findOne({ guildId }).sort({ slot: -1 });
    try {
      rot = await ExpShopRotation.create({
        guildId, slot, startsAt: new Date(slot * ROT_MS), endsAt: new Date((slot + 1) * ROT_MS),
        items: pickItems(prev?.items.map((i) => i.itemId)),
      });
    } catch (err) {
      if (err.code !== 11000) throw err;
      rot = await ExpShopRotation.findOne({ guildId, slot }); // otra ejecución la creó justo antes
    }
  }
  if (publish && (force || !rot.published)) {
    const cfg = await getGuildConfig(guildId);
    if (cfg.expShopChannelId) {
      await withLock(guildId, async () => {
        const fresh = await ExpShopRotation.findById(rot._id);
        if (force || !fresh.published) rot = await publishPanel(client, rot._id, { announce });
      });
    }
  }
  return rot;
}

/** Cada minuto: crea y publica la nueva rotación cuando cambia la franja. */
async function tick(client) {
  for (const cfg of await GuildConfig.find({ expShopChannelId: { $ne: null } }).lean()) {
    if (!client.guilds.cache.has(cfg.guildId)) continue;
    await ensureRotation(client, cfg.guildId, { announce: true }).catch((e) => console.error('[tienda-exp] rotación:', e.message));
  }
}

/** Quita el panel del canal (al desactivar o antes de cambiar de canal). */
const removePanel = (client, guildId) => withLock(guildId, () => clearPanels(client, guildId));

// ---------------- Actualización de tarjetas tras una compra ----------------
const timers = new Map();
function queueCardUpdate(client, rotId, itemId) {
  const key = `${rotId}:${itemId}`;
  clearTimeout(timers.get(key));
  timers.set(key, setTimeout(async () => {
    timers.delete(key);
    try {
      const rot = await ExpShopRotation.findById(rotId);
      const it = rot?.items.find((i) => i.itemId === itemId);
      if (!it?.messageId || !rot.channelId) return;
      const ch = await client.channels.fetch(rot.channelId);
      const msg = await ch.messages.fetch(it.messageId);
      const card = buildCard(langForGuild(client.guilds.cache.get(rot.guildId)), rot, it);
      await msg.edit({ ...card, attachments: [] });
    } catch (e) {
      console.error('[tienda-exp] actualizar tarjeta:', e.message);
    }
  }, 1500));
}

// ---------------- Compra ----------------
/** `interaction` debe estar "deferred" (efímero). Reserva stock -> cobra -> entrega; si algo falla, revierte. */
async function purchase(interaction, rotId, itemId) {
  const tt = interaction.t;
  const userId = interaction.user.id;
  const eph = (key, vars) => interaction.editReply(tt(key, vars));

  if (!/^[a-f\d]{24}$/i.test(rotId)) return eph('expShop.expired');
  const rot = await ExpShopRotation.findOne({ _id: rotId, guildId: interaction.guildId });
  const it = rot?.items.find((i) => i.itemId === itemId);
  if (!rot || !it || rot.endsAt <= new Date()) return eph('expShop.expired');
  if (it.buyers.includes(userId)) return eph('expShop.alreadyBought');
  if (it.stock <= 0) return eph('expShop.soldOut');

  const item = ITEMS[itemId];
  const ok = await askConfirmation(interaction, {
    content: tt('expShop.confirm', { item: itemLabel(interaction.lang, itemId, item.maxUses), price: fmt(it.price), uses: item.maxUses, currency: config.currency.name }),
  });
  if (!ok) return;

  // 1) Reservar una unidad (atómico: stock > 0 y el usuario aún no la compró).
  const reserved = await ExpShopRotation.findOneAndUpdate(
    { _id: rot._id, endsAt: { $gt: new Date() }, items: { $elemMatch: { itemId, stock: { $gt: 0 }, buyers: { $ne: userId } } } },
    { $inc: { 'items.$.stock': -1, 'items.$.sold': 1 }, $push: { 'items.$.buyers': userId } },
    { new: true }
  );
  if (!reserved) return eph('expShop.soldOut');
  const release = async () => {
    await ExpShopRotation.updateOne({ _id: rot._id, 'items.itemId': itemId }, { $inc: { 'items.$.stock': 1, 'items.$.sold': -1 }, $pull: { 'items.$.buyers': userId } });
    queueCardUpdate(interaction.client, rot._id, itemId);
  };

  // 2) Cobrar.
  try {
    await getUser(userId);
    await removeCoinks(userId, it.price, { type: 'expshop_buy', reason: itemId, guildId: interaction.guildId });
  } catch (err) {
    await release();
    if (err instanceof InsufficientFundsError) return eph('expShop.noFunds', { currency: config.currency.name });
    throw err;
  }

  // 3) Entregar (con sus usos completos).
  try {
    await User.updateOne({ discordId: userId }, { $push: { 'piggy.inventory': { itemId, usesLeft: item.maxUses } } });
  } catch (err) {
    console.error('[tienda-exp] fallo al entregar, reembolsando', err);
    await addCoinks(userId, it.price, { type: 'expshop_refund', reason: itemId, guildId: interaction.guildId }).catch((e) => console.error('[tienda-exp] REEMBOLSO FALLÓ', userId, it.price, e));
    await release();
    return eph('expShop.deliverFail');
  }
  queueCardUpdate(interaction.client, rot._id, itemId);
  const left = reserved.items.find((i) => i.itemId === itemId);
  logPurchase(interaction.client, interaction.guildId, { kind: 'expshop', itemId, price: it.price, buyerId: userId, delivery: 'inventory', stockLeft: left?.stock, stockTotal: left?.total });
  return eph('expShop.bought', { item: itemLabel(interaction.lang, itemId, item.maxUses) });
}

module.exports = { ensureRotation, tick, removePanel, purchase, buildHeader, currentSlot, pickItems, ROT_MS };
