# MCP Legal Chile

Conector **MCP** libre y gratuito de derecho chileno para Claude, Cursor y apps compatibles.

**Licencia:** [MIT](LICENSE) — código abierto  
**Producción:** https://mcp-legal-chile.onrender.com/mcp  
**Versión:** 1.15.0

## Proyecto libre

Este MCP usa **solo fuentes públicas sin costo de API**:

| Fuente | Uso |
|---|---|
| LeyChile / BCN SPARQL | Texto y metadata de normas |
| Tribunal Constitucional | Fallos TC con texto y considerandos |
| OpenAlex + DOAJ + Crossref | Doctrina académica OA |
| SciELO ArticleMeta | Enrich de artículos SciELO (PDF/HTML) por DOI/PID |
| Portales oficiales (PJUD, CGR, superintendencias, etc.) | Deep links |
| Yahoo HTML (+ DDG HTML/lite fallback) | Búsqueda web best-effort (sin claves) |

**No** se usan APIs comerciales (Serper, Brave, vLex, etc.).  
PJUD no publica API de texto: para citar Corte Suprema / Apelaciones, pega el fallo en `citar_jurisprudencia`.

Acceso abierto por defecto (sin `MCP_API_KEYS`). Redis es opcional para self-host.  
`CONTACT_EMAIL` activa el *polite pool* de OpenAlex/Crossref (`mailto=`).

