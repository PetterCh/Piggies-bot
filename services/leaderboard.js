// "Liga de Ballenas del Chiquero": Top 10 por Coinks (desempate: expediciones), exclusiones y temporadas mensuales (rol Top 3).
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const User = require('../models/User');
const GuildConfig = require('../models/GuildConfig');
const LootboxLog = require('../models/LootboxLog');
const Expedition = require('../models/Expedition');
const config = require('../config');
const { getGuildConfig, updateGuildConfig } = require('../utils/guildConfig');
const { t, langForGuild } = require('../utils/i18n');
const { fmt } = require('../utils/helpers');

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];
const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
const BATCH = 50;
const MAX_BATCHES = 6; // mira hasta 300 cuentas para completar el Top (por si hay muchas excluidas o que salieron del servidor)

/** IDs que no compiten: lista del .env + los añadidos con /leaderboard-admin excluir. */
const excludedIds = (cfg) => [...new Set([...config.leaderboard.blacklistIds, ...(cfg.lbExcludedIds || [])])];

/** Clave de mes "2026-10" en la zona horaria configurada. `offset` = meses hacia atrás. */
function seasonKey(date = new Date(), offset = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.leaderboard.timezone, year: 'numeric', month: '2-digit' }).formatToParts(date);
  let y = Number(parts.find((p) => p.type === 'year').value);
  let m = Number(parts.find((p) => p.type === 'month').value) - offset;
  while (m < 1) { m += 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Los mejores `limit` jugadores que SIGUEN en el servidor, no son bots y no están excluidos.
 * Devuelve [{ id, coinks, exp }].
 */
async function computeTop(guild, cfg, limit = config.leaderboard.size) {
  const skipIds = excludedIds(cfg);
  const out = [];
  for (let b = 0; b < MAX_BATCHES && out.length < limit; b++) {
    const docs = await User.find({ discordId: { $nin: skipIds } })
      .sort({ coinks: -1, 'piggy.stats.expeditions': -1, _id: 1 }).skip(b * BATCH).limit(BATCH)
      .select('discordId coinks piggy.stats.expeditions').lean();
    if (!docs.length) break;
    const ids = docs.map((d) => d.discordId);
    let members = guild.members.cache;
    const missing = ids.filter((id) => !members.has(id));
    if (missing.length) members = await guild.members.fetch({ user: missing }).then((got) => got.concat(guild.members.cache)).catch(() => guild.members.cache);
    for (const d of docs) {
      const m = members.get(d.discordId);
      if (!m || m.user.bot) continue;
      out.push({ id: d.discordId, coinks: d.coinks || 0, exp: d.piggy?.stats?.expeditions || 0 });
      if (out.length >= limit) break;
    }
  }
  return out;
}


// ---------------- MÉTRICAS: SUERTE Y CONSTANCIA ----------------
const HIT_RARITIES = ['epic', 'legendary'];
const MIN_ATTEMPTS = 5; // con menos intentos no se puede estimar la suerte
const SMOOTH_K = 10; // "intentos virtuales" con el promedio del servidor: evita que 1 acierto en 1 intento dé 99 %
const STREAK_LOOKBACK_DAYS = 400;
let baseCache = { p0: null, expires: 0 };

// Un "intento" = una apertura de caja o una expedición completada. Un "acierto" = premio Épico/Legendario (o NFT).
const lootHit = { $cond: [{ $or: [{ $eq: ['$type', 'nft'] }, { $in: ['$rarity', HIT_RARITIES] }] }, 1, 0] };
const expHit = { $cond: [{ $in: ['$result.rarity', HIT_RARITIES] }, 1, 0] };

/** Probabilidad media de acierto en TODO el servidor (la referencia del 50 %). Caché de 10 min. */
async function baseRate() {
  if (baseCache.expires > Date.now()) return baseCache.p0;
  const [a] = await LootboxLog.aggregate([{ $group: { _id: null, n: { $sum: 1 }, hits: { $sum: lootHit } } }]);
  const [b] = await Expedition.aggregate([{ $match: { status: 'completed' } }, { $group: { _id: null, n: { $sum: 1 }, hits: { $sum: expHit } } }]);
  const n = (a?.n || 0) + (b?.n || 0);
  const hits = (a?.hits || 0) + (b?.hits || 0);
  const p0 = n >= 50 && hits > 0 ? hits / n : 0.1; // sin datos suficientes, un valor razonable
  baseCache = { p0, expires: Date.now() + 10 * 60_000 };
  return p0;
}

/**
 * Índice de suerte 1–99 %. Compara la tasa de aciertos del jugador (suavizada) con la media del servidor:
 * igual a la media = 50 %; el doble = 67 %; el triple = 75 %; la mitad = 33 %. null si hay pocos intentos.
 */
function luckScore(hits, attempts, p0) {
  if (attempts < MIN_ATTEMPTS) return null;
  const p = (hits + p0 * SMOOTH_K) / (attempts + SMOOTH_K);
  const r = p / p0;
  return Math.max(1, Math.min(99, Math.round((100 * r) / (r + 1))));
}

const dayStr = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: config.leaderboard.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const prevDay = (s) => new Date(Date.parse(`${s}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/** Días seguidos jugando. La racha sigue viva si hoy aún no jugaste pero ayer sí. */
function streakFrom(days, today) {
  let cur = days.has(today) ? today : prevDay(today);
  let n = 0;
  while (days.has(cur)) { n++; cur = prevDay(cur); }
  return n;
}

const luckTier = (pct) => (pct >= 85 ? 1 : pct >= 65 ? 2 : pct >= 40 ? 3 : pct >= 20 ? 4 : 5);
const streakTier = (n) => (n >= 14 ? 4 : n >= 7 ? 3 : n >= 3 ? 2 : n >= 1 ? 1 : 0);

/** Suerte y constancia de varios jugadores a la vez (3-4 consultas agregadas en total). Devuelve Map id -> { luck, attempts, streak }. */
async function getProfiles(ids) {
  const out = new Map(ids.map((id) => [id, { luck: null, attempts: 0, streak: 0 }]));
  if (!ids.length) return out;
  const tz = config.leaderboard.timezone;
  const since = new Date(Date.now() - STREAK_LOOKBACK_DAYS * 86_400_000);
  const day = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });
  const [p0, loot, exps, lootDays, expDays] = await Promise.all([
    baseRate(),
    LootboxLog.aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: '$userId', n: { $sum: 1 }, hits: { $sum: lootHit } } }]),
    Expedition.aggregate([{ $match: { discordId: { $in: ids }, status: 'completed' } }, { $group: { _id: '$discordId', n: { $sum: 1 }, hits: { $sum: expHit } } }]),
    LootboxLog.aggregate([{ $match: { userId: { $in: ids }, createdAt: { $gte: since } } }, { $group: { _id: { u: '$userId', d: day('$createdAt') } } }]),
    Expedition.aggregate([{ $match: { discordId: { $in: ids }, status: { $ne: 'cancelled' }, startedAt: { $gte: since } } }, { $group: { _id: { u: '$discordId', d: day('$startedAt') } } }]),
  ]);
  const tally = new Map(ids.map((id) => [id, { n: 0, hits: 0 }]));
  for (const r of [...loot, ...exps]) { const t0 = tally.get(r._id); if (t0) { t0.n += r.n; t0.hits += r.hits; } }
  const days = new Map(ids.map((id) => [id, new Set()]));
  for (const r of [...lootDays, ...expDays]) days.get(r._id.u)?.add(r._id.d);
  const today = dayStr(new Date());
  for (const id of ids) {
    const { n, hits } = tally.get(id);
    out.set(id, { luck: luckScore(hits, n, p0), attempts: n, streak: streakFrom(days.get(id), today) });
  }
  return out;
}

/** Textos de las dos métricas ya localizados. */
function metricLines(L, prof) {
  const luck = prof.luck == null
    ? t(L, 'leaderboard.luckNone')
    : t(L, 'leaderboard.luckLine', { icon: prof.luck >= 50 ? '🍀' : '📉', pct: prof.luck, label: t(L, `leaderboard.luck${luckTier(prof.luck)}`) });
  const unit = t(L, prof.streak === 1 ? 'leaderboard.day' : 'leaderboard.days');
  const streak = t(L, 'leaderboard.streakLine', { icon: prof.streak ? '🔥' : '🧊', n: prof.streak, unit, label: t(L, `leaderboard.streak${streakTier(prof.streak)}`) });
  return { luck, streak, unit };
}

/** Embed + botones del panel. */
async function buildPanel(guild, cfg) {
  const L = langForGuild(guild);
  const top = await computeTop(guild, cfg);
  const profiles = await getProfiles(top.map((p) => p.id)).catch((e) => { console.error('[leaderboard] métricas:', e.message); return new Map(); });
  const list = top.length
    ? top.map((p, i) => t(L, 'leaderboard.entry', {
      medal: MEDALS[i], rank: i + 1, user: `<@${p.id}>`, coinks: fmt(p.coinks), exp: fmt(p.exp),
      ...metricLines(L, profiles.get(p.id) || { luck: null, attempts: 0, streak: 0 }),
      tag: i < 3 ? ` — ${t(L, `leaderboard.tag${i + 1}`)}` : '',
    })).join('\n')
    : t(L, 'leaderboard.empty');
  const embed = new EmbedBuilder().setColor(0xf1c40f)
    .setTitle(t(L, 'leaderboard.title'))
    .setDescription(t(L, 'leaderboard.desc', { list }))
    .addFields(
      { name: t(L, 'leaderboard.prizeName'), value: cfg.lbRoleId ? t(L, 'leaderboard.prize', { role: `<@&${cfg.lbRoleId}>` }) : t(L, 'leaderboard.prizeNone') },
      { name: '\u200b', value: `*${t(L, 'leaderboard.metricsNote')}*` }
    )
    .setFooter({ text: t(L, 'leaderboard.footer', { season: seasonKey(), min: config.leaderboard.refreshMinutes }) })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('lbd:refresh').setStyle(ButtonStyle.Secondary).setEmoji('🔄').setLabel(t(L, 'leaderboard.btnRefresh')),
    new ButtonBuilder().setCustomId('lbd:me').setStyle(ButtonStyle.Primary).setEmoji('🐷').setLabel(t(L, 'leaderboard.btnMe'))
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

/** Publica el panel (o edita el existente si el canal es el mismo). Devuelve el mensaje o null si el canal no sirve. */
async function publishPanel(client, guildId, channelId) {
  const cfg = await getGuildConfig(guildId);
  const guild = client.guilds.cache.get(guildId);
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!guild || !channel?.isTextBased() || !channel.permissionsFor(guild.members.me)?.has(NEEDED)) return null;
  const payload = await buildPanel(guild, cfg);

  if (cfg.lbMessageId && cfg.lbChannelId) {
    const oldCh = await client.channels.fetch(cfg.lbChannelId).catch(() => null);
    if (oldCh && oldCh.id === channel.id) {
      const msg = await oldCh.messages.fetch(cfg.lbMessageId).catch(() => null);
      if (msg) return msg.edit(payload);
    } else if (oldCh) {
      await oldCh.messages.delete(cfg.lbMessageId).catch(() => {});
    }
  }
  const msg = await channel.send(payload);
  await updateGuildConfig(guildId, { $set: { lbChannelId: channel.id, lbMessageId: msg.id } });
  return msg;
}

async function removePanel(client, guildId) {
  const cfg = await getGuildConfig(guildId);
  if (cfg.lbMessageId && cfg.lbChannelId) {
    const ch = await client.channels.fetch(cfg.lbChannelId).catch(() => null);
    await ch?.messages.delete(cfg.lbMessageId).catch(() => {});
  }
  await updateGuildConfig(guildId, { $set: { lbChannelId: null, lbMessageId: null } });
}

/** Refresco automático de todos los paneles (cada pocos minutos). */
async function refreshAll(client) {
  const cfgs = await GuildConfig.find({ lbMessageId: { $ne: null }, lbChannelId: { $ne: null } }).lean();
  for (const cfg of cfgs) {
    try {
      const guild = client.guilds.cache.get(cfg.guildId);
      const ch = await client.channels.fetch(cfg.lbChannelId).catch(() => null);
      const msg = ch ? await ch.messages.fetch(cfg.lbMessageId).catch(() => null) : null;
      if (!guild || !msg) continue;
      await msg.edit(await buildPanel(guild, cfg));
    } catch (e) { console.error('[leaderboard] refresco:', e.message); }
  }
}

/** Puesto de un usuario: exacto si está en el Top 100, aproximado (conteo en BD) si no. null = sin cuenta. */
async function myRank(guild, cfg, userId) {
  const doc = await User.findOne({ discordId: userId }).select('coinks piggy.stats.expeditions').lean();
  if (!doc) return { none: true };
  if (excludedIds(cfg).includes(userId)) return { excluded: true };
  const coinks = doc.coinks || 0;
  const exp = doc.piggy?.stats?.expeditions || 0;
  const top = await computeTop(guild, cfg, 100);
  const idx = top.findIndex((p) => p.id === userId);
  if (idx >= 0) return { rank: idx + 1, coinks, exp, approx: false };
  const ahead = await User.countDocuments({ coinks: { $gt: coinks }, discordId: { $nin: excludedIds(cfg) } });
  return { rank: ahead + 1, coinks, exp, approx: true };
}

/**
 * Cierra la temporada: entrega el rol a los 3 primeros, se lo quita a quien bajó y lo anuncia.
 * `season` = clave del mes que termina. `manual` = lanzado por un admin (no toca lbLastSeason).
 * Los Coinks NO se reinician: el rol es el premio del mes, la tabla es acumulada.
 */
async function closeSeason(client, guildId, { season, manual = false } = {}) {
  const cfg = await getGuildConfig(guildId);
  const guild = client.guilds.cache.get(guildId);
  const res = { winners: [], warnings: [] };
  if (!guild || !cfg.lbRoleId) return res;
  const L = langForGuild(guild);
  season = season || seasonKey(new Date(), 1);

  const role = await guild.roles.fetch(cfg.lbRoleId).catch(() => null);
  const top = await computeTop(guild, cfg, 3);
  res.winners = top;
  const winnerIds = top.map((p) => p.id);

  if (!role) res.warnings.push(t(L, 'leaderboard.warnRoleMissing'));
  else {
    // Quién tiene el rol ahora: los ganadores guardados + los miembros que lo tengan en caché.
    await guild.members.fetch().catch(() => {});
    const holders = new Set([...(cfg.lbWinnerIds || []), ...role.members.keys()]);
    for (const id of holders) {
      if (winnerIds.includes(id)) continue;
      const m = guild.members.cache.get(id) || (await guild.members.fetch(id).catch(() => null));
      if (m?.roles.cache.has(role.id) && !(await m.roles.remove(role, 'Leaderboard: bajó del Top 3').then(() => true).catch(() => false))) res.roleError = true;
    }
    for (const id of winnerIds) {
      const m = guild.members.cache.get(id);
      if (m && !m.roles.cache.has(role.id) && !(await m.roles.add(role, `Leaderboard: Top 3 de ${season}`).then(() => true).catch(() => false))) res.roleError = true;
    }
    if (res.roleError) res.warnings.push(t(L, 'leaderboard.warnRole'));
  }

  // Anuncio en el canal de eventos (o en el del panel).
  const channelId = cfg.eventsChannelId || cfg.lbChannelId;
  const ch = channelId ? await client.channels.fetch(channelId).catch(() => null) : null;
  if (!ch?.isTextBased() || !ch.permissionsFor(guild.members.me)?.has(NEEDED)) res.warnings.push(t(L, 'leaderboard.warnAnnounce'));
  else {
    const list = top.length
      ? top.map((p, i) => t(L, 'leaderboard.annEntry', { medal: MEDALS[i], user: `<@${p.id}>`, coinks: fmt(p.coinks), exp: fmt(p.exp) })).join('\n')
      : t(L, 'leaderboard.annNobody');
    const embed = new EmbedBuilder().setColor(0xf1c40f)
      .setTitle(t(L, 'leaderboard.annTitle', { season }))
      .setDescription(`${t(L, 'leaderboard.annDesc', { list })}${role && top.length ? `\n\n${t(L, 'leaderboard.annRole', { role: `<@&${role.id}>` })}` : ''}`)
      .setFooter({ text: t(L, 'leaderboard.annFooter') }).setTimestamp();
    await ch.send({ embeds: [embed], allowedMentions: { users: winnerIds, roles: [] } }).catch(() => res.warnings.push(t(L, 'leaderboard.warnAnnounce')));
  }

  const $set = { lbWinnerIds: winnerIds };
  if (!manual) $set.lbLastSeason = season;
  await updateGuildConfig(guildId, { $set });
  return res;
}

/** Cierra el mes anterior en los servidores a los que les toca (también recupera cierres perdidos si el bot estuvo apagado). */
async function closeDue(client) {
  const prev = seasonKey(new Date(), 1);
  const cfgs = await GuildConfig.find({ lbRoleId: { $ne: null } }).lean();
  for (const cfg of cfgs) {
    if (cfg.lbLastSeason === prev) continue;
    try {
      const r = await closeSeason(client, cfg.guildId, { season: prev });
      console.log(`[leaderboard] ${cfg.guildId}: temporada ${prev} cerrada (${r.winners.length} ganadores)`);
    } catch (e) { console.error('[leaderboard] cierre:', e); }
  }
}

module.exports = { getProfiles, luckScore, streakFrom, metricLines, computeTop, buildPanel, publishPanel, removePanel, refreshAll, myRank, closeSeason, closeDue, seasonKey, excludedIds, NEEDED };
