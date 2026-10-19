// Eventos globales: automáticos (sorpresa) o programados por un admin. Modifican las expediciones que SALEN mientras están
// activos y reparten objetos únicos (con anuncio y mención en el canal de eventos). Al empezar y al terminar se menciona el
// rol configurado con /set-ping-role tipo:eventos.
const { EmbedBuilder } = require('discord.js');
const GameEvent = require('../models/GameEvent');
const GuildConfig = require('../models/GuildConfig');
const { EVENTS } = require('../data/events');
const { RARITY_INFO } = require('../data/gameData');
const { getGuildConfig, updateGuildConfig } = require('../utils/guildConfig');
const { t, tOr, langForGuild } = require('../utils/i18n');
const { itemLabel, perkText } = require('../utils/itemText');
const { withMedia } = require('../utils/media');
const { randInt, pickRandom } = require('../utils/helpers');
const config = require('../config');

const HOUR = 3600_000;
const cache = new Map(); // guildId -> { value, expires }

/** Evento activo del servidor ({...doc, def}) o null. Con caché corta: se consulta en cada expedición. */
async function getActiveEvent(guildId) {
  const hit = cache.get(guildId);
  if (hit && hit.expires > Date.now() && (!hit.value || hit.value.endsAt > new Date())) return hit.value;
  const doc = await GameEvent.findOne({ guildId, status: 'active', endsAt: { $gt: new Date() } }).lean();
  const value = doc && EVENTS[doc.typeId] ? { ...doc, def: EVENTS[doc.typeId] } : null;
  cache.set(guildId, { value, expires: Date.now() + 15_000 });
  return value;
}
const invalidate = (guildId) => cache.delete(guildId);

const signed = (n) => `${n > 0 ? '+' : n < 0 ? '-' : '±'}${Math.round(Math.abs(n) * 100)}%`;
const effectsText = (L, def) => t(L, 'event.effects', { survival: signed(def.survivalDelta), coins: Math.round(def.coinBonus * 100), chance: Math.round(def.dropChance * 100) });

/** Menciones del anuncio: el rol de eventos (inicio y fin) y, solo al empezar y si está activado, @everyone. */
function pingPayload(cfg, { everyone }) {
  const roleId = cfg.eventsRoleId;
  const useEveryone = everyone && cfg.eventsEveryone;
  const parts = [useEveryone ? '@everyone' : null, roleId ? `<@&${roleId}>` : null].filter(Boolean);
  return { content: parts.join(' ') || undefined, allowedMentions: { parse: useEveryone ? ['everyone'] : [], roles: roleId ? [roleId] : [] } };
}

async function channelOf(client, guildId) {
  const cfg = await getGuildConfig(guildId);
  if (!cfg.eventsChannelId) return { cfg, channel: null };
  const channel = await client.channels.fetch(cfg.eventsChannelId).catch(() => null);
  return { cfg, channel: channel?.isTextBased() ? channel : null };
}

async function announceStart(client, doc) {
  const { cfg, channel } = await channelOf(client, doc.guildId);
  if (!channel) return;
  const def = EVENTS[doc.typeId];
  const L = langForGuild(client.guilds.cache.get(doc.guildId));
  const embed = new EmbedBuilder().setColor(def.color)
    .setTitle(t(L, 'event.startTitle', { emoji: def.emoji, name: t(L, `event.${def.id}.name`) }))
    .setDescription(`${t(L, `event.${def.id}.start`)}\n\n${effectsText(L, def)}\n${t(L, 'event.endsAt', { when: `<t:${Math.floor(doc.endsAt.getTime() / 1000)}:R>` })}`)
    .addFields({ name: t(L, 'event.items'), value: def.items.map((id) => itemLabel(L, id)).join('\n') });
  const { files } = withMedia(embed, [`event.start.${def.id}`, 'event.start']);
  await channel.send({ ...pingPayload(cfg, { everyone: true }), embeds: [embed], files });
}

async function endEvent(client, doc) {
  await GameEvent.updateOne({ _id: doc._id, status: 'active' }, { status: 'ended' });
  invalidate(doc.guildId);
  const { cfg, channel } = await channelOf(client, doc.guildId);
  if (!channel) return;
  const def = EVENTS[doc.typeId];
  const L = langForGuild(client.guilds.cache.get(doc.guildId));
  const embed = new EmbedBuilder().setColor(0x7f8c8d).setDescription(`${def.emoji} ${t(L, `event.${def.id}.end`)}`);
  const { files } = withMedia(embed, [`event.end.${def.id}`, 'event.end']);
  await channel.send({ ...pingPayload(cfg, { everyone: false }), embeds: [embed], files }).catch(() => {});
}

/** Efectos de que un evento pase a estar activo: reprograma el siguiente evento sorpresa y lo anuncia. */
async function afterStart(client, doc) {
  invalidate(doc.guildId);
  const gap = randInt(config.events.minGapHours * 60, config.events.maxGapHours * 60) * 60_000;
  await updateGuildConfig(doc.guildId, { $set: { lastEventType: doc.typeId, nextEventAt: new Date(doc.endsAt.getTime() + gap) } });
  await announceStart(client, doc).catch((e) => console.error('[eventos] anuncio de inicio:', e.message));
}

