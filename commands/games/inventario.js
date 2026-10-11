// /inventario: TODO lo de la mochila en un solo sitio — ver, equipar, desequipar, vender, fusionar y recetas.
// Los botones/menús (prefijo "inv") son persistentes y comparten la lógica de services/inventory.js con los subcomandos.
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const User = require('../../models/User');
const config = require('../../config');
const { ITEMS, RARITY_INFO, RARITIES, SELL_PRICE, FUSION, requiredDistinct, isNormal } = require('../../data/gameData');
const inv = require('../../services/inventory');
const { getOpenExpedition } = require('../../services/expeditions');
const { getUser } = require('../../utils/economy');
const { askConfirmation } = require('../../utils/confirm');
const { itemLabel } = require('../../utils/itemText');
const { fmt } = require('../../utils/helpers');

const eph = { flags: MessageFlags.Ephemeral };
const cur = config.currency;
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const cancelBtn = (t) => new ButtonBuilder().setCustomId('inv:cancel').setStyle(ButtonStyle.Secondary).setLabel(t('common.cancel'));

// ======================= EQUIPAR / DESEQUIPAR =======================
// La lógica vive en services/inventory.js (equipItem / unequip); aquí solo se arman los mensajes.
const equipMessage = (t, L, res) => {
  if (!res.ok) return t(res.reason === 'locked' ? 'equip.locked' : res.reason === 'unknown' ? 'equip.unknown' : res.reason === 'missing' ? 'equip.missing' : 'equip.fail');
  return t('equip.done', { item: itemLabel(L, res.itemId, res.usesLeft), back: res.previous ? t('equip.back', { item: itemLabel(L, res.previous) }) : '' });
};
const unequipMessage = (t, L, res) => {
  if (!res.ok) return t(res.reason === 'locked' ? 'equip.locked' : res.reason === 'nothing' ? 'unequip.nothing' : 'unequip.unknown');
  return t('unequip.done', { items: res.removed.map((id) => itemLabel(L, id)).join(', ') });
};

async function equip(interaction) {
  const res = await inv.equipItem(interaction.user.id, interaction.options.getString('objeto', true));
  return interaction.reply({ content: equipMessage(interaction.t, interaction.lang, res), ...eph });
}

async function unequipCommand(interaction) {
  const res = await inv.unequip(interaction.user.id, interaction.options.getString('ranura') || 'all');
  return interaction.reply({ content: unequipMessage(interaction.t, interaction.lang, res), ...eph });
}

/** Desde los menús de /inventario ver: aplica el cambio, y redibuja la pantalla en el mismo mensaje con el aviso encima. */
async function equipFromMenu(interaction, res, message) {
  const { flags, ...view } = await inv.renderInventory(interaction); // update() no admite flags
  return interaction.update({ ...view, content: message });
}

// ======================= VENTA =======================
async function showSell(interaction) { // botón "Vender": menú con los objetos vendibles
  const t = interaction.t;
  const user = await User.findOne({ discordId: interaction.user.id }).lean();
  const counts = inv.countByItem(user || { piggy: { inventory: [] } });
  const ids = Object.keys(counts).filter((id) => ITEMS[id].sellable !== false).sort((a, b) => inv.rankOf(b) - inv.rankOf(a)).slice(0, 25);
  if (!ids.length) return interaction.reply({ content: t('sell.none'), ...eph });
  const menu = new StringSelectMenuBuilder().setCustomId('inv:sellItem').setPlaceholder(t('sell.placeholder'))
    .addOptions(ids.map((id) => ({
      label: `${t(`item.${id}`)} x${counts[id]}`.slice(0, 100),
      description: t('sell.optionDesc', { price: fmt(SELL_PRICE[ITEMS[id].rarity]), currency: cur.name }).slice(0, 100),
      value: id,
    })));
  return interaction.reply({ content: t('sell.pick'), components: [row(menu)], ...eph });
}

async function sellDetail(interaction, itemId) {
  const t = interaction.t;
  const item = ITEMS[itemId];
  if (!item || item.sellable === false) return interaction.update({ content: t('sell.notSellable'), components: [] });
  const user = await User.findOne({ discordId: interaction.user.id }).lean();
  const count = (user?.piggy.inventory || []).filter((i) => i.itemId === itemId).length;
  if (!count) return interaction.update({ content: t('sell.fail'), components: [] });
  const price = SELL_PRICE[item.rarity];
  const buttons = [new ButtonBuilder().setCustomId(`inv:sellGo:${itemId}:1`).setStyle(ButtonStyle.Success).setLabel(t('sell.btnOne', { price: fmt(price) }))];
  if (count > 1) buttons.push(new ButtonBuilder().setCustomId(`inv:sellGo:${itemId}:all`).setStyle(ButtonStyle.Danger).setLabel(t('sell.btnAll', { count, total: fmt(price * count) })));
  return interaction.update({
    content: t('sell.detail', { item: itemLabel(interaction.lang, itemId), price: fmt(price), emoji: cur.emoji, count }),
    components: [row(...buttons, cancelBtn(t))],
  });
}

