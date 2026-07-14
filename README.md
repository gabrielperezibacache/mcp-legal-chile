# MCP Legal Chile

Conector **MCP** de derecho chileno para Claude, Cursor y apps compatibles.

**Producción:** https://mcp-legal-chile.onrender.com/mcp  
**Versión:** 1.7.0

## Matriz de honestidad (qué trae cada tool)

| Tool | Evidencia | Fuente |
|---|---|---|
| `citar_texto_legal` | **Texto íntegro + cita** | XML LeyChile en blockquote |
| `buscar_doctrina` / `obtener_doctrina` | Metadata + abstract + **citas Chile/APA** | **SciELO Chile** (22 revistas) + OpenAlex + Crossref |
| `buscar_doctrina_latam` | Metadata + citas + enlaces por país | Catálogo PE / BR / AR / MX / CO (OpenAlex + SciELO/OJS) |
| `buscar_jurisprudencia` | **Solo enlace** (PJUD) | Búsqueda web → pjud.cl |
| `buscar_tc` | Metadata + PDF | API `buscador-backend.tcchile.cl` |
| `resolver_rol` | Enlaces + candidatos | TC API + portales PJUD/TC/TDLC… |
| `obtener_fallo_tc` | **Extracto + blockquote** | API oficial Tribunal Constitucional |
| `buscar_dictamenes` / `resolver_dictamen` | **Solo enlace** | Contraloría |
| `investigar_tema` | Pack mixto | Orquesta lo anterior |

**Regla:** si `evidence=link_only`, el asistente no debe afirmar el contenido del fallo/dictamen.

## SLOs (objetivos P95)

| Operación | Objetivo |
|---|---|
| Artículo con cache hit | &lt; 500 ms |
| Artículo cold (sin 429) | &lt; 5 s |
| `buscar_legislacion` | &lt; 4 s |
| `buscar_derecho_chileno` (parcial OK) | &lt; 8 s |
| Éxito XML LeyChile (24h, con caché) | &gt; 95% |

Métricas en vivo: `GET /metrics`

## Capacidades principales

- Texto oficial LeyChile (artículos, índice/cuerpo, inciso/literal heurístico)
- Catálogo de normas frecuentes (CPR, Códigos, 19.628, 19.496…)
- `investigar_tema` — pack anti-alucinación
- `formatear_cita` — citas chilenas solo con IDs ya obtenidos
- Jurisprudencia/TC con parsers ROL/RIT + catálogo de 18 tribunales/portales
- Caché durable (Redis si `REDIS_URL`) + singleflight + stale-if-error
- Rate limit / circuit breaker por proveedor (LeyChile, TC, OpenAlex, Crossref, SciELO…)
- API keys + cuotas diarias persistentes en Redis (`MCP_API_KEYS` + `REDIS_URL`)
- `investigar_tema` cancela fetches al expirar `PACK_TIMEOUT_MS`
- Warmup `/warmup` + cron keep-alive

## Inicio rápido

```bash
npm install
npm run dev
npm test
# smoke local (server corriendo):
SMOKE_BASE=http://127.0.0.1:3000 npm run smoke
```

MCP: `http://localhost:3000/mcp`

## Variables de entorno

| Variable | Descripción |
|---|---|
| `REDIS_URL` | Redis/Key Value: caché + cuotas diarias (si falta, solo memoria) |
| `MCP_API_KEYS` | `name:key:limit,...` — cuotas por key; persistentes con Redis |
| `SEARCH_PROVIDER` | `auto` \| `serper` \| `brave` |
| `SEARCH_API_KEY` / `SERPER_API_KEY` / `BRAVE_API_KEY` | Búsqueda web |
| `WARMUP_ON_BOOT` | `1` (default) / `0` |
| `LEYCHILE_MIN_INTERVAL_MS` | Intervalo mínimo entre requests LeyChile |
| `CIRCUIT_OPEN_MS` / `CIRCUIT_THRESHOLD` | Circuit breaker |
| `UNIFIED_BUDGET_MS` / `PACK_TIMEOUT_MS` | Presupuestos de fan-out |

## Deploy

Blueprint: [`render.yaml`](render.yaml) — plan **starter**, Key Value, cron keep-alive cada 10 min.

## Aviso

No sustituye asesoría jurídica. PJUD/CGR no ofrecen API abierta de texto completo.
