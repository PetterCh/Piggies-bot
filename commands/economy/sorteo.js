const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Giveaway = require('../../models/Giveaway');
const config = require('../../config');
const { removeCoinks, addCoinks, InsufficientFundsError } = require('../../utils/economy');
const { audit } = require('../../utils/adminLog');
const { parseDuration, fmt } = require('../../utils/helpers');
const { buildEmbed, buildRow, endGiveaway, cancelGiveaway, prizeLabel } = require('../../services/giveaways');

const eph = { flags: MessageFlags.Ephemeral };
const lastEdit = new Map(); // giveawayId -> timestamp (para no saturar la API al actualizar el contador)

/** Botón "Participar": cobra la entrada (si la hay) y registra al usuario sin duplicados. */
async function onJoin(interaction, args) {
  const t = interaction.t;
  const id = args[1];
  const userId = interaction.user.id;
  const cur = config.currency;
  const g = await Giveaway.findById(id);
  if (!g || g.status !== 'active' || g.endsAt <= new Date()) return interaction.reply({ content: t('giveaway.notActive'), ...eph });
  if (g.entries.includes(userId)) return interaction.reply({ content: t('giveaway.already'), ...eph });

  if (g.entryCost > 0) {
    try {
      await removeCoinks(userId, g.entryCost, { type: 'giveaway_entry', reason: 'giveaway', guildId: g.guildId });
    } catch (err) {
      if (err instanceof InsufficientFundsError) return interaction.reply({ content: t('giveaway.noFunds', { price: fmt(g.entryCost), currency: cur.name }), ...eph });
      throw err;
    }
  }
  // Inserción atómica: solo entra si sigue activo y el usuario no estaba (doble clic = una sola entrada).
  const updated = await Giveaway.findOneAndUpdate({ _id: id, status: 'active', endsAt: { $gt: new Date() }, entries: { $ne: userId } }, { $push: { entries: userId } }, { new: true });
  if (!updated) {
    if (g.entryCost > 0) await addCoinks(userId, g.entryCost, { type: 'giveaway_refund', reason: 'entry rejected', guildId: g.guildId }).catch(() => {});
    return interaction.reply({ content: t('giveaway.notActive'), ...eph });
  }
  await interaction.reply({ content: t('giveaway.joined', { cost: g.entryCost > 0 ? t('giveaway.paidNote', { price: fmt(g.entryCost), emoji: cur.emoji }) : '' }), ...eph });

  const now = Date.now();
  if (now - (lastEdit.get(id) || 0) > 5000) {
    lastEdit.set(id, now);
    interaction.message?.edit({ embeds: [buildEmbed(updated)] }).catch(() => {}); // refresca el contador de participantes
  }
}

module.exports = {
  adminOnly: true, // la comprobación real vive en events/interactionCreate.js
  data: new SlashCommandBuilder()
    .setName('sorteo')
    .setDescription('(Admin) Giveaways automáticos con Coinks')
    .setNameLocalizations({ 'en-US': 'giveaway', 'en-GB': 'giveaway' })
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('crear').setDescription('Crea un sorteo en este canal')
      .addStringOption((o) => o.setName('duracion').setDescription('Ej: 30m, 2h, 1d, 1h30m').setRequired(true))
      .addIntegerOption((o) => o.setName('ganadores').setDescription('Número de ganadores (por defecto 1)').setMinValue(1).setMaxValue(config.giveaways.maxWinners))
      .addIntegerOption((o) => o.setName('premio-coinks').setDescription('Coinks que gana CADA ganador').setMinValue(1).setMaxValue(1_000_000_000))
      .addStringOption((o) => o.setName('premio-texto').setDescription('Premio manual (WL, merch, rol...)').setMaxLength(100))
      .addIntegerOption((o) => o.setName('costo').setDescription('Coinks que cuesta participar (0 = gratis)').setMinValue(0).setMaxValue(1_000_000)))
    .addSubcommand((s) => s.setName('terminar').setDescription('Termina ahora un sorteo y sortea ganadores')
      .addStringOption((o) => o.setName('sorteo').setDescription('Sorteo activo').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('cancelar').setDescription('Cancela un sorteo y reembolsa las entradas')
      .addStringOption((o) => o.setName('sorteo').setDescription('Sorteo activo').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction) {
    const list = await Giveaway.find({ guildId: interaction.guildId, status: 'active' }).sort({ endsAt: 1 }).limit(25).lean();
    await interaction.respond(list.map((g) => ({ name: `${prizeLabel(g)} · ${g.entries.length}`.slice(0, 100), value: String(g._id) })));
  },

  async execute(interaction) {
    const t = interaction.t;
    const sub = interaction.options.getSubcommand();

    if (sub === 'crear') {
      const ms = parseDuration(interaction.options.getString('duracion', true));
      const prizeCoinks = interaction.options.getInteger('premio-coinks') ?? 0;
      const prizeText = interaction.options.getString('premio-texto');
      const gw = config.giveaways;
      if (!ms || ms < gw.minDurationMs || ms > gw.maxDurationMs) return interaction.reply({ content: t('giveaway.badDuration'), ...eph });
      if (!prizeCoinks && !prizeText) return interaction.reply({ content: t('giveaway.needPrize'), ...eph });

      const g = await Giveaway.create({
        guildId: interaction.guildId, channelId: interaction.channelId, hostId: interaction.user.id, lang: interaction.lang,
        prizeText, prizeCoinks, entryCost: interaction.options.getInteger('costo') ?? 0,
        winnersCount: interaction.options.getInteger('ganadores') ?? 1, endsAt: new Date(Date.now() + ms),
      });
      await interaction.reply({ embeds: [buildEmbed(g)], components: [buildRow(g)] });
      const msg = await interaction.fetchReply();
      await Giveaway.updateOne({ _id: g._id }, { messageId: msg.id });
      await audit({ guildId: g.guildId, action: 'giveaway_create', byId: interaction.user.id, details: { id: g._id, prizeCoinks, prizeText, cost: g.entryCost } });
      return;
    }

    await interaction.deferReply(eph);
    const id = interaction.options.getString('sorteo', true);
    if (!/^[a-f\d]{24}$/i.test(id)) return interaction.editReply(t('giveaway.notFound'));
    const owned = await Giveaway.exists({ _id: id, guildId: interaction.guildId });
    if (!owned) return interaction.editReply(t('giveaway.notFound'));

    const res = sub === 'terminar' ? await endGiveaway(interaction.client, id) : await cancelGiveaway(interaction.client, id);
    await audit({ guildId: interaction.guildId, action: `giveaway_${sub}`, byId: interaction.user.id, details: { id } });
    return interaction.editReply(res ? t(sub === 'terminar' ? 'giveaway.ended' : 'giveaway.cancelled') : t('giveaway.notActive'));
  },

  components: [{ kind: 'button', prefix: 'gw', execute: (i, args) => onJoin(i, args) }],
};
