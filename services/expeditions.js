// Lógica del minijuego "Expediciones de Cerditos": salida, resolución, cancelación y resultado.
const { EmbedBuilder } = require('discord.js');
const User = require('../models/User');
const Expedition = require('../models/Expedition');
const { getUser, logLedger, removeCoinks, addCoinks, InsufficientFundsError } = require('../utils/economy');
const { randInt, pickRandom } = require('../utils/helpers');
const { t, tOr } = require('../utils/i18n');
const { itemLabel } = require('../utils/itemText');
const { withMedia } = require('../utils/media');
const events = require('./events');
const { EVENTS } = require('../data/events');
const { RARITIES, RARITY_INFO, ITEMS, ZONES, SLOTS, MAX_SURVIVAL, CANCEL, rollItemId, gearBonus, perksOf } = require('../data/gameData');

/** Suma "en bruto" de los bonus equipados (solo informativa; la real depende de la zona: ver gearBonus). */
const equipmentBonus = (equipped) => SLOTS.reduce((sum, slot) => sum + (ITEMS[equipped?.[slot]]?.bonus || 0), 0);

/** Probabilidad de sobrevivir en una zona: base + equipo (normal × eficacia de zona + exclusivo) + efecto del evento. */
function computeSurvival(zone, equipped, eventDef = null) {
  return Math.max(0.01, Math.min(MAX_SURVIVAL, zone.baseSurvival + gearBonus(zone, equipped) + (eventDef?.survivalDelta || 0)));
}

function rollRarity(luck) {
  const weights = RARITIES.map((r, i) => RARITY_INFO[r].weight * Math.pow(luck, i));
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < RARITIES.length; i++) {
    roll -= weights[i];
    if (roll < 0) return RARITIES[i];
  }
  return RARITIES[0];
}

/** Sortea el resultado. Coinks = rango de la rareza × rewardMult de la zona × evento × perk de botín. */
function rollOutcome(zone, survivalChance, { perks, event }) {
  let survived = Math.random() < survivalChance;
  let revived = false;
  if (!survived && perks.revive > 0 && Math.random() < perks.revive) { survived = true; revived = true; } // perk "revive"
  if (!survived) return { survived: false, revived: false, coinks: 0, rarity: null, itemId: null, eventItemId: null };

  const rarity = rollRarity(zone.luck);
  const [min, max] = RARITY_INFO[rarity].coinks;
  const coins = randInt(min, max) * zone.rewardMult * (event?.coinMult || 1) * (1 + perks.loot) * (revived ? 0.5 : 1);
  return {
    survived: true, revived, rarity,
    coinks: Math.max(1, Math.round(coins)),
    itemId: Math.random() < zone.dropChance ? rollItemId(rarity) : null,
    eventItemId: event && Math.random() < event.dropChance ? pickRandom(event.items) : null,
  };
}

const getOpenExpedition = (discordId) => Expedition.findOne({ discordId, open: true });

/** Despacha al cerdito fijando el equipo y el evento activo en ese momento. Lanza E11000 si ya hay una abierta. */
async function startExpedition({ discordId, guildId, channelId, zoneId, lang }) {
  const zone = ZONES[zoneId];
  if (!zone) throw new Error('Zona inválida');
  const user = await getUser(discordId);
  const equipped = Object.fromEntries(SLOTS.map((s) => [s, user.piggy.equipped?.[s] ?? null]));
  const active = await events.getActiveEvent(guildId);
  const now = Date.now();
  return Expedition.create({
    discordId, guildId, channelId, zoneId, lang,
    startedAt: new Date(now),
    endsAt: new Date(now + zone.durationMs),
    equipmentSnapshot: equipped,
    eventId: active?.def.id ?? null,
    survivalChance: computeSurvival(zone, equipped, active?.def),
  });
}

