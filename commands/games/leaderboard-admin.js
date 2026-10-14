const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');
const { askConfirmation } = require('../../utils/confirm');
const config = require('../../config');
const { fmt } = require('../../utils/helpers');
const { buildPanel, publishPanel, removePanel, myRank, getProfiles, metricLines, closeSeason, excludedIds, seasonKey } = require('../../services/leaderboard');

const eph = { flags: MessageFlags.Ephemeral };
const lastRefresh = new Map(); // guildId -> timestamp (anti-spam del botón Actualizar)

module.exports = {
  // Botones del panel (públicos: los usa cualquier jugador). customId: lbd:refresh · lbd:me
  components: [
    {
      kind: 'button',
      prefix: 'lbd',
      async execute(interaction, args) {
        const t = interaction.t;
        const cfg = await getGuildConfig(interaction.guildId);
        if (args[0] === 'refresh') {
          if (Date.now() - (lastRefresh.get(interaction.guildId) || 0) < 15_000) return interaction.reply({ content: t('leaderboard.cooldown'), ...eph });
          lastRefresh.set(interaction.guildId, Date.now());
          await interaction.deferUpdate();
          return interaction.message.edit(await buildPanel(interaction.guild, cfg)).catch(() => {});
        }
        // lbd:me
        await interaction.deferReply(eph);
        const r = await myRank(interaction.guild, cfg, interaction.user.id);
        if (r.none) return interaction.editReply(t('leaderboard.meNone'));
        if (r.excluded) return interaction.editReply(t('leaderboard.meExcluded'));
        const prof = (await getProfiles([interaction.user.id]).catch(() => new Map())).get(interaction.user.id) || { luck: null, streak: 0 };
        const m = metricLines(interaction.lang, prof);
        const profile = prof.luck == null ? `${m.luck} · ${m.streak}` : t('leaderboard.meProfile', { pct: prof.luck, n: prof.streak, unit: m.unit });
        return interaction.editReply(`${t(r.approx ? 'leaderboard.meApprox' : 'leaderboard.meRank', { rank: fmt(r.rank), coinks: fmt(r.coinks), exp: fmt(r.exp) })}\n${profile}`);
      },
    },
  ],
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('leaderboard-admin')
    .setDescription('(Admin) Liga de Ballenas: panel, exclusiones y rol mensual del Top 3')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('panel').setDescription('Publica o actualiza el panel del leaderboard')
      .addChannelOption((o) => o.setName('canal').setDescription('Canal del panel (vacío = el actual)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addBooleanOption((o) => o.setName('desactivar').setDescription('Borra el panel del canal')))
    .addSubcommand((s) => s.setName('excluir').setDescription('Oculta a una cuenta del leaderboard (admins, bots, tú…)')
      .addUserOption((o) => o.setName('usuario').setDescription('Cuenta a excluir').setRequired(true)))
    .addSubcommand((s) => s.setName('incluir').setDescription('Devuelve a una cuenta excluida al leaderboard')
      .addUserOption((o) => o.setName('usuario').setDescription('Cuenta a volver a incluir').setRequired(true)))
    .addSubcommand((s) => s.setName('excluidos').setDescription('Lista las cuentas excluidas'))
    .addSubcommand((s) => s.setName('rol').setDescription('Rol exclusivo que se entrega cada mes al Top 3')
      .addRoleOption((o) => o.setName('rol').setDescription('Rol premio (vacío = ver el actual)'))
      .addBooleanOption((o) => o.setName('quitar').setDescription('Desactiva las temporadas mensuales')))
    .addSubcommand((s) => s.setName('temporada-ahora').setDescription('Cierra la temporada ya (entrega roles y anuncia)')),

  async execute(interaction) {
    const t = interaction.t;
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const cfg = await getGuildConfig(guildId);

    if (sub === 'panel') {
      if (interaction.options.getBoolean('desactivar')) {
        await removePanel(interaction.client, guildId);
        await audit({ guildId, action: 'leaderboard_panel_off', byId: interaction.user.id });
        return interaction.reply({ content: t('leaderboard.removed'), ...eph });
      }
      await interaction.deferReply(eph);
      const channel = interaction.options.getChannel('canal') || interaction.channel;
      const msg = await publishPanel(interaction.client, guildId, channel.id);
      if (!msg) return interaction.editReply(t('leaderboard.noPerms'));
      await audit({ guildId, action: 'leaderboard_panel_set', byId: interaction.user.id, details: { channelId: channel.id } });
      return interaction.editReply(t('leaderboard.published', { url: msg.url }));
    }

    if (sub === 'excluir' || sub === 'incluir') {
      const user = interaction.options.getUser('usuario', true);
      const mention = `<@${user.id}>`;
      const inList = (cfg.lbExcludedIds || []).includes(user.id);
      const base = { allowedMentions: { parse: [] }, ...eph };
      if (sub === 'excluir') {
        if (inList) return interaction.reply({ content: t('leaderboard.alreadyExcluded', { user: mention }), ...base });
        if (config.leaderboard.blacklistIds.includes(user.id)) return interaction.reply({ content: t('leaderboard.envLocked', { user: mention }), ...base });
        await updateGuildConfig(guildId, { $addToSet: { lbExcludedIds: user.id } });
      } else {
        if (config.leaderboard.blacklistIds.includes(user.id)) return interaction.reply({ content: t('leaderboard.envLocked', { user: mention }), ...base });
        if (!inList) return interaction.reply({ content: t('leaderboard.notExcluded', { user: mention }), ...base });
        await updateGuildConfig(guildId, { $pull: { lbExcludedIds: user.id } });
      }
      await audit({ guildId, action: `leaderboard_${sub}`, byId: interaction.user.id, details: { userId: user.id } });
      return interaction.reply({ content: t(sub === 'excluir' ? 'leaderboard.excluded' : 'leaderboard.included', { user: mention }), ...base });
    }

    if (sub === 'excluidos') {
      const ids = excludedIds(cfg);
      if (!ids.length) return interaction.reply({ content: t('leaderboard.listEmpty'), ...eph });
      const lines = ids.map((id) => `• <@${id}>${config.leaderboard.blacklistIds.includes(id) ? ` ${t('leaderboard.listEnv')}` : ''}`).join('\n').slice(0, 1800);
      return interaction.reply({ content: `${t('leaderboard.listHeader', { n: ids.length })}\n${lines}`, allowedMentions: { parse: [] }, ...eph });
    }

    if (sub === 'rol') {
      const base = { allowedMentions: { parse: [] }, ...eph };
      if (interaction.options.getBoolean('quitar')) {
        await updateGuildConfig(guildId, { $set: { lbRoleId: null } });
        await audit({ guildId, action: 'leaderboard_role_off', byId: interaction.user.id });
        return interaction.reply({ content: t('leaderboard.roleRemoved'), ...base });
      }
      const role = interaction.options.getRole('rol');
      if (!role) return interaction.reply({ content: cfg.lbRoleId ? t('leaderboard.roleCurrent', { role: `<@&${cfg.lbRoleId}>` }) : t('leaderboard.roleNone'), ...base });
      if (role.id === guildId) return interaction.reply({ content: t('leaderboard.everyone'), ...base });
      // lbLastSeason = mes anterior: así no se "recupera" un cierre de un mes que ocurrió antes de configurar el rol.
      await updateGuildConfig(guildId, { $set: { lbRoleId: role.id, lbLastSeason: seasonKey(new Date(), 1) } });
      await audit({ guildId, action: 'leaderboard_role_set', byId: interaction.user.id, details: { roleId: role.id } });
      const warn = role.editable ? '' : `\n${t('leaderboard.roleHierarchy')}`;
      return interaction.reply({ content: t('leaderboard.roleSet', { role: `${role}`, tz: config.leaderboard.timezone }) + warn, ...base });
    }

    // temporada-ahora
    if (!cfg.lbRoleId) return interaction.reply({ content: t('leaderboard.noRole'), ...eph });
    await interaction.deferReply(eph);
    if (!(await askConfirmation(interaction, { content: t('leaderboard.closeConfirm') }))) return;
    const res = await closeSeason(interaction.client, guildId, { manual: true });
    const winners = res.winners.length ? res.winners.map((p) => `<@${p.id}>`).join(' ') : t('leaderboard.nobody');
    const text = res.warnings.length ? t('leaderboard.closeFail', { warn: res.warnings.join('; ') }) : t('leaderboard.closeDone', { winners });
    return interaction.editReply({ content: text, allowedMentions: { parse: [] } });
  },
};
