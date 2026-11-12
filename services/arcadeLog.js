// Avisos automáticos de Arcade (Piggy Crash y Buscaminas) en el canal de logs (/set-logs-channel).
// Nunca lanza errores ni retrasa el juego: se llama sin await desde web/arcade/service.js.
// Variable opcional: ARCADE_LOG_MIN (Coinks mínimos de ganancia/pérdida para avisar; por defecto 0 = todas las partidas).
const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { getGuildConfig } = require('../utils/guildConfig');
const { t, langForGuild } = require('../utils/i18n');
const { fmt } = require('../utils/helpers');

let client = null;
const setClient = (c) => { client = c; };
const minAmount = () => Math.max(0, Number(process.env.ARCADE_LOG_MIN) || 0);
const GAME = { crash: { emoji: '🐷', key: 'crash' }, mines: { emoji: '💣', key: 'mines' } };

/** Anuncia el resultado de una partida ya cerrada (status 'cashed' o 'lost'). */
async function announce(doc) {
  try {
    if (!client || !doc || !doc.guildId || !GAME[doc.game]) return;
    const profit = Number(doc.profit) || 0;
    if (profit === 0 || Math.abs(profit) < minAmount()) return;
    const cfg = await getGuildConfig(doc.guildId);
    if (!cfg.logsChannelId) return;
    const channel = await client.channels.fetch(cfg.logsChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;

    const guild = client.guilds.cache.get(doc.guildId);
    const L = langForGuild(guild);
    const won = profit > 0;
    const g = GAME[doc.game];
    const name = escapeMarkdown(String(doc.userName || 'Piggy')).slice(0, 60);
    const vars = {
      user: name, game: t(L, `arcadeLog.game.${g.key}`), emoji: g.emoji, bet: fmt(doc.bet),
      coinks: fmt(Math.abs(profit)), payout: fmt(doc.payout || 0), mult: Number(doc.cashMult || 0).toFixed(2),
    };
    const embed = new EmbedBuilder()
      .setColor(won ? 0x42d77d : 0xff5a6e)
      .setTitle(t(L, won ? 'arcadeLog.winTitle' : 'arcadeLog.loseTitle', vars))
      .setDescription(t(L, won ? 'arcadeLog.win' : 'arcadeLog.lose', vars))
      .setTimestamp();
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch (e) {
    console.error('[arcadeLog]', e.message);
  }
}

module.exports = { setClient, announce };
