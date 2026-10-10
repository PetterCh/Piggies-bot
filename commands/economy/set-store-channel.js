const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { updateGuildConfig } = require('../../utils/guildConfig');
const { syncAll } = require('../../services/storeSync');
const { audit } = require('../../utils/adminLog');
const { purchase } = require('../../services/shop');

const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

module.exports = {
  // Botón "Comprar" de las tarjetas del canal de la tienda (público: lo pulsa cualquier usuario). customId: shop:buy:<itemId>
  components: [
    {
      kind: 'button',
      prefix: 'shop',
      async execute(interaction, args) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return purchase(interaction, args[1]);
      },
    },
  ],
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('set-store-channel')
    .setDescription('(Admin) Define el canal donde el bot publica y mantiene la tienda')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('canal').setDescription('Canal de la tienda').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName('desactivar').setDescription('Dejar de publicar la tienda y borrar las tarjetas')),

  async execute(interaction) {
    const t = interaction.t;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel('canal');
    const off = interaction.options.getBoolean('desactivar');

    if (off) {
      await updateGuildConfig(interaction.guildId, { $set: { storeChannelId: null } });
      await syncAll(interaction.client, interaction.guildId); // sin canal: borra las tarjetas
      await audit({ guildId: interaction.guildId, action: 'store_channel_off', byId: interaction.user.id });
      return interaction.editReply(t('storeChannel.disabled'));
    }
    if (!channel) return interaction.editReply(t('storeChannel.needChannel'));

    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(NEEDED)) return interaction.editReply(t('storeChannel.noPerms', { channel: `${channel}` }));

    await updateGuildConfig(interaction.guildId, { $set: { storeChannelId: channel.id } });
    await interaction.editReply(t('storeChannel.publishing', { channel: `${channel}` }));
    const n = await syncAll(interaction.client, interaction.guildId);
    await audit({ guildId: interaction.guildId, action: 'store_channel_set', byId: interaction.user.id, details: { channelId: channel.id } });
    return interaction.editReply(t('storeChannel.set', { channel: `${channel}`, n }));
  },
};
