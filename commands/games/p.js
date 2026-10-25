// /p [id] — Vista previa de un Piggie + botón que abre su página interactiva (/play/<id>).
// Módulo independiente: solo lee los archivos de public/piggies; no toca la economía, expediciones ni inventario.
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { normId, readMetadata, spriteExists, playUrl, publicBaseUrl } = require('../../web/piggies');

const eph = { flags: MessageFlags.Ephemeral };
const isHttps = (u) => typeof u === 'string' && /^https?:\/\/\S+$/i.test(u);

module.exports = {
  data: new SlashCommandBuilder()
    .setName('p')
    .setDescription('Mira un Piggie y juega con él en la web')
    .addIntegerOption((o) => o.setName('id').setDescription('ID del Piggie (ej. 150)').setRequired(true).setMinValue(0).setMaxValue(9_999_999)),

  async execute(interaction) {
    const t = interaction.t;
    const id = normId(interaction.options.getInteger('id', true));
    const meta = readMetadata(id);
    if (!meta) return interaction.reply({ content: t('piggyWeb.notFound', { id }), ...eph });

    const url = playUrl(id);
    if (!url) return interaction.reply({ content: t('piggyWeb.noWeb'), ...eph });

    const base = publicBaseUrl();
    const embed = new EmbedBuilder()
      .setColor(0xff7eb6)
      .setTitle(`🐷 ${String(meta.name || `Piggie #${id}`).slice(0, 200)}`)
      .setDescription(String(meta.description || t('piggyWeb.noDesc')).slice(0, 400))
      .setFooter({ text: t('piggyWeb.footer', { id }) });

    const attrs = (Array.isArray(meta.attributes) ? meta.attributes : [])
      .filter((a) => a && (a.trait_type || a.value !== undefined))
      .slice(0, 12)
      .map((a) => ({ name: String(a.trait_type || '—').slice(0, 256), value: String(a.value ?? '—').slice(0, 200) || '—', inline: true }));
    if (attrs.length) embed.addFields(attrs);

    // Vista previa: la imagen del metadato si es una URL; si no, la hoja de sprites alojada en este servicio.
    if (isHttps(meta.image)) embed.setImage(meta.image);
    else if (spriteExists(id)) embed.setImage(`${base}/piggies/sprites/${id}.png`);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(t('piggyWeb.play', { id })),
    );
    return interaction.reply({ embeds: [embed], components: [row] });
  },
};
