const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { updateGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');

const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('set-purchases-channel')
    .setDescription('(Admin) Canal de logs de compras (tienda, NFT y Tienda de Expedición)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('canal').setDescription('Canal de logs de compras').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName('publico').setDescription('Canal visible para todos: oculta wallets completas e IDs de pedido (por defecto no)'))
    .addBooleanOption((o) => o.setName('desactivar').setDescription('Dejar de registrar compras')),

  async execute(interaction) {
    const t = interaction.t;
    const eph = { flags: MessageFlags.Ephemeral };
    const channel = interaction.options.getChannel('canal');

    if (interaction.options.getBoolean('desactivar')) {
      await updateGuildConfig(interaction.guildId, { $set: { purchasesChannelId: null } });
      await audit({ guildId: interaction.guildId, action: 'purchases_channel_off', byId: interaction.user.id });
      return interaction.reply({ content: t('purchasesChannel.disabled'), ...eph });
    }
    if (!channel) return interaction.reply({ content: t('purchasesChannel.needChannel'), ...eph });
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(NEEDED)) return interaction.reply({ content: t('purchasesChannel.noPerms', { channel: `${channel}` }), ...eph });

    const publicMode = interaction.options.getBoolean('publico') ?? false;
    await updateGuildConfig(interaction.guildId, { $set: { purchasesChannelId: channel.id, purchasesPublic: publicMode } });
    await audit({ guildId: interaction.guildId, action: 'purchases_channel_set', byId: interaction.user.id, details: { channelId: channel.id, publicMode } });
    return interaction.reply({ content: t(publicMode ? 'purchasesChannel.setPublic' : 'purchasesChannel.setPrivate', { channel: `${channel}` }), ...eph });
  },
};
