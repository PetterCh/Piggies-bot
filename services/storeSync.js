// Mantiene el canal de la tienda: una "tarjeta" (embed + botón Comprar) por artículo, siempre actualizada.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const ShopItem = require('../models/ShopItem');
const { getGuildConfig } = require('../utils/guildConfig');
const { t, langForGuild } = require('../utils/i18n');
const { sleep, fmt } = require('../utils/helpers');
const config = require('../config');

function buildCard(item, L) {
  const cur = config.currency;
  const soldOut = item.stock !== null && item.stock <= 0;
  const embed = new EmbedBuilder()
    .setColor(soldOut ? 0x7f8c8d : 0xf1c40f)
    .setTitle(`${{ role: '🎭', nft: '💎', manual: '🎁' }[item.type] || '🎁'} ${item.name}`)
    .setDescription(item.description || t(L, 'store.noDescription'))
    .addFields(
      { name: t(L, 'store.price'), value: `${cur.emoji} **${fmt(item.price)}** ${cur.name}`, inline: true },
      { name: t(L, 'store.stock'), value: item.stock === null ? t(L, 'store.unlimited') : soldOut ? t(L, 'store.soldOut') : t(L, 'store.left', { n: item.stock }), inline: true },
      { name: t(L, 'store.delivery'), value: item.type === 'role' ? t(L, 'store.deliveryRole', { role: `<@&${item.roleId}>` }) : item.type === 'nft' ? t(L, 'store.deliveryNft') : t(L, 'store.deliveryManual'), inline: true }
    );
  if (item.type === 'nft' && (item.nftContract || item.nftTokenId)) {
    embed.addFields({ name: 'NFT', value: [item.nftNetwork, item.nftContract && `\`${item.nftContract}\``, item.nftTokenId && `#${item.nftTokenId}`].filter(Boolean).join(' · ') });
  }
  if (item.maxPerUser > 0) embed.setFooter({ text: t(L, 'store.maxPerUser', { n: item.maxPerUser }) });
  if (item.imageUrl) embed.setImage(item.imageUrl);
  const button = new ButtonBuilder()
    .setCustomId(`shop:buy:${item._id}`)
    .setStyle(ButtonStyle.Success)
    .setEmoji('🛒')
    .setLabel(t(L, soldOut ? 'store.soldOut' : 'store.buy'))
    .setDisabled(soldOut);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

async function deleteCard(client, item) {
  if (!item.storeMessageId) return;
  try {
    const ch = await client.channels.fetch(item.storeChannelId);
    await (await ch.messages.fetch(item.storeMessageId)).delete();
  } catch { /* el mensaje ya no existe: nada que borrar */ }
  await ShopItem.updateOne({ _id: item._id }, { storeMessageId: null, storeChannelId: null });
}

/** Publica o actualiza la tarjeta de UN artículo (o la elimina si está oculto). */
async function syncItem(client, itemId, { announce = false } = {}) {
  const item = await ShopItem.findById(itemId);
  if (!item) return;
  const cfg = await getGuildConfig(item.guildId);
  if (!cfg.storeChannelId) return;
  if (!item.active) return deleteCard(client, item);

  const channel = await client.channels.fetch(cfg.storeChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const payload = buildCard(item, langForGuild(client.guilds.cache.get(item.guildId)));

  if (item.storeMessageId && item.storeChannelId === channel.id) {
    try {
      await (await channel.messages.fetch(item.storeMessageId)).edit(payload);
      return;
    } catch { /* la tarjeta fue borrada a mano: se vuelve a publicar */ }
  }
  // Artículo NUEVO: avisa al rol de novedades de la tienda (/set-ping-role tipo:tienda), nunca en ediciones ni republicaciones.
  const ping = announce && cfg.shopRoleId
    ? { content: t(langForGuild(client.guilds.cache.get(item.guildId)), 'store.newItem', { role: `<@&${cfg.shopRoleId}>`, item: item.name }), allowedMentions: { roles: [cfg.shopRoleId] } }
    : {};
  const msg = await channel.send({ ...payload, ...ping });
  await ShopItem.updateOne({ _id: item._id }, { storeMessageId: msg.id, storeChannelId: channel.id });
}

// Varias compras seguidas se agrupan en una sola edición (evita rate limits de Discord).
const timers = new Map();
function queueSync(client, itemId, opts = {}) {
  const key = String(itemId);
  clearTimeout(timers.get(key)?.timer);
  const announce = opts.announce || timers.get(key)?.announce || false; // un aviso pendiente no se pierde si llega otra edición
  const timer = setTimeout(() => {
    timers.delete(key);
    syncItem(client, itemId, { announce }).catch((e) => console.error('[tienda] sync:', e.message));
  }, 1500);
  timers.set(key, { timer, announce });
}

/** Borra las tarjetas que estén en un canal distinto a `keepChannelId` (al cambiar o desactivar el canal). */
async function purgeCards(client, guildId, keepChannelId) {
  const items = await ShopItem.find({ guildId, storeMessageId: { $ne: null } });
  for (const it of items) if (it.storeChannelId !== keepChannelId) await deleteCard(client, it);
}

/** Reconstruye la tienda completa en el canal configurado. Devuelve cuántas tarjetas hay. */
async function syncAll(client, guildId) {
  const cfg = await getGuildConfig(guildId);
  await purgeCards(client, guildId, cfg.storeChannelId);
  if (!cfg.storeChannelId) return 0;
  const items = await ShopItem.find({ guildId }).sort({ price: 1 });
  let n = 0;
  for (const it of items) {
    if (!it.active) { await deleteCard(client, it); continue; }
    await syncItem(client, it._id);
    n++;
    await sleep(400);
  }
  return n;
}

module.exports = { buildCard, syncItem, queueSync, syncAll, purgeCards };
