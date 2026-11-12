# Sprites del Arcade (pixel art)

Pon tus PNG en esta carpeta (`public/arcade/sprites/`) con EXACTAMENTE estos nombres. Los que no subas se sustituyen por un emoji/color,
así que el juego funciona desde el primer minuto.

| Archivo | Se usa en | Si falta |
|---|---|---|
| `piggy-fly.png` | Cerdito idle / volando en Piggy Crash | 🐷 |
| `win.png` | Victoria (al cobrar, en Crash y Buscaminas) | 🎉 |
| `lose.png` | Derrota / explosión (Crash y bomba del Buscaminas) | 💥 |
| `tile-closed.png` | Casilla cerrada del Buscaminas | casilla morada |
| `tile-coin.png` | Casilla segura (moneda/premio) | 🪙 |
| `tile-bomb.png` | Bomba | 💣 |
| `crash-bg.png` *(opcional)* | Fondo del Crash (se estira a 640×360) | cielo con estrellas |

## Animaciones
Un PNG puede ser una **tira horizontal** de frames del mismo tamaño. Indica cuántos frames tiene en `sprites.json`:

```json
{ "pig": { "frames": 4, "fps": 8 }, "lose": { "frames": 6, "fps": 12 } }
```
Las casillas del Buscaminas usan solo el primer frame. El archivo `sprites.json` es opcional (sin él, todo es 1 frame).

## Cambiar nombres de archivo
En `public/arcade/arcade.js`, el objeto `SPRITE_FILES` (arriba del todo) enlaza cada uso con su nombre de archivo.
El renderizado usa `image-rendering: pixelated`, así que dibuja a tamaño pequeño (p. ej. 32×32 o 48×48) y se ampliará nítido.
