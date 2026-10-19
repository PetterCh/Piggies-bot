// MINIJUEGO 2: Expediciones de Cerditos (idle). Regla: UNA expedición activa por usuario.
// El equipo, la venta y la fusión viven en /inventario.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const Expedition = require('../../models/Expedition');
const { startExpedition, getOpenExpedition, cancelExpedition } = require('../../services/expeditions');
const { askConfirmation } = require('../../utils/confirm');
const { itemLabel } = require('../../utils/itemText');
const { ZONES, SLOTS, BOSS } = require('../../data/gameData');
const { EVENTS } = require('../../data/events');
const config = require('../../config');
const { choice, t: tr } = require('../../utils/i18n');
const { withMedia } = require('../../utils/media');
const { fmt } = require('../../utils/helpers');

const pct = (n) => `${Math.round(n * 100)}%`;
const eph = { flags: MessageFlags.Ephemeral };
const unix = (d) => Math.floor(d.getTime() / 1000);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('expedicion')
    .setDescription('Expediciones de tu cerdito')
    .setDMPermission(false)
    .addSubcommand((s) =>
      s.setName('enviar').setDescription('Manda a tu cerdito a una expedición (vuelve solo)')
        .addStringOption((o) => o.setName('zona').setDescription('Destino').setRequired(true)
          .addChoices(...Object.values(ZONES).map((z) => choice('zone.choice', z.id, { emoji: z.emoji, name: tr('es', `zone.${z.id}.name`), duration: tr('es', `zone.${z.id}.duration`), pct: pct(z.baseSurvival), mult: z.rewardMult }))))
    )
    .addSubcommand((s) => s.setName('estado').setDescription('Mira cómo va tu expedición actual'))
    .addSubcommand((s) => s.setName('cancelar').setDescription('Cancela la expedición en curso (pagando un coste) para volver a equipar y enviar')),

  async execute(interaction) {
    const t = interaction.t;
    const L = interaction.lang;
    const discordId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    // Lo PRIMERO: confirmar la interacción (Discord da solo 3 s). `enviar` se anuncia en público;
    // el resto (estado / cancelar / antiguos) es privado.
    await interaction.deferReply(sub === 'enviar' ? {} : eph);

    // ---------------- ENVIAR ----------------
    if (sub === 'enviar') {
      const zone = ZONES[interaction.options.getString('zona', true)];
      // Avisos de error: la respuesta diferida es pública, así que se borra y el aviso se manda en privado.
      const warn = async (content) => {
        await interaction.deleteReply().catch(() => {});
        return interaction.followUp({ content, ...eph });
      };

      // REGLA: una sola expedición activa. Si ya hay una, se avisa cuándo regresa.
      const open = await getOpenExpedition(discordId);
      if (open) {
        const z = ZONES[open.zoneId];
        return warn(open.status === 'resolving'
          ? t('expedition.busyResolving')
          : t('expedition.busy', { emoji: z.emoji, zone: t(`zone.${z.id}.name`), when: `<t:${unix(open.endsAt)}:R>` }));
      }

      let exp;
      try {
        exp = await startExpedition({ discordId, guildId: interaction.guildId, channelId: interaction.channelId, zoneId: zone.id, lang: L });
      } catch (err) {
        if (err.code === 11000) return warn(t('expedition.busyShort'));
        throw err;
      }
      const ev = exp.eventId ? EVENTS[exp.eventId] : null;
      const desc = [t('expedition.sent', { when: `<t:${unix(exp.endsAt)}:R>` })];
      if (ev) desc.push(t('expedition.eventBanner', { emoji: ev.emoji, name: t(`event.${ev.id}.name`) }));
      if (zone.gearEff < 1) desc.push(t('expedition.gearEffNote', { pct: pct(zone.gearEff) }));
      if (exp.survivalChance < 0.2) desc.push(t('expedition.lowSurvival'));
      if (zone.boss) desc.push(t('expedition.bossWarn', { chance: Math.round(BOSS.chance * 100), steal: Math.round(BOSS.stealPct * 100), max: fmt(BOSS.maxSteal) }));
      const embed = new EmbedBuilder().setColor(ev ? ev.color : 0x3498db)
        .setTitle(t('expedition.title', { emoji: zone.emoji, zone: t(`zone.${zone.id}.name`) }))
        .setDescription(desc.join('\n'))
        .addFields(
          ...SLOTS.map((s) => ({ name: t(`slot.${s}`), value: itemLabel(L, exp.equipmentSnapshot[s]), inline: true })),
          { name: t('expedition.fSurvival'), value: pct(exp.survivalChance), inline: true },
          { name: t('expedition.fReward'), value: `x${zone.rewardMult}`, inline: true },
          { name: t('expedition.fDuration'), value: t(`zone.${zone.id}.duration`), inline: true }
        );
      // Arte: el GIF/WEBP de media.json de ESA zona (expedition.start.<zona> → expedition.start).
      const { files } = withMedia(embed, [`expedition.start.${zone.id}`, 'expedition.start']);
      return interaction.editReply({ embeds: [embed], files });
    }

    // ---------------- ESTADO ----------------
    if (sub === 'estado') {
      const active = await getOpenExpedition(discordId);
      if (active) {
        const z = ZONES[active.zoneId];
        return interaction.editReply({
          content: active.status === 'resolving' ? t('expedition.statusResolving') : `${t('expedition.statusActive', { emoji: z.emoji, zone: t(`zone.${z.id}.name`), when: `<t:${unix(active.endsAt)}:R>` })}\n${t('expedition.cancelHint')}`,
        });
      }
      const last = await Expedition.findOne({ discordId, status: 'completed' }).sort({ completedAt: -1 });
      if (!last) return interaction.editReply({ content: t('expedition.statusIdle') });
      const r = last.result;
      const txt = r.survived ? t('expedition.lastAlive', { coins: fmt(r.coinks), item: r.droppedItem ? t('expedition.lastItem', { item: itemLabel(L, r.droppedItem) }) : '' }) : t('expedition.lastDead');
      return interaction.editReply({ content: t('expedition.statusLast', { zone: t(`zone.${last.zoneId}.name`), result: txt }) });
    }

    // ---------------- CANCELAR ----------------
    if (sub === 'cancelar') {
      const check = await cancelExpedition(discordId, interaction.guildId, { dryRun: true });
      if (!check.ok) return interaction.editReply(t(`cancel.${check.reason}`));
      const ok = await askConfirmation(interaction, {
        content: t('cancel.confirm', { emoji: check.zone.emoji, zone: t(`zone.${check.zone.id}.name`), cost: fmt(check.cost), currency: config.currency.name }),
      });
      if (!ok) return;
      const res = await cancelExpedition(discordId, interaction.guildId);
      if (!res.ok) return interaction.editReply(t(`cancel.${res.reason}`, { cost: fmt(res.cost ?? 0), currency: config.currency.name }));
      return interaction.editReply(t('cancel.done', { cost: fmt(res.cost), currency: config.currency.name }));
    }

    // Subcomandos antiguos (equipar / inventario / recetas) que pueden seguir registrados en Discord si no se ejecutó `npm run deploy`.
    return interaction.editReply({ content: t('expedition.moved') });
  },
};
