# 🪙 Coinks Bot v7.4

## Novedades v7.9

1. **`/inventario` único:** sin subcomandos. Muestra directamente el panel con equipar, desequipar, vender y fusionar (botones y menús). Se eliminaron `equipar`, `desequipar`, `vender`, `fusionar` y `recetas`.
2. **Lootbox:** solo queda `/lootbox-admin` (`panel`, `nft-agregar`, `nft-listar`, `nft-quitar`, `nft-pendientes`, `nft-entregar`); las cajas se abren desde el panel.
3. **Leaderboard con 4 roles:** Top 1, Top 2, Top 3 y Top 4–10 (ver arriba). Un rol por puesto, sin repetir.
4. **Embed del leaderboard:** sin `#1/#2…`, nombre en **negrita** antes del título y una línea en blanco entre jugadores. Nuevo comando público `/ballenas-chiquero` (EN `/pigsty-whales`) para ver la tabla en cualquier canal.
⚠️ Ejecuta `npm run deploy` (cambiaron comandos).

## Novedades v7.8 — correcciones y rediseño

- **Arranque:** los archivos viejos `commands/games/lootbox.js` y `commands/economy/tienda.js` ahora se **ignoran con un aviso** en vez de tumbar el bot con "Componente duplicado". Aun así, lo ideal es borrarlos (o reemplazar la carpeta completa conservando solo tu `.env`).
- **Tienda de expedición (E11000):** la causa era que al limpiar el panel se re-guardaban las rotaciones antiguas (sin `tier`) y Mongoose les ponía `tier: 'fast'`, chocando con la rotación nueva del mismo slot. Ahora (1) se limpian con `updateOne`, (2) la migración marca las antiguas como `legacy`, elimina duplicados y corrige un índice no único, y (3) la creación de rotaciones es un `upsert` atómico. Todo se aplica solo al arrancar; no hace falta borrar índices a mano.
- **Leaderboard:** cada puesto en 3 líneas exactas: `🥇 #1 @Usuario — Título` / `🏛️ Coinks: 91,166 • 🗺️ Expeditions: 13` / `🍀 Luck: 43% (Balanced) • 🔥 Streak: 4 days (Steady)`.
- **Inventario:** esferas de rareza (🟡 Legendario, 🟣 Épico, 🔵 Raro, 🟢 Poco común, ⚪ Común; el legendario pasó de 🟠 a 🟡 en todo el bot), bonus en negrita, usos como `7/9 usos`, copias idénticas agrupadas con `x2`, y una línea de aire entre categorías.

## Novedades v7.7 — Suerte y constancia en el leaderboard

Cada puesto del Top 10 ahora se ve así:

```
🥇 #1 @Usuario — Ballena Suprema 🐋
💰 Coinks: 45,200 | 🗺️ Expediciones: 128
🍀 Suerte: 78% (Buena estrella) | 🔥 Constancia: 12 días (Imparable)
```

- **🍀/📉 Suerte (1–99 %):** intento = apertura de caja o expedición completada; acierto = premio Épico/Legendario (o NFT). Se compara la tasa del jugador con la **media de todo el servidor** (50 % = igual que el promedio; el triple = 75 %; la mitad = 33 %), suavizada para que 1 acierto en 1 intento no dé 99 %. Con menos de 5 intentos sale "sin datos (novato)". Etiquetas: Bendecido ≥85, Buena estrella ≥65, Equilibrado ≥40, Mala racha ≥20, Pura mula <20.
- **🔥 Constancia:** días seguidos con alguna expedición enviada o caja abierta (día según `LEADERBOARD_TIMEZONE`; la racha sigue viva si hoy aún no jugaste pero ayer sí). Etiquetas: Dormido 0, Calentando 1-2, Constante 3-6, Imparable 7-13, Leyenda 14+.
- El botón **🐷 Mi puesto** también muestra tu suerte y tu constancia.
- No hace falta migrar nada ni ejecutar `npm run deploy`: se calcula con los historiales que ya guarda el bot. Exclusiones, roles mensuales y anuncio de temporada no cambian.

## Novedades v7.6 — Liga de Ballenas del Chiquero (leaderboard)

