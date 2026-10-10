// Ejecuta la migración a mano:  npm run migrate
const mongoose = require('mongoose');
const config = require('../config');
(async () => {
  await mongoose.connect(config.mongoUri);
  await require('../migrations/001-v2').run();
  console.log('Migración terminada.');
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
