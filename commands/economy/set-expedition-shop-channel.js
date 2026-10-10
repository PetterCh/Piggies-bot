const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { updateGuildConfig, getGuildConfig } = require('../../utils/guildConfig');
const { ensureRotation, removePanel } = require('../../services/expShop');
const { audit } = require('../../utils/adminLog');
const { purchase } = require('../../services/expShop');

const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

module.exports = {
  // Botón "Comprar" del panel de la Tienda de Expedición (público). customId: xshop:buy:<rotationId>:<itemId>
  components: [
    {
      kind: 'button',
      prefix: 'xshop',
      async execute(interaction, args) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return purchase(interaction, args[1], args[2]);
      },
    },
  ],
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('set-expedition-shop-channel')
    .setDescription('(Admin) Canal exclusivo de la Tienda de Expedición rotativa')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('canal').setDescription('Canal de la tienda de expedición').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName('republicar').setDescription('Volver a publicar el escaparate actual en el canal'))
    .addBooleanOption((o) => o.setName('desactivar').setDescription('Quitar la tienda del canal y dejar de rotarla')),

  async execute(interaction) {
    const t = interaction.t;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guildId = interaction.guildId;
    const channel = interaction.options.getChannel('canal');

    if (interaction.options.getBoolean('desactivar')) {
      await removePanel(interaction.client, guildId);
      await updateGuildConfig(guildId, { $set: { expShopChannelId: null } });
      await audit({ guildId, action: 'expshop_channel_off', byId: interaction.user.id });
      return interaction.editReply(t('expShopChannel.disabled'));
    }
    // `republicar` sin canal: vuelve a publicar el escaparate en el canal ya configurado.
    let target = channel;
    if (!target && interaction.options.getBoolean('republicar')) {
      const cfg = await getGuildConfig(guildId);
      target = cfg.expShopChannelId ? await interaction.client.channels.fetch(cfg.expShopChannelId).catch(() => null) : null;
    }
    if (!target) return interaction.editReply(t('expShopChannel.needChannel'));
    const perms = target.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(NEEDED)) return interaction.editReply(t('expShopChannel.noPerms', { channel: `${target}` }));

    await interaction.editReply(t('expShopChannel.publishing', { channel: `${target}` }));
    await removePanel(interaction.client, guildId); // borra el panel del canal anterior
    await updateGuildConfig(guildId, { $set: { expShopChannelId: target.id } });
    const rot = await ensureRotation(interaction.client, guildId, { force: true });
    await audit({ guildId, action: 'expshop_channel_set', byId: interaction.user.id, details: { channelId: target.id } });
    return interaction.editReply(t('expShopChannel.set', { channel: `${target}`, n: rot?.items.length ?? 0, when: `<t:${Math.floor(rot.endsAt.getTime() / 1000)}:R>` }));
  },
};
