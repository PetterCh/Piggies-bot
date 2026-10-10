const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { setOverride, t, fromLocale } = require('../../utils/i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('idioma')
    .setDescription('Language / Idioma: auto, español o English')
    .addStringOption((o) =>
      o.setName('idioma').setDescription('Auto = usar el idioma de tu Discord').setRequired(true)
        .addChoices({ name: 'Auto', value: 'auto' }, { name: 'Español', value: 'es' }, { name: 'English', value: 'en' })
    ),

  async execute(interaction) {
    const choice = interaction.options.getString('idioma', true);
    await setOverride(interaction.user.id, choice === 'auto' ? null : choice);
    // Responde ya en el idioma elegido (en "auto", en el idioma detectado del cliente).
    const lang = choice === 'auto' ? fromLocale(interaction.locale) || fromLocale(interaction.guildLocale) || config.defaultLang : choice;
    return interaction.reply({ content: t(lang, `lang.set.${choice}`), flags: MessageFlags.Ephemeral });
  },
};
