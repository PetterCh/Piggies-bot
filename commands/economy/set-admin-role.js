const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { updateGuildConfig, getGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');

const MAX_ROLES = 10;

module.exports = {
  superAdminOnly: true, // solo el dueño o un Administrador de Discord puede delegar permisos
  data: new SlashCommandBuilder()
    .setName('set-admin-role')
    .setDescription('(Dueño/Admin) Autoriza qué roles pueden usar las herramientas administrativas del bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addRoleOption((o) => o.setName('rol').setDescription('Rol a autorizar o quitar'))
    .addStringOption((o) => o.setName('accion').setDescription('Por defecto: agregar')
      .addChoices({ name: 'Agregar / Add', value: 'add' }, { name: 'Quitar / Remove', value: 'remove' }, { name: 'Listar / List', value: 'list' })),

  async execute(interaction) {
    const t = interaction.t;
    const eph = { flags: MessageFlags.Ephemeral };
    const guildId = interaction.guildId;
    const action = interaction.options.getString('accion') || (interaction.options.getRole('rol') ? 'add' : 'list');
    const role = interaction.options.getRole('rol');
    const cfg = await getGuildConfig(guildId);

    if (action === 'list') {
      const lines = cfg.adminRoleIds.map((id) => `• <@&${id}>`).join('\n') || t('adminRole.listEmpty');
      return interaction.reply({ content: `${t('adminRole.listTitle')}\n${lines}`, allowedMentions: { parse: [] }, ...eph });
    }
    if (!role) return interaction.reply({ content: t('adminRole.needRole'), ...eph });

    if (action === 'add') {
      if (role.id === guildId) return interaction.reply({ content: t('adminRole.everyone'), ...eph });
      if (cfg.adminRoleIds.includes(role.id)) return interaction.reply({ content: t('adminRole.already', { role: `${role}` }), allowedMentions: { parse: [] }, ...eph });
      if (cfg.adminRoleIds.length >= MAX_ROLES) return interaction.reply({ content: t('adminRole.limit', { max: MAX_ROLES }), ...eph });
      await updateGuildConfig(guildId, { $addToSet: { adminRoleIds: role.id } });
      await audit({ guildId, action: 'admin_role_add', byId: interaction.user.id, details: { roleId: role.id } });
      return interaction.reply({ content: t('adminRole.added', { role: `${role}` }), allowedMentions: { parse: [] }, ...eph });
    }

    if (!cfg.adminRoleIds.includes(role.id)) return interaction.reply({ content: t('adminRole.notFound', { role: `${role}` }), allowedMentions: { parse: [] }, ...eph });
    await updateGuildConfig(guildId, { $pull: { adminRoleIds: role.id } });
    await audit({ guildId, action: 'admin_role_remove', byId: interaction.user.id, details: { roleId: role.id } });
    return interaction.reply({ content: t('adminRole.removed', { role: `${role}` }), allowedMentions: { parse: [] }, ...eph });
  },
};
