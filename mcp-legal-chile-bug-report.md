# MCP Legal Chile — Reporte de Bugs y Fallas Observadas

**Objetivo:** Documentar los fallos reproducibles del servidor `mcp-legal-chile` (v1.7.3) para que un desarrollador (Cursor) los corrija.
**Fecha del test:** 2026-07-16
**Entorno:** macOS, cliente MCP en Hermes Agent. Red residencial Chile.
**Correcciones:** aplicadas en **v1.11.1** (ver columna «Corregido en»).

---

## Resumen ejecutivo

| # | Herramienta(s) afectada(s) | Severidad | Estado | Tipo de falla | Corregido en |
|---|---|---|---|---|---|
| 1 | `obtener_articulo`, `citar_texto_legal`, `obtener_texto_norma` | 🔴 Alta | Recuperable tras cooldown | HTTP 429 (rate-limit) sin backoff/retry | **1.11.1** — Retry-After, retries, cache 429 corta, soft response |
| 2 | `buscar_legislacion` | 🟠 Media | Persistente | No indexa lenguaje natural, solo números de ley | **1.11.1** — SPARQL OR + buscador HTML LeyChile + aliases |
| 3 | `buscar_jurisprudencia` | 🟠 Media | Persistente | Índice vacío; 0 resultados; sin fallback efectivo | **1.11.1** — siempre portal stubs + warnings claros |
| 4 | `investigar_tema` | 🟡 Baja | Parcial | Timeouts en fuentes jurisprudencia/dictámenes (deadline 6s) | **1.11.1** — defaults PACK 18s / ~11s por fuente |
| 5 | `resolver_rol` | 🟡 Baja | Funcional pero limitado | PJUD sin API abierta → solo links candidatos | **1.11.1** — copy sin «fetch failed» técnico |
| 6 | Servidor MCP | 🟠 Media | Auto-protección | Se auto-bloquea tras 3 fallos (cooldown ~58s) | **1.11.1** — soft 429 (sin isError) + README (Hermes es el cliente) |

**Fuente NO afectada:** `buscar_doctrina` (SciELO/OpenAlex) funciona al 100% en paralelo a los fallos de LeyChile. Buen aislamiento de fuentes.

---

## BUG 1 — HTTP 429 en endpoint XML de LeyChile, sin reintento ni backoff

### Síntomas
- `obtener_articulo(idNorma=18520, articulo=163)` → `HTTP 429` en `https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=18520`
- `citar_texto_legal(idNorma=18520, articulo=163)` → mismo 429
- `obtener_texto_norma(idNorma=24241, modo=indice)` → mismo 429
- `obtener_texto_norma(idNorma=24241, modo=cuerpo)` → **mismo 429 en la primera llamada**

### Reproducción
Llamar a cualquiera de las 3 herramientas de texto íntegro 2–3 veces seguidas (o bien en ráfaga dentro de la misma sesión).

### Comportamiento esperado
- Al recibir 429, el servidor debe hacer **exponential backoff** (respetando `Retry-After` de la respuesta) y reintentar 2–3 veces antes de devolver error al cliente.
- Debe existir **cache local** del XML de LeyChile (el SLO `obtener_articulo_cache_hit_p95_ms: 500` implica que ya hay cache de lectura; el problema es el *miss* que va a red sin protección).

### Comportamiento actual
- Devuelve el 429 directo al cliente sin reintento.
- Tras 3 fallos consecutivos el **servidor entero** se auto-marca `unreachable` y exige esperar ~58s (ver BUG 6), castigando también a herramientas no afectadas.

### Sugiere fix
1. Wrapper HTTP para `leychile.cl/Consulta/obtxml` con: `max_retries=3`, `backoff_factor=2.0`, lectura de header `Retry-After`.
2. Cache de respuestas 429/no-modificadas con TTL (evita reconsultar lo ya negado).
3. Aislar el rate-limit por *endpoint/host*, no por "servidor MCP": un 429 de LeyChile no debe bloquear `buscar_doctrina`.

---

## BUG 2 — `buscar_legislacion` no entiende lenguaje natural

