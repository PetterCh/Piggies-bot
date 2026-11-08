// Leaderboard mensual: rellena UNA sola vez `monthlyCoinks` con lo ganado en el mes en curso (expediciones + premios de cajas, sorteos y
// juegos) para que la tabla no arranque vacía. Idempotente (marca BotMeta 'lbMonth'). NO toca saldos (`coinks`), inventarios ni nada más.
const mongoose = require('mongoose');
const config = require('../config');
const { zonedMonthStart } = require('../utils/month');

async function run() {
  const db = mongoose.connection;
  const meta = db.collection('botmetas');
  if (await meta.findOne({ _id: 'lbMonth' })) return;
  const { seasonKey } = require('../services/leaderboard');
  const start = zonedMonthStart(config.leaderboard.timezone);
  const sums = new Map();
  const add = (rows) => rows.forEach((r) => sums.set(r._id, (sums.get(r._id) || 0) + r.total));
  try {
    add(await db.collection('expeditions').aggregate([
      { $match: { status: 'completed', completedAt: { $gte: start }, 'result.coinks': { $gt: 0 } } },
      { $group: { _id: '$discordId', total: { $sum: '$result.coinks' } } },
    ]).toArray());
    add(await db.collection('ledgers').aggregate([
      { $match: { createdAt: { $gte: start }, type: { $in: ['lootbox_win', 'giveaway_win', 'game_win'] }, toId: { $ne: null } } },
      { $group: { _id: '$toId', total: { $sum: '$amount' } } },
    ]).toArray());
    const ops = [...sums].map(([id, total]) => ({ updateOne: { filter: { discordId: id }, update: { $set: { monthlyCoinks: total } } } }));
    for (let i = 0; i < ops.length; i += 1000) await db.collection('users').bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    console.log(`[migración] Leaderboard mensual: contador inicial de ${ops.length} usuarios (desde ${start.toISOString()})`);
  } catch (err) {
    console.error('[migración] Leaderboard mensual (no crítico, el contador empieza en 0):', err.message);
  }
  await meta.updateOne({ _id: 'lbMonth' }, { $set: { value: seasonKey() } }, { upsert: true });
}

module.exports = { run };
