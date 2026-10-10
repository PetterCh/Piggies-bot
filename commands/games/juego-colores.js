// MINIJUEGO 1: La Carrera de Colores (lobby con botones -> rondas que eliminan colores -> reparto del pool).
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const config = require('../../config');
const { addCoinks, removeCoinks, InsufficientFundsError } = require('../../utils/economy');
const { sleep, shuffle, fmt } = require('../../utils/helpers');
const { t, resolveLang } = require('../../utils/i18n');
const { withMedia } = require('../../utils/media');

const COLORS = [
  { id: 'orange', emoji: '🟧' }, { id: 'yellow', emoji: '🟨' }, { id: 'green', emoji: '🟩' },
  { id: 'blue', emoji: '🟦' }, { id: 'purple', emoji: '🟪' },
];
const BY_ID = Object.fromEntries(COLORS.map((c) => [c.id, c]));
const cname = (L, id) => `${BY_ID[id].emoji} ${t(L, `colorgame.color.${id}`)}`;
const activeGames = new Set(); // un juego por canal
const cur = config.currency;

const lobbyButtons = (gameId, L) =>
  new ActionRowBuilder().addComponents(
    COLORS.map((c) => new ButtonBuilder().setCustomId(`cc:${gameId}:${c.id}`).setEmoji(c.emoji).setLabel(t(L, `colorgame.color.${c.id}`)).setStyle(ButtonStyle.Secondary))
  );

function lobbyEmbed(L, { entry, players, endsAt }) {
  const counts = COLORS.map((c) => `${c.emoji} **${[...players.values()].filter((v) => v === c.id).length}**`).join('   ');
  return new EmbedBuilder().setColor(0xf5a623).setTitle(t(L, 'colorgame.title'))
    .setDescription(t(L, 'colorgame.lobbyDesc', { entry: fmt(entry), emoji: cur.emoji, when: `<t:${Math.floor(endsAt / 1000)}:R>`, counts }))
    .addFields(
      { name: t(L, 'colorgame.fPlayers'), value: String(players.size), inline: true },
      { name: t(L, 'colorgame.fPool'), value: `${fmt(entry * players.size)} ${cur.emoji}`, inline: true }
    );
}

function raceEmbed(L, { players, remaining, eliminated, pool, last }) {
  const status = COLORS.map((c) => {
    const n = [...players.values()].filter((v) => v === c.id).length;
    return `${eliminated.includes(c.id) ? '❌' : '✅'} ${cname(L, c.id)} — ${t(L, 'colorgame.playersN', { n })}`;
  }).join('\n');
  return new EmbedBuilder().setColor(last ? 0xe74c3c : 0xf5a623).setTitle(t(L, 'colorgame.title'))
    .setDescription((last ? t(L, 'colorgame.eliminated', { color: cname(L, last) }) : t(L, 'colorgame.raceStart')) + `\n\n${status}`)
    .addFields({ name: t(L, 'colorgame.fPool'), value: `${fmt(pool)} ${cur.emoji}`, inline: true }, { name: t(L, 'colorgame.fRemaining'), value: String(remaining.length), inline: true });
}

async function refundAll(players, entry, guildId) {
  for (const id of players.keys()) await addCoinks(id, entry, { type: 'game_refund', reason: 'juego-colores', guildId }).catch((e) => console.error('[colores] refund', id, e));
}