async function resolveExpedition(expId) {
  const exp = await Expedition.findOneAndUpdate({ _id: expId, status: 'active', endsAt: { $lte: new Date() } }, { status: 'resolving' }, { new: true });
  if (!exp) return null;

  const zone = ZONES[exp.zoneId];
  const eq = exp.equipmentSnapshot;
  const event = exp.eventId ? EVENTS[exp.eventId] : null;
  const outcome = rollOutcome(zone, exp.survivalChance, { perks: perksOf(eq), event });

  // Desgaste: -1 uso a cada objeto exclusivo equipado (el equipo está bloqueado durante la expedición, así que sigue puesto).
  const user = await User.findOne({ discordId: exp.discordId });
  const set = {};
  const broken = [];
  const usesLeft = [];
  for (const slot of SLOTS) {
    const id = eq?.[slot];
    const it = ITEMS[id];
    if (!it?.maxUses || user?.piggy.equipped?.[slot] !== id) continue;
    const left = (user.piggy.equippedUses?.[slot] ?? it.maxUses) - 1;
    if (left <= 0) {
      set[`piggy.equipped.${slot}`] = null;
      set[`piggy.equippedUses.${slot}`] = null;
      broken.push(id);
    } else {
      set[`piggy.equippedUses.${slot}`] = left;
      usesLeft.push({ id, left });
    }
  }

  const update = { $inc: { 'piggy.stats.expeditions': 1, [outcome.survived ? 'piggy.stats.survived' : 'piggy.stats.deaths']: 1 } };
  if (Object.keys(set).length) update.$set = set;
  if (outcome.survived) {
    update.$inc.coinks = outcome.coinks;
    update.$inc['piggy.stats.totalLoot'] = outcome.coinks;
    const drops = [];
    if (outcome.itemId) drops.push({ itemId: outcome.itemId });
    if (outcome.eventItemId) drops.push({ itemId: outcome.eventItemId, usesLeft: ITEMS[outcome.eventItemId].maxUses });
    if (drops.length) update.$push = { 'piggy.inventory': { $each: drops } }; // un solo $push: dos sobre el mismo campo chocan
  }
  await User.updateOne({ discordId: exp.discordId }, update);
  if (outcome.survived) logLedger({ type: 'expedition', toId: exp.discordId, amount: outcome.coinks, reason: `Expedition: ${exp.zoneId}`, guildId: exp.guildId });

  await Expedition.updateOne(
    { _id: exp._id },
    { status: 'completed', open: false, completedAt: new Date(), result: { survived: outcome.survived, revived: outcome.revived, coinks: outcome.coinks, rarity: outcome.rarity, droppedItem: outcome.itemId, eventItem: outcome.eventItemId, broken } }
  );
  return { exp, outcome: { ...outcome, broken, usesLeft } };
}

const recoverStuckExpeditions = () => Expedition.updateMany({ status: 'resolving' }, { status: 'active' });

// ---------------- CANCELAR ----------------
/** Coste de cancelar: más barato cuanto antes lo hagas (p. ej. porque olvidaste equipar algo). */
function cancelCost(zone, exp, now = Date.now()) {
  const elapsed = Math.max(0, Math.min(1, (now - exp.startedAt.getTime()) / zone.durationMs));
  const factor = CANCEL.minFraction + (1 - CANCEL.minFraction) * elapsed;
  return Math.max(CANCEL.minFee, Math.round(CANCEL.feePerMult * zone.rewardMult * factor));
}

/**
 * Cancela la expedición abierta. Orden seguro: cobrar (atómico) -> marcar cancelada (solo si sigue activa);
 * si ya se resolvió/terminó en ese instante, se devuelve el cobro. El cerdito vuelve sin botín y sin gastar usos.
 */
async function cancelExpedition(discordId, guildId, { dryRun = false } = {}) {
  const exp = await getOpenExpedition(discordId);
  if (!exp) return { ok: false, reason: 'none' };
  if (exp.status !== 'active' || exp.endsAt <= new Date()) return { ok: false, reason: 'finished' };
  const zone = ZONES[exp.zoneId];
  const cost = cancelCost(zone, exp);
  if (dryRun) return { ok: true, exp, zone, cost };

  try {
    await removeCoinks(discordId, cost, { type: 'expedition_cancel', reason: exp.zoneId, guildId });
  } catch (err) {
    if (err instanceof InsufficientFundsError) return { ok: false, reason: 'funds', cost };
    throw err;
  }
  const claimed = await Expedition.findOneAndUpdate(
    { _id: exp._id, status: 'active', endsAt: { $gt: new Date() } },
    { status: 'cancelled', open: false, completedAt: new Date() },
    { new: true }
  );
  if (!claimed) {
    await addCoinks(discordId, cost, { type: 'expedition_cancel_refund', reason: exp.zoneId, guildId });
    return { ok: false, reason: 'finished' };
  }
  return { ok: true, exp: claimed, zone, cost };
}

