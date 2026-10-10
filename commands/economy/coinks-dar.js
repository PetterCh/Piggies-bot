const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { addCoinks } = require('../../utils/economy');
const { fmt } = require('../../utils/helpers');

module.exports = {
  adminOnly: true, // la comprobación real vive en events/interactionCreate.js
  data: new SlashCommandBuilder()
    .setName('coinks-dar')
    .setDescription('(Admin) Otorga Coinks a un usuario')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('usuario').setDescription('Quién los recibe').setRequired(true))
    .addIntegerOption((o) => o.setName('cantidad').setDescription('Cantidad de Coinks').setRequired(true).setMinValue(1).setMaxValue(1_000_000_000))
    .addStringOption((o) => o.setName('motivo').setDescription('Motivo (queda en el registro)').setMaxLength(100)),

  async execute(interaction) {
    const t = interaction.t;
    const target = interaction.options.getUser('usuario', true);
    const amount = interaction.options.getInteger('cantidad', true);
    const reason = interaction.options.getString('motivo') || t('coinksDar.noReason');
    if (target.bot) return interaction.reply({ content: t('common.noBots'), flags: MessageFlags.Ephemeral });

    const user = await addCoinks(target.id, amount, { type: 'admin_give', reason, guildId: interaction.guildId, byId: interaction.user.id });
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle(t('coinksDar.title', { emoji: config.currency.emoji }))
      .setDescription(t('coinksDar.desc', { user: `${target}`, amount: fmt(amount), currency: config.currency.name, balance: fmt(user.coinks), reason }));
    return interaction.reply({ embeds: [embed], allowedMentions: { users: [target.id] } });
  },
};
