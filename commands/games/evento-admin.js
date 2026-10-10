const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const GameEvent = require('../../models/GameEvent');
const { EVENTS } = require('../../data/events');
const ev = require('../../services/events');
const { getGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');
const { choice, t: tr } = require('../../utils/i18n');
const { parseDuration, parseUtc } = require('../../utils/helpers');

const eph = { flags: MessageFlags.Ephemeral };
const ts = (d) => Math.floor(d.getTime() / 1000);
const MAX_AHEAD_MS = 90 * 24 * 3600_000;

const typeOption = (o) => o.setName('tipo').setDescription('Tipo de evento').setRequired(true)
  .addChoices(...Object.values(EVENTS).map((e) => choice('event.choice', e.id, { emoji: e.emoji, name: tr('es', `event.${e.id}.name`) })));

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('evento-admin')
    .setDescription('(Admin) Lanza, programa o termina eventos globales (los automáticos salen solos)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('iniciar').setDescription('Lanza un evento ahora')
      .addStringOption(typeOption)
      .addNumberOption((o) => o.setName('horas').setDescription('Duración en horas (por defecto la del evento)').setMinValue(0.25).setMaxValue(72)))
    .addSubcommand((s) => s.setName('programar').setDescription('Programa el inicio (y fin) de un evento')
      .addStringOption(typeOption)
      .addStringOption((o) => o.setName('en').setDescription('Empieza dentro de... Ej: 3h, 1d, 1d12h'))
      .addStringOption((o) => o.setName('fecha').setDescription('O fecha y hora exacta en UTC: AAAA-MM-DD HH:mm'))
      .addNumberOption((o) => o.setName('horas').setDescription('Duración en horas (por defecto la del evento)').setMinValue(0.25).setMaxValue(72)))
    .addSubcommand((s) => s.setName('programados').setDescription('Lista el evento activo y los programados'))
    .addSubcommand((s) => s.setName('cancelar-programado').setDescription('Cancela un evento programado')
      .addStringOption((o) => o.setName('evento').setDescription('Evento programado').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('terminar').setDescription('Termina el evento activo')),

  async autocomplete(interaction) {
    const list = await GameEvent.find({ guildId: interaction.guildId, status: 'scheduled' }).sort({ startedAt: 1 }).limit(25).lean();
    await interaction.respond(list.map((e) => ({
      name: `${tr(interaction.lang, `event.${e.typeId}.name`)} · ${e.startedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`.slice(0, 100),
      value: String(e._id),
    })));
  },

  async execute(interaction) {
    const t = interaction.t;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const now = new Date();

    if (sub === 'terminar') {
      const active = await GameEvent.findOne({ guildId, status: 'active', endsAt: { $gt: now } });
      if (!active) return interaction.reply({ content: t('eventAdmin.noActive'), ...eph });
      await ev.endEvent(interaction.client, active);
      await audit({ guildId, action: 'event_end', byId: interaction.user.id, details: { type: active.typeId } });
      return interaction.reply({ content: t('eventAdmin.ended'), ...eph });
    }

    if (sub === 'programados') {
      const list = await GameEvent.find({ guildId, status: { $in: ['active', 'scheduled'] } }).sort({ startedAt: 1 }).lean();
      if (!list.length) return interaction.reply({ content: t('eventAdmin.listEmpty'), ...eph });
      const lines = list.map((e) => t(e.status === 'active' ? 'eventAdmin.lineActive' : 'eventAdmin.lineScheduled', {
        emoji: EVENTS[e.typeId]?.emoji ?? '', name: t(`event.${e.typeId}.name`), start: `<t:${ts(e.startedAt)}:F>`, startRel: `<t:${ts(e.startedAt)}:R>`, end: `<t:${ts(e.endsAt)}:F>`,
      }));
      return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(t('eventAdmin.listTitle')).setDescription(lines.join('\n'))], ...eph });
    }

    if (sub === 'cancelar-programado') {
      const id = interaction.options.getString('evento', true);
      const doc = /^[a-f\d]{24}$/i.test(id) ? await ev.cancelScheduled(guildId, id) : null;
      if (!doc) return interaction.reply({ content: t('eventAdmin.scheduledNotFound'), ...eph });
      await audit({ guildId, action: 'event_schedule_cancel', byId: interaction.user.id, details: { type: doc.typeId } });
      return interaction.reply({ content: t('eventAdmin.scheduledCancelled'), ...eph });
    }

    // iniciar / programar necesitan el canal de eventos (para anunciar)
    const cfg = await getGuildConfig(guildId);
    if (!cfg.eventsChannelId) return interaction.reply({ content: t('eventAdmin.noChannel'), ...eph });
    const typeId = interaction.options.getString('tipo', true);
    const hours = interaction.options.getNumber('horas');
    const def = EVENTS[typeId];

    if (sub === 'iniciar') {
      const end = new Date(now.getTime() + Math.round((hours ?? def.maxHours) * 3600_000));
      if (await ev.findOverlap(guildId, now, end)) return interaction.reply({ content: t('eventAdmin.overlap'), ...eph });
      await interaction.deferReply(eph);
      const doc = await ev.startEvent(interaction.client, guildId, typeId, { hours, forcedBy: interaction.user.id });
      await audit({ guildId, action: 'event_start', byId: interaction.user.id, details: { type: typeId, endsAt: doc.endsAt } });
      return interaction.editReply(t('eventAdmin.started', { name: t(`event.${typeId}.name`), when: `<t:${ts(doc.endsAt)}:R>` }));
    }

    // programar
    const inStr = interaction.options.getString('en');
    const dateStr = interaction.options.getString('fecha');
    if (!inStr && !dateStr) return interaction.reply({ content: t('eventAdmin.needTime'), ...eph });
    let startsAt;
    if (dateStr) startsAt = parseUtc(dateStr);
    else { const ms = parseDuration(inStr); startsAt = ms ? new Date(now.getTime() + ms) : null; }
    if (!startsAt) return interaction.reply({ content: t('eventAdmin.badTime'), ...eph });
    if (startsAt.getTime() < now.getTime() + 60_000) return interaction.reply({ content: t('eventAdmin.tooSoon'), ...eph });
    if (startsAt.getTime() > now.getTime() + MAX_AHEAD_MS) return interaction.reply({ content: t('eventAdmin.tooFar'), ...eph });

    const maxEnd = new Date(startsAt.getTime() + Math.round((hours ?? def.maxHours) * 3600_000));
    if (await ev.findOverlap(guildId, startsAt, maxEnd)) return interaction.reply({ content: t('eventAdmin.overlap'), ...eph });
    const doc = await ev.scheduleEvent(guildId, typeId, startsAt, { hours, forcedBy: interaction.user.id });
    await audit({ guildId, action: 'event_schedule', byId: interaction.user.id, details: { type: typeId, startsAt: doc.startedAt, endsAt: doc.endsAt } });
    return interaction.reply({ content: t('eventAdmin.scheduled', { name: t(`event.${typeId}.name`), start: `<t:${ts(doc.startedAt)}:F>`, startRel: `<t:${ts(doc.startedAt)}:R>`, end: `<t:${ts(doc.endsAt)}:F>` }), ...eph });
  },
};