- **Panel:** `/leaderboard-admin panel canal:#ranking` publica un embed con el **Top 10** (🥇🥈🥉…, mención, Coinks y expediciones completadas). Se actualiza solo cada 10 min (`LEADERBOARD_REFRESH_MIN`) y tiene botones **🔄 Actualizar** y **🐷 Mi puesto** (privado). Orden: Coinks, y a igualdad, más expediciones. Solo salen miembros que siguen en el servidor y no son bots.
- **Exclusiones:** `/leaderboard-admin excluir @usuario`, `incluir @usuario` y `excluidos`. También puedes fijar una lista negra fija en el `.env`: `LEADERBOARD_BLACKLIST_IDS=id1,id2`.
- **Roles por puesto (v7.9):** `/leaderboard-admin rol top1:@… top2:@… top3:@… top10:@…` (Top 10 = puestos #4–#10). Se reparten solos al refrescar el panel y al cerrar la temporada, y se quitan a quien cambia de rango. `LEADERBOARD_LIVE_ROLES=off` los deja solo para el cierre mensual.
- **Temporada mensual:** el día 1 de cada mes a las 00:05 (zona `LEADERBOARD_TIMEZONE`, por defecto `CRON_TIMEZONE` o UTC; para Ecuador `America/Guayaquil`) el bot da el rol a los 3 primeros, se lo quita a quien bajó y anuncia a los ganadores en el canal de eventos (si no hay, en el del panel). Si el bot estaba apagado ese día, recupera el cierre al arrancar. `temporada-ahora` lo ejecuta manualmente (para probar).
- Los Coinks **no se reinician**: la tabla es acumulada y lo que cambia cada mes es quién lleva el rol.
- El rol del bot debe estar **por encima** del rol Top 3 y tener *Gestionar roles*. Nuevo comando → ejecuta `npm run deploy`.

## Novedades v7.5

1. **Inventario por categorías** (`/inventario`): 🛡️ CASCO / ⚔️ ARMA / 🥋 ARMADURA, cada una ordenada de Legendario a Común, con `[Rareza] Nombre (Tienda Expedición) (+X%) - N usos`.
2. **Panel de cajas interactivo:** `/lootbox-admin panel canal:#cajas imagen:https://…` publica un embed con imagen configurable y 3 botones (Caja 100 / 500 / 2000 Coinks) con resumen de premios y probabilidades. `quitar-imagen:true` vuelve a la imagen por defecto (`data/media.json`, clave `lootbox.panel`) y `desactivar:true` borra el panel. Los resultados son privados por defecto (`LOOTBOX_PUBLIC=on` para hacerlos públicos). El comando `/lootbox` **fue eliminado**.
3. **Tienda de expedición:** común/poco común/raro rotan cada 12 h; épico/legendario cada 24 h (`EXPSHOP_SLOW_ROTATION_HOURS`). Ambas frecuencias son independientes y el panel solo se republica cuando algo rota. La migración elimina sola el índice antiguo.

⚠️ Ejecuta `npm run deploy` (cambiaron comandos).

## Novedades de la v7.4: el bot llena solo el índice de Token IDs

Ya no tienes que cargar nada a mano. `tasks/tokenOwnersTask.js` mantiene el índice de los grupos 1/1 en segundo plano:
- **Primera carga:** 1 minuto después de arrancar, si faltan tokens en el índice.
- **Refresco diario:** a las 02:30 (`TOKEN_OWNERS_CRON`, zona `CRON_TIMEZONE`), una hora antes de la sincronización de roles de las 03:00. Solo relee los tokens que faltan o tienen más de ~20 h.
- **Muy despacio y aparte:** una lectura cada 0,4 s (`TOKEN_OWNERS_DELAY_MS`), una a la vez, con reintentos. Un fallo conserva el dato anterior; tras 10 fallos seguidos se corta y reintenta en el siguiente ciclo. Un token quemado/inexistente queda sin dueño.
- **Si algo cambió** (primera carga o un 1/1 cambió de dueño), el bot sincroniza los roles de ese servidor automáticamente.
- **La sincronización de roles sigue leyendo SOLO MongoDB**; la blockchain solo se toca en este refresco aislado (~108 lecturas al día con tus 3 grupos, no por usuario).
- `TOKEN_OWNERS_AUTO=off` lo desactiva (entonces usa `tokens-importar` / `tokens-actualizar`, que siguen funcionando). Los logs de Railway muestran `[nft] Índice de Token IDs: …`.

**Antes de arrancar:** pon los `role_id` reales en `data/token-roles.json` (o `TOKEN_ROLES_JSON`), registra las colecciones con `/nft-registrar coleccion` con el mismo nombre que usa el campo `coleccion` del JSON, y usa un RPC propio en `RPC_EVM_URL`/`RPC_RONIN_URL`.

---

# Novedades de la v7.3

## Novedades de la v7.3: índice interno de Token IDs (sin blockchain)

Los logs mostraban `400 Bad Request` / `missing response for request` hasta en la lectura normal de las colecciones: el **RPC público** que trae por defecto el bot (`RPC_EVM_URL`/`RPC_RONIN_URL`) limita las peticiones. Para que los grupos 1/1 no dependan de él, ahora **no consultan la cadena**: usan un índice propio guardado en MongoDB.

**Cómo llenar el índice** (dos formas; la primera no toca la blockchain):
1. **`/nft-registrar tokens-importar coleccion:Piggies archivo:<csv/json>`** — adjunta un archivo con los dueños actuales. CSV: una línea por token, `token_id,wallet` (con o sin cabecera; admite `,` `;` o tabulador). JSON: `{"3": "0x…", "853": "0x…"}` o `[{"token_id":3,"owner":"0x…"}]`. Puedes exportarlo del explorador/marketplace de tu colección (lista de holders con token ID) o de cualquier indexador. Filas con wallet inválida se ignoran y se te avisa; una wallet vacía/`null` significa «quemado/sin dueño». Máx. 2 MB. Se pueden importar solo los IDs de tus grupos o toda la colección.
2. **`/nft-registrar tokens-actualizar coleccion:Piggies`** — lee de la cadena **solo los IDs de tus grupos**, de uno en uno, con pausa de 0,4 s y reintentos; un fallo conserva el dato anterior y se corta tras 10 fallos seguidos. Es una acción manual del admin, **nunca** parte de la sincronización.

**Mantenerlo al día:** el índice es una foto; si los 1/1 cambian de dueño, vuelve a importar o ejecuta `tokens-actualizar` (puedes hacerlo cuando quieras; no corre solo). Después, `/nft-registrar sincronizar`. `/nft-registrar token-roles` muestra por grupo cuántos tokens tiene el índice y cuándo se actualizó por última vez.

**Recomendación:** pon un RPC propio (Alchemy, Infura, Chainstack, QuickNode…) en `RPC_EVM_URL` / `RPC_RONIN_URL` de Railway. Aun con el índice, la lectura base de las colecciones (rol de Holder) sigue usando el RPC; las lecturas tienen reintentos con espera creciente y `NFT_RPC_CONCURRENCY` (por defecto 3) limita la simultaneidad.

---

# Novedades de la v7.2.1

> **v7.2.1:** corrige los errores `400 Bad Request` / `missing response for request` de los grupos 1/1: ya no se consulta la cadena por cada Token ID del JSON (eran ~108 `ownerOf` por sincronización). Ahora los IDs vienen de la lectura normal de la wallet y se comparan en local; además todas las lecturas RPC **reintentan con espera creciente** (0,5 s · 1 s · 2 s) y la concurrencia bajó a 3 (`NFT_RPC_CONCURRENCY`).

## Novedades de la v7.2: roles por Token ID (1/1) con JSON externo

Da roles a quien tenga **tokens concretos** (por ID), con la lista y el `role_id` en un JSON que puedes cambiar sin tocar el código.

**Dónde vive el JSON** (el primero que exista): la variable de entorno `TOKEN_ROLES_JSON` (cómoda en Railway: editas la variable y reinicias) o el archivo `data/token-roles.json` (`TOKEN_ROLES_FILE` cambia la ruta; se relee solo si el archivo cambia).

```json
{ "roles": [
  { "nombre_referencia": "Piggies OG 1/1", "descripcion": "…", "coleccion": "Piggies",
    "role_id": "123456789012345678", "token_ids": [3, 853, 996] }
] }
```

- **`coleccion` (nuevo campo, obligatorio):** nombre o contrato de una colección ya registrada con `/nft-registrar coleccion`. Hace falta porque los mismos IDs existen en colecciones distintas (en tu lista, el 996 y el 999 están en Piggies y en Baby Piggies). Si solo hay una colección activa, puede omitirse.
- **`role_id`:** mientras valga `TU_DISCORD_ROLE_ID_AQUI` (o no sea un ID válido) ese grupo se ignora y `/nft-registrar token-roles` te lo avisa. Cambiarlo es editar el JSON y reiniciar.
- **Cómo verifica (v7.3): índice interno, CERO llamadas a la blockchain.** Los roles por Token ID leen **solo MongoDB** (colección `TokenOwner`: token → wallet dueña) y comparan en local con las listas `token_ids` y con las wallets vinculadas del usuario. No hay `ownerOf`, ni `balanceOf`, ni metadatos para estos grupos. Si un grupo aún no tiene datos en el índice, su rol **no se quita** (y `/nft-registrar token-roles` lo muestra).
- **Se suma, no reemplaza:** convive con el rol de Holder, los roles por rasgo y por categoría. Un rol se quita solo cuando ya no corresponde **y** la lectura no falló (si el RPC se cae, nadie pierde roles). Un token quemado o inexistente se trata como «sin dueño».
- **Cuándo se aplica:** en la sincronización automática de 24 h, al vincular una wallet, y al instante con `/nft-registrar sincronizar`.
- **`/nft-registrar token-roles`** muestra cada grupo con su colección, nº de tokens y rol (✅ listo, ⚠️ falta colección o rol, ❌ el rol del bot está por debajo del rol a asignar).
- Los ids repetidos dentro de un grupo se ignoran; los roles deben estar **por debajo** del rol del bot.

**Pasos:** 1) registra las colecciones si no lo hiciste (`/nft-registrar coleccion`); 2) crea los 3 roles y copia sus IDs (modo desarrollador de Discord → clic derecho → Copiar ID); 3) edita `data/token-roles.json` (o `TOKEN_ROLES_JSON`) con el `role_id` y el nombre de la colección de cada grupo; 4) reinicia, revisa `/nft-registrar token-roles` y ejecuta `/nft-registrar sincronizar`. Por esto no hace falta `npm run deploy` salvo que sea tu primera vez con la v7.2 (hay un subcomando nuevo).

