// /arcade — Genera tu enlace PERSONAL (firmado y temporal) al Panel Arcade de la web. Independiente del resto del bot.
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { publicBaseUrl } = require('../../web/piggies');
const { createLinkToken } = require('../../web/arcade/auth');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('arcade')
    .setDescription('Abre el Panel Arcade (Piggy Crash, Buscaminas…) con tu enlace personal')
    .setDMPermission(false),

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
    return interaction.reply({ content: t('arcade.intro'), components: [row], flags: MessageFlags.Ephemeral }); // solo lo ves tú
  },
};
