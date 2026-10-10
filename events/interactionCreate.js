const { Events, MessageFlags } = require('discord.js');
const { t, resolveLang } = require('../utils/i18n');
const { isBotAdmin, isSuperAdmin } = require('../utils/permissions');

async function replyError(interaction) {
  const payload = { content: interaction.t('common.error'), flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
  else await interaction.reply(payload).catch(() => {});
}

/** ¿Puede este usuario usar el comando/componente? (marcas: superAdminOnly > adminOnly > público) */
async function allowed(target, interaction) {
  if (target.superAdminOnly) return isSuperAdmin(interaction.member);
  if (target.adminOnly) return isBotAdmin(interaction.member);
  return true;
}

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction, client) {
    // Idioma de esta interacción: interaction.t(key, vars) en todos los comandos.
    interaction.lang = await resolveLang(interaction);
    interaction.t = (key, vars) => t(interaction.lang, key, vars);

    if (interaction.isAutocomplete()) {
      const cmd = client.commands.get(interaction.commandName);
      try {
        if (!cmd?.autocomplete) return;
        if (!(await allowed(cmd, interaction))) return interaction.respond([]); // los autocompletados de admin no filtran datos
        await cmd.autocomplete(interaction);
      } catch (err) {
        console.error('[autocomplete]', err);
      }
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) { // comando retirado que Discord aún muestra (falta `npm run deploy`): se avisa en vez de dejar "la aplicación no responde"
        return interaction.reply({ content: interaction.t('common.commandRemoved'), flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      try {
        if (!(await allowed(command, interaction))) {
          return interaction.reply({ content: interaction.t('common.noPermission'), flags: MessageFlags.Ephemeral });
        }
        await command.execute(interaction, client);
      } catch (err) {
        console.error(`[comando /${interaction.commandName}]`, err);
        await replyError(interaction);
      }
      return;
    }

    // Componentes persistentes (botones, modales, menús) registrados por los comandos con `components`.
    const kind = interaction.isButton() ? 'button' : interaction.isModalSubmit() ? 'modal' : interaction.isStringSelectMenu() ? 'select' : null;
    if (!kind) return;
    const [prefix, ...args] = interaction.customId.split(':');
    const handler = client.components.get(`${kind}:${prefix}`);
    if (!handler) return; // p. ej. botones con collector (juego de colores, confirmaciones)
    try {
      if (!(await allowed(handler, interaction))) {
        return interaction.reply({ content: interaction.t('common.noPermission'), flags: MessageFlags.Ephemeral });
      }
      await handler.execute(interaction, args, client);
    } catch (err) {
      console.error(`[componente ${kind}:${prefix}]`, err);
      await replyError(interaction);
    }
  },
};
