// Eventos globales aleatorios. Los textos (nombre, descripción, anuncios) viven en locales/*.js bajo event.<id>.*
//   survivalDelta : suma/resta a la probabilidad de sobrevivir de las expediciones que SALEN durante el evento
//   coinMult      : multiplicador de los Coinks de esas expediciones
//   dropChance    : probabilidad de que una expedición exitosa suelte un objeto único del evento
//   minHours/maxHours : duración (sorteada)
// Las expediciones fijan el evento activo al salir: lo que ves al enviarlas es lo que se aplica al volver.
const EVENTS = {
  tormenta_de_sangre: { id: 'tormenta_de_sangre', emoji: '🩸', color: 0xb71c1c, survivalDelta: -0.15, coinMult: 1.5, dropChance: 0.20, minHours: 2, maxHours: 4,
    items: ['colmillo_carmesi', 'coraza_de_sangre_coagulada', 'yelmo_sediento'] },
  lluvia_de_estrellas: { id: 'lluvia_de_estrellas', emoji: '🌠', color: 0x5c6bc0, survivalDelta: 0.10, coinMult: 1.25, dropChance: 0.18, minHours: 2, maxHours: 5,
    items: ['lanza_estelar', 'manto_de_polvo_de_estrellas', 'diadema_fugaz'] },
  fiebre_del_oro: { id: 'fiebre_del_oro', emoji: '💰', color: 0xf9a825, survivalDelta: 0, coinMult: 2.0, dropChance: 0.15, minHours: 2, maxHours: 4,
    items: ['pico_de_oro_macizo', 'armadura_de_lingotes', 'casco_del_rey_midas'] },
  niebla_espectral: { id: 'niebla_espectral', emoji: '👻', color: 0x78909c, survivalDelta: -0.05, coinMult: 1.15, dropChance: 0.25, minHours: 3, maxHours: 6,
    items: ['guadana_fantasmal', 'sudario_espectral', 'capucha_del_mas_alla'] },
};

module.exports = { EVENTS };
