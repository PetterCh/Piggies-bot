const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { updateGuildConfig } = require('../../utils/guildConfig');
const { audit } = require('../../utils/adminLog');

const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('set-events-channel')
    .setDescription('(Admin) Canal donde aparecen los eventos globales sorpresa y se anuncian sus premios')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('canal').setDescription('Canal de eventos').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addBooleanOption((o) => o.setName('everyone').setDescription('Hacer @everyone cuando empiece un evento (por defecto no)'))
    .addBooleanOption((o) => o.setName('desactivar').setDescription('Dejar de generar eventos')),

  async execute(interaction) {
    const t = interaction.t;
    const eph = { flags: MessageFlags.Ephemeral };
    const channel = interaction.options.getChannel('canal');

    if (interaction.options.getBoolean('desactivar')) {
      await updateGuildConfig(interaction.guildId, { $set: { eventsChannelId: null, nextEventAt: null } });
      await audit({ guildId: interaction.guildId, action: 'events_channel_off', byId: interaction.user.id });
      return interaction.reply({ content: t('eventsChannel.disabled'), ...eph });
    }
    if (!channel) return interaction.reply({ content: t('eventsChannel.needChannel'), ...eph });
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(NEEDED)) return interaction.reply({ content: t('eventsChannel.noPerms', { channel: `${channel}` }), ...eph });

    const everyone = interaction.options.getBoolean('everyone') ?? false;
    // nextEventAt = null: el primer evento se programa solo (2-24 h) en el siguiente ciclo del temporizador.
    await updateGuildConfig(interaction.guildId, { $set: { eventsChannelId: channel.id, eventsEveryone: everyone, eventsEnabled: true, nextEventAt: null } });
    await audit({ guildId: interaction.guildId, action: 'events_channel_set', byId: interaction.user.id, details: { channelId: channel.id, everyone } });
    const warn = everyone && !perms.has(PermissionFlagsBits.MentionEveryone) ? `\n${t('logsChannel.noMentionPerm')}` : '';
    return interaction.reply({ content: t('eventsChannel.set', { channel: `${channel}` }) + warn, ...eph });
  },
};
