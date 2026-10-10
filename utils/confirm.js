const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');

/**
 * Botones Confirmar/Cancelar sobre la respuesta de la interacción (debe estar "deferred" o respondida;
 * sirve para comandos, botones y modales). Devuelve true si el MISMO usuario confirma.
 */
async function askConfirmation(interaction, { content, embeds = [], timeMs = 60_000 }) {
  const t = interaction.t;
  const uid = interaction.id;
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`confirm:${uid}`).setLabel(t('common.confirm')).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`cancel:${uid}`).setLabel(t('common.cancel')).setStyle(ButtonStyle.Secondary)
  );
  const message = await interaction.editReply({ content, embeds, components: [row] });

  try {
    const btn = await message.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: timeMs,
      filter: (i) => i.user.id === interaction.user.id && i.customId.endsWith(uid),
    });
    const accepted = btn.customId.startsWith('confirm:');
    await btn.update({ content: accepted ? t('common.processing') : t('common.cancelled'), embeds: [], components: [] });
    return accepted;
  } catch {
    await interaction.editReply({ content: t('common.timeout'), embeds: [], components: [] }).catch(() => {});
    return false;
  }
}

module.exports = { askConfirmation };
