// Comprueba que todos los comandos tengan traducción al inglés (locales/commandText.js). Uso: npm run check:commands
const path = require('node:path');
const { loadCommands } = require('../utils/loader');
const { localizeCommand } = require('../utils/commandLocalization');
const text = require('../locales/commandText');

const commands = [...loadCommands(path.join(__dirname, '..', 'commands')).values()];
const missing = [];
const used = new Set();
const collect = (j) => { used.add(j.description); (j.options || []).forEach(collect); };
for (const c of commands) {
  const json = c.data.toJSON();
  collect(json);
  localizeCommand(json, (m) => missing.push(m));
}
const stale = Object.keys(text.descriptions).filter((d) => !used.has(d));
missing.forEach((m) => console.log(`✖ ${m}`));
stale.forEach((d) => console.log(`ℹ entrada sin uso en commandText.js: "${d}"`));
console.log(missing.length ? `\n✖ ${missing.length} traducciones faltantes` : `✔ ${commands.length} comandos con traducción completa`);
process.exit(missing.length ? 1 : 0);
