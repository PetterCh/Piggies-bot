// Giveaways: creación del mensaje, cierre automático, reparto de premios.
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Giveaway = require('../models/Giveaway');
const { addCoinks } = require('../utils/economy');
const { shuffle, fmt } = require('../utils/helpers');
const { t } = require('../utils/i18n');
const { withMedia } = require('../utils/media');
const config = require('../config');

const prizeLabel = (g, L) =>
  [g.prizeText, g.prizeCoinks ? `${fmt(g.prizeCoinks)} ${config.currency.emoji} ${config.currency.name}` : null].filter(Boolean).join(' + ');

function buildEmbed(g, { ended = false, cancelled = false } = {}) {
  const L = g.lang || 'es';
  const ts = Math.floor(g.endsAt.getTime() / 1000);
  const cost = g.entryCost > 0 ? t(L, 'giveaway.cost', { price: fmt(g.entryCost), emoji: config.currency.emoji, currency: config.currency.name }) : t(L, 'giveaway.free');
  const e = new EmbedBuilder()
    .setTitle(`🎉 ${prizeLabel(g, L)}`)
    .setColor(cancelled ? 0x7f8c8d : ended ? 0x95a5a6 : 0xe91e63)
    .addFields(
      { name: t(L, 'giveaway.fWinners'), value: String(g.winnersCount), inline: true },
      { name: t(L, 'giveaway.fEntry'), value: cost, inline: true },
      { name: t(L, 'giveaway.fEntries'), value: String(g.entries.length), inline: true }
    );
  if (cancelled) return e.setDescription(t(L, 'giveaway.cancelledDesc'));
  if (ended) {
    const w = g.winners.length ? g.winners.map((id) => `<@${id}>`).join(', ') : t(L, 'giveaway.noWinners');
    return e.setDescription(t(L, 'giveaway.endedDesc', { winners: w }));
  }
  return e.setDescription(t(L, 'giveaway.desc', { when: `<t:${ts}:R>`, host: `<@${g.hostId}>` }));
}

const buildRow = (g, disabled = false) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gw:join:${g._id}`)
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎉')
      .setLabel(t(g.lang || 'es', 'giveaway.btnJoin'))
      .setDisabled(disabled)
  );

/** Edita el mensaje original del sorteo. */
async function updateMessage(client, g, opts, disabled) {
  try {
    const ch = await client.channels.fetch(g.channelId);
    const msg = await ch.messages.fetch(g.messageId);
    await msg.edit({ embeds: [buildEmbed(g, opts)], components: [buildRow(g, disabled)] });
  } catch (e) {
    console.error('[sorteo] no pude editar el mensaje:', e.message);
  }
}

/** Paga (una sola vez por ganador) y anuncia. Reentrante: sirve también para reanudar tras un reinicio. */
async function finalize(client, g) {
  const L = g.lang || 'es';
  for (const w of g.winners) {
    if (!g.prizeCoinks) break;
    // "Marcar y luego pagar": cada ganador cobra como máximo una vez aunque el bot se caiga a mitad.
    const marked = await Giveaway.findOneAndUpdate({ _id: g._id, paid: { $ne: w } }, { $addToSet: { paid: w } });
    if (!marked) continue;
    await addCoinks(w, g.prizeCoinks, { type: 'giveaway_win', reason: 'giveaway', guildId: g.guildId }).catch((e) => console.error('[sorteo] ERROR pagando', w, e));
  }
  await Giveaway.updateOne({ _id: g._id }, { status: 'ended' });
  g.status = 'ended';
  await updateMessage(client, g, { ended: true }, true);

  try {
    const ch = await client.channels.fetch(g.channelId);
    const embed = new EmbedBuilder().setColor(0xe91e63);
    if (!g.winners.length) {
      embed.setDescription(t(L, 'giveaway.announceNone', { prize: prizeLabel(g, L) }));
      return ch.send({ embeds: [embed] });
    }
    embed.setTitle(`🏆 ${prizeLabel(g, L)}`).setDescription(t(L, 'giveaway.announce', { winners: g.winners.map((id) => `<@${id}>`).join(', ') }));
    const { files } = withMedia(embed, ['giveaway.end']);
    await ch.send({ content: g.winners.map((id) => `<@${id}>`).join(' '), embeds: [embed], files, allowedMentions: { users: g.winners } });
  } catch (e) {
    console.error('[sorteo] no pude anunciar:', e.message);
  }
}

/** Cierra un sorteo activo: elige ganadores, los guarda y finaliza. */
async function endGiveaway(client, id) {
  const g = await Giveaway.findOneAndUpdate({ _id: id, status: 'active' }, { status: 'ending' }, { new: true });
  if (!g) return null;
  const winners = shuffle([...g.entries]).slice(0, g.winnersCount);
  g.winners = winners;
  await Giveaway.updateOne({ _id: g._id }, { winners });
  await finalize(client, g);
  return g;
}

/** Cancela y reembolsa las entradas pagadas. */
async function cancelGiveaway(client, id) {
  const g = await Giveaway.findOneAndUpdate({ _id: id, status: 'active' }, { status: 'cancelled' }, { new: true });
  if (!g) return null;
  if (g.entryCost > 0) {
    for (const uid of g.entries) {
      await addCoinks(uid, g.entryCost, { type: 'giveaway_refund', reason: 'giveaway cancelled', guildId: g.guildId }).catch((e) => console.error('[sorteo] reembolso falló', uid, e));
    }
  }
  await updateMessage(client, g, { cancelled: true }, true);
  return g;
}

/** Al arrancar: devuelve a la cola los "ending" sin ganadores y reanuda los que ya tenían ganadores. */
async function recoverStuck(client) {
  await Giveaway.updateMany({ status: 'ending', 'winners.0': { $exists: false } }, { status: 'active' });
  for (const g of await Giveaway.find({ status: 'ending', 'winners.0': { $exists: true } })) await finalize(client, g);
}

module.exports = { buildEmbed, buildRow, updateMessage, endGiveaway, cancelGiveaway, recoverStuck, prizeLabel };
