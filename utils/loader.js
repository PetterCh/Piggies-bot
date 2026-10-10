const fs = require('node:fs');
const path = require('node:path');

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.js')) yield full;
  }
}

/** Carga todos los comandos (commands/**) con forma { data, execute, autocomplete?, components? }. */
function loadCommands(baseDir) {
  const commands = new Map();
  for (const file of walk(baseDir)) {
    const cmd = require(file);
    if (!cmd.data || typeof cmd.execute !== 'function') {
      console.warn(`[loader] ${file} ignorado: debe exportar { data, execute }`);
      continue;
    }
    if (commands.has(cmd.data.name)) throw new Error(`Comando duplicado: ${cmd.data.name}`);
    cmd.file = path.relative(path.join(baseDir, '..'), file);
    commands.set(cmd.data.name, cmd);
  }
  return commands;
}

/**
 * Registra los componentes PERSISTENTES (botones, modales y menús) que declaran los comandos:
 *   components: [{ kind: 'button'|'modal'|'select', prefix: 'wl', execute(interaction, args, client) }]
 * El customId debe tener el formato  "prefix:arg1:arg2". Al no depender de collectors, siguen funcionando
 * tras reiniciar el bot (paneles de verificación, sorteos, botones de "abrir otra caja"...).
 */
function loadComponents(commands) {
  const map = new Map();
  for (const cmd of commands.values()) {
    for (const c of cmd.components || []) {
      const key = `${c.kind}:${c.prefix}`;
      if (map.has(key)) {
        throw new Error(
          `Componente duplicado "${key}": lo declaran ${map.get(key).file} y ${cmd.file}.\n` +
            'Casi siempre es un archivo viejo que quedó de una versión anterior: borra la carpeta del bot y copia la nueva COMPLETA (solo conserva tu .env).',
        );
      }
      map.set(key, { ...c, file: cmd.file });
    }
  }
  return map;
}

module.exports = { walk, loadCommands, loadComponents };
