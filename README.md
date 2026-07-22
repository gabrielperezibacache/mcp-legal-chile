# MCP Legal Chile

Conector **MCP** libre y gratuito de derecho chileno para Claude, Cursor y apps compatibles.

**Licencia:** [MIT](LICENSE) — código abierto  
**Producción:** https://mcp-legal-chile.onrender.com/mcp  
**Versión:** 1.12.0

## Proyecto libre

Este MCP usa **solo fuentes públicas sin costo de API**:

| Fuente | Uso |
|---|---|
| LeyChile / BCN SPARQL | Texto y metadata de normas |
| Tribunal Constitucional | Fallos TC con texto y considerandos |
| OpenAlex + DOAJ + Crossref | Doctrina académica OA |
| SciELO ArticleMeta | Enrich de artículos SciELO (PDF/HTML) por DOI/PID |
| Portales oficiales (PJUD, CGR, etc.) | Deep links |
| DuckDuckGo HTML/lite | Búsqueda web best-effort (sin claves) |

**No** se usan APIs comerciales (Serper, Brave, vLex, etc.).  
PJUD no publica API de texto: para citar Corte Suprema / Apelaciones, pega el fallo en `citar_jurisprudencia`.

Acceso abierto por defecto (sin `MCP_API_KEYS`). Redis es opcional para self-host.  
`CONTACT_EMAIL` activa el *polite pool* de OpenAlex/Crossref (`mailto=`).

## Matriz de honestidad (qué trae cada tool)

| Tool | Evidencia | Fuente |
|---|---|---|
| `citar_texto_legal` | **Texto íntegro + cita** | XML LeyChile en blockquote |
| `citar_jurisprudencia` | **Texto + considerando** | API TC gratis, o **texto pegado** (PJUD) |
| `buscar_doctrina` / `obtener_doctrina` | Metadata + abstract + citas | OpenAlex + **DOAJ** + Crossref + ArticleMeta |
| `buscar_doctrina_latam` | Metadata + citas + enlaces | Catálogo ISSN + OpenAlex + DOAJ |
| `buscar_jurisprudencia` | Enlace / candidatos | TC + DDG libre → portales PJUD |
| `buscar_tc` | Metadata + PDF | API gratuita TC |
| `resolver_rol` | Enlaces + candidatos | TC + portales |
| `obtener_fallo_tc` | Extracto + índice de considerandos | API gratuita TC |
| `buscar_dictamenes` / `resolver_dictamen` | Solo enlace | Contraloría (deep link por número) |
| `investigar_tema` | Pack mixto (parcial OK) | Orquesta lo anterior (~12s) |

**Integridad (anti-alucinación):** cada resultado lleva `integrity`:

| Nivel | Significado |
|---|---|
| `verified` | Texto/fuente oficial recuperada por el MCP |
| `candidate` | Metadato o enlace a verificar; no afirmar contenido |
| `portal_stub` | Solo portal de búsqueda; **no** es un documento encontrado |

**Calidad de citas (1.11):** jurisprudencia unifica el formato chileno (tribunal, tipo, ROL, año, considerando); la web ya no usa el título de página como cita. Doctrina normaliza autores (`Apellido, N.`), completa vol./páginas DOAJ y prioriza relevancia temática + catálogo Chile.

**Reglas:** si `evidence=link_only` o `integrity` es `portal_stub`/`candidate`, no afirmes el contenido. `citar_jurisprudencia` **rechaza** un considerando que no exista en el texto (no sustituye por otro). Sin resultados → decirlo; no completar con memoria.

### Cómo usarlo sin quedarse corto

