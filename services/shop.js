// Compra de artículos de la tienda del servidor.
const ShopItem = require('../models/ShopItem');
const ShopPurchase = require('../models/ShopPurchase');
const { removeCoinks, addCoinks, InsufficientFundsError } = require('../utils/economy');
const { askConfirmation } = require('../utils/confirm');
const WalletLink = require('../models/WalletLink');
const { logPurchase } = require('./purchaseLog');
const { fmt } = require('../utils/helpers');
const config = require('../config');
const { queueSync } = require('./storeSync');

/**
 * Flujo de compra. `interaction` debe estar ya "deferred" (efímero). Orden seguro:
 * validar -> confirmar -> reservar stock (atómico) -> cobrar (atómico) -> entregar; si algo falla se revierte.
 */
async function purchase(interaction, itemId) {
  const t = interaction.t;
  const userId = interaction.user.id;
  const guild = interaction.guild;
  const cur = config.currency;

  if (!/^[a-f\d]{24}$/i.test(itemId)) return interaction.editReply(t('shop.notFound'));
  const item = await ShopItem.findOne({ _id: itemId, guildId: guild.id, active: true });
  if (!item) return interaction.editReply(t('shop.notFound'));
  if (item.stock !== null && item.stock <= 0) return interaction.editReply(t('shop.soldOut'));
  if (item.maxPerUser > 0) {
    const n = await ShopPurchase.countDocuments({ itemId: item._id, userId, status: { $ne: 'refunded' } });
    if (n >= item.maxPerUser) return interaction.editReply(t('shop.limitReached', { max: item.maxPerUser }));
  }
  if (item.type === 'role' && interaction.member.roles.cache.has(item.roleId)) return interaction.editReply(t('shop.hasRole'));
  // Los NFT se envían a mano a la wallet vinculada del comprador: sin wallet no se puede comprar.
  if (item.type === 'nft' && !(await WalletLink.exists({ discordId: userId }))) return interaction.editReply(t('shop.needWallet'));

  const ok = await askConfirmation(interaction, {
    content: t('shop.confirm', { item: item.name, price: fmt(item.price), emoji: cur.emoji, currency: cur.name }),
  });
  if (!ok) return;

  // 1) Reservar stock de forma atómica (evita vender de más si dos personas compran a la vez).
  if (item.stock !== null) {
    const reserved = await ShopItem.findOneAndUpdate({ _id: item._id, active: true, stock: { $gt: 0 } }, { $inc: { stock: -1, sold: 1 } });
    if (!reserved) return interaction.editReply(t('shop.soldOut'));
  } else {
    await ShopItem.updateOne({ _id: item._id }, { $inc: { sold: 1 } });
  }
  queueSync(interaction.client, item._id); // actualiza el stock de la tarjeta en el canal de la tienda
  const releaseStock = async () => {
    await ShopItem.updateOne({ _id: item._id }, { $inc: { sold: -1, ...(item.stock !== null ? { stock: 1 } : {}) } });
    queueSync(interaction.client, item._id);
  };

  // 2) Cobrar.
  try {
    await removeCoinks(userId, item.price, { type: 'shop_buy', reason: item.name, guildId: guild.id });
  } catch (err) {
    await releaseStock();
    if (err instanceof InsufficientFundsError) return interaction.editReply(t('shop.noFunds', { currency: cur.name }));
    throw err;
  }

  // 3) Entregar.
  const stockLeft = item.stock !== null ? item.stock - 1 : null; // stock restante tras esta compra
  const base = { kind: 'shop', name: item.name, price: item.price, buyerId: userId, stockLeft };
  try {
    if (item.type === 'role') {
      await interaction.member.roles.add(item.roleId, 'Compra en la tienda');
      await ShopPurchase.create({ guildId: guild.id, itemId: item._id, itemName: item.name, userId, price: item.price, status: 'completed' });
      logPurchase(interaction.client, guild.id, { ...base, delivery: 'role', roleId: item.roleId });
      return interaction.editReply(t('shop.boughtRole', { item: item.name, role: `<@&${item.roleId}>` }));
    }
    // manual y nft: queda un pedido pendiente que un admin entrega con /tienda-admin entregar
    const order = await ShopPurchase.create({ guildId: guild.id, itemId: item._id, itemName: item.name, userId, price: item.price, status: 'pending' });
    logPurchase(interaction.client, guild.id, { ...base, delivery: item.type, orderId: String(order._id), contract: item.nftContract, tokenId: item.nftTokenId, network: item.nftNetwork });
    return interaction.editReply(t(item.type === 'nft' ? 'shop.boughtNft' : 'shop.boughtManual', { item: item.name }));
  } catch (err) {
    console.error('[tienda] fallo al entregar, reembolsando', err);
    await addCoinks(userId, item.price, { type: 'shop_refund', reason: item.name, guildId: guild.id }).catch((e) => console.error('[tienda] REEMBOLSO FALLÓ', userId, item.price, e));
    await releaseStock();
    return interaction.editReply(t('shop.deliverFail'));
  }
}

module.exports = { purchase };
