const path = require('node:path');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const mongoose = require('mongoose');
const config = require('./config');

// Los índices se crean DESPUÉS de las migraciones (así un índice antiguo no choca con el nuevo esquema).
mongoose.set('autoIndex', false);

const { walk, loadCommands, loadComponents } = require('./utils/loader');
const migration = require('./migrations/001-v2');

for (const key of ['token', 'clientId', 'mongoUri']) {
  if (!config[key]) {
    console.error(`Falta la variable de entorno para "${key}". Revisa tu archivo .env`);
    process.exit(1);
  }
}

const client = new Client({
  // GuildMembers es un intent PRIVILEGIADO: actívalo en el Developer Portal (Bot > Privileged Gateway Intents).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const commands = loadCommands(path.join(__dirname, 'commands'));
client.commands = new Collection(commands);
client.components = loadComponents(commands);

for (const file of walk(path.join(__dirname, 'events'))) {
  const event = require(file);
  client[event.once ? 'once' : 'on'](event.name, (...args) => event.execute(...args, client));
}

// Módulo web de Piggies (independiente: /play/:id + assets estáticos). Si falla, el bot sigue funcionando igual.
try { require('./web/server').startWebServer(); } catch (err) { console.error('[web] no se pudo iniciar:', err.message); }

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

async function shutdown(signal) {
  console.log(`\n${signal} recibido, cerrando…`);
  await client.destroy();
  await mongoose.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15_000 });
  console.log('✅ MongoDB conectado');
  await migration.run();
  // Crea los índices uno a uno: si uno falla se muestra el error pero el bot sigue arrancando.
  for (const model of Object.values(mongoose.models)) {
    await model.createIndexes().catch((e) => console.error(`[índices] ${model.modelName}:`, e.message));
  }
  await client.login(config.token);
})().catch((err) => {
  console.error('Error al iniciar:', err);
  process.exit(1);
});