1. Empieza con `investigar_tema` (mapa rápido).
2. Extrae texto con `citar_texto_legal`, `obtener_articulo`, `obtener_fallo_tc` o `citar_jurisprudencia`.
3. Fallos PJUD: abre el [portal unificado](https://www.pjud.cl/portal-unificado-sentencias), copia el texto y pásalo a `citar_jurisprudencia` con `rol`, `tribunal` y `texto`.

## SLOs (objetivos P95)

| Operación | Objetivo | Notas |
|---|---|---|
| Artículo con cache hit | &lt; 500 ms | |
| Artículo cold (sin 429) | &lt; 5 s | LeyChile puede rate-limitar |
| `buscar_legislacion` | &lt; 4 s | SPARQL BCN |
| `buscar_derecho_chileno` (parcial OK) | &lt; 8 s | |
| `investigar_tema` (parcial OK) | &lt; **18 s** | Tope duro `PACK_TOTAL_MS` (default 18s; ~11s por fuente) |
| Éxito XML LeyChile (24h, con caché) | &gt; 95% | |

Métricas en vivo: `GET /metrics`

## Capacidades principales

- Texto oficial LeyChile (artículos, índice/cuerpo, inciso/literal heurístico)
- Doctrina OA: ranking por relevancia, abstracts (backfill Crossref), enrich SciELO
- `citar_jurisprudencia` con considerando (TC o texto pegado)
- Caché en memoria (Redis opcional)
- Rate limit / circuit breaker **por proveedor** (LeyChile 429 no abre el circuito de doctrina/OpenAlex)
- Warmup `/warmup` + cron keep-alive
- Endurecimiento de producción (1.12): CORS explícito para clientes MCP en navegador, rate limit por IP en `/mcp` (60 req/min por defecto, independiente de las cuotas por API key), errores JSON-RPC limpios (sin stack traces ni rutas de archivo aunque `NODE_ENV` no esté seteado), apagado ordenado ante `SIGTERM`/`SIGINT`, timeouts de socket HTTP contra clientes lentos, y `uncaughtException`/`unhandledRejection` no derriban el proceso

> **Nota clientes MCP (Hermes, etc.):** un mensaje global tipo «MCP unreachable» tras ~3 errores suele ser **protección del cliente**, no del servidor. En el servidor los circuitos son por host; ante 429 de LeyChile las tools de texto devuelven markdown útil (URL oficial + reintento) sin marcar `isError` cuando es posible.

## Inicio rápido

```bash
npm install
npm run dev
npm test
SMOKE_BASE=http://127.0.0.1:3000 npm run smoke
```

MCP: `http://localhost:3000/mcp`

## Variables de entorno

| Variable | Descripción |
|---|---|
| `CONTACT_EMAIL` | Polite pool OpenAlex/Crossref (`mailto=`) |
| `REDIS_URL` | Opcional: Redis self-host |
| `MCP_API_KEYS` | Opcional — si falta, acceso abierto |
| `WARMUP_ON_BOOT` | `1` (default) / `0` |
| `SEARCH_TOOL_TIMEOUT_MS` | Tope búsquedas standalone (default 22s) |
| `JURIS_WEB_BUDGET_MS` / `WEB_SEARCH_TIMEOUT_MS` | Búsqueda web libre (DDG) |
| `WEB_FAIL_CACHE_MS` | Enfriamiento tras bloqueo DDG (default 180s) |
| `PACK_TOTAL_MS` | Tope `investigar_tema` (default 18s) |
| `PACK_TIMEOUT_MS` | Timeout por fuente en el pack (default ~11s) |
| `RATE_LIMIT_PER_MINUTE` | Tope de requests/IP a `/mcp` (default 60) |
| `HTTP_REQUEST_TIMEOUT_MS` / `HTTP_HEADERS_TIMEOUT_MS` / `HTTP_KEEPALIVE_TIMEOUT_MS` | Timeouts de socket HTTP (defaults 60s/65s/61s) |

## Deploy

Blueprint: [`render.yaml`](render.yaml) — plan **free**, sin Key Value de pago ni API keys comerciales.

## Aviso

No sustituye asesoría jurídica. PJUD/CGR no ofrecen API abierta de texto completo. El MCP es un puente gratuito a fuentes oficiales y OA.