async function runGame({ interaction, L, entry, players, guildId, state }) {
  const cfg = config.colorGame;
  if (players.size < cfg.minPlayers) {
    await refundAll(players, entry, guildId);
    return interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x95a5a6).setTitle(t(L, 'colorgame.cancelledTitle')).setDescription(t(L, 'colorgame.cancelledDesc', { min: cfg.minPlayers }))], components: [] });
  }

  const pool = entry * players.size;
  const remaining = COLORS.map((c) => c.id);
  const eliminated = [];
  const start = raceEmbed(L, { players, remaining, eliminated, pool });
  const startMedia = withMedia(start, ['colorgame.start']);
  await interaction.editReply({ embeds: [start], components: [], files: startMedia.files });
  await sleep(cfg.roundDelayMs);

  while (remaining.length > 1) {
    const [out] = remaining.splice(Math.floor(Math.random() * remaining.length), 1);
    eliminated.push(out);
    await interaction.editReply({ embeds: [raceEmbed(L, { players, remaining, eliminated, pool, last: out })], attachments: [] });
    await sleep(cfg.roundDelayMs);
  }

  const winnerColor = remaining[0];
  const winners = [...players].filter(([, c]) => c === winnerColor).map(([id]) => id);
  state.payoutStarted = true;

  // --- Nadie acertó: el pool se "quema" y el bot se burla (frase al azar entre muchas) ---
  if (!winners.length) {
    const embed = new EmbedBuilder().setColor(0x8e44ad)
      .setTitle(t(L, 'colorgame.nobodyTitle', { color: cname(L, winnerColor) }))
      .setDescription(`${t(L, 'colorgame.lose')}\n\n${t(L, 'colorgame.burned', { pool: fmt(pool), emoji: cur.emoji })}`);
    const { files } = withMedia(embed, ['colorgame.lose']);
    await interaction.editReply({ embeds: [embed], files, attachments: [] });
    const mentions = [...players.keys()].slice(0, 30);
    return interaction.followUp({ content: mentions.map((id) => `<@${id}>`).join(' '), allowedMentions: { users: mentions } });
  }

  // --- Reparto equitativo (el resto de la división se reparte de a 1 entre ganadores al azar) ---
  const share = Math.floor(pool / winners.length);
  const remainder = pool - share * winners.length;
  shuffle(winners);
  const failed = [];
  for (const [i, id] of winners.entries()) {
    try {
      await addCoinks(id, share + (i < remainder ? 1 : 0), { type: 'game_win', reason: 'juego-colores', guildId });
    } catch (err) {
      failed.push(id);
      console.error('[colores] ERROR pagando premio', id, share, err);
    }
  }
  const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle(t(L, 'colorgame.winnerTitle', { color: cname(L, winnerColor) }))
    .setDescription(t(L, 'colorgame.winnersDesc', { n: winners.length, pool: fmt(pool), emoji: cur.emoji, share: fmt(share) }) + (failed.length ? `\n${t(L, 'colorgame.payFail', { n: failed.length })}` : ''));
  const { files } = withMedia(embed, ['colorgame.win']);
  await interaction.editReply({ embeds: [embed], files, attachments: [] });
  const mentions = winners.slice(0, 50);
  return interaction.followUp({ content: `🎉 ${mentions.map((id) => `<@${id}>`).join(' ')}`, allowedMentions: { users: mentions } });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('juego-colores')
    .setDescription('Inicia una Carrera de Colores: elige tu color y apuesta Coinks')
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('entrada').setDescription(`Entrada por jugador (por defecto ${config.colorGame.defaultEntry})`).setMinValue(config.colorGame.minEntry).setMaxValue(config.colorGame.maxEntry))
    .addIntegerOption((o) => o.setName('tiempo').setDescription('Segundos para unirse (15-120)').setMinValue(15).setMaxValue(120)),

  async execute(interaction) {
    const L = interaction.lang; // los mensajes públicos usan el idioma de quien inicia la carrera
    const cfg = config.colorGame;
    const entry = interaction.options.getInteger('entrada') ?? cfg.defaultEntry;
    const lobbySeconds = interaction.options.getInteger('tiempo') ?? cfg.lobbySeconds;
    const channelId = interaction.channelId;
    const guildId = interaction.guildId;

    if (activeGames.has(channelId)) return interaction.reply({ content: t(L, 'colorgame.alreadyRunning'), flags: MessageFlags.Ephemeral });
    activeGames.add(channelId);

    const gameId = interaction.id;
    const players = new Map();
    const pending = new Set();
    const endsAt = Date.now() + lobbySeconds * 1000;
    const state = { payoutStarted: false };

    let message;
    try {
      await interaction.reply({ embeds: [lobbyEmbed(L, { entry, players, endsAt })], components: [lobbyButtons(gameId, L)] });
      message = await interaction.fetchReply();
    } catch (err) {
      activeGames.delete(channelId);
      throw err;
    }

    const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: lobbySeconds * 1000, filter: (i) => i.customId.startsWith(`cc:${gameId}:`) });

    let refreshTimer = null;
    const refresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        interaction.editReply({ embeds: [lobbyEmbed(L, { entry, players, endsAt })] }).catch(() => {});
      }, 2000);
    };

    collector.on('collect', async (i) => {
      const eph = { flags: MessageFlags.Ephemeral };
      const UL = await resolveLang(i); // respuestas privadas en el idioma de quien pulsa
      const colorId = i.customId.split(':')[2];
      if (collector.ended) return i.reply({ content: t(UL, 'colorgame.lobbyClosed'), ...eph }).catch(() => {});
      if (pending.has(i.user.id)) return i.reply({ content: t(UL, 'colorgame.busy'), ...eph }).catch(() => {});

      pending.add(i.user.id);
      try {
        if (players.has(i.user.id)) {
          players.set(i.user.id, colorId); // cambiar de color es gratis mientras el lobby esté abierto
          await i.reply({ content: t(UL, 'colorgame.changed', { color: cname(UL, colorId) }), ...eph });
        } else {
          await removeCoinks(i.user.id, entry, { type: 'game_entry', reason: 'juego-colores', guildId });
          players.set(i.user.id, colorId);
          await i.reply({ content: t(UL, 'colorgame.paid', { entry: fmt(entry), emoji: cur.emoji, color: cname(UL, colorId) }), ...eph });
        }
        refresh();
      } catch (err) {
        if (err instanceof InsufficientFundsError) await i.reply({ content: t(UL, 'colorgame.noFunds', { entry: fmt(entry), emoji: cur.emoji }), ...eph }).catch(() => {});
        else {
          console.error('[colores] collect', err);
          await i.reply({ content: t(UL, 'colorgame.entryError'), ...eph }).catch(() => {});
        }
      } finally {
        pending.delete(i.user.id);
      }
    });

    collector.on('end', async () => {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      try {
        for (let n = 0; pending.size > 0 && n < 50; n++) await sleep(100); // esperar cobros en curso
        await runGame({ interaction, L, entry, players, guildId, state });
      } catch (err) {
        console.error('[colores] error en la partida', err);
        if (!state.payoutStarted) await refundAll(players, entry, guildId);
        await interaction.editReply({ embeds: [], components: [], content: t(L, state.payoutStarted ? 'colorgame.errorPayout' : 'colorgame.errorRefunded') }).catch(() => {});
      } finally {
        activeGames.delete(channelId);
      }
    });
  },
};
