// Lógica de juego del Arcade, 100 % en el servidor. Reglas de seguridad:
//  - Apuesta: se crea la partida (índice único parcial = una abierta por usuario) y LUEGO se cobra con removeCoinks (atómico, con saldo
//    comprobado en la misma operación). Si no hay saldo, la partida se borra.
//  - Cada cambio de estado es un findOneAndUpdate con filtro {open:true,status:'active'}: solo uno puede ganar la carrera (doble clic,
//    peticiones simultáneas...). El premio solo se abona a quien consiguió cambiar el estado, una vez, y se reintenta si algo falla.
//  - El punto de explosión y las bombas nunca salen del servidor mientras la partida sigue abierta.
const User = require('../../models/User');
const Ledger = require('../../models/Ledger');
const ArcadeGame = require('../../models/ArcadeGame');
const { addCoinks, removeCoinks, InsufficientFundsError } = require('../../utils/economy');
const { zonedMonthStart } = require('../../utils/month');
const M = require('./math');

const env = (k, d) => (Number(process.env[k]) > 0 ? Number(process.env[k]) : d);
const LIMITS = {
  minBet: env('ARCADE_MIN_BET', 10),
  maxBet: env('ARCADE_MAX_BET', 5000),
  maxPayout: env('ARCADE_MAX_PAYOUT', 50_000), // tope de premio por partida
  edge: Math.min(0.2, Math.max(0.01, Number(process.env.ARCADE_HOUSE_EDGE) || 0.04)),
  minBombs: 1,
  maxBombs: 24,
};

class ArcadeError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

const SEL = '+crashPoint +bombs';
const ownerQuery = (userId, game) => ({ userId, open: true, ...(game ? { game } : {}) });
const loadOpen = (userId, game) => ArcadeGame.findOne(ownerQuery(userId, game)).select(SEL);
const reload = (id) => ArcadeGame.findById(id).select(SEL);

async function balanceOf(userId) {
  const u = await User.findOne({ discordId: userId }).select('coinks').lean();
  return u?.coinks || 0;
}

const capMultFor = (bet) => Math.max(1, Math.floor((LIMITS.maxPayout / bet) * 100) / 100);
const payoutFor = (bet, mult) => Math.min(LIMITS.maxPayout, Math.floor(bet * mult));

// ---------------- Cierre de partidas ----------------
/** Abona el premio de una partida ganada (idempotente: comprueba el libro contable antes de pagar). */
async function settle(doc) {
  if (!(doc.status === 'cashed' && doc.payout > 0 && !doc.paid)) return doc;
  try {
    if (!(await Ledger.exists({ type: 'arcade_win', reason: String(doc._id) }))) {
      await addCoinks(doc.userId, doc.payout, { type: 'arcade_win', reason: String(doc._id), guildId: doc.guildId });
    }
    await ArcadeGame.updateOne({ _id: doc._id, paid: false }, { $set: { paid: true } });
    doc.paid = true;
  } catch (err) {
    console.error('[arcade] no se pudo abonar el premio (se reintentará solo)', doc._id, err.message);
  }
  return doc;
}

async function finishLost(doc) {
  const res = await ArcadeGame.findOneAndUpdate(
    { _id: doc._id, open: true, status: 'active' },
    { $set: { status: 'lost', open: false, endedAt: new Date(), cashMult: 0, payout: 0, profit: -doc.bet, paid: true } },
    { new: true }
  ).select(SEL);
  return res || reload(doc._id);
}

async function finishCashed(doc, mult, extraFilter = {}) {
  const payout = payoutFor(doc.bet, mult);
  const res = await ArcadeGame.findOneAndUpdate(
    { _id: doc._id, open: true, status: 'active', ...extraFilter },
    { $set: { status: 'cashed', open: false, endedAt: new Date(), cashMult: mult, payout, profit: payout - doc.bet, paid: false } },
    { new: true }
  ).select(SEL);
  if (!res) return null; // otro proceso cambió la partida antes: quien llama la vuelve a leer
  return settle(res);
}

// ---------------- Alta de partida ----------------
function checkBet(bet) {
  if (!Number.isSafeInteger(bet) || bet < LIMITS.minBet || bet > LIMITS.maxBet) throw new ArcadeError('bet');
  return bet;
}

