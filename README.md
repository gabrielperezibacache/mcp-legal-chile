# MCP Legal Chile

Conector **MCP** para consultar derecho chileno desde Claude, Cursor u otras apps compatibles — respuestas con **citas y enlaces verificables**.

**Producción:** https://mcp-legal-chile.onrender.com/mcp

## Capacidades (v1.1)

| Herramienta | Qué hace |
|---|---|
| `buscar_legislacion` / `obtener_norma` | Metadata BCN / LeyChile (SPARQL) |
| `obtener_texto_norma` | **Texto oficial** completo desde XML LeyChile |
| `obtener_articulo` | Artículo puntual con URL a LeyChile |
| `buscar_jurisprudencia` | Enlaces a fallos PJUD / Tribunal Constitucional |
| `buscar_doctrina` | Doctrina académica (OpenAlex) |
| `buscar_dictamenes` | Dictámenes CGR / administración |
| `buscar_derecho_chileno` | Búsqueda unificada |
| Prompts | `consulta_juridica_chile`, `citar_articulo_ley` |

Las búsquedas devuelven **markdown listo para citar** (o JSON con `formato: "json"`).

## Inicio rápido

```bash
npm install
npm run dev
```

- Landing: `http://localhost:3000`
- MCP: `http://localhost:3000/mcp`

### Claude (remoto)

Conectores → Añadir → `https://mcp-legal-chile.onrender.com/mcp`

### Cursor (stdio)

Ver `cursor-mcp.example.json`.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `PORT` / `HOST` | Puerto y bind (`0.0.0.0` en Render) |
| `PUBLIC_BASE_URL` | URL pública |
| `ALLOWED_HOSTS` | Hosts permitidos (opcionales; Render hostname se detecta) |
| `FETCH_TIMEOUT_MS` | Timeout HTTP general (default 45000) |
| `SPARQL_TIMEOUT_MS` | Timeout BCN SPARQL (default 60000) |

## Aviso

No sustituye asesoría jurídica. Jurisprudencia y dictámenes dependen de índices públicos (PJUD/CGR no ofrecen API abierta). Verifica siempre la URL oficial.
