// Log de compras: un aviso detallado en el canal de /set-purchases-channel cada vez que alguien compra en la tienda del
// servidor o en la Tienda de Expedición. Las compras de NFT y las "destacadas" (caras, épicas/legendarias) salen resaltadas.
const { EmbedBuilder } = require('discord.js');
const WalletLink = require('../models/WalletLink');
const { ITEMS, RARITY_INFO } = require('../data/gameData');
const { getGuildConfig } = require('../utils/guildConfig');
const { notifyAdmins } = require('../utils/adminLog');
const { t, langForGuild } = require('../utils/i18n');
const { fmt, shortAddr } = require('../utils/helpers');
const config = require('../config');

/**
 * Qué se muestra (función pura, fácil de probar). p = {
 *   kind: 'shop' | 'expshop', name, itemId?, price, buyerId, delivery: 'role'|'manual'|'nft'|'inventory',
 *   roleId?, orderId?, stockLeft?, stockTotal?, wallets?, contract?, tokenId?, network?
 * }. publicMode = canal visible para todos: wallets abreviadas y sin ID de pedido.
 */
function describePurchase(p, L, { publicMode = false } = {}) {
  const cur = config.currency;
  const isNft = p.delivery === 'nft';
  const item = p.itemId ? ITEMS[p.itemId] : null;
  const highlight = isNft || p.price >= config.purchases.highlightMinCoins || ['epic', 'legendary'].includes(item?.rarity);
  const name = item ? t(L, `item.${p.itemId}`) : p.name;
  const titleKey = isNft ? 'purchaseLog.title.nft' : p.kind === 'expshop' ? 'purchaseLog.title.expshop' : 'purchaseLog.title.shop';

  const fields = [
    { name: t(L, 'purchaseLog.fBuyer'), value: `<@${p.buyerId}>${publicMode ? '' : ` (\`${p.buyerId}\`)`}`, inline: true },
    { name: t(L, 'purchaseLog.fPrice'), value: `${cur.emoji} **${fmt(p.price)}** ${cur.name}`, inline: true },
  ];
  if (p.stockLeft !== null && p.stockLeft !== undefined) {
    fields.push({ name: t(L, 'purchaseLog.fStock'), value: p.stockTotal ? `${p.stockLeft}/${p.stockTotal}` : t(L, 'purchaseLog.stockLeft', { n: p.stockLeft }), inline: true });
  }
  if (item) {
    const perks = [];
    if (item.perk?.loot) perks.push(t(L, 'perk.loot', { pct: Math.round(item.perk.loot * 100) }));
    if (item.perk?.revive) perks.push(t(L, 'perk.revive', { pct: Math.round(item.perk.revive * 100) }));
    fields.push({
      name: t(L, 'purchaseLog.fItem'),
      value: `${RARITY_INFO[item.rarity].emoji} ${t(L, `rarity.${item.rarity}`)} · ${t(L, `slot.${item.type}`)} · +${Math.round(item.bonus * 100)}%${item.maxUses ? ` · 🔁${item.maxUses}` : ''}${perks.length ? `\n✨ ${perks.join(' · ')}` : ''}`,
    });
  }
  if (isNft && (p.contract || p.tokenId)) {
    fields.push({ name: 'NFT', value: [p.network, p.contract && `\`${p.contract}\``, p.tokenId && `#${p.tokenId}`].filter(Boolean).join(' · ') });
  }

  const wallets = (p.wallets || []).map((w) => `\`${publicMode ? shortAddr(w) : w}\``).join('\n');
  const delivery = {
    role: t(L, 'purchaseLog.deliveryRole', { role: `<@&${p.roleId}>` }),
    manual: t(L, 'purchaseLog.deliveryManual') + (!publicMode && p.orderId ? `\n${t(L, 'purchaseLog.order', { id: p.orderId })}` : ''),
    nft: t(L, 'purchaseLog.deliveryNft') + `\n${wallets || t(L, 'purchaseLog.noWallet')}` + (!publicMode && p.orderId ? `\n${t(L, 'purchaseLog.order', { id: p.orderId })}` : ''),
    inventory: t(L, 'purchaseLog.deliveryInventory'),
  }[p.delivery];
  fields.push({ name: t(L, 'purchaseLog.fDelivery'), value: delivery });

  return {
    title: `${highlight ? '🌟 ' : ''}${t(L, titleKey, { item: name })}`,
    description: `**${name}**`,
    color: isNft ? 0xff3df2 : highlight ? 0xf1c40f : 0x2ecc71,
    highlight,
    fields,
  };
}

/** Publica el aviso. Sin canal configurado, los pedidos pendientes (manual/NFT) siguen avisando al canal de admins del .env. */
async function logPurchase(client, guildId, p) {
  try {
    const cfg = await getGuildConfig(guildId);
    const L = langForGuild(client.guilds.cache.get(guildId));
    if (p.delivery === 'nft') p.wallets = (await WalletLink.find({ discordId: p.buyerId }).lean()).map((w) => w.address);
    const user = await client.users.fetch(p.buyerId).catch(() => null);

    const build = (publicMode) => {
      const d = describePurchase(p, L, { publicMode });
      const e = new EmbedBuilder().setColor(d.color).setTitle(d.title).setDescription(d.description).addFields(d.fields).setTimestamp();
      if (user) e.setThumbnail(user.displayAvatarURL());
      return e;
    };

    if (cfg.purchasesChannelId) {
      const channel = await client.channels.fetch(cfg.purchasesChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [build(!!cfg.purchasesPublic)], allowedMentions: { parse: [] } });
        return;
      }
    }
    if (p.delivery === 'manual' || p.delivery === 'nft') await notifyAdmins(client, { embeds: [build(false)] });
  } catch (err) {
    console.error('[compras] no pude registrar la compra:', err.message);
  }
}

module.exports = { describePurchase, logPurchase };