### Síntomas
- `buscar_legislacion(consulta="despido injustificado indemnización")` → **0 hallazgos**.
- `buscar_legislacion(consulta="18520")` → 1 hallazgo (Ley N° 18520).
- El propio mensaje de error admite: *"No se encontraron normas en el endpoint SPARQL de la BCN. Prueba con el número de ley (p. ej. 19628)."*

### Comportamiento esperado
- Aceptar consultas en lenguaje natural y traducirlas a una búsqueda útil (p. ej. caer al buscador de leyChile `https://www.bcn.cl/leychile/consulta/buscador?termino=...` o hacer stemming de términos legales).

### Comportamiento actual
- Solo resuelve cuando `consulta` es un número de ley. Cualquier texto libre devuelve 0 con advertencia.

### Sugiere fix
- Detectar si `consulta` es numérica; si no, enrutar a búsqueda por término (leyChile buscador web) en lugar de (o además de) el SPARQL de BCN.
- O documentar claramente la limitación en el schema/descripción de la tool para que el agente sepa pasar el número.

---

## BUG 3 — `buscar_jurisprudencia` sin índice (siempre 0)

### Síntomas
- `buscar_jurisprudencia(consulta="despido injustificado")` → **0 hallazgos**.
- Mensaje: *"No se indexaron fallos automáticamente. Prueba resolver_rol si conoces el ROL."* y *"Búsqueda en pjud.cl limitada: Circuito abierto para websearch."*

### Comportamiento esperado
- Devolver links a fallos PJUD relevantes, o al menos ejecutar el circuito websearch y devolver resultados.

### Comportamiento actual
- Devuelve 0 y delega a `resolver_rol` / búsqueda web manual. La herramienta es efectivamente un no-op para el usuario.

### Sugiere fix
- Implementar el circuito websearch (DuckDuckGo `site:pjud.cl`) de forma real y devolver los N primeros links con título/fecha/tribunal.
- O bien marcar la tool como `link_only` en su descripción para que el agente no espere contenido.

---

## BUG 4 — `investigar_tema` con fuentes incompletas por timeout

### Síntomas
- `investigar_tema(consulta="plazo de prescripción acción de despido", limite_por_fuente=2)` → pack parcial:
  - Marco normativo: OK (1 norma candidata).
  - **Jurisprudencia: `DeadlineError: Timeout jurisprudencia (6000ms)`**
  - **Dictámenes: `DeadlineError: Timeout dictamenes (6000ms)`**
  - Doctrina: OK.
- Tiempo pack: 6003ms (tope 12000ms).

### Comportamiento esperado
- El fan-out debería dar más margen a jurisprudencia/dictámenes o degradar con elegancia indicando claramente qué faltó (lo hace, pero el timeout de 6s es agresivo para fuentes externas lentas).

### Comportamiento actual
- Timeouts duros a 6s matan esas dos fuentes. El pack se entrega "parcial OK" pero sin jurisprudencia ni dictámenes.

### Sugiere fix
- Subir el deadline por fuente (p. ej. 10–12s) o aumentar el tope total del pack cuando hay pocas fuentes.
- Permitir `limite_por_fuente` más alto sin disparar el tope global tan pronto.

---

## BUG 5 — `resolver_rol` solo entrega links (PJUD sin API)

### Síntomas
- `resolver_rol(rol="12345-2024")` → devuelve portales candidatos + `"pjud search: fetch failed"`.
- No hay cuerpo de sentencia, solo URLs a verificar manualmente.

### Nota
Esto es **limitación de la fuente** (PJUD no expone API), no un bug del MCP. Pero el cliente recibe un "fetch failed" que suena a error cuando en realidad es el comportamiento esperado (link_only).

### Sugiere fix
- Cambiar el mensaje de `"fetch failed"` por algo explícito: *"PJUD no tiene API abierta; se devuelven solo enlaces candidatos para verificación manual"*. Evita que el agente crea que hubo un fallo recuperable.

---

## BUG 6 — Auto-bloqueo del servidor tras 3 fallos (cooldown global)

