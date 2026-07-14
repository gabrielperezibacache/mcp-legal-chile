# MCP Legal Chile

Conector **MCP** de derecho chileno para Claude, Cursor y apps compatibles.

**Producción:** https://mcp-legal-chile.onrender.com/mcp  
**Versión:** 1.7.1

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
| `investigar_tema` | Pack mixto (parcial OK) | Orquesta lo anterior con tope global ~12s |

**Regla:** si `evidence=link_only`, el asistente no debe afirmar el contenido del fallo/dictamen.

### Cómo usarlo sin quedarse corto

1. Empieza con `investigar_tema` (mapa rápido, no texto íntegro de todo).
2. Extrae texto solo con tools de extracción: `citar_texto_legal`, `obtener_articulo`, `obtener_fallo_tc`.
3. No esperes contenido de PJUD/CGR vía `buscar_*` — solo enlaces oficiales a verificar.

## SLOs (objetivos P95)

| Operación | Objetivo | Notas |
|---|---|---|
| Artículo con cache hit | &lt; 500 ms | |
| Artículo cold (sin 429) | &lt; 5 s | LeyChile puede rate-limitar |
| `buscar_legislacion` | &lt; 4 s | SPARQL BCN |
| `buscar_derecho_chileno` (parcial OK) | &lt; 8 s | |
| `investigar_tema` (parcial OK) | &lt; **12 s** | Tope duro `PACK_TOTAL_MS`; no es 4–8s end-to-end |
| Éxito XML LeyChile (24h, con caché) | &gt; 95% | |

**Latencia variable (0.2–8s):** típica en Render starter (arranque en frío / red). El keep-alive mitiga, no elimina.

Métricas en vivo: `GET /metrics`

## Capacidades principales

- Texto oficial LeyChile (artículos, índice/cuerpo, inciso/literal heurístico)
- Catálogo de normas frecuentes (CPR, Códigos, 19.628, 19.496…)
- `investigar_tema` — pack anti-alucinación con presupuesto global y salida acotada (~10k chars)
- `formatear_cita` — citas chilenas solo con IDs ya obtenidos
- Jurisprudencia/TC con parsers ROL/RIT + catálogo de 18 tribunales/portales
- Caché durable (Redis si `REDIS_URL`) + singleflight + stale-if-error
- Rate limit / circuit breaker por proveedor (LeyChile, TC, OpenAlex, Crossref, SciELO…)
- API keys + cuotas diarias persistentes en Redis (`MCP_API_KEYS` + `REDIS_URL`)
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
| `UNIFIED_BUDGET_MS` | Tope fan-out `buscar_derecho_chileno` (default 8s) |
| `PACK_TOTAL_MS` | Tope global `investigar_tema` (default 12s) |
| `PACK_TIMEOUT_MS` | Tope por fuente dentro del pack (default ~6s) |
| `PACK_MAX_CHARS` | Cap de salida del pack (default 10_000) |
| `PACK_ARTICLE_CHARS` | Cap de quote de artículo en pack (default 1_200) |

## Deploy

Blueprint: [`render.yaml`](render.yaml) — plan **starter**, Key Value, cron keep-alive cada 10 min.

## Aviso

No sustituye asesoría jurídica. PJUD/CGR no ofrecen API abierta de texto completo. El MCP es un puente: si BCN/PJUD/TC fallan, las tools degradan a warning/link o timeout parcial.
