const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { getUser } = require('../../utils/economy');
const { fmt } = require('../../utils/helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('coinks-saldo')
    .setDescription('Consulta tu saldo de Coinks (o el de otro miembro)')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Miembro a consultar (por defecto, tú)')),

  async execute(interaction) {
    const t = interaction.t;
    const target = interaction.options.getUser('usuario') || interaction.user;
    if (target.bot) return interaction.reply({ content: t('common.noBots'), flags: MessageFlags.Ephemeral });
    const user = await getUser(target.id);
    const vars = { emoji: config.currency.emoji, amount: fmt(user.coinks), currency: config.currency.name, user: `${target}` };
    return interaction.reply({ content: t(target.id === interaction.user.id ? 'balance.self' : 'balance.other', vars), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  },
};
