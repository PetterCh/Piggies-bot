const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { getGuildConfig, updateGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');
const { askConfirmation } = require('../../utils/confirm');
const config = require('../../config');
const { fmt } = require('../../utils/helpers');
const { renderPanel, publishPanel, removePanel, myRank, getProfiles, metricLines, closeSeason, excludedIds, seasonKey, roleMap, hasRoles, roleLines, RANK_KEYS } = require('../../services/leaderboard');

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
          return interaction.message.edit(await renderPanel(interaction.guild, cfg)).catch(() => {});
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
    .setDescription('(Admin) Liga de Ballenas: panel, exclusiones y roles por puesto')
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
    .addSubcommand((s) => s.setName('rol').setDescription('Roles por puesto: Top 1, Top 2, Top 3 y Top 4–10')
      .addRoleOption((o) => o.setName('top1').setDescription('Rol exclusivo del puesto #1'))
      .addRoleOption((o) => o.setName('top2').setDescription('Rol exclusivo del puesto #2'))
      .addRoleOption((o) => o.setName('top3').setDescription('Rol exclusivo del puesto #3'))
      .addRoleOption((o) => o.setName('top10').setDescription('Rol de los puestos #4 al #10'))
      .addStringOption((o) => o.setName('quitar').setDescription('Desactiva un rol (o todos)')
        .addChoices({ name: 'Todos / All', value: 'all' }, { name: 'Top 1', value: 'top1' }, { name: 'Top 2', value: 'top2' }, { name: 'Top 3', value: 'top3' }, { name: 'Top 4–10', value: 'top10' })))
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
      const listOf = (c) => roleLines(interaction.lang, c);
      const quitar = interaction.options.getString('quitar');
      const picked = Object.fromEntries(RANK_KEYS.map(([opt]) => [opt, interaction.options.getRole(opt)]));
      const hadRoles = hasRoles(cfg);

      if (quitar) {
        const keys = quitar === 'all' ? RANK_KEYS : RANK_KEYS.filter(([opt]) => opt === quitar);
        const $set = Object.fromEntries(keys.map(([, field]) => [field, null]));
        // El rol único antiguo (v7.6) equivale a Top 3: se limpia junto con él.
        if (quitar === 'all' || quitar === 'top3') $set.lbRoleId = null;
        await updateGuildConfig(guildId, { $set });
        await audit({ guildId, action: 'leaderboard_role_off', byId: interaction.user.id, details: { which: quitar } });
        return interaction.reply({ content: t('leaderboard.roleRemoved', { which: quitar === 'all' ? t('leaderboard.all') : t(`leaderboard.label${quitar === 'top10' ? 10 : quitar.slice(3)}`) }), ...base });
      }
      if (!Object.values(picked).some(Boolean)) return interaction.reply({ content: hadRoles ? t('leaderboard.roleCurrent', { list: listOf(cfg) }) : t('leaderboard.roleNone'), ...base });

      const $set = {};
      for (const [opt, field] of RANK_KEYS) {
        const role = picked[opt];
        if (!role) continue;
        if (role.id === guildId) return interaction.reply({ content: t('leaderboard.everyone'), ...base });
        $set[field] = role.id;
      }
      // El rol único antiguo pasa a ser Top 3 si no se reconfigura ahora.
      if (cfg.lbRoleId) { if (!$set.lbRoleTop3 && !cfg.lbRoleTop3) $set.lbRoleTop3 = cfg.lbRoleId; $set.lbRoleId = null; }
      const merged = { ...cfg, ...$set };
      // Cada puesto necesita un rol distinto (si no, quitarlo de un puesto se lo quitaría al otro).
      const seen = new Set();
      for (const id of Object.values(roleMap(merged)).filter(Boolean)) {
        if (seen.has(id)) return interaction.reply({ content: t('leaderboard.roleDup', { role: `<@&${id}>` }), ...base });
        seen.add(id);
      }
      // lbLastSeason = mes anterior al activar por primera vez: así no se "recupera" un cierre anterior a la configuración.
      if (!hadRoles) $set.lbLastSeason = seasonKey(new Date(), 1);
      await updateGuildConfig(guildId, { $set });
      await audit({ guildId, action: 'leaderboard_role_set', byId: interaction.user.id, details: $set });
      const unmanaged = Object.values(roleMap(merged)).filter(Boolean).filter((id) => !interaction.guild.roles.cache.get(id)?.editable).map((id) => `<@&${id}>`);
      const warn = unmanaged.length ? `\n${t('leaderboard.roleHierarchy', { roles: unmanaged.join(' ') })}` : '';
      return interaction.reply({ content: t('leaderboard.roleSet', { list: listOf(merged), tz: config.leaderboard.timezone }) + warn, ...base });
    }

    // temporada-ahora
    if (!hasRoles(cfg)) return interaction.reply({ content: t('leaderboard.noRole'), ...eph });
    await interaction.deferReply(eph);
    if (!(await askConfirmation(interaction, { content: t('leaderboard.closeConfirm') }))) return;
    const res = await closeSeason(interaction.client, guildId, { manual: true });
    const winners = res.winners.length ? res.winners.map((p) => `<@${p.id}>`).join(' ') : t('leaderboard.nobody');
    const text = res.warnings.length ? t('leaderboard.closeFail', { warn: res.warnings.join('; ') }) : t('leaderboard.closeDone', { winners });
    return interaction.editReply({ content: text, allowedMentions: { parse: [] } });
  },
};
