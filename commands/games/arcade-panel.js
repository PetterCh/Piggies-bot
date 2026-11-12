// /arcade-panel — (Admin) Publica un panel fijo en el canal con botones:
//   · Botón Link  -> abre directamente la web del Panel Arcade (https://tu-url/arcade/)
//   · Botón normal -> entrega a cada usuario su enlace PERSONAL (firmado, 10 min, un solo uso), solo visible para él.
// Un botón Link no puede llevar un token distinto por persona, por eso existe el segundo botón.
const { SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } = require('discord.js');
const { publicBaseUrl } = require('../../web/piggies');
const { createLinkToken } = require('../../web/arcade/auth');
const { langForGuild, t: tr } = require('../../utils/i18n');

module.exports = {
  adminOnly: true,
  data: new SlashCommandBuilder()
    .setName('arcade-panel')
    .setDescription('(Admin) Publica el panel fijo del Arcade con botones de acceso')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const t = interaction.t;
    const base = publicBaseUrl();
    if (!base) return interaction.reply({ content: t('arcade.noWeb'), flags: MessageFlags.Ephemeral });
    const L = langForGuild(interaction.guild);
    const embed = new EmbedBuilder()
      .setColor(0x7c5cff)
      .setTitle(tr(L, 'arcadePanel.title'))
      .setDescription(tr(L, 'arcadePanel.desc'));
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`${base}/arcade/`).setLabel(tr(L, 'arcadePanel.openWeb')),
      new ButtonBuilder().setStyle(ButtonStyle.Primary).setCustomId('arcp:link').setLabel(tr(L, 'arcadePanel.myLink')),
    );
    await interaction.channel.send({ embeds: [embed], components: [row] });
    return interaction.reply({ content: t('arcadePanel.posted'), flags: MessageFlags.Ephemeral });
  },

  components: [
    {
      kind: 'button',
      prefix: 'arcp',
      async execute(interaction) {
        const t = interaction.t;
        const base = publicBaseUrl();
        if (!base) return interaction.reply({ content: t('arcade.noWeb'), flags: MessageFlags.Ephemeral });
        const token = createLinkToken({
          id: interaction.user.id,
          name: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
          avatar: interaction.user.displayAvatarURL({ extension: 'png', size: 64 }),
          guildId: interaction.guildId,
        });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(`${base}/arcade/enter?t=${token}`).setLabel(t('arcade.button')),
        );
        return interaction.reply({ content: t('arcade.intro'), components: [row], flags: MessageFlags.Ephemeral });
      },
    },
  ],
};
