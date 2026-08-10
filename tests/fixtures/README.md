# Fixtures VCR (offline CI)

Grabaciones mínimas para tests sin red. No son textos oficiales íntegros.

## Refrescar LeyChile

```bash
curl -sL 'https://www.leychile.cl/Consulta/obtxml?opt=7&idNorma=242302' \
  | head -c 200000 > /tmp/cpr.xml
# Recortar a los artículos necesarios y guardar en leychile/
```

## Layout

| Path | Uso |
|---|---|
| `leychile/*.xml` | `parseNormaFromXml` |
| `tc/*.txt` | `parseConsiderandos` |
| `doaj/*.json` | mapeo DOAJ (opcional) |
