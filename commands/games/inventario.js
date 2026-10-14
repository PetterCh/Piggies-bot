// /inventario: UN solo comando sin subcomandos. Muestra el panel interactivo completo (mochila + equipo) y todo se hace con
// sus botones y menús (equipar, desequipar, vender, fusionar). Los componentes (prefijo "inv") son persistentes y comparten
// la lógica de services/inventory.js.
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const User = require('../../models/User');
const config = require('../../config');
const { ITEMS, RARITY_INFO, SELL_PRICE, FUSION, requiredDistinct, isNormal } = require('../../data/gameData');
const inv = require('../../services/inventory');
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

/** Desde los menús de /inventario: aplica el cambio, y redibuja la pantalla en el mismo mensaje con el aviso encima. */
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

// ======================= FUSIÓN =======================
const recipeText = (t, type, rarity) => {
  const r = FUSION[rarity];
  return t('fuse.recipeInfo', {
    type: t(`slotPlural.${type}`), from: t(`rarity.${rarity}`), to: t(`rarity.${r.next}`), count: r.count,
    distinct: requiredDistinct(type, rarity), fee: fmt(r.fee), currency: cur.name, chance: Math.round(r.chance * 100),
  });
};

async function showFuse(interaction) { // botón "Fusionar": elegir receta
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('inventario')
    .setDescription('Tu mochila: equipa, vende y fusiona objetos con botones y menús')
    .setDMPermission(false),

  async execute(interaction) {
    return interaction.reply(await inv.renderInventory(interaction));
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