> **Excepción — `pjudCauses` (§ [Case-tracking PJUD](#case-tracking-pjud-experimentalno-oficial)):** a diferencia de todo lo anterior, esta función **sí** elude una protección anti-bot (paga un solver de CAPTCHA para pasar el WAF F5/TSPD de PJUD). Está **deshabilitada por defecto** y es responsabilidad de quien la active.

## Matriz de honestidad (qué trae cada tool)

| Tool | Evidencia | Fuente |
|---|---|---|
| `citar_texto_legal` | **Texto íntegro + cita** | XML LeyChile en blockquote |
| `citar_jurisprudencia` | **Texto + considerando** | API TC gratis, o **texto pegado** (PJUD) |
| `buscar_doctrina` / `obtener_doctrina` | Metadata + abstract + citas | OpenAlex + **DOAJ** + Crossref + ArticleMeta |
| `buscar_doctrina_latam` | Metadata + citas + enlaces | Catálogo ISSN + OpenAlex + DOAJ |
| `buscar_jurisprudencia` | Enlace / candidatos | TC + web libre (Yahoo) → portales PJUD |
| `buscar_tc` | Metadata + PDF | API gratuita TC |
| `resolver_rol` | Enlaces + candidatos | TC + portales |
| `obtener_fallo_tc` | Extracto + índice de considerandos | API gratuita TC |
| `buscar_dictamenes` / `resolver_dictamen` | Solo enlace | Contraloría (deep link por número) |
| `buscar_administrativo` | Solo enlace / portal_stub | CMF, Superintendencia de Salud, SUSESO, SEC, SUPERIR (sin API pública) |
| `investigar_tema` | Pack mixto (parcial OK) | Orquesta lo anterior (~18s); cierra con Verificado / Por verificar / Portales / Próximos pasos |
| `pegar_fallo_pjud` | **Texto + considerando** | Fallo PJUD/CS/CA pegado (sin API abierta) |
| `citar_dictamen_pegado` | **Texto + cita** | Dictamen CGR pegado desde el portal |
| `flujo_estudio` | Plan de tools (local) | Router memo / escrito / seguimiento_causa / cita_rapida / consulta |
| `buscar_causa_pjud` / `obtener_causa_pjud` | **Siempre `candidate`** (scraping) | Oficina Judicial Virtual PJUD — **experimental/no oficial**, ver [abajo](#case-tracking-pjud-experimentalno-oficial) |

**Integridad (anti-alucinación):** cada resultado lleva `integrity`:

| Nivel | Significado |
|---|---|
| `verified` | Texto/fuente oficial recuperada por el MCP |
| `candidate` | Metadato o enlace a verificar; no afirmar contenido |
| `portal_stub` | Solo portal de búsqueda; **no** es un documento encontrado |

**Calidad de citas:** jurisprudencia unifica el formato chileno (tribunal, tipo, ROL, año, considerando); la web ya no usa el título de página como cita. Doctrina normaliza autores (`Apellido, N.`), completa vol./páginas DOAJ y prioriza relevancia temática + catálogo Chile. Niveles de `integrity`: `verified` | `candidate` | `portal_stub` (evidence puede ser `full_text` / `metadata` / `link_only`).

**Reglas:** si `evidence=link_only` o `integrity` es `portal_stub`/`candidate`, no afirmes el contenido. `citar_jurisprudencia` **rechaza** un considerando que no exista en el texto (no sustituye por otro). Sin resultados → decirlo; no completar con memoria.

### Cómo usarlo sin quedarse corto

1. Empieza con `flujo_estudio` (elige modo: memo / escrito / seguimiento_causa / cita_rapida) o `investigar_tema` (mapa rápido).
2. Extrae texto con `citar_texto_legal`, `obtener_articulo`, `obtener_fallo_tc` o `citar_jurisprudencia`.
3. Fallos PJUD: abre el [portal unificado](https://www.pjud.cl/portal-unificado-sentencias), copia el texto y pásalo a `pegar_fallo_pjud` (o `citar_jurisprudencia` con `texto`).
4. Dictámenes CGR: `resolver_dictamen` (enlace) → pega el cuerpo en `citar_dictamen_pegado`.
5. Prompts del servidor: `flujo_estudio`, `pegar_fallo_pjud`, `pegar_dictamen_cgr`, checklists (protección, laboral, ejecutivo, familia, contencioso-administrativo, nulidad penal).

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
- Rate limit / circuit breaker **por proveedor** (LeyChile XML aislado de BCN SPARQL/HTML; DOAJ aislado de Crossref; abort/deadline no abre circuitos; un solo conteo terminal tras reintentos)
- Warmup boot + `GET /warmup` (cron) omiten XML si LeyChile está en cooldown 429 / circuito abierto
- Endurecimiento de producción: CORS explícito para clientes MCP en navegador, rate limit por IP en `/mcp` (60 req/min por defecto, independiente de las cuotas por API key), errores JSON-RPC limpios (sin stack traces ni rutas de archivo aunque `NODE_ENV` no esté seteado), apagado ordenado ante `SIGTERM`/`SIGINT`, timeouts de socket HTTP contra clientes lentos, y `uncaughtException`/`unhandledRejection` no derriban el proceso

> **Nota clientes MCP (Hermes, etc.):** un mensaje global tipo «MCP unreachable» tras ~3 errores suele ser **protección del cliente**, no del servidor. En el servidor los circuitos son por host; ante 429 o circuito abierto de LeyChile las tools de texto devuelven markdown útil (URL oficial + reintento) sin marcar `isError` cuando es posible.

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

## Case-tracking PJUD (experimental/no oficial)

`buscar_causa_pjud` / `obtener_causa_pjud` automatizan la **Consulta Unificada de Causas** de PJUD (Oficina Judicial Virtual) para devolver estado, litigantes y movimientos por RUT/nombre o ROL/RIT/RUC. A diferencia de todo el resto de este proyecto:

- **Elude activamente** el WAF anti-bot (F5/TSPD) de PJUD usando un navegador headless (Playwright) y un **servicio de pago** de resolución de CAPTCHA (2Captcha o CapSolver).
- No es una API oficial ni endorsada por PJUD: los datos son **siempre `integrity=candidate`**, obtenidos por scraping, y pueden romperse sin aviso si PJUD cambia su HTML/anti-bot.
- Implica un **riesgo de Términos de Servicio** que asume explícitamente quien habilite la función (ver [`docs/pjud-casetracking-solution.md`](docs/pjud-casetracking-solution.md) para el diseño completo).

**Deshabilitada por defecto** (kill switch): si `PJUD_CAUSAS_ENABLED != 1` o no hay un solver de CAPTCHA configurado, ambas tools degradan a una respuesta tipo `portal_stub` con el link a la Consulta Unificada, nunca fallan en silencio ni inventan datos.

| Variable | Descripción |
|---|---|
| `PJUD_CAUSAS_ENABLED` | `1` para habilitar (default: deshabilitado) |
| `CAPTCHA_SOLVER_PROVIDER` | `2captcha` \| `capsolver` |
| `CAPTCHA_SOLVER_API_KEY` | API key del solver (cuenta de pago) |
| `CAPTCHA_SOLVE_TIMEOUT_MS` | Timeout de resolución (default 120s) |
| `PJUD_SESSION_TTL_MS` | TTL de la cookie de sesión reutilizada (default 25 min), para amortizar el costo del CAPTCHA entre búsquedas |
| `PJUD_CAUSAS_DAILY_SOLVE_BUDGET` | Tope diario de CAPTCHAs resueltos (control de costo/abuso, default 50) |
| `PJUD_CAUSAS_CACHE_TTL_MS` / `PJUD_CAUSAS_CACHE_STALE_MS` | Cache de resultados (default 6h / 24h) — el estado de una causa cambia a lo sumo a diario |

`npm run build`/`postinstall` **no** descarga Chromium salvo que `PJUD_CAUSAS_ENABLED=1` esté seteado en tiempo de instalación (ver `scripts/installPlaywright.mjs`), así el build por defecto (p. ej. `render.yaml`) permanece liviano.

## Deploy

Blueprint: [`render.yaml`](render.yaml) — plan **free**, sin Key Value de pago ni API keys comerciales. `pjudCauses` está comentado en el blueprint por defecto: requiere una API key de pago (agrégala manualmente en el dashboard de Render si decides habilitarla).

## Aviso

No sustituye asesoría jurídica. PJUD/CGR no ofrecen API abierta de texto completo. El MCP es un puente gratuito a fuentes oficiales y OA.