async function openGame(user, game, bet, fields) {
  // Una partida de crash que ya explotó y nadie cerró no debe bloquear al jugador.
  const prev = await loadOpen(user.id);
  if (prev?.game === 'crash') await resolveCrash(prev);
  let doc;
  try {
    doc = await ArcadeGame.create({ userId: user.id, userName: user.name, guildId: user.guildId, game, bet, status: 'pending', open: true, edge: LIMITS.edge, ...fields });
  } catch (err) {
    if (err.code === 11000) throw new ArcadeError('busy', 409);
    throw err;
  }
  try {
    await removeCoinks(user.id, bet, { type: 'arcade_bet', reason: String(doc._id), guildId: user.guildId });
  } catch (err) {
    await ArcadeGame.deleteOne({ _id: doc._id });
    if (err instanceof InsufficientFundsError) throw new ArcadeError('funds');
    throw err;
  }
  const active = await ArcadeGame.findOneAndUpdate(
    { _id: doc._id, open: true, status: 'pending' },
    { $set: { status: 'active', ...(game === 'crash' ? { startedAt: new Date() } : {}) } },
    { new: true }
  ).select(SEL);
  if (!active) throw new ArcadeError('server', 500); // lo resuelve reconcile() (reembolso)
  return active;
}

// ---------------- Vistas (lo ÚNICO que ve el cliente) ----------------
function crashView(doc, now = Date.now()) {
  const v = { game: 'crash', id: String(doc._id), status: doc.status, bet: doc.bet, startedAt: doc.startedAt ? doc.startedAt.getTime() : null, serverNow: now };
  if (doc.status === 'active') v.mult = M.crashMult(now - v.startedAt);
  else { v.mult = doc.cashMult; v.payout = doc.payout; v.crashPoint = doc.crashPoint; } // ya terminó: se puede revelar
  return v;
}

function minesView(doc) {
  const n = doc.revealed.length;
  const edge = doc.edge ?? LIMITS.edge;
  const v = { game: 'mines', id: String(doc._id), status: doc.status, bet: doc.bet, bombCount: doc.bombCount, revealed: doc.revealed, mult: M.minesMult(doc.bombCount, n, edge), serverNow: Date.now() };
  v.next = n < M.CELLS - doc.bombCount ? M.minesMult(doc.bombCount, n + 1, edge) : null;
  if (doc.status !== 'active') { v.mult = doc.cashMult || v.mult; v.payout = doc.payout; v.bombs = doc.bombs; v.hit = doc.hit; }
  return v;
}
const viewOf = (doc) => (doc.game === 'crash' ? crashView(doc) : minesView(doc));

// ---------------- PIGGY CRASH ----------------
/** Lleva la partida de crash al estado real según el reloj del servidor (explotó / tope de premio). */
async function resolveCrash(doc, now = Date.now()) {
  if (doc.status !== 'active') return doc;
  const el = now - doc.startedAt.getTime();
  const cap = capMultFor(doc.bet);
  if (doc.crashPoint > cap && M.crashMult(el) >= cap) return (await finishCashed(doc, cap)) || reload(doc._id); // tope de premio: cobra solo
  if (M.crashed(doc.crashPoint, el)) return (await finishLost(doc)) || reload(doc._id);
  return doc;
}

async function crashStart(user, bet) {
  checkBet(bet);
  const doc = await openGame(user, 'crash', bet, { crashPoint: M.crashPoint(LIMITS.edge) });
  return crashView(doc);
}

async function crashState(user) {
  const doc = await loadOpen(user.id, 'crash');
  if (!doc) return { game: null };
  return crashView(await resolveCrash(doc));
}

async function crashCashout(user) {
  const doc = await loadOpen(user.id, 'crash');
  if (!doc) throw new ArcadeError('nogame', 404);
  const now = Date.now();
  const resolved = await resolveCrash(doc, now);
  if (resolved.status !== 'active') return crashView(resolved);
  const mult = Math.min(M.crashMult(now - doc.startedAt.getTime()), capMultFor(doc.bet));
  const done = await finishCashed(doc, mult);
  return crashView(done || (await reload(doc._id)));
}

// ---------------- BUSCAMINAS ----------------
async function minesStart(user, bet, bombs) {
  checkBet(bet);
  if (!Number.isInteger(bombs) || bombs < LIMITS.minBombs || bombs > LIMITS.maxBombs) throw new ArcadeError('bombs');
  const doc = await openGame(user, 'mines', bet, { bombCount: bombs, bombs: M.placeBombs(bombs) });
  return minesView(doc);
}

async function minesState(user) {
  const doc = await loadOpen(user.id, 'mines');
  return doc ? minesView(doc) : { game: null };
}