---

# Novedades de la v7.1

## Novedades de la v7.1

| # | Cambio | Dónde |
|---|--------|-------|
| 1 | **Desequipar**: en `/inventario`, menús para **equipar** y **desequipar** sin escribir nada. El objeto vuelve a la mochila **con sus usos restantes** | `commands/games/inventario.js`, `services/inventory.js` (`equipItem`, `unequip`) |
| 2 | **Inglés por defecto** (comandos, descripciones, mensajes y embeds) conservando el español para quien lo use | `config.js`, `utils/i18n.js`, `locales/commandText.js`, `utils/commandLocalization.js`, `deploy-commands.js` |
| 3 | **Roles por categoría de rasgos**: `/nft-registrar rasgo` sin `valor` da el rol a cualquier NFT que tenga ese tipo de rasgo | `commands/nft/nft-registrar.js`, `services/nftSync.js`, `utils/blockchain.js` |

### 1. Equipar y desequipar
- `/inventario` muestra la mochila con tres controles: botones *Vender*/*Fusionar*, menú **Equipar desde la mochila…** (lo mejor primero, hasta 25 modelos) y menú **Quitar equipo…** (solo las ranuras ocupadas, más *Quitar todo*). Al elegir, el mismo mensaje se redibuja.
- Quitar es **una sola operación atómica por ranura** (sale de la ranura y entra a la mochila a la vez): nunca se pierde ni se duplica un objeto. Mientras el cerdito está de expedición el equipo está **bloqueado** (igual que antes; si te olvidaste algo, `/expedicion cancelar`).
- Nota: en la v7 `equipar` vive en `/inventario` (ya no en `/expedicion`).

### 2. Idioma
- Prioridad: `/idioma` del usuario → idioma del cliente de Discord → idioma preferido del servidor → **`DEFAULT_LANG` (ahora `en`)**. Quien tenga Discord en español, o elija `/idioma español`, sigue viendo todo en español. Si falta una clave en un idioma, se usa el inglés.
- **Railway / `.env`:** si ya tenías la variable `DEFAULT_LANG=es`, cámbiala a `en` (o bórrala); si no, seguirá en español.
- **Comandos en Discord:** al hacer `npm run deploy`, la descripción base de cada comando es la inglesa y los usuarios con Discord en español ven la original; los **nombres** se ven en inglés con Discord en inglés (`/inventory`, `/expedition`, `/shop-admin`, `/nft-register`…). Internamente los nombres base no cambian (Discord siempre los envía igual), así que nada se rompe. Los usuarios con otros idiomas ven los nombres base (en español) con descripción en inglés.
- Los textos de los comandos están en `locales/commandText.js`. Al crear un comando nuevo, añade ahí su descripción en inglés; `npm run check:commands` (y el propio `deploy`) avisan de lo que falte.
- Los mensajes fijos del bot que mencionan comandos (p. ej. «usa `/expedicion cancelar`») usan el nombre base.

### 3. Roles por categoría de rasgos
`/nft-registrar rasgo coleccion:<nombre> tipo:<categoría> rol:@rol [valor:<valor>]`
- **Con `valor`** (p. ej. `tipo:Background valor:Gold`): regla exacta, como antes.
- **Sin `valor`** (p. ej. `tipo:Special rol:@Piggy 1/1`): **categoría**: cualquier NFT que tenga un rasgo `Special`, con el valor que sea, da el rol. Se ignoran los valores vacíos tipo `none`, `n/a`, `no`, `ninguno`, `-`.
- Si tus metadatos son `Category = special`, usa `tipo:Category valor:special` (regla exacta).
- **No toca el rol de Holder** ni la verificación de balance: los roles de rasgo se suman a los de holder (se calcula la unión de todas las colecciones y wallets vinculadas) y, como siempre, un rol se quita solo si ya no corresponde y la lectura de esa colección no falló. Repetir el comando con el mismo `tipo` y `valor` solo cambia el rol. `/nft-registrar listar` muestra las categorías como `Special = (cualquier valor)`. Requiere contratos ERC721Enumerable (como los roles por rasgo).
- Tras configurarlo ejecuta `/nft-registrar sincronizar` (si no, se aplica en la sincronización de 24 h).

### Actualizar desde la v7
1. Copia **todo** el código reemplazando (conserva `.env`). No hacen falta paquetes nuevos.
2. En Railway, pon `DEFAULT_LANG=en` (o bórrala).
3. **`npm run deploy`** (registra los nombres/descripciones localizados y el nuevo `/inventario desequipar`) y reinicia.

---

> Lo que sigue es la documentación de la v7, que sigue vigente.

# 🪙 Coinks Bot v7

**v7 = tu versión estable v4 + únicamente los 7 cambios pedidos.** Sin `canvas`, sin paperdoll y sin `interactions/`: todo el equipo se muestra con emojis y texto. Los botones persistentes viven **dentro del archivo del comando** que los crea, y si alguna vez hay un componente duplicado el bot te dice exactamente qué dos archivos lo declaran.

## Qué cambió respecto a la v4

| # | Cambio | Dónde |
|---|--------|-------|
| 1 | Comandos de configuración solo para admins (**Gestionar servidor**): canal de la tienda de expedición, republicar, etc. | `utils/permissions.js`, `/set-expedition-shop-channel` |
| 2 | **Eventos programados** (inicio y fin automáticos) y **rol a mencionar** al empezar y terminar | `/evento-admin programar`, `/set-ping-role tipo:eventos` |
| 3 | **Arte por zona** en `media.json` (`expedition.start.<zona>`, `expedition.survive.<zona>`, `expedition.die.<zona>`; `expedicion.*` es alias) | `utils/media.js`, `data/media.json` |
| 4 | **Un solo `/inventario`**: ver, equipar, vender, fusionar, recetas | `commands/games/inventario.js`, `services/inventory.js` |
| 5 | **Canal de log de compras** (tienda, NFT y Tienda de Expedición; las destacadas resaltan) | `/set-purchases-channel`, `services/purchaseLog.js` |
| 6 | **Auto-roles por botones** (eventos, drops, novedades) sin `@everyone` | `/autoroles`, `/set-ping-role` |
| 7 | **Limpieza:** retirados `/evento`, `/tienda` (ver/comprar/compras), `/tienda-expedicion` y los subcomandos de inventario dentro de `/expedicion` | ver tabla de abajo |

**Fuera de esta versión (a propósito):** la animación de apertura de cajas estilo Counter-Strike. Quedó fuera porque pediste "únicamente" estos puntos; las cajas son las de la v4 (ahora con panel, ver v7.5). Se puede añadir después como cambio aparte.

## Actualizar desde la v4 (importante)

1. Copia de seguridad (código y base de datos).
2. **Borra la carpeta vieja del bot y copia esta COMPLETA**, conservando solo tu `.env`. No mezcles archivos: un `tienda.js` o `interactions/` viejo junto a los nuevos es la causa típica del error *Componente duplicado*.
3. `npm install` → **`npm run deploy`** (reemplaza la lista completa y Discord borra los comandos retirados) → `npm start`.
4. No hay migración: los campos nuevos (`eventsRoleId`, `dropsRoleId`, `shopRoleId`, `purchasesChannelId`, tipo NFT de artículo, `RolePanel`, estados de evento `scheduled`/`cancelled`) se crean solos y los datos de la v4 siguen válidos.
5. Configura lo que quieras: `/set-expedition-shop-channel`, `/set-purchases-channel`, `/autoroles`, `/set-ping-role`.

## Comandos

- **Jugadores:** `/coinks-saldo`, `/coinks-transferir`, `/juego-colores`, `/expedicion` (enviar, estado, cancelar), `/inventario` (panel único con botones y menús), `/ballenas-chiquero` (EN `/pigsty-whales`), `/idioma` (las cajas se abren con los botones del panel).
- **Admins** (Gestionar servidor): `/set-store-channel`, `/set-expedition-shop-channel`, `/set-events-channel`, `/set-logs-channel`, `/set-purchases-channel`, `/set-ping-role`, `/autoroles`, `/evento-admin`, `/tienda-admin`, `/lootbox-admin`, `/sorteo`, `/coinks-dar`, `/coinks-airdrop`, `/nft-registrar`, `/verificacion-panel`, `/wallet-desvincular`.
- **Solo dueño/Administrador:** `/set-admin-role`.

| Retirado | Dónde queda la función |
|---|---|
| `/evento` | Avisos en el canal de eventos (con mención al rol). Gestión en `/evento-admin` |
| `/tienda ver/comprar/compras` | Botón *Comprar* de cada tarjeta del canal de `/set-store-channel`; historial en el log de compras |
| `/tienda-expedicion` | Botón del panel de `/set-expedition-shop-channel` |
| `/expedicion equipar/inventario/recetas` | `/inventario equipar/ver/recetas`. Si Discord aún muestra uno viejo, el bot responde que se movió (se limpia con `npm run deploy`) |

## 1. Permisos: "Gestionar servidor"

Pueden administrar: el dueño, quien tenga *Administrador*, quien tenga **Gestionar servidor** y los roles autorizados con `/set-admin-role` (solo dueño/Administrador puede autorizar roles). Los comandos se registran con permiso por defecto *Gestionar servidor* (Discord los oculta al resto) y el bot lo vuelve a comprobar al ejecutar: comandos, autocompletados y botones, de forma centralizada en `events/interactionCreate.js`. Para exigir solo *Administrador*, cambia `ManageGuild` por `Administrator` en `utils/permissions.js` y en los `setDefaultMemberPermissions`. Los botones de usuario (comprar, sorteos, wallets, auto-roles, inventario) son públicos a propósito. Discord no deja que un bot cambie la visibilidad de sus comandos: para que un rol de `/set-admin-role` los *vea*, permítelos una vez en *Ajustes → Integraciones → tu bot*.

**Tienda de expedición:** `/set-expedition-shop-channel canal:#tienda` la publica y la mantiene sola (rota cada 12 h, stock en vivo). `republicar:true` la vuelve a publicar en el canal ya configurado; `desactivar:true` la quita.

## 2. Eventos programados y rol a mencionar

- `/evento-admin programar tipo:Tormenta de Sangre en:3h` (o `fecha:2026-10-12 18:30` en **UTC**; `horas:` fija la duración, si no se usa la del evento; máx. 90 días). Empieza y termina solo, con anuncio y mención, y sobrevive a reinicios. Se rechazan horarios que choquen con otro evento activo o programado.
- `/evento-admin programados` lista, `cancelar-programado` anula, `iniciar` lanza uno ya, `terminar` cierra el activo.
- `/set-ping-role tipo:eventos rol:@Eventos` → se menciona a ese rol al **empezar** y al **terminar** (sin `rol`: muestra el actual; `quitar:true`: lo borra). El rol debe ser *mencionable* o el bot necesita *Mencionar @everyone, @here y todos los roles* en el canal de eventos (el comando avisa si falta). `@everyone` (opción de `/set-events-channel`) sigue siendo opcional y solo al empezar.
- Mientras haya un evento activo o programado, el generador automático espera; los eventos sorpresa siguen apareciendo solos cuando no hay nada programado.

## 3. Arte por zona en `media.json`

Orden de búsqueda (de más específica a más general):

- **Inicio:** `expedition.start.<zona>` → `expedition.start`
- **Supervivencia:** `expedition.survive.<zona>.<rareza>` → `expedition.survive.<zona>` → `expedition.survive.<rareza>` → `expedition.survive`
- **Muerte:** `expedition.die.<zona>` → `expedition.die`

Zonas: `bosque`, `cueva`, `volcan`, `ruinas`, `abismo`, `trono`. Rarezas: `common` … `legendary`. El prefijo **`expedicion.`** es alias de `expedition.` (`expedicion.start.bosque` = `expedition.start.bosque`). El fichero ya trae las claves por zona vacías (sin imagen = sin imagen). Más: `event.end.<evento>`. Formato de `media.json` más abajo.

## 4. `/inventario` único

| Subcomando | Qué hace |
|---|---|
| `ver` | Equipo, perks, mochila (los exclusivos con sus usos), estadísticas y botones **Vender** / **Fusionar** |
| `equipar` | Equipa un objeto (bloqueado mientras el cerdito está de expedición) |
| `desequipar [ranura]` | Devuelve el equipo a la mochila con sus usos restantes (v7.1) |
| `vender objeto cantidad|todos` | Venta con confirmación; los exclusivos no se venden |
| `fusionar` | Categoría → objetos → confirmación (tarifa y % de éxito visibles) |
| `recetas` | Precios de venta y recetas de fusión |

Todo es atómico sobre saldo e inventario (`services/inventory.js`); comandos y botones llaman a las mismas funciones. Los objetos se muestran con emoji de rareza + nombre + bonus (p. ej. `🔵 Hacha Pezuña (+10%)`).

## 5. Log de compras

`/set-purchases-channel canal:#compras [publico:true] [desactivar:true]`. Cada compra publica comprador, precio, stock restante, entrega y, en la Tienda de Expedición, rareza, bonus, usos y perks. Salen con 🌟 las de **NFT**, las de **5000 Coinks o más** (`PURCHASE_HIGHLIGHT_MIN`) y los objetos épicos/legendarios.

- **NFT en la tienda:** `/tienda-admin agregar tipo:NFT` (`contrato`, `token-id` y `red` son informativos). El comprador **necesita wallet vinculada**; el pedido queda pendiente y el log muestra la(s) wallet(s). Al enviarlo: `/tienda-admin entregar pedido:… tx:<hash>`. El bot **nunca custodia NFT ni claves**.
- **Privacidad:** por defecto el log es para el staff (ID del comprador, wallets completas, ID de pedido). Con `publico:true`, wallets abreviadas y sin IDs.
- Sin canal configurado, los pedidos manuales/NFT siguen avisando al canal de admins del `.env`.

## 6. Auto-roles y roles de aviso

1. `/autoroles crear titulo:"Avisos" descripcion:"…" [canal] [color]` publica el panel.
2. `/autoroles agregar panel:Avisos nuevo-rol:"Avisos de eventos" emoji:🔔 ping:eventos` crea el rol (mencionable, **sin permisos**), añade su botón y lo registra como rol de aviso. También `rol:@existente`. `ping`: `eventos`, `lootbox`, `tienda`.
3. `/autoroles quitar|eliminar|listar` (hasta 25 botones por panel, 10 paneles por servidor). Cada clic activa/desactiva el rol (respuesta privada); los botones sobreviven a reinicios.

**Seguridad:** un auto-rol no puede dar permisos de moderación/administración, ni ser un rol gestionado por una integración, ni de admin del bot, ni estar por encima del rol del bot. Se comprueba al añadirlo **y en cada clic**. Un botón de un rol retirado deja de funcionar. Para `nuevo-rol` el bot necesita *Gestionar roles*.

`/set-ping-role tipo:(eventos|lootbox|tienda) rol:@rol`:
- **eventos** → al empezar y al terminar un evento.
- **lootbox** → en premios épicos/legendarios y NFT de alto valor del canal de premios, **en vez de `@everyone`** (máx. un aviso por minuto). Sin rol se usa `@everyone` solo si lo dejaste activo en `/set-logs-channel`.
- **tienda** → al publicar un artículo **nuevo** y cuando la Tienda de Expedición se renueva sola.

---

# Referencia general (heredada de la v4, sigue vigente)

## Eventos globales

- `/set-events-channel canal:#eventos [everyone:true]` los activa. El primero llega entre 2 y 24 h después; tras cada evento, el siguiente aparece pasadas entre **8 y 72 h** (`events.minGapHours/maxGapHours` en `config.js`) y dura 2-6 h según el tipo. Es totalmente automático y sobrevive a reinicios (todo está en MongoDB).
- Efectos (`data/events.js`): Tormenta de Sangre −15% supervivencia y Coinks ×1,5; Lluvia de Estrellas +10% y ×1,25; Fiebre del Oro Coinks ×2; Niebla Espectral −5% y ×1,15. Cada expedición exitosa tiene una probabilidad (15-25%) de soltar un **objeto único del evento** (rareza `event`, 3 por evento, perks de +Coinks o "sobrevivir a la muerte", 15 usos, no vendibles ni fusionables).
- Cada premio de evento se anuncia en el canal de eventos **mencionando al ganador**.

## Tienda de Expedición rotativa

- `/set-expedition-shop-channel canal:#tienda-expedicion` publica un **panel**: cabecera + una tarjeta por objeto (imagen opcional, stats, usos, precio, stock y botón *Comprar*). Cada **12 h** (`EXPSHOP_ROTATION_HOURS`, 2 rotaciones al día) el bot borra el panel anterior y publica un escaparate nuevo de **10 objetos** (2 comunes, 2 poco comunes, 3 raros, 2 épicos, 1 legendario; arma/armadura/casco al azar y sin repetir los de la rotación anterior). El stock se actualiza solo con cada compra.
- Catálogo: 30 objetos exclusivos (`data/exclusive.js`). **No caen** en expediciones, cajas, ni se pueden fusionar o vender. Stats: +6%…+32% de supervivencia según rareza (el doble que el equipo normal) y algunos con perks.
- **Usos limitados** por rareza: común 3, poco común 5, raro 7, épico 9, legendario 11 (los de evento, 15). Se gasta **1 uso por expedición completada** (las canceladas no gastan). Al llegar a 0 el objeto se rompe y se avisa en el resultado.
- Precio / stock por rotación y servidor: 300/8, 700/6, 1.800/4, 4.500/2 y 11.000/1 Coinks (`SHOP_PRICE`/`SHOP_STOCK`). **Máximo 1 unidad por persona y rotación** (para que un solo jugador no acapare). La compra es atómica (reserva de stock → cobro → entrega, con reversión si algo falla).
- Se compra con el botón de cada tarjeta del panel (no hay comando manual).
- Equipar: el equipo **se bloquea mientras el cerdito está de expedición** (así el equipo y los usos del resultado son los que salieron). Si olvidaste algo: cancela.
- Imágenes: `data/media.json` → `expshop.header`, `expshop.rarity.<rareza>` y `expshop.item.<id>` (por objeto).

## Cancelar una expedición

`/expedicion cancelar` (con confirmación). Coste = `12 × multiplicador de recompensa × (0,4 + 0,6 × fracción de tiempo transcurrido)`, mínimo 5: **cuanto antes canceles, menos pagas**. El cerdito vuelve sin botín y sin gastar usos; luego puedes equipar y reenviar. Si la expedición termina en ese instante, se te devuelve el cobro. Ajustable en `CANCEL` (`data/gameData.js`).

## Zonas, dificultad y recompensas

Recompensa de Coinks = rango de la rareza × `rewardMult`, con `rewardMult = (minutos / 10) × dificultad`:

| Zona | Duración | Dificultad | rewardMult | Superv. base | Eficacia equipo normal |
|---|---|---|---|---|---|
| Bosque Embarrado | 10 min | 1,0 | ×1 | 70% | 100% |
| Cueva Oscura | 30 min | 1,15 | ×3,45 | 55% | 100% |
| Volcán Jamonero | 1 h | 1,3 | ×7,8 | 40% | 90% |
| Ruinas Malditas | 4 h | 1,4 | ×33,6 | 25% | 70% |
| Abismo Eterno | 12 h | 1,6 | ×115,2 | 12% | 50% |
| Trono del Dragón | 1 día | 1,8 | ×259,2 | 5% | 35% |

El equipo **normal** rinde cada vez menos en las zonas largas (columna "eficacia") y el **exclusivo** siempre al 100%, así que con el mejor equipo normal tienes ~28% de volver del Trono y con el set legendario de la tienda ~85%. `npm run expedition:ev` imprime la tabla de supervivencias, EV de Coinks por expedición/hora, coste de cancelar y coste por uso de cada rareza para que lo balancees.

> **Cambios que afectan al balance:** las zonas existentes (Cueva y Volcán) ahora pagan ×3,45 y ×7,8 (antes pagaban lo mismo que el Bosque). Las expediciones ya en curso al actualizar se resuelven con las reglas nuevas. Las zonas largas pagan mucho (la suerte de rareza sube con la dificultad, así que el reparto real crece algo más rápido que tiempo × dificultad): vigila la inflación con el libro contable y ajusta `difficulty`/`luck` en `ZONES`; con `luck: 1` el pago es estrictamente `tiempo × dificultad`.

## Tienda en un canal (estilo Drip)

1. `/set-store-channel canal:#tienda` → el bot comprueba sus permisos y publica una tarjeta por artículo (ordenadas por precio).
2. `/tienda-admin agregar` ahora acepta `imagen` (URL `https://` estable: tu CDN o un host de imágenes; los enlaces de adjuntos de Discord caducan). `/tienda-admin editar` permite cambiar precio, stock, descripción, imagen y visibilidad.
3. Cada compra, reembolso o edición actualiza la tarjeta (stock, *Agotado* con botón desactivado). Si ocultas un artículo, su tarjeta se borra. Si borras una tarjeta a mano, el bot la republica en el siguiente cambio. `/tienda-admin refrescar` reconstruye todo.
4. Cambiar de canal borra las tarjetas del canal anterior. `/set-store-channel desactivar:true` las quita todas. Se compra solo con el botón de la tarjeta.

## Logs de lootboxes

`/set-logs-channel canal:#premios everyone:true minimo:Todos` anuncia cada premio (las cajas vacías no se anuncian). `minimo` filtra por rareza; los NFT siempre se anuncian. `@everyone` solo en premios **épicos o legendarios** y **NFT de alto valor** (`/lootbox-admin nft-agregar alto-valor:true`, por defecto sí), con un máximo de **un ping por minuto y servidor** para evitar spam. El bot necesita el permiso *Mencionar @everyone* en ese canal; si falta, anuncia sin ping y te avisa al configurarlo. Los avisos privados para admins (pedidos de tienda, NFT por entregar) siguen yendo a `ADMIN_LOG_CHANNEL_ID`.

## Arsenal

`data/arsenal.js` es la fuente única: 10 armas y 10 armaduras por rareza (cada una con su bonus de supervivencia dentro de la banda de su rareza, y nombres ES/EN) más 1 casco por rareza. Los objetos de versiones anteriores **conservan su id y bonus**, así que los inventarios guardados siguen válidos. Al caer un objeto se elige primero la ranura (40% arma, 40% armadura, 20% casco, editable en `DROP_SLOT_WEIGHTS`) y luego un modelo al azar de esa rareza. Para añadir objetos: una fila `[id, nombreES, nombreEN]` en su grupo; `npm run check:i18n` valida que haya al menos 10 por tipo y rareza.

> Pediste cuatro rarezas (Común, Raro, Épico, Legendario); el juego ya tenía también *Poco común*, así que la rareza intermedia también tiene sus 10 + 10 en vez de quitarla (habría roto inventarios existentes).

## Venta y fusión
Desde `/inventario` con los botones **Vender** / **Fusionar** (los menús muestran precios y recetas).

- **Vender:** eliges el objeto y vendes 1 o todos los del mismo modelo. Precio por rareza: 8 / 25 / 80 / 250 / 800 Coinks (`SELL_PRICE`). La operación es atómica (no se puede vender dos veces la misma copia).
- **Fusionar:** N objetos del **mismo tipo y rareza** → 1 objeto aleatorio de la **rareza siguiente** (mismo tipo). Escala así (`FUSION` en `data/gameData.js`):

| Fusión | Objetos | Modelos distintos | Tarifa | Éxito |
|---|---|---|---|---|
| Común → Poco común | 3 | 1 | 0 | 100% |
| Poco común → Raro | 4 | 2 | 50 | 90% |
| Raro → Épico | 5 | 3 | 300 | 75% |
| Épico → Legendario | 6 | 4 | 1500 | 60% |

Si falla, se pierden los objetos y se devuelve el 50% de su valor de venta; la tarifa siempre se cobra. Para quitar el riesgo pon `chance: 1`. Los cascos (1 modelo por rareza) piden como máximo ese único modelo. Eliges tú qué copias consumir (el menú muestra primero un ejemplar de cada modelo para poder cumplir la variedad). El consumo de objetos y el cobro son **una sola operación atómica** contra tu saldo e inventario. Los Coinks y objetos quedan registrados en el libro contable (`item_sell`, `fusion_fee`, `fusion_consolation`).

## Primeros pasos con lo nuevo

- **Panel de wallets:** `/verificacion-panel` en el canal elegido. Los botones sobreviven a reinicios.
- **Desvincular:** `/wallet-desvincular usuario:@x direccion:(autocompleta) motivo:...`
- **Tienda:** `/tienda-admin agregar` (tipo *Rol* = entrega automática; *Manual* = pedido pendiente que un admin entrega con `/tienda-admin entregar`). Los pedidos manuales avisan en `ADMIN_LOG_CHANNEL_ID`.
- **Sorteos:** `/sorteo crear duracion:2h premio-coinks:500 ganadores:3 costo:50` (el costo es opcional; 0 = gratis). Se cierran solos y sobreviven a reinicios.
- **NFT como premio de caja:** `/lootbox-admin nft-agregar` (1 registro = 1 NFT). Cuando alguien lo gana, queda reservado y se avisa a los admins; **tú lo envías a mano** a la wallet vinculada del ganador y lo marcas con `/lootbox-admin nft-entregar`. El bot **nunca custodia NFTs ni claves privadas**.
- **Balance de cajas:** edita `data/lootboxes.js` y ejecuta `npm run lootbox:ev` para ver probabilidades y retorno esperado antes de publicar. El panel de cajas muestra a los jugadores un resumen de las probabilidades.

## GIF / WEBP

Edita `data/media.json` (se recarga sin reiniciar). Cada clave admite varias entradas; se elige una al azar:

```json
"lootbox.legendary": ["https://tu-cdn.com/legendario.gif", "assets/lootbox/legendary.webp"]
```

- `https://…` se usa directo en el embed. `assets/…` adjunta un archivo local (solo dentro de `/assets`).
- Claves: `colorgame.start|win|lose`, `expedition.start[.zona]|survive[.zona][.rareza]|die[.zona]`, `lootbox.opening|common|uncommon|rare|epic|legendary|nft|nothing`, `giveaway.end`.
- Las más específicas tienen prioridad (`expedition.die.volcan` antes que `expedition.die`). Las vacías simplemente no muestran imagen.
- Usa enlaces estables (tu propio CDN o un archivo subido a Discord); los enlaces de buscadores de GIFs pueden caducar. Los GIF pesados (>8 MB) pueden no animarse en el embed.

## Idiomas y frases

`interaction.t('clave', { vars })` en todos los comandos. Prioridad: `/idioma` → idioma del cliente de Discord del usuario → idioma preferido del servidor → `DEFAULT_LANG`. Los avisos sin interacción (expedición que regresa, sorteo que termina) usan el idioma guardado al iniciarlos.

Los valores que son arrays en `locales/*.js` se eligen al azar: añade líneas para tener más variedad (por ejemplo `expedition.death.volcan`). Para una zona nueva, añade `zone.<id>`, `expedition.death.<id>` y `expedition.survive.<id>`. `npm run check:i18n` valida que ES y EN tengan las mismas claves y que no falte ninguna usada en el código.


## Estructura

```
index.js · deploy-commands.js · config.js
migrations/001-v2.js            # migración idempotente al arrancar
models/                         # User, Ledger, WalletLink, NftCollection, Expedition, ExpShopRotation, GameEvent, GuildConfig,
                                # ShopItem, ShopPurchase, Giveaway, NftPrize, LootboxLog, RolePanel, AuditLog
data/                           # gameData, arsenal, exclusive, events, lootboxes, media.json
locales/                        # es.js, en.js
utils/                          # economy, i18n, media, blockchain, confirm, permissions, adminLog, guildConfig, loader, helpers
services/                       # nftSync, expeditions, inventory, shop, storeSync, expShop, events, purchaseLog, autoroles, giveaways, lootbox, lootboxLog
tasks/                          # nftSyncTask, expeditionTask, giveawayTask, eventTask, expShopTask
events/                         # ready, interactionCreate (router + permisos)
commands/economy/ · commands/games/ · commands/nft/
scripts/                        # lootbox-ev, expedition-ev, check-i18n, migrate
```

Un comando puede declarar `components: [{ kind: 'button'|'modal'|'select', prefix, execute }]` (customId `prefijo:arg1:arg2`); el loader los registra solo. Aquí: `shop` (set-store-channel), `xshop` (set-expedition-shop-channel), `ar` (autoroles), `inv` (inventario), `gw` (sorteo), `lb` (lootbox), `wl` (verificacion-panel).

## Instalación desde cero

Node.js 18.17+ (recomendado 20+). MongoDB Atlas: crea cluster, usuario y permite tu IP en *Network Access*. Discord Developer Portal: crea el bot, activa **Server Members Intent**, copia token y Application ID, e invítalo con `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=268454912`. Sube el rol del bot por encima de los roles que vaya a gestionar.

```bash
npm install
cp .env.example .env      # rellena token, CLIENT_ID, GUILD_ID, MONGODB_URI, RPCs...
npm run deploy
npm start
```

## Notas de seguridad y límites

- **El panel de wallets no prueba que seas el dueño de la dirección** (Collab.Land sí, porque pide firmar un mensaje en una web). Aquí cualquiera puede escribir la dirección pública de otra persona. Mitigaciones incluidas: confirmación, una wallet = una cuenta, y `/wallet-desvincular` para corregir suplantaciones. Si los roles o los NFT premio tienen valor real, añade verificación por firma (SIWE) en el punto `onModalSubmit` de `verificacion-panel.js`.
- Los NFT premio exigen wallet vinculada y se entregan manualmente. Antes de entregar, comprueba la wallet y, si te preocupa la suplantación, verifica al ganador por otra vía.
- Las cajas son una mecánica de azar con premios de valor real (NFT). Si algún día los Coinks se pueden comprar con dinero, revisa la normativa de *loot boxes* de tus países. Las probabilidades son públicas en el panel de cajas.
- Roles por rasgo: requieren contratos ERC721Enumerable y metadatos accesibles. Ronin se trata como EVM. Usa RPC propios (Alchemy, Infura…).
- Las URIs de metadatos las define el contrato: el bot hace peticiones HTTP a ellas. Registra solo colecciones en las que confíes.
- Los premios en Coinks de sorteos se pagan como máximo una vez por ganador, incluso si el bot se reinicia a mitad del reparto (en un caso extremo podría quedar sin pagar uno; el error se registra en consola).
