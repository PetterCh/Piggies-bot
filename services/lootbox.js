// Cajas misteriosas: tirada, cobro, entrega del premio y mensaje de resultado.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const User = require('../models/User');
const NftPrize = require('../models/NftPrize');
const WalletLink = require('../models/WalletLink');
const LootboxLog = require('../models/LootboxLog');
const { addCoinks, removeCoinks, InsufficientFundsError } = require('../utils/economy');
const { notifyAdmins } = require('../utils/adminLog');
const { withMedia } = require('../utils/media');
const { sleep, randInt, pickRandom, fmt } = require('../utils/helpers');
const { RARITY_INFO, ITEMS, rollItemId } = require('../data/gameData');
const { announceWin } = require('./lootboxLog');
const { BOXES } = require('../data/lootboxes');
const config = require('../config');

/** Sortea un premio de la tabla de la caja. `allowNft=false` excluye el premio NFT. */
function rollSet(box) {
  const slots = ['weapon', 'armor', 'helmet'];
  const rar = slots.map(() => (Math.random() < box.legendaryChance ? 'legendary' : 'epic'));
  if (!rar.includes('legendary')) rar[Math.floor(Math.random() * rar.length)] = 'legendary'; // pity: mínimo 1 legendaria
  const itemIds = slots.map((slot, i) => pickRandom(Object.keys(ITEMS).filter((id) => ITEMS[id].source === 'shop' && ITEMS[id].type === slot && ITEMS[id].rarity === rar[i])));
  return { type: 'set', rarity: 'legendary', itemIds, itemId: itemIds.join(',') };
}

function rollOutcome(box, { allowNft }) {
  if (box.kind === 'set') return rollSet(box);
  const entries = box.table.filter((e) => e.type !== 'nft' || allowNft);
  let r = Math.random() * entries.reduce((a, e) => a + e.weight, 0);
  let entry = entries[entries.length - 1];
  for (const e of entries) {
    r -= e.weight;
    if (r < 0) { entry = e; break; }
  }
  switch (entry.type) {
    case 'coinks': return { type: 'coinks', rarity: entry.rarity, coinks: randInt(...entry.range) };
    case 'gear': return { type: 'gear', rarity: entry.rarity, itemId: rollItemId(entry.rarity) };
    case 'nft': return { type: 'nft', rarity: 'nft' };
    default: return { type: 'nothing', rarity: 'nothing' };
  }
}

/** Reserva un NFT disponible al azar de forma atómica (dos ganadores nunca se llevan el mismo). */
async function claimNftPrize(guildId, userId) {
  for (let i = 0; i < 3; i++) {
    const [pick] = await NftPrize.aggregate([{ $match: { guildId, status: 'available' } }, { $sample: { size: 1 } }]);
    if (!pick) return null;
    const won = await NftPrize.findOneAndUpdate({ _id: pick._id, status: 'available' }, { status: 'won', wonBy: userId, wonAt: new Date() }, { new: true });
    if (won) return won;
  }
  return null;
}

/** Líneas de probabilidades (transparencia con el jugador). */
function oddsLines(box, L, t) {
  const total = box.table.reduce((a, e) => a + e.weight, 0);
  return box.table.map((e) => {
    const pct = (e.weight / total) * 100;
    return t(L, `lootbox.odds.${e.type}`, {
      pct: pct >= 1 ? pct.toFixed(1) : pct.toFixed(2),
      rarity: e.rarity ? `${RARITY_INFO[e.rarity].emoji} ${t(L, `rarity.${e.rarity}`)}` : '',
      min: e.range ? fmt(e.range[0]) : '',
      max: e.range ? fmt(e.range[1]) : '',
    });
  });
}

const busy = new Set(); // usuarios con una apertura en curso (evita cobrar dos veces por un doble clic)

/**
 * Abre una caja desde el panel (botón lb:open) o con "abrir otra" (botón lb:again, `again: true`).
 *  - ephemeral: el resultado lo ve SOLO quien abre (así el canal del panel no se llena). Con "abrir otra" se hereda del mensaje.
 * Orden: cobrar -> responder al instante (animación) -> sortear/entregar -> revelar. Si algo falla tras cobrar, se reembolsa.
 */