/** Cobra con el multiplicador de las casillas reveladas AHORA (el filtro $size evita cobrar sobre un estado que cambió a la vez). */
async function minesCash(doc) {
  for (let i = 0; i < 4; i++) {
    const n = doc.revealed.length;
    if (n < 1) throw new ArcadeError('norevealed');
    const done = await finishCashed(doc, M.minesMult(doc.bombCount, n, doc.edge ?? LIMITS.edge), { revealed: { $size: n } });
    if (done) return done;
    doc = await reload(doc._id);
    if (!doc || doc.status !== 'active') return doc;
  }
  throw new ArcadeError('busy', 409);
}

async function minesReveal(user, idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= M.CELLS) throw new ArcadeError('cell');
  const doc = await loadOpen(user.id, 'mines');
  if (!doc) throw new ArcadeError('nogame', 404);
  if (doc.revealed.includes(idx)) return minesView(doc);
  if (doc.bombs.includes(idx)) {
    const res = await ArcadeGame.findOneAndUpdate(
      { _id: doc._id, open: true, status: 'active' },
      { $set: { status: 'lost', open: false, endedAt: new Date(), cashMult: 0, payout: 0, profit: -doc.bet, paid: true, hit: idx } },
      { new: true }
    ).select(SEL);
    return minesView(res || (await reload(doc._id)));
  }
  let updated = await ArcadeGame.findOneAndUpdate({ _id: doc._id, open: true, status: 'active', revealed: { $ne: idx } }, { $push: { revealed: idx } }, { new: true }).select(SEL);
  if (!updated) return minesView(await reload(doc._id));
  if (updated.revealed.length >= M.CELLS - updated.bombCount) updated = (await minesCash(updated)) || updated; // limpió el tablero: cobra solo
  return minesView(updated);
}

async function minesCashout(user) {
  const doc = await loadOpen(user.id, 'mines');
  if (!doc) throw new ArcadeError('nogame', 404);
  return minesView(await minesCash(doc));
}

// ---------------- Perfil y ranking ----------------
async function me(user) {
  const [balance, active] = await Promise.all([balanceOf(user.id), loadOpen(user.id)]);
  let view = null;
  if (active) view = active.game === 'crash' ? crashView(await resolveCrash(active)) : minesView(active);
  if (view && view.status !== 'active') view = null;
  return { user: { id: user.id, name: user.name, avatar: user.avatar }, balance, active: view, limits: { minBet: LIMITS.minBet, maxBet: LIMITS.maxBet, maxPayout: LIMITS.maxPayout, maxBombs: LIMITS.maxBombs } };
}

async function leaderboard({ type = 'mult', range = 'month' } = {}) {
  const q = { status: 'cashed', profit: { $gt: 0 } };
  if (range !== 'all') q.endedAt = { $gte: zonedMonthStart(process.env.LEADERBOARD_TIMEZONE || 'America/Guayaquil') };
  const rows = await ArcadeGame.find(q).sort(type === 'profit' ? { profit: -1 } : { cashMult: -1, profit: -1 }).limit(10).select('userName game bet cashMult payout profit').lean();
  return rows.map((r, i) => ({ rank: i + 1, name: r.userName || 'Piggy', game: r.game, bet: r.bet, mult: r.cashMult, payout: r.payout, profit: r.profit }));
}

// ---------------- Mantenimiento ----------------
/** Abona premios pendientes y reembolsa apuestas cobradas cuya partida quedó a medias (por un reinicio justo en ese instante). */
async function reconcile() {
  const now = Date.now();
  for (const g of await ArcadeGame.find({ status: 'cashed', paid: false, endedAt: { $lt: new Date(now - 30_000) } }).limit(50)) await settle(g);
  for (const g of await ArcadeGame.find({ status: 'pending', createdAt: { $lt: new Date(now - 120_000) } }).limit(50)) {
    const debited = await Ledger.exists({ type: 'arcade_bet', reason: String(g._id) });
    const voided = await ArcadeGame.findOneAndUpdate({ _id: g._id, status: 'pending' }, { $set: { status: 'void', open: false, endedAt: new Date(), paid: true } });
    if (voided && debited) await addCoinks(g.userId, g.bet, { type: 'arcade_refund', reason: String(g._id), guildId: g.guildId });
  }
}

module.exports = { LIMITS, ArcadeError, me, crashStart, crashState, crashCashout, minesStart, minesState, minesReveal, minesCashout, leaderboard, reconcile, balanceOf };
