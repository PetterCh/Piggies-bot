// Matemáticas puras del Arcade (sin base de datos ni Express): fácil de auditar y de probar.
const crypto = require('node:crypto');

/** Aleatorio uniforme en [0,1) criptográficamente seguro. */
const rand01 = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

// ---------------- PIGGY CRASH ----------------
// Crecimiento del multiplicador: mult(t) = floor(e^(GROWTH·t) · 100) / 100. Con 0.07: 2x ≈ 10 s, 10x ≈ 33 s, 100x ≈ 66 s.
const GROWTH = 0.07;
const CRASH_MAX = 100; // el punto de explosión nunca pasa de 100x

/** Multiplicador tras `ms` milisegundos desde el despegue. */
const crashMult = (ms) => Math.floor(Math.exp((GROWTH * Math.max(0, ms)) / 1000) * 100) / 100;

/**
 * Punto de explosión (2 decimales). P(X ≥ m) = (1-edge)/m, así que la ventaja de la casa es exactamente `edge` en cualquier momento de
 * retirada. Con probabilidad `edge` el cerdito explota al instante (1.00x).
 */
function crashPoint(edge, u = rand01()) {
  const x = (1 - edge) / (1 - u);
  if (x < 1) return 1;
  return Math.min(CRASH_MAX, Math.floor(x * 100) / 100);
}

/** ¿Ya explotó? (usa el mismo multiplicador de 2 decimales que ve el jugador). */
const crashed = (point, ms) => crashMult(ms) >= point;

// ---------------- BUSCAMINAS (5x5) ----------------
const CELLS = 25;

/** Multiplicador tras `safe` casillas seguras con `bombs` bombas: (1-edge) · Π (25-i)/(25-bombs-i). */
function minesMult(bombs, safe, edge) {
  if (safe <= 0) return 1;
  let m = 1 - edge;
  for (let i = 0; i < safe; i++) m *= (CELLS - i) / (CELLS - bombs - i);
  return Math.floor(m * 100) / 100;
}

/** Posiciones de las bombas: Fisher-Yates con aleatorio criptográfico. */
function placeBombs(count) {
  const cells = Array.from({ length: CELLS }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells.slice(0, count).sort((a, b) => a - b);
}

module.exports = { rand01, GROWTH, CRASH_MAX, crashMult, crashPoint, crashed, CELLS, minesMult, placeBombs };
