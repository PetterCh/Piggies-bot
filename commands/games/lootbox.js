// Cajas misteriosas. El botón "abrir otra" es persistente (prefijo lb) y solo lo puede usar quien abrió la caja.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { BOXES } = require('../../data/lootboxes');
const { choice, t: tr } = require('../../utils/i18n');
const { fmt } = require('../../utils/helpers');
const { openBox, oddsLines } = require('../../services/lootbox');

const eph = { flags: MessageFlags.Ephemeral };
const boxChoices = Object.values(BOXES).map((b) => choice('lootbox.boxChoice', b.id, { emoji: b.emoji, name: tr('es', `lootbox.box.${b.id}`), price: fmt(b.price) }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lootbox')
    .setDescription('Cajas misteriosas: NFTs, accesorios, Coinks... ¡o nada!')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('abrir').setDescription('Compra y abre una caja')
      .addStringOption((o) => o.setName('caja').setDescription('Tipo de caja').setRequired(true).addChoices(...boxChoices)))
    .addSubcommand((s) => s.setName('cajas').setDescription('Mira las cajas disponibles y sus precios'))
    .addSubcommand((s) => s.setName('probabilidades').setDescription('Probabilidades exactas de una caja')
      .addStringOption((o) => o.setName('caja').setDescription('Tipo de caja').setRequired(true).addChoices(...boxChoices))),

  async execute(interaction) {
    const t = interaction.t;
    const sub = interaction.options.getSubcommand();
    const cur = config.currency;

    if (sub === 'abrir') return openBox(interaction, interaction.options.getString('caja', true));

    if (sub === 'cajas') {
      const embed = new EmbedBuilder().setColor(0xf5a623).setTitle(t('lootbox.list.title')).setDescription(t('lootbox.list.desc'));
      for (const b of Object.values(BOXES)) embed.addFields({ name: `${b.emoji} ${t(`lootbox.box.${b.id}`)} — ${fmt(b.price)} ${cur.emoji}`, value: t(`lootbox.boxDesc.${b.id}`) });
      return interaction.reply({ embeds: [embed], ...eph });
    }

    const box = BOXES[interaction.options.getString('caja', true)];
    const embed = new EmbedBuilder().setColor(0x3498db)
      .setTitle(t('lootbox.odds.title', { box: `${box.emoji} ${t(`lootbox.box.${box.id}`)}`, price: fmt(box.price), emoji: cur.emoji }))
      .setDescription(oddsLines(box, interaction.lang, tr).join('\n'))
      .setFooter({ text: t('lootbox.odds.footer') });
    return interaction.reply({ embeds: [embed], ...eph });
  },

  components: [
    {
      kind: 'button', prefix: 'lb',
      async execute(interaction, args) {
        const [, boxId, ownerId] = args; // lb:again:<boxId>:<userId>
        if (interaction.user.id !== ownerId) return interaction.reply({ content: interaction.t('lootbox.notYours'), ...eph });
        return openBox(interaction, boxId);
      },
    },
  ],
};
