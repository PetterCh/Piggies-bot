// Localiza los slash commands al registrarlos (npm run deploy). Ver el encabezado de locales/commandText.js.
//   base            -> nombre en español (identificador que usa el código) + descripción en INGLÉS
//   en-US / en-GB   -> nombre en inglés (si cambia) y descripción en inglés
//   es-ES / es-419  -> descripción original en español
const text = require('../locales/commandText');

const EN = ['en-US', 'en-GB'];
const ES = ['es-ES', 'es-419'];
const NAME_RE = /^[-_\p{L}\p{N}]{1,32}$/u;
const both = (langs, v) => Object.fromEntries(langs.map((l) => [l, v]));

/** Devuelve una copia localizada del JSON de un comando; `warn(msg)` recibe lo que falte por traducir. */
function localizeCommand(json, warn = () => {}, trail = json.name) {
  const out = { ...json };

  // --- descripción: inglés de base, español como localización
  if (out.description) {
    const en = text.descriptions[out.description];
    if (!en) warn(`Sin traducción al inglés: "${out.description}" (${trail})`);
    else {
      out.description_localizations = { ...(out.description_localizations || {}), ...both(ES, out.description.slice(0, 100)), ...both(EN, en.slice(0, 100)) };
      out.description = en.slice(0, 100);
    }
  }

  // --- nombre: el base no cambia; el inglés va como localización
  const en = text.names[json.name];
  if (en && en !== json.name && NAME_RE.test(en) && en === en.toLowerCase()) out.name_localizations = { ...(out.name_localizations || {}), ...both(EN, en) };

  // --- opciones de lista desplegable
  if (out.choices) {
    out.choices = out.choices.map((c) => {
      if (c.name_localizations) return c;
      const cen = text.choices[c.name];
      if (!cen) { warn(`Sin traducción de la opción: "${c.name}" (${trail})`); return c; }
      return { ...c, name_localizations: both(EN, cen.slice(0, 100)) };
    });
  }

  // --- subcomandos / opciones (los nombres en inglés deben ser únicos entre hermanos)
  if (out.options) {
    out.options = out.options.map((o) => localizeCommand(o, warn, `${trail} ${o.name}`));
    const seen = new Map();
    for (const o of out.options) {
      const shown = o.name_localizations?.['en-US'] || o.name;
      if (seen.has(shown)) {
        warn(`Nombre en inglés repetido "${shown}" en ${trail}: se omite la traducción de "${o.name}"`);
        delete o.name_localizations;
      } else seen.set(shown, true);
    }
  }
  return out;
}

module.exports = { localizeCommand };