async function openBox(interaction, boxId, { again = false, ephemeral = true } = {}) {
  const t = interaction.t;
  const box = BOXES[boxId];
  const eph = { flags: MessageFlags.Ephemeral };
  if (!box) return interaction.reply({ content: t('lootbox.unknown'), ...eph });
  if (busy.has(interaction.user.id)) return interaction.reply({ content: t('lootbox.busy'), ...eph });
  busy.add(interaction.user.id);
  try {
    return await openBoxLocked(interaction, box, { again, ephemeral });
  } finally {
    busy.delete(interaction.user.id);
  }
}

async function openBoxLocked(interaction, box, { again, ephemeral }) {
  const t = interaction.t;
  const eph = { flags: MessageFlags.Ephemeral };
  const userId = interaction.user.id;
  const guildId = interaction.guildId;
  const cur = config.currency;

  try {
    await removeCoinks(userId, box.price, { type: 'lootbox_buy', reason: box.id, guildId });
  } catch (err) {
    if (err instanceof InsufficientFundsError) return interaction.reply({ content: t('lootbox.noFunds', { price: fmt(box.price), currency: cur.name }), ...eph });
    throw err;
  }

  // Animación de apertura (respuesta inmediata para no pasar de los 3 s de Discord).
  const boxName = t(`lootbox.box.${box.id}`);
  const opening = new EmbedBuilder().setColor(0xf5a623).setTitle(`${box.emoji} ${t('lootbox.opening', { box: boxName })}`).setDescription(t('lootbox.openingDesc'));
  const m = withMedia(opening, ['lootbox.opening']);
  let edit;
  if (again && interaction.isButton() && !ephemeral) {
    await interaction.update({ components: [] }); // quita el botón del mensaje anterior
    const msg = await interaction.followUp({ embeds: [opening], files: m.files });
    edit = (p) => interaction.webhook.editMessage(msg.id, { attachments: [], ...p });
  } else if (again && interaction.isButton()) {
    await interaction.update({ embeds: [opening], files: m.files, components: [] }); // mensaje privado: se transforma en la animación
    edit = (p) => interaction.editReply({ attachments: [], ...p });
  } else {
    await interaction.reply({ embeds: [opening], files: m.files, ...(ephemeral ? eph : {}) });
    edit = (p) => interaction.editReply({ attachments: [], ...p });
  }

  let outcome;
  let prize = null;
  let hasWallet = false;
  try {
    hasWallet = !!(await WalletLink.exists({ discordId: userId }));
    const stock = hasWallet ? await NftPrize.exists({ guildId, status: 'available' }) : null;
    outcome = rollOutcome(box, { allowNft: !!stock });
    if (outcome.type === 'nft') {
      prize = await claimNftPrize(guildId, userId);
      if (!prize) outcome = rollOutcome(box, { allowNft: false }); // alguien se llevó el último justo antes
    }
    if (outcome.type === 'coinks') await addCoinks(userId, outcome.coinks, { type: 'lootbox_win', reason: box.id, guildId });
    if (outcome.type === 'set') await User.updateOne({ discordId: userId }, { $push: { 'piggy.inventory': { $each: outcome.itemIds.map((itemId) => ({ itemId, usesLeft: ITEMS[itemId].maxUses })) } } });
    if (outcome.type === 'gear') await User.updateOne({ discordId: userId }, { $push: { 'piggy.inventory': { itemId: outcome.itemId } } });
    LootboxLog.create({ guildId, userId, boxId: box.id, price: box.price, type: outcome.type, rarity: outcome.rarity, coinks: outcome.coinks || 0, itemId: outcome.itemId || null, nftPrizeId: prize?._id || null })
      .catch((e) => console.error('[lootbox] log', e));
  } catch (err) {
    console.error('[lootbox] error tras cobrar, reembolsando', err);
    if (prize) await NftPrize.updateOne({ _id: prize._id, wonBy: userId, status: 'won' }, { status: 'available', wonBy: null, wonAt: null }).catch(() => {});
    await addCoinks(userId, box.price, { type: 'lootbox_refund', reason: box.id, guildId }).catch((e) => console.error('[lootbox] REEMBOLSO FALLÓ', userId, box.price, e));
    return edit({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setDescription(t('lootbox.error'))], files: [] });
  }

  await sleep(config.lootbox.openDelayMs);

  // ---- Resultado ----
  const rar = outcome.rarity;
  const rarityText = RARITY_INFO[rar] ? `${RARITY_INFO[rar].emoji} ${t(`rarity.${rar}`)}` : '';
  const embed = new EmbedBuilder()
    .setColor(rar === 'nothing' ? 0x7f8c8d : rar === 'nft' ? 0xff3df2 : RARITY_INFO[rar].color)
    .setTitle(`${box.emoji} ${t(`lootbox.title.${rar}`)}`);

  if (outcome.type === 'nothing') embed.setDescription(t('lootbox.result.nothing', { user: `<@${userId}>`, price: fmt(box.price) }));
  if (outcome.type === 'coinks') embed.setDescription(t('lootbox.result.coinks', { coinks: fmt(outcome.coinks), rarity: rarityText }));
  if (outcome.type === 'gear') {
    const it = ITEMS[outcome.itemId];
    embed.setDescription(t('lootbox.result.gear', { item: t(`item.${outcome.itemId}`), rarity: rarityText, slot: t(`slot.${it.type}`), bonus: Math.round(it.bonus * 100) }));
  }
  if (outcome.type === 'set') {
    const lines = outcome.itemIds.map((id) => `${RARITY_INFO[ITEMS[id].rarity].emoji} **${t(`item.${id}`)}** — ${t(`slot.${ITEMS[id].type}`)} +${Math.round(ITEMS[id].bonus * 100)}% · ${ITEMS[id].maxUses} ${t('lootbox.result.uses')}`);
    embed.setDescription(t('lootbox.result.set', { items: lines.join('\n') }));
  }
  if (outcome.type === 'nft') {
    embed.setDescription(t('lootbox.result.nft', { name: prize.name })).addFields({ name: 'NFT', value: `**${prize.name}**${prize.description ? `\n${prize.description}` : ''}` });
    if (prize.imageUrl && /^https?:\/\//i.test(prize.imageUrl)) embed.setThumbnail(prize.imageUrl);
    const wallets = (await WalletLink.find({ discordId: userId }).lean()).map((w) => `\`${w.address}\``).join('\n');
    await notifyAdmins(interaction.client, {
      embeds: [new EmbedBuilder().setColor(0xff3df2).setTitle('🏆 NFT ganado en caja').setDescription(`<@${userId}> → **${prize.name}**\n${prize.contractAddress ? `${prize.network} \`${prize.contractAddress}\` #${prize.tokenId ?? '?'}\n` : ''}ID: \`${prize._id}\`\n\n**Wallets:**\n${wallets}\n\n/lootbox-admin nft-entregar`)],
    });
  }

  const net = (outcome.coinks || 0) - box.price;
  embed.addFields({ name: t('lootbox.fNet'), value: `${net >= 0 ? '+' : ''}${fmt(net)} ${cur.emoji}`, inline: true });
  if (!hasWallet) embed.setFooter({ text: t('lootbox.walletHint') });

  const againBtn = new ButtonBuilder()
    .setCustomId(`lb:again:${box.id}:${userId}`)
    .setStyle(outcome.type === 'nothing' ? ButtonStyle.Danger : ButtonStyle.Primary)
    .setLabel(t(outcome.type === 'nothing' ? 'lootbox.revenge' : 'lootbox.again', { price: fmt(box.price) }))
    .setEmoji(box.emoji);
  const media = withMedia(embed, [`lootbox.${rar}`]);
  // Anuncio público en el canal de logs (con @everyone en premios épicos/legendarios o NFT de alto valor)
  announceWin(interaction.client, interaction.guild, { user: interaction.user, box, outcome, prize }).catch((e) => console.error('[lootbox] anuncio:', e.message));
  return edit({ embeds: [embed], files: media.files, components: [new ActionRowBuilder().addComponents(againBtn)] });
}

module.exports = { openBox, oddsLines, rollOutcome };
