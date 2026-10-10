// Panel de auto-roles por botones: los usuarios activan/desactivan roles (avisos de eventos, drops, novedades de la tienda...)
// sin que el bot tenga que hacer @everyone. Los botones (persistentes) están al principio de este mismo archivo.
const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const RolePanel = require('../../models/RolePanel');
const { MAX_BUTTONS, roleProblem, refreshPanel, deletePanelMessage } = require('../../services/autoroles');
const { updateGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');
const { UserError } = require('../../utils/helpers');

const eph = { flags: MessageFlags.Ephemeral };
const lastClick = new Map(); // userId -> timestamp (anti-spam de clics en los botones)
const MAX_PANELS = 10;
const PING_FIELDS = { eventos: 'eventsRoleId', lootbox: 'dropsRoleId', tienda: 'shopRoleId' };
const EMOJI_RE = /^(<a?:\w{2,32}:\d{17,20}>|\p{Extended_Pictographic}\uFE0F?(\u200d\p{Extended_Pictographic}\uFE0F?)*)$/u;
const isId = (s) => /^[a-f\d]{24}$/i.test(s);

module.exports = {
  // Botones del panel (públicos). customId: ar:<panelId>:<roleId>. Pulsar activa el rol; volver a pulsar lo quita.
  components: [
    {
      kind: 'button',
      prefix: 'ar',
      async execute(interaction, args) {
        const t = interaction.t;
        const [panelId, roleId] = args;
        const now = Date.now();
        if (now - (lastClick.get(interaction.user.id) || 0) < 2000) return interaction.reply({ content: t('autoroles.cooldown'), ...eph });
        lastClick.set(interaction.user.id, now);
        if (lastClick.size > 5000) lastClick.clear();

        // El botón solo vale si el rol SIGUE en el panel (un botón viejo no puede dar un rol retirado).
        const panel = /^[a-f\d]{24}$/i.test(panelId) ? await RolePanel.findOne({ _id: panelId, guildId: interaction.guildId }).lean() : null;
        const role = interaction.guild.roles.cache.get(roleId);
        if (!panel || !role || !panel.roles.some((r) => r.roleId === roleId)) return interaction.reply({ content: t('autoroles.stale'), ...eph });
        // Revalidación al pulsar: si el rol ganó permisos peligrosos después de añadirlo, ya no se entrega.
        if (await roleProblem(interaction.guild, role)) return interaction.reply({ content: t('autoroles.blocked'), ...eph });

        const member = interaction.member;
        const has = member.roles.cache.has(roleId);
        try {
          if (has) await member.roles.remove(roleId, 'Auto-rol (panel)');
          else await member.roles.add(roleId, 'Auto-rol (panel)');
        } catch (err) {
          console.error('[autoroles]', err.message);
          return interaction.reply({ content: t('autoroles.failed'), ...eph });
        }
        return interaction.reply({ content: t(has ? 'autoroles.toggledOff' : 'autoroles.toggledOn', { role: `${role}` }), allowedMentions: { parse: [] }, ...eph });
      },
    },
  ],
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('autoroles')
    .setDescription('(Admin) Paneles de auto-roles por botones')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('crear').setDescription('Crea y publica un panel')
      .addStringOption((o) => o.setName('titulo').setDescription('Título del panel').setRequired(true).setMaxLength(100))
      .addStringOption((o) => o.setName('descripcion').setDescription('Texto del panel').setMaxLength(1000))
      .addChannelOption((o) => o.setName('canal').setDescription('Canal donde publicarlo (por defecto, este)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addStringOption((o) => o.setName('color').setDescription('Color en hexadecimal, ej: #5865F2')))
    .addSubcommand((s) => s.setName('agregar').setDescription('Añade un botón de rol a un panel')
      .addStringOption((o) => o.setName('panel').setDescription('Panel').setRequired(true).setAutocomplete(true))
      .addRoleOption((o) => o.setName('rol').setDescription('Rol existente'))
      .addStringOption((o) => o.setName('nuevo-rol').setDescription('O el nombre de un rol NUEVO que el bot creará (mencionable, sin permisos)').setMaxLength(100))
      .addStringOption((o) => o.setName('etiqueta').setDescription('Texto del botón (por defecto, el nombre del rol)').setMaxLength(80))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji del botón'))
      .addStringOption((o) => o.setName('descripcion').setDescription('Qué recibe quien lo activa').setMaxLength(100))
      .addStringOption((o) => o.setName('ping').setDescription('Usar también este rol como el que el bot menciona para...')
        .addChoices({ name: 'Eventos globales', value: 'eventos' }, { name: 'Drops de lootbox', value: 'lootbox' }, { name: 'Novedades de la tienda', value: 'tienda' })))
    .addSubcommand((s) => s.setName('quitar').setDescription('Quita un botón de rol de un panel')
      .addStringOption((o) => o.setName('panel').setDescription('Panel').setRequired(true).setAutocomplete(true))
      .addRoleOption((o) => o.setName('rol').setDescription('Rol a quitar').setRequired(true)))
    .addSubcommand((s) => s.setName('eliminar').setDescription('Elimina un panel y su mensaje')
      .addStringOption((o) => o.setName('panel').setDescription('Panel').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('listar').setDescription('Lista los paneles')),

  async autocomplete(interaction) {
    const q = String(interaction.options.getFocused()).toLowerCase();
    const list = await RolePanel.find({ guildId: interaction.guildId }).sort({ createdAt: 1 }).limit(25).lean();
    await interaction.respond(list.filter((p) => p.title.toLowerCase().includes(q)).map((p) => ({ name: `${p.title} (${p.roles.length})`.slice(0, 100), value: String(p._id) })));
  },

  async execute(interaction) {
    const t = interaction.t;
    await interaction.deferReply(eph);
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();
    const getPanel = async () => {
      const id = interaction.options.getString('panel', true);
      const panel = isId(id) ? await RolePanel.findOne({ _id: id, guildId: guild.id }) : null;
      if (!panel) throw new UserError(t('autoroles.panelNotFound'));
      return panel;
    };

    try {
      if (sub === 'crear') {
        if ((await RolePanel.countDocuments({ guildId: guild.id })) >= MAX_PANELS) throw new UserError(t('autoroles.panelLimit', { max: MAX_PANELS }));
        const channel = interaction.options.getChannel('canal') || interaction.channel;
        const me = guild.members.me;
        if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) throw new UserError(t('autoroles.noPerms', { channel: `${channel}` }));
        const colorRaw = interaction.options.getString('color');
        if (colorRaw && !/^#?[0-9a-f]{6}$/i.test(colorRaw)) throw new UserError(t('autoroles.badColor'));
        const panel = await RolePanel.create({
          guildId: guild.id, channelId: channel.id, createdBy: interaction.user.id,
          title: interaction.options.getString('titulo', true), description: interaction.options.getString('descripcion') || '',
          ...(colorRaw ? { color: parseInt(colorRaw.replace('#', ''), 16) } : {}),
        });
        await refreshPanel(interaction.client, panel);
        await audit({ guildId: guild.id, action: 'autoroles_create', byId: interaction.user.id, details: { id: panel._id } });
        return interaction.editReply(t('autoroles.created', { channel: `${channel}` }));
      }

      if (sub === 'listar') {
        const list = await RolePanel.find({ guildId: guild.id }).sort({ createdAt: 1 }).lean();
        if (!list.length) return interaction.editReply(t('autoroles.listEmpty'));
        const lines = list.map((p) => t('autoroles.listLine', { title: p.title, n: p.roles.length, url: p.messageId ? `https://discord.com/channels/${guild.id}/${p.channelId}/${p.messageId}` : `<#${p.channelId}>` }));
        return interaction.editReply({ content: `${t('autoroles.listTitle')}\n${lines.join('\n')}`.slice(0, 1900), allowedMentions: { parse: [] } });
      }

      const panel = await getPanel();

      if (sub === 'eliminar') {
        await deletePanelMessage(interaction.client, panel);
        await panel.deleteOne();
        await audit({ guildId: guild.id, action: 'autoroles_delete', byId: interaction.user.id, details: { id: panel._id } });
        return interaction.editReply(t('autoroles.deleted'));
      }

      if (sub === 'quitar') {
        const role = interaction.options.getRole('rol', true);
        if (!panel.roles.some((r) => r.roleId === role.id)) throw new UserError(t('autoroles.notInPanel', { role: `${role}` }));
        panel.roles = panel.roles.filter((r) => r.roleId !== role.id);
        await panel.save();
        await refreshPanel(interaction.client, panel);
        await audit({ guildId: guild.id, action: 'autoroles_remove', byId: interaction.user.id, details: { id: panel._id, roleId: role.id } });
        return interaction.editReply({ content: t('autoroles.removed', { role: `${role}` }), allowedMentions: { parse: [] } });
      }

      // agregar
      if (panel.roles.length >= MAX_BUTTONS) throw new UserError(t('autoroles.buttonLimit', { max: MAX_BUTTONS }));
      let role = interaction.options.getRole('rol');
      const newName = interaction.options.getString('nuevo-rol');
      if (!role && !newName) throw new UserError(t('autoroles.roleRequired'));
      const emoji = interaction.options.getString('emoji')?.trim() || null;
      if (emoji && !EMOJI_RE.test(emoji)) throw new UserError(t('autoroles.badEmoji'));

      let created = false;
      if (!role) {
        try {
          role = await guild.roles.create({ name: newName.trim(), mentionable: true, permissions: [], reason: `Auto-rol creado por ${interaction.user.tag}` });
          created = true;
        } catch (err) {
          throw new UserError(t('autoroles.createRoleFail', { error: err.message }));
        }
      }
      const problem = await roleProblem(guild, role);
      if (problem) {
        if (created) await role.delete('Auto-rol no válido').catch(() => {});
        throw new UserError(t(`autoroles.problem.${problem}`, { role: `${role}` }));
      }
      if (panel.roles.some((r) => r.roleId === role.id)) throw new UserError(t('autoroles.alreadyInPanel', { role: `${role}` }));

      panel.roles.push({ roleId: role.id, label: interaction.options.getString('etiqueta') || role.name, emoji, description: interaction.options.getString('descripcion') || '' });
      await panel.save();
      await refreshPanel(interaction.client, panel);

      const ping = interaction.options.getString('ping');
      if (ping) await updateGuildConfig(guild.id, { $set: { [PING_FIELDS[ping]]: role.id } });
      await audit({ guildId: guild.id, action: 'autoroles_add', byId: interaction.user.id, details: { id: panel._id, roleId: role.id, created, ping } });
      return interaction.editReply({
        content: t('autoroles.added', { role: `${role}` }) + (created ? `\n${t('autoroles.roleCreated')}` : '') + (ping ? `\n${t('autoroles.pingSet', { type: t(`pingRole.type.${ping}`) })}` : ''),
        allowedMentions: { parse: [] },
      });
    } catch (err) {
      if (err instanceof UserError) return interaction.editReply(`❌ ${err.message}`);
      throw err;
    }
  },
};
