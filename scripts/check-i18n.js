// Verifica que (1) es/en tengan exactamente las mismas claves, (2) todas las claves usadas en el código existan
// y (3) existan las traducciones de todo lo enumerable (objetos, zonas, rarezas, cajas...).  npm run check:i18n
const fs = require('node:fs');
const path = require('node:path');
const es = require('../locales/es');
const en = require('../locales/en');
const { ITEMS, ZONES, RARITIES, SLOTS } = require('../data/gameData');
const { BOXES } = require('../data/lootboxes');
const { EVENTS } = require('../data/events');

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [`${p}${k}`]));
const esKeys = new Set(flat(es));
const enKeys = new Set(flat(en));
let problems = 0;
const bad = (m) => { problems++; console.log('✖', m); };

for (const k of esKeys) if (!enKeys.has(k)) bad(`falta en EN: ${k}`);
for (const k of enKeys) if (!esKeys.has(k)) bad(`falta en ES: ${k}`);

// Claves usadas en el código
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'locales', 'scripts', 'migrations'].includes(e.name) || e.name === 'i18n.js') continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.js')) files.push(f);
  }
})(path.join(__dirname, '..'));

const used = new Set();
const dynamic = new Set();
const add = (k) => (k.includes('${') ? dynamic.add(k) : used.add(k));
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\b(?:t|tr|tOr|choice)\(\s*(?:[A-Za-z]+\s*,\s*|'(?:es|en)'\s*,\s*)?(['`])([^'`]+)\1/g)) add(m[2]);
  for (const m of src.matchAll(/tOr\([^,]+,\s*\[([^\]]+)\]/g)) for (const s of m[1].matchAll(/[`']([^`']+)[`']/g)) add(s[1]);
  for (const m of src.matchAll(/\?\s*'([a-z]\w*(?:\.\w+)+)'\s*:\s*'([a-z]\w*(?:\.\w+)+)'/g)) { add(m[1]); add(m[2]); }
}
// tOr(... 'expedition.death.default') etc. ya entran arriba; los de zona (dinámicos) se validan abajo.
for (const k of used) if (!k.startsWith('piggy.') && !esKeys.has(k)) bad(`clave usada y no definida: ${k}`);
for (const d of dynamic) {
  const re = new RegExp('^' + d.replace(/\$\{[^}]+\}/g, '[^.]+').replace(/\./g, '\\.') + '$');
  if (![...esKeys].some((k) => re.test(k))) bad(`patrón dinámico sin ninguna clave: ${d}`);
}

// Enumerables
const need = (k) => { if (!esKeys.has(k) || !enKeys.has(k)) bad(`falta traducción: ${k}`); };
Object.keys(ITEMS).forEach((id) => need(`item.${id}`));
Object.keys(ZONES).forEach((z) => { need(`zone.${z}.name`); need(`zone.${z}.duration`); need(`expedition.death.${z}`); need(`expedition.survive.${z}`); });
RARITIES.forEach((r) => { need(`rarity.${r}`); need(`lootbox.title.${r}`); });
['nothing', 'nft'].forEach((r) => need(`lootbox.title.${r}`));
SLOTS.forEach((s) => { need(`slot.${s}`); need(`slotPlural.${s}`); });
['recipe', 'count', 'items', 'type', 'distinct', 'funds', 'changed'].forEach((r) => need(`fuse.errors.${r}`));

// Arsenal: mínimo 10 armas y 10 armaduras por rareza
const { itemsOf } = require('../data/gameData');
for (const type of ['weapon', 'armor']) for (const r of RARITIES) if (itemsOf(type, r).length < 10) bad(`arsenal: ${type} ${r} tiene ${itemsOf(type, r).length} (<10)`);
Object.keys(BOXES).forEach((b) => { need(`lootbox.box.${b}`); need(`lootbox.boxDesc.${b}`); });
['auto', 'es', 'en'].forEach((l) => need(`lang.set.${l}`));
['eventos', 'lootbox', 'tienda'].forEach((x) => need(`pingRole.type.${x}`));
['everyone', 'managed', 'dangerous', 'adminRole', 'hierarchy'].forEach((x) => need(`autoroles.problem.${x}`));
['shop', 'expshop', 'nft'].forEach((x) => need(`purchaseLog.title.${x}`));
['available', 'won', 'delivered'].forEach((s) => need(`lootboxAdmin.status.${s}`));
['orange', 'yellow', 'green', 'blue', 'purple'].forEach((c) => need(`colorgame.color.${c}`));
['nothing', 'coinks', 'gear', 'nft'].forEach((x) => need(`lootbox.odds.${x}`));

// Eventos globales y rareza única
need('rarity.event');
for (const e of Object.values(EVENTS)) {
  ['name', 'desc', 'start', 'end', 'prize'].forEach((k) => need(`event.${e.id}.${k}`));
  for (const id of e.items) if (!require('../data/gameData').ITEMS[id]) bad(`evento ${e.id}: objeto inexistente ${id}`);
}
['none', 'loot'].forEach(() => {});
['none', 'finished', 'funds'].forEach((r) => need(`cancel.${r}`));

// Claves sin usar (informativo): ayudan a detectar textos de comandos retirados
const regs = [...dynamic].map((d) => new RegExp('^' + d.replace(/\$\{[^}]+\}/g, '[^.]+').replace(/\./g, '\\.') + '$'));
const alwaysDynamic = [/^item\./, /^event\.[a-z_]+\.(name|desc|start|end|prize)$/, /^zone\./, /^expedition\.(death|survive)\./];
const unused = [...esKeys].filter((k) => !used.has(k) && !regs.some((r) => r.test(k)) && !alwaysDynamic.some((r) => r.test(k)));
if (unused.length) console.log(`ℹ claves sin uso aparente (${unused.length}):`, unused.slice(0, 40).join(', '));

// Variedad de frases
const count = (k) => { const v = k.split('.').reduce((o, p) => o?.[p], es); return Array.isArray(v) ? v.length : 1; };
console.log(`Claves: ${esKeys.size} (ES) / ${enKeys.size} (EN). Usadas en código: ${used.size} + ${dynamic.size} dinámicas.`);
console.log('Variantes → burlas colores:', count('colorgame.lose'), '| caja vacía:', count('lootbox.result.nothing'), '| muerte bosque/cueva/volcán:', count('expedition.death.bosque'), count('expedition.death.cueva'), count('expedition.death.volcan'));
console.log(problems ? `\n${problems} problema(s).` : '\n✔ i18n OK');
process.exit(problems ? 1 : 0);
