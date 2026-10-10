const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const config = require('../../config');
const { airdropCoinks } = require('../../utils/economy');
const { askConfirmation } = require('../../utils/confirm');
const { fmt } = require('../../utils/helpers');

module.exports = {
  adminOnly: true, // la comprobación real vive en events/interactionCreate.js
  data: new SlashCommandBuilder()
    .setName('coinks-airdrop')
    .setDescription('(Admin) Reparte Coinks a todos los miembros o a los de un rol')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addIntegerOption((o) => o.setName('cantidad').setDescription('Coinks POR PERSONA').setRequired(true).setMinValue(1).setMaxValue(1_000_000))
    .addRoleOption((o) => o.setName('rol').setDescription('Solo miembros con este rol (si no, todos los humanos)'))
    .addStringOption((o) => o.setName('motivo').setDescription('Motivo (queda en el registro)').setMaxLength(100)),

  async execute(interaction) {
    const t = interaction.t;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const amount = interaction.options.getInteger('cantidad', true);
    const role = interaction.options.getRole('rol');
    const reason = interaction.options.getString('motivo') || 'Airdrop';

    await interaction.guild.members.fetch();
    const pool = role ? interaction.guild.roles.cache.get(role.id).members : interaction.guild.members.cache;
    const ids = [...pool.filter((m) => !m.user.bot).keys()];
    if (!ids.length) return interaction.editReply(t('airdrop.noMembers'));

    const vars = { amount: fmt(amount), count: fmt(ids.length), total: fmt(amount * ids.length), currency: config.currency.name, emoji: config.currency.emoji, role: role ? `${role}` : '' };
    const ok = await askConfirmation(interaction, { content: t(role ? 'airdrop.confirmRole' : 'airdrop.confirmAll', vars) });
    if (!ok) return;

    await airdropCoinks(ids, amount, { reason, guildId: interaction.guildId, byId: interaction.user.id });
    await interaction.editReply(t('airdrop.done', vars));
    await interaction.channel?.send({ content: t(role ? 'airdrop.announceRole' : 'airdrop.announceAll', { ...vars, host: `${interaction.user}`, reason }), allowedMentions: { parse: [] } }).catch(() => {});
  },
};
