# MCP Legal Chile

Conector **MCP** (Model Context Protocol) para consultar derecho chileno desde Claude, Cursor u otras apps compatibles — inspirado en el enfoque de [Trifolia Conector MCP](https://trifolia.cl/conector-mcp/): respuestas con **citas y enlaces verificables**, no inventados de memoria.

## Fuentes

| Herramienta | Fuente |
|---|---|
| `buscar_legislacion` / `obtener_norma` | BCN Linked Open Data (SPARQL) + enlaces a LeyChile |
| `buscar_jurisprudencia` | Índices públicos (PJUD / TC) + Crossref |
| `buscar_doctrina` | OpenAlex (instituciones chilenas) |
| `buscar_dictamenes` | Contraloría y administración (enlaces públicos) |
| `buscar_derecho_chileno` | Búsqueda unificada en las cuatro fuentes |
| `acerca_de` | Metadatos del servidor |

## Inicio rápido

```bash
npm install
npm run dev
```

Abre `http://localhost:3000` (landing) y usa el endpoint MCP:

```
http://localhost:3000/mcp
```

### Claude (conector remoto)

1. Asegura que el servicio esté publicado con HTTPS.
2. En Claude → Conectores → Añadir → pega `https://TU-DOMINIO/mcp`.

### Cursor / Claude Desktop (stdio local)

```json
{
  "mcpServers": {
    "mcp-legal-chile": {
      "command": "npx",
      "args": ["tsx", "/ruta/absoluta/a/MCP Legal/src/stdio.ts"]
    }
  }
}
```

O tras `npm run build`:

```json
{
  "mcpServers": {
    "mcp-legal-chile": {
      "command": "node",
      "args": ["/ruta/absoluta/a/MCP Legal/dist/stdio.js"]
    }
  }
}
```

## Variables de entorno

Copia `.env.example`:

| Variable | Descripción |
|---|---|
| `PORT` | Puerto HTTP (Render usa `PORT`) |
| `HOST` | Bind address (`0.0.0.0` en producción) |
| `PUBLIC_BASE_URL` | URL pública del servicio |
| `ALLOWED_HOSTS` | Hosts permitidos (DNS rebinding), separados por coma |
| `USER_AGENT` | User-Agent para APIs externas |

## Deploy en Render

Incluye `render.yaml`. El servicio web debe escuchar en `0.0.0.0:$PORT` (ya configurado).

```bash
npm run build && npm start
```

## Aviso

Este proyecto **no es asesoría jurídica**. Las APIs oficiales de jurisprudencia/dictámenes son limitadas; siempre verifica el texto en la URL oficial de cada resultado.