### Síntomas
- Tras 3 llamadas 429 seguidas, el servidor devolvió:
  > `MCP server 'mcp-legal-chile' is unreachable after 3 consecutive failures. Auto-retry available in ~58s. Do NOT retry this tool yet.`

### Comportamiento esperado
- El rate-limit de LeyChile (BUG 1) debería manejarse a nivel de esa fuente. El servidor no debería considerarse "unreachable" globalmente por un 429 de un solo host.

### Comportamiento actual
- 3 fallos consecutivos (de cualquier tipo) marcan todo el MCP como unreachable por ~58s, bloqueando también `buscar_doctrina` y `buscar_legislacion` que funcionan.

### Sugiere fix
- Contar fallos **por fuente/host**, no globales. Un 429 de `leychile.cl` no debe inhabilitar `scielo.org` ni `bcn.cl` (metadata).
- El cooldown debería aplicar solo a la herramienta/host afectado.

---

## Evidencia cruda (respuestas captureadas)

### BUG 1 — 429 (obtener_articulo)
```json
{"error":"No se pudo extraer texto oficial desde LeyChile.\nDetalle: HTTP 429 al consultar https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=18520\nFuente oficial: https://www.bcn.cl/leychile/navegar?idNorma=18520"}
```

### BUG 1 — Recuperación tras cooldown (obtener_texto_norma, idNorma=24241)
```json
{"result":"# Ley 3781\n**LEI NUM. 3,781, QUE AUTORIZA EL PAGO...**\nEstado: no derogado\n## Artículos\n### Artículo \nArtículo único.- Se autoriza al Presidente..."}
```
→ Confirma que el 429 es **transitorio** y se resuelve solo con espera (backoff del cliente).

### BUG 2 — lenguaje natural 0 (buscar_legislacion)
```json
{"result":"## Resultados — Legislación (BCN / LeyChile)\nConsulta: _despido injustificado indemnización_\nHallazgos: **0**\n_Sin resultados..."}
```

### BUG 3 — jurisprudencia vacía (buscar_jurisprudencia)
```json
{"result":"## Resultados — Jurisprudencia\nConsulta: _despido injustificado_\nHallazgos: **0**\n_No se indexaron fallos automáticamente..."}
```

### BUG 4 — timeouts (investigar_tema)
```
## 2. Jurisprudencia (verificar texto oficial)
- Fuente incompleta: DeadlineError: Timeout jurisprudencia (6000ms)
## 3. Dictámenes (verificar texto oficial)
- Fuente incompleta: DeadlineError: Timeout dictamenes (6000ms)
```

### BUG 5 — resolver_rol
```json
{"result":"## Resolución ROL 12345-2024\n...- **poderJudicial:** https://www.pjud.cl/portal-unificado-sentencias\n- **tcBuscador:** https://buscador.tcchile.cl/#/?q=12345-2024\n### Advertencias\n- PJUD no tiene API abierta...- PJUD búsqueda: fetch failed"}
```

### BUG 6 — servidor unreachable
```
MCP server 'mcp-legal-chile' is unreachable after 3 consecutive failures. Auto-retry available in ~58s.
```

---

## Prioridad de arreglo sugerida
1. **BUG 1 + BUG 6** (juntos): backoff/retry + cache en LeyChile XML y conteo de fallos por host. Es lo que rompe la experiencia principal (texto íntegro de leyes).
2. **BUG 2**: enrutar lenguaje natural a buscador leyChile.
3. **BUG 3**: implementar websearch real o documentar link_only.
4. **BUG 4**: ajustar timeouts del fan-out.
5. **BUG 5**: mejorar copy de "fetch failed" → link_only explícito.

## Notas para el desarrollador
- No se inventen fallos/dictámenes/artículos (la matriz de honestidad del servidor ya lo prohíbe y está bien).
- `buscar_doctrina` (SciELO Chile + OpenAlex + Crossref) es la fuente más estable: considérela canaria para no auto-bloquear el servidor.
- Los SLOs publicados (`obtener_articulo_cold_p95_ms: 5000`, `xml_success_rate_24h_target: 0.95`) no se cumplen mientras el 429 no tenga backoff.
