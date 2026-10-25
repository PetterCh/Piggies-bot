# Assets de la colección Piggies (estáticos)

Sube aquí tus archivos (se sirven tal cual en `https://TU-DOMINIO/piggies/...`):

```
public/piggies/
├── metadata/   1.json, 150.json …   (un JSON por Piggie)
├── sprites/    1.png,  150.png  …   (una hoja de sprites PNG por Piggie)
└── sprite-config.json  (tamaño de frame / columnas de tus hojas)
```

- La página interactiva es `/play/<id>`, el comando de Discord `/p <id>`.
- El nombre de archivo es el ID **sin ceros a la izquierda** (`150.json`, no `0150.json`).
- Los metadatos pueden seguir el estándar ERC-721 (`name`, `description`, `image`, `attributes`). Se muestran en el embed de `/p`.
  Si `image` es una URL https se usa como vista previa; si no, se usa la hoja de sprites.

## Frames de la hoja (numerados desde 1, de izquierda a derecha y de arriba abajo)
| Frames | Animación |
|---|---|
| 1 – 4 | IDLE (quieto, en bucle) |
| 5 – 12 | Caminar (WASD / flechas) |
| 13 – 16 | Comer (botón "Comer" o tecla E) |

La hoja es una cuadrícula de **4 columnas × 4 filas** con frames de **91×100 px** (364×400 en total). Ya está configurado en `sprite-config.json`:

```json
{ "frameWidth": 91, "frameHeight": 100, "columns": 4, "frames": 16, "scale": 2, "facing": "right" }
```
`scale` = aumento entero en pantalla; `facing` = hacia dónde mira el sprite original (`right`/`left`), para voltearlo al caminar al otro lado. Un objeto `"sprite"` dentro de un metadato concreto manda sobre este archivo.

## Carpeta fuera del repositorio (Railway)
Si no quieres subir miles de archivos al repo, monta un Volume y define `PIGGIES_DIR=/data/piggies` (con las subcarpetas `metadata/` y `sprites/`).
