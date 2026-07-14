# MCP Legal Chile

Conector **MCP** de derecho chileno para Claude, Cursor y apps compatibles.

**Producción:** https://mcp-legal-chile.onrender.com/mcp  
**Versión:** 1.2.0

## Matriz de honestidad (qué trae cada tool)

| Tool | Evidencia | Fuente |
|---|---|---|
| `obtener_articulo` / `obtener_texto_norma` / `obtener_inciso` | **Texto íntegro** | XML oficial LeyChile |
| `buscar_legislacion` / `obtener_norma` / `estado_norma` | Metadata | BCN SPARQL |
| `buscar_jurisprudencia` / `buscar_tc` | **Solo enlace** | PJUD / TC (vía búsqueda) |
| `buscar_dictamenes` / `resolver_dictamen` | **Solo enlace** | Contraloría |
| `buscar_doctrina` | Metadata académica | OpenAlex |
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
- Jurisprudencia/TC con parsers ROL/RIT
- Caché durable (Redis si `REDIS_URL`) + singleflight + stale-if-error
- Rate limit / circuit breaker hacia LeyChile
- API keys + cuotas diarias (`MCP_API_KEYS`)
- Warmup `/warmup` + cron keep-alive

## Inicio rápido

```bash
npm install
npm run dev
# smoke local (server corriendo):
SMOKE_BASE=http://127.0.0.1:3000 npm run smoke
```

MCP: `http://localhost:3000/mcp`

## Variables de entorno

| Variable | Descripción |
|---|---|
| `REDIS_URL` | Redis/Key Value (opcional; si falta, solo memoria) |
| `MCP_API_KEYS` | `name:key:limit,...` — si está vacío, acceso abierto |
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
