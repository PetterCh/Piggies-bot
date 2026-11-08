// /ballenas-chiquero (EN: /pigsty-whales): muestra la Liga de Ballenas (Top 10) en cualquier canal.
// Usa los mismos botones persistentes (prefijo "lbd") que el panel fijo de /leaderboard-admin panel.
const { SlashCommandBuilder } = require('discord.js');
const { getGuildConfig } = require('../../utils/guildConfig');
const { buildPanel } = require('../../services/leaderboard');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ballenas-chiquero')
    .setDescription('Mira la Liga de Ballenas del Chiquero: el Top 10 de Coinks')
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.deferReply();
    const cfg = await getGuildConfig(interaction.guildId);
    return interaction.editReply(await buildPanel(interaction.guild, cfg));
  },
};
