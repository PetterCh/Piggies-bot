// Utilidades de "mes" en la zona horaria configurada (sin dependencias).
/** Instante (Date) en que empieza el mes actual en `tz`. */
function zonedMonthStart(tz, now = new Date()) {
  const fmtParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
  const p = fmtParts(now);
  const guess = Date.UTC(Number(p.year), Number(p.month) - 1, 1, 0, 0, 0); // 1 del mes a las 00:00 "como si fuera UTC"
  const g = fmtParts(new Date(guess));
  const asUtc = Date.UTC(Number(g.year), Number(g.month) - 1, Number(g.day), Number(g.hour), Number(g.minute), Number(g.second));
  return new Date(guess - (asUtc - guess)); // corrige con el desfase de la zona en ese momento
}
module.exports = { zonedMonthStart };
