const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { updateGuildConfig, getGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');

// tipo -> campo de GuildConfig y canal donde se usa (para avisar si el rol no se podrá mencionar)
const TYPES = {
  eventos: { field: 'eventsRoleId', channel: 'eventsChannelId' },
  lootbox: { field: 'dropsRoleId', channel: 'logsChannelId' },
  tienda: { field: 'shopRoleId', channel: 'storeChannelId' },
};

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('set-ping-role')
    .setDescription('(Admin) Rol que el bot menciona en vez de @everyone: eventos, drops o tienda')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('tipo').setDescription('Qué avisos recibirá el rol').setRequired(true)
      .addChoices({ name: 'Eventos globales (inicio y fin)', value: 'eventos' }, { name: 'Drops de lootbox (premios épicos y NFT)', value: 'lootbox' }, { name: 'Novedades de la tienda (artículo nuevo y rotación)', value: 'tienda' }))
    .addRoleOption((o) => o.setName('rol').setDescription('Rol a mencionar (vacío = ver el actual)'))
    .addBooleanOption((o) => o.setName('quitar').setDescription('Dejar de mencionar un rol para este tipo')),

  async execute(interaction) {
    const t = interaction.t;
    const eph = { flags: MessageFlags.Ephemeral };
    const guildId = interaction.guildId;
    const type = interaction.options.getString('tipo', true);
    const { field, channel: channelField } = TYPES[type];
    const role = interaction.options.getRole('rol');
    const label = t(`pingRole.type.${type}`);

    if (interaction.options.getBoolean('quitar')) {
      await updateGuildConfig(guildId, { $set: { [field]: null } });
      await audit({ guildId, action: 'ping_role_off', byId: interaction.user.id, details: { type } });
      return interaction.reply({ content: t('pingRole.removed', { type: label }), ...eph });
    }
    const cfg = await getGuildConfig(guildId);
    if (!role) return interaction.reply({ content: cfg[field] ? t('pingRole.current', { type: label, role: `<@&${cfg[field]}>` }) : t('pingRole.none', { type: label }), allowedMentions: { parse: [] }, ...eph });
    if (role.id === guildId) return interaction.reply({ content: t('pingRole.everyone'), ...eph });

    await updateGuildConfig(guildId, { $set: { [field]: role.id } });
    await audit({ guildId, action: 'ping_role_set', byId: interaction.user.id, details: { type, roleId: role.id } });

    // Un rol solo se puede mencionar si es "mencionable" o si el bot tiene el permiso de mencionar a todos en el canal.
    const ch = cfg[channelField] ? await interaction.client.channels.fetch(cfg[channelField]).catch(() => null) : null;
    const canPing = role.mentionable || ch?.permissionsFor(interaction.guild.members.me)?.has(PermissionFlagsBits.MentionEveryone);
    const warn = ch && !canPing ? `\n${t('pingRole.notMentionable', { role: `${role}` })}` : '';
    const noCh = ch ? '' : `\n${t('pingRole.noChannel', { type: label })}`;
    return interaction.reply({ content: t('pingRole.set', { type: label, role: `${role}` }) + warn + noCh, allowedMentions: { parse: [] }, ...eph });
  },
};