const durationMs = (def, hours) => Math.round((hours ?? def.minHours + Math.random() * (def.maxHours - def.minHours)) * HOUR);

/** Evento que empieza ahora (automático o forzado por un admin). */
async function startEvent(client, guildId, typeId, { hours = null, forcedBy = null } = {}) {
  const def = EVENTS[typeId];
  if (!def) throw new Error(`Evento desconocido: ${typeId}`);
  const startedAt = new Date();
  const doc = await GameEvent.create({ guildId, typeId, startedAt, endsAt: new Date(startedAt.getTime() + durationMs(def, hours)), forcedBy });
  await afterStart(client, doc);
  return doc;
}

/** Programa un evento para una fecha futura: empieza y termina solo (con sus menciones). */
async function scheduleEvent(guildId, typeId, startsAt, { hours = null, forcedBy = null } = {}) {
  const def = EVENTS[typeId];
  if (!def) throw new Error(`Evento desconocido: ${typeId}`);
  return GameEvent.create({ guildId, typeId, status: 'scheduled', startedAt: startsAt, endsAt: new Date(startsAt.getTime() + durationMs(def, hours)), forcedBy });
}

/** ¿Choca el intervalo [start, end) con un evento activo o programado del servidor? */
const findOverlap = (guildId, start, end) =>
  GameEvent.findOne({ guildId, status: { $in: ['scheduled', 'active'] }, startedAt: { $lt: end }, endsAt: { $gt: start } });

const cancelScheduled = (guildId, id) => GameEvent.findOneAndUpdate({ _id: id, guildId, status: 'scheduled' }, { status: 'cancelled' }, { new: true });

/** Pasa un evento programado a activo (si el bot estuvo apagado y ya terminó, se descarta sin anunciar). */
async function activateScheduled(client, doc) {
  const claimed = await GameEvent.findOneAndUpdate({ _id: doc._id, status: 'scheduled' }, { status: 'active' }, { new: true });
  if (!claimed) return;
  if (claimed.endsAt <= new Date()) return void (await GameEvent.updateOne({ _id: claimed._id }, { status: 'ended' }));
  await afterStart(client, claimed);
}

/** Anuncia un premio de evento mencionando al ganador. */
async function announcePrize(client, exp, itemId) {
  const { channel } = await channelOf(client, exp.guildId);
  if (!channel) return;
  const def = EVENTS[exp.eventId];
  if (!def) return;
  const L = langForGuild(client.guilds.cache.get(exp.guildId));
  const user = `<@${exp.discordId}>`;
  const embed = new EmbedBuilder().setColor(def.color)
    .setTitle(t(L, 'event.prizeTitle', { emoji: def.emoji, name: t(L, `event.${def.id}.name`) }))
    .setDescription(tOr(L, [`event.${def.id}.prize`, 'event.prizeLine'], { user, item: t(L, `item.${itemId}`) }))
    .addFields({ name: RARITY_INFO.event.emoji + ' ' + t(L, 'rarity.event'), value: `${itemLabel(L, itemId)}\n${perkText(L, itemId)}` });
  const { files } = withMedia(embed, [`event.prize.${def.id}`, 'event.prize']);
  await channel.send({ content: user, embeds: [embed], files, allowedMentions: { users: [exp.discordId] } });
}

/** Cada minuto: cierra eventos vencidos, inicia los programados cuya hora llegó y lanza uno sorpresa si toca. */
async function tick(client) {
  const now = new Date();
  for (const doc of await GameEvent.find({ status: 'active', endsAt: { $lte: now } })) {
    await endEvent(client, doc).catch((e) => console.error('[eventos] cierre:', e.message));
  }
  for (const doc of await GameEvent.find({ status: 'scheduled', startedAt: { $lte: now } })) {
    await activateScheduled(client, doc).catch((e) => console.error('[eventos] inicio programado:', e.message));
  }

  const cfgs = await GuildConfig.find({ eventsChannelId: { $ne: null }, eventsEnabled: { $ne: false } }).lean();
  for (const cfg of cfgs) {
    if (!client.guilds.cache.has(cfg.guildId)) continue;
    if (!cfg.nextEventAt) { // primera vez: el primer evento llega entre 2 y 24 h después de configurar el canal
      await updateGuildConfig(cfg.guildId, { $set: { nextEventAt: new Date(Date.now() + randInt(120, 1440) * 60_000) } });
      continue;
    }
    if (cfg.nextEventAt > now) continue;
    // Si hay un evento activo o programado por un admin, el automático espera.
    if (await GameEvent.exists({ guildId: cfg.guildId, status: { $in: ['active', 'scheduled'] } })) continue;
    const types = Object.keys(EVENTS).filter((id) => id !== cfg.lastEventType);
    await startEvent(client, cfg.guildId, pickRandom(types)).catch((e) => console.error('[eventos] inicio:', e.message));
  }
}

module.exports = { getActiveEvent, invalidate, startEvent, scheduleEvent, activateScheduled, cancelScheduled, findOverlap, endEvent, announcePrize, effectsText, tick };