// ---------------- RESULTADO ----------------
function buildResultEmbed(exp, outcome) {
  const L = exp.lang || 'es';
  const zone = ZONES[exp.zoneId];
  const embed = new EmbedBuilder().setTitle(t(L, 'expedition.return.title', { emoji: zone.emoji, zone: t(L, `zone.${zone.id}.name`) }));
  const event = exp.eventId ? EVENTS[exp.eventId] : null;
  if (event) embed.setFooter({ text: t(L, 'expedition.eventFooter', { emoji: event.emoji, event: t(L, `event.${event.id}.name`) }) });

  const extras = (e) => {
    if (outcome.broken?.length) e.addFields({ name: t(L, 'expedition.return.broken'), value: outcome.broken.map((id) => `🔧 ${itemLabel(L, id)}`).join('\n') });
    if (outcome.usesLeft?.length) e.addFields({ name: t(L, 'expedition.return.uses'), value: outcome.usesLeft.map((u) => itemLabel(L, u.id, u.left)).join('\n') });
  };

  if (!outcome.survived) {
    embed.setColor(0xe74c3c).setDescription(`💀 ${tOr(L, [`expedition.death.${zone.id}`, 'expedition.death.default'])}`);
    extras(embed);
    return { embed, ...withMedia(embed, [`expedition.die.${zone.id}`, 'expedition.die']) };
  }

  const r = RARITY_INFO[outcome.rarity];
  embed.setColor(r.color)
    .setDescription(
      `${tOr(L, [`expedition.survive.${zone.id}`, 'expedition.survive.default'])}\n\n` +
        (outcome.revived ? `${t(L, 'expedition.revived')}\n` : '') +
        t(L, 'expedition.return.loot', { rarity: `${r.emoji} ${t(L, `rarity.${outcome.rarity}`)}` })
    )
    .addFields({ name: t(L, 'expedition.return.coinks'), value: `🪙 +${outcome.coinks.toLocaleString('en-US')}`, inline: true });
  if (outcome.itemId) embed.addFields({ name: t(L, 'expedition.return.item'), value: itemLabel(L, outcome.itemId), inline: true });
  if (outcome.eventItemId) embed.addFields({ name: `${RARITY_INFO.event.emoji} ${t(L, 'expedition.return.eventItem')}`, value: itemLabel(L, outcome.eventItemId, ITEMS[outcome.eventItemId].maxUses) });
  extras(embed);
  return { embed, ...withMedia(embed, [`expedition.survive.${zone.id}.${outcome.rarity}`, `expedition.survive.${zone.id}`, `expedition.survive.${outcome.rarity}`, 'expedition.survive']) };
}

async function notifyResult(client, exp, outcome) {
  const { embed, files } = buildResultEmbed(exp, outcome);
  const payload = { content: `<@${exp.discordId}>`, embeds: [embed], files, allowedMentions: { users: [exp.discordId] } };
  try {
    const channel = await client.channels.fetch(exp.channelId);
    await channel.send(payload);
  } catch {
    const user = await client.users.fetch(exp.discordId).catch(() => null);
    await user?.send({ embeds: [embed], files }).catch(() => {});
  }
  // Premio de evento: anuncio público con mención en el canal de eventos.
  if (outcome.eventItemId) await events.announcePrize(client, exp, outcome.eventItemId).catch((e) => console.error('[eventos] anuncio de premio:', e.message));
}

module.exports = {
  equipmentBonus, computeSurvival, rollOutcome, getOpenExpedition, startExpedition, resolveExpedition,
  recoverStuckExpeditions, cancelCost, cancelExpedition, notifyResult,
};
