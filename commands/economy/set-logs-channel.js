const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { updateGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');

const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('set-logs-channel')
    .setDescription('(Admin) Define el canal donde se anuncian los premios de las lootboxes')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('canal').setDescription('Canal de anuncios').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName('everyone').setDescription('Hacer @everyone en premios épicos/legendarios y NFT de alto valor (por defecto sí)'))
    .addStringOption((o) => o.setName('minimo').setDescription('Premio mínimo a anunciar (los NFT siempre se anuncian)')
      .addChoices({ name: 'Todos los premios', value: 'common' }, { name: 'Poco común o superior', value: 'uncommon' }, { name: 'Raro o superior', value: 'rare' }, { name: 'Épico o superior', value: 'epic' }))
    .addBooleanOption((o) => o.setName('desactivar').setDescription('Dejar de anunciar premios')),

  async execute(interaction) {
    const t = interaction.t;
    const eph = { flags: MessageFlags.Ephemeral };
    const channel = interaction.options.getChannel('canal');

    if (interaction.options.getBoolean('desactivar')) {
      await updateGuildConfig(interaction.guildId, { $set: { logsChannelId: null } });
      await audit({ guildId: interaction.guildId, action: 'logs_channel_off', byId: interaction.user.id });
      return interaction.reply({ content: t('logsChannel.disabled'), ...eph });
    }
    if (!channel) return interaction.reply({ content: t('logsChannel.needChannel'), ...eph });

    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(NEEDED)) return interaction.reply({ content: t('logsChannel.noPerms', { channel: `${channel}` }), ...eph });

    const everyone = interaction.options.getBoolean('everyone') ?? true;
    const min = interaction.options.getString('minimo') || 'common';
    await updateGuildConfig(interaction.guildId, { $set: { logsChannelId: channel.id, logsEveryone: everyone, logsMinRarity: min } });
    await audit({ guildId: interaction.guildId, action: 'logs_channel_set', byId: interaction.user.id, details: { channelId: channel.id, everyone, min } });

    const warn = everyone && !perms.has(PermissionFlagsBits.MentionEveryone) ? `\n${t('logsChannel.noMentionPerm')}` : '';
    return interaction.reply({ content: t('logsChannel.set', { channel: `${channel}`, everyone: everyone ? t('logsChannel.on') : t('logsChannel.off') }) + warn, ...eph });
  },
};
