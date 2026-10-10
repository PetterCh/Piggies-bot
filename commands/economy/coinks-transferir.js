const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { transferCoinks, InsufficientFundsError } = require('../../utils/economy');
const { fmt } = require('../../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinks-transferir')
    .setDescription('Dona o transfiere Coinks a otro miembro')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Quién los recibe').setRequired(true))
    .addIntegerOption((o) => o.setName('cantidad').setDescription('Cantidad de Coinks').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000))
    .addStringOption((o) => o.setName('mensaje').setDescription('Mensaje opcional').setMaxLength(100)),

  async execute(interaction) {
    const t = interaction.t;
    const target = interaction.options.getUser('usuario', true);
    const amount = interaction.options.getInteger('cantidad', true);
    const note = interaction.options.getString('mensaje');
    const eph = { flags: MessageFlags.Ephemeral };

    if (target.bot) return interaction.reply({ content: t('transfer.bot'), ...eph });
    if (target.id === interaction.user.id) return interaction.reply({ content: t('transfer.self'), ...eph });

    try {
      await transferCoinks(interaction.user.id, target.id, amount, { reason: note || '', guildId: interaction.guildId });
    } catch (err) {
      if (err instanceof InsufficientFundsError) return interaction.reply({ content: t('transfer.insufficient', { currency: config.currency.name }), ...eph });
      throw err;
    }
    const embed = new EmbedBuilder().setColor(0x2ecc71).setTitle(t('transfer.title', { emoji: config.currency.emoji }))
      .setDescription(t('transfer.desc', { from: `${interaction.user}`, to: `${target}`, amount: fmt(amount), currency: config.currency.name }) + (note ? `\n💬 ${note}` : ''));
    return interaction.reply({ embeds: [embed], allowedMentions: { users: [target.id] } });
  },
};