async function doSell(interaction, itemId, qty) {
  const t = interaction.t;
  const res = await inv.sellItems(interaction.user.id, itemId, qty);
  if (!res.ok) return interaction.update({ content: t('sell.fail'), components: [] });
  return interaction.update({ content: t('sell.done', { n: res.n, item: itemLabel(interaction.lang, itemId), total: fmt(res.total), emoji: cur.emoji, balance: fmt(res.balance) }), components: [] });
}

/** /inventario vender objeto:… [cantidad] [todos]: atajo por comando (con confirmación). */
async function sellCommand(interaction) {
  const t = interaction.t;
  await interaction.deferReply(eph);
  const itemId = interaction.options.getString('objeto', true);
  const item = ITEMS[itemId];
  if (!item) return interaction.editReply(t('equip.unknown'));
  if (item.sellable === false) return interaction.editReply(t('sell.notSellable'));
  const user = await User.findOne({ discordId: interaction.user.id }).lean();
  const have = (user?.piggy.inventory || []).filter((i) => i.itemId === itemId).length;
  if (!have) return interaction.editReply(t('sell.fail'));
  const all = interaction.options.getBoolean('todos');
  const n = all ? have : Math.min(interaction.options.getInteger('cantidad') ?? 1, have);
  const ok = await askConfirmation(interaction, {
    content: t('sell.confirmSlash', { n, item: itemLabel(interaction.lang, itemId), total: fmt(SELL_PRICE[item.rarity] * n), emoji: cur.emoji }),
  });
  if (!ok) return;
  const res = await inv.sellItems(interaction.user.id, itemId, all ? 'all' : n);
  if (!res.ok) return interaction.editReply(t('sell.fail'));
  return interaction.editReply(t('sell.done', { n: res.n, item: itemLabel(interaction.lang, itemId), total: fmt(res.total), emoji: cur.emoji, balance: fmt(res.balance) }));
}

// ======================= FUSIÓN =======================
const recipeText = (t, type, rarity) => {
  const r = FUSION[rarity];
  return t('fuse.recipeInfo', {
    type: t(`slotPlural.${type}`), from: t(`rarity.${rarity}`), to: t(`rarity.${r.next}`), count: r.count,
    distinct: requiredDistinct(type, rarity), fee: fmt(r.fee), currency: cur.name, chance: Math.round(r.chance * 100),
  });
};

async function showFuse(interaction) { // botón "Fusionar" o /inventario fusionar: elegir receta
  const t = interaction.t;
  const user = await User.findOne({ discordId: interaction.user.id });
  const recipes = user ? inv.availableRecipes(user) : [];
  if (!recipes.length) return interaction.reply({ content: t('fuse.none'), ...eph });
  const menu = new StringSelectMenuBuilder().setCustomId('inv:fuseCat').setPlaceholder(t('fuse.placeholderCat'))
    .addOptions(recipes.slice(0, 25).map(({ type, rarity, recipe, copies }) => ({
      label: t('fuse.catLabel', { type: t(`slotPlural.${type}`), from: t(`rarity.${rarity}`), to: t(`rarity.${recipe.next}`) }).slice(0, 100),
      description: t('fuse.catDesc', { have: copies.length, need: recipe.count, fee: fmt(recipe.fee), chance: Math.round(recipe.chance * 100) }).slice(0, 100),
      value: `${type}:${rarity}`,
    })));
  return interaction.reply({ content: t('fuse.pickCategory'), components: [row(menu)], ...eph });
}

async function fuseItemsMenu(interaction, value) { // elegir exactamente N copias
  const t = interaction.t;
  const [type, rarity] = value.split(':');
  const recipe = FUSION[rarity];
  const user = await User.findOne({ discordId: interaction.user.id });
  const copies = (user?.piggy.inventory || []).filter((i) => isNormal(i.itemId) && ITEMS[i.itemId].type === type && ITEMS[i.itemId].rarity === rarity);
  if (!recipe || copies.length < recipe.count) return interaction.update({ content: t('fuse.errors.items'), components: [] });
  const shown = inv.pickDisplayCopies(copies);
  const menu = new StringSelectMenuBuilder().setCustomId(`inv:fuseItems:${type}:${rarity}`).setPlaceholder(t('fuse.placeholderItems', { count: recipe.count }))
    .setMinValues(recipe.count).setMaxValues(Math.min(recipe.count, shown.length))
    .addOptions(shown.map((c) => ({ label: `${t(`item.${c.itemId}`)} (+${Math.round(ITEMS[c.itemId].bonus * 100)}%)`.slice(0, 100), value: String(c._id) })));
  return interaction.update({ content: `${recipeText(t, type, rarity)}\n\n${t('fuse.pickItems', { count: recipe.count })}`, components: [row(menu)] });
}

async function fuseConfirm(interaction, type, rarity, values) { // validar y pedir confirmación
  const t = interaction.t;
  const check = await inv.fuse(interaction.user.id, values, type, rarity, { dryRun: true });
  if (!check.ok) return interaction.update({ content: t(`fuse.errors.${check.reason}`, { distinct: requiredDistinct(type, rarity), fee: fmt(FUSION[rarity]?.fee || 0) }), components: [] });
  const token = inv.putPending({ userId: interaction.user.id, ids: values, type, rarity });
  const r = FUSION[rarity];
  return interaction.update({
    content: `${recipeText(t, type, rarity)}\n\n${t('fuse.confirm', { count: r.count, type: t(`slotPlural.${type}`), from: t(`rarity.${rarity}`), fee: fmt(r.fee), currency: cur.name, chance: Math.round(r.chance * 100), consolation: 50 })}`,
    components: [row(new ButtonBuilder().setCustomId(`inv:fuseGo:${token}`).setStyle(ButtonStyle.Success).setEmoji('⚗️').setLabel(t('fuse.btnGo')), cancelBtn(t))],
  });
}

async function doFuse(interaction, token) { // ejecutar
  const t = interaction.t;
  const p = inv.takePending(token, interaction.user.id);
  if (!p) return interaction.update({ content: t('fuse.expired'), components: [] });
  const res = await inv.fuse(interaction.user.id, p.ids, p.type, p.rarity);
  if (!res.ok) return interaction.update({ content: t(`fuse.errors.${res.reason}`, { distinct: requiredDistinct(p.type, p.rarity), fee: fmt(FUSION[p.rarity]?.fee || 0) }), components: [] });
  const r = FUSION[p.rarity];
  if (res.success) {
    const embed = new EmbedBuilder().setColor(RARITY_INFO[r.next].color).setTitle(t('fuse.successTitle'))
      .setDescription(t('fuse.successDesc', { count: r.count, type: t(`slotPlural.${p.type}`), from: t(`rarity.${p.rarity}`), item: itemLabel(interaction.lang, res.itemId) }));
    return interaction.update({ content: '', embeds: [embed], components: [] });
  }
  const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle(t('fuse.failTitle')).setDescription(t('fuse.failDesc', { count: r.count, coins: fmt(res.consolation), emoji: cur.emoji }));
  return interaction.update({ content: '', embeds: [embed], components: [] });
}

// ======================= RECETAS =======================
function recipes(interaction) {
  const t = interaction.t;
  const prices = RARITIES.map((r) => `${RARITY_INFO[r].emoji} ${t(`rarity.${r}`)}: **${fmt(SELL_PRICE[r])}** ${cur.emoji}`).join('\n');
  const lines = Object.entries(FUSION).map(([r, f]) => t('fuse.recipeLine', {
    from: `${RARITY_INFO[r].emoji} ${t(`rarity.${r}`)}`, to: `${RARITY_INFO[f.next].emoji} ${t(`rarity.${f.next}`)}`,
    count: f.count, distinct: f.distinct, fee: fmt(f.fee), currency: cur.name, chance: Math.round(f.chance * 100),
  })).join('\n');
  const embed = new EmbedBuilder().setColor(0x9b59b6).setTitle(t('fuse.recipesTitle')).setDescription(t('fuse.recipesIntro'))
    .addFields({ name: t('fuse.sellPrices'), value: prices }, { name: t('fuse.recipes'), value: lines }, { name: '\u200b', value: t('fuse.recipesFooter', { pct: 50 }) });
  return interaction.reply({ embeds: [embed], ...eph });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventario')
    .setDescription('Tu mochila: ver, equipar, desequipar, vender y fusionar objetos')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('ver').setDescription('Mira tu mochila y tu equipo (con botones de vender y fusionar)'))
    .addSubcommand((s) => s.setName('equipar').setDescription('Equipa un arma, armadura o casco')
      .addStringOption((o) => o.setName('objeto').setDescription('Objeto a equipar').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('desequipar').setDescription('Quita un objeto equipado y lo devuelve a la mochila')
      .addStringOption((o) => o.setName('ranura').setDescription('Qué quitar (por defecto, todo)')
        .addChoices({ name: 'Arma / Weapon', value: 'weapon' }, { name: 'Armadura / Armor', value: 'armor' }, { name: 'Casco / Helmet', value: 'helmet' }, { name: 'Todo / All', value: 'all' })))
    .addSubcommand((s) => s.setName('vender').setDescription('Vende objetos sobrantes a cambio de Coinks')
      .addStringOption((o) => o.setName('objeto').setDescription('Objeto a vender').setRequired(true).setAutocomplete(true))
      .addIntegerOption((o) => o.setName('cantidad').setDescription('Cuántos (por defecto 1)').setMinValue(1).setMaxValue(500))
      .addBooleanOption((o) => o.setName('todos').setDescription('Vender todos los de ese modelo')))
    .addSubcommand((s) => s.setName('fusionar').setDescription('Combina objetos del mismo tipo y rareza para subirlos de tier'))
    .addSubcommand((s) => s.setName('recetas').setDescription('Precios de venta y recetas de fusión')),

  // Autocompletado: equipar = todo lo que tienes; vender = solo lo vendible.
  async autocomplete(interaction) {
    const t = interaction.t;
    const sellOnly = interaction.options.getSubcommand() === 'vender';
    const focused = String(interaction.options.getFocused()).toLowerCase();
    const user = await User.findOne({ discordId: interaction.user.id }).lean();
    const groups = {};
    for (const it of user?.piggy?.inventory ?? []) {
      if (!ITEMS[it.itemId] || (sellOnly && ITEMS[it.itemId].sellable === false)) continue;
      const g = (groups[it.itemId] ||= { n: 0, uses: -1 });
      g.n++;
      g.uses = Math.max(g.uses, it.usesLeft ?? -1);
    }
    const choices = Object.entries(groups)
      .filter(([id]) => t(`item.${id}`).toLowerCase().includes(focused))
      .sort((a, b) => inv.rankOf(b[0]) - inv.rankOf(a[0]))
      .slice(0, 25)
      .map(([id, g]) => ({
        name: `${t(`item.${id}`)} · ${t(`slot.${ITEMS[id].type}`)} +${Math.round(ITEMS[id].bonus * 100)}%${ITEMS[id].maxUses ? ` · 🔁${g.uses}/${ITEMS[id].maxUses}` : ''}${sellOnly ? ` · ${fmt(SELL_PRICE[ITEMS[id].rarity])}${cur.emoji}` : ''} (x${g.n})`.slice(0, 100),
        value: id,
      }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    switch (interaction.options.getSubcommand()) {
      case 'ver': return interaction.reply(await inv.renderInventory(interaction));
      case 'equipar': return equip(interaction);
      case 'desequipar': return unequipCommand(interaction);
      case 'vender': return sellCommand(interaction);
      case 'fusionar': return showFuse(interaction);
      case 'recetas': return recipes(interaction);
    }
  },

  components: [
    {
      kind: 'button', prefix: 'inv',
      async execute(interaction, args) {
        const [action, a, b] = args;
        if (action === 'sell') return showSell(interaction);
        if (action === 'fuse') return showFuse(interaction);
        if (action === 'sellGo') return doSell(interaction, a, b);
        if (action === 'fuseGo') return doFuse(interaction, a);
        if (action === 'cancel') return interaction.update({ content: interaction.t('common.cancelled'), embeds: [], components: [] });
      },
    },
    {
      kind: 'select', prefix: 'inv',
      async execute(interaction, args) {
        const [action, a, b] = args;
        if (action === 'equipSel') {
          const res = await inv.equipItem(interaction.user.id, interaction.values[0]);
          return equipFromMenu(interaction, res, equipMessage(interaction.t, interaction.lang, res));
        }
        if (action === 'unequipSel') {
          const res = await inv.unequip(interaction.user.id, interaction.values[0]);
          return equipFromMenu(interaction, res, unequipMessage(interaction.t, interaction.lang, res));
        }
        if (action === 'sellItem') return sellDetail(interaction, interaction.values[0]);
        if (action === 'fuseCat') return fuseItemsMenu(interaction, interaction.values[0]);
        if (action === 'fuseItems') return fuseConfirm(interaction, a, b, interaction.values);
      },
    },
  ],
};
