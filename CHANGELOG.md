# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [1.23.3] — 2026-08-10

### Fixed
- Jurisprudencia: hosts oficiales por dominio exacto/subdominio (no substring lookalike); año ROL ≠ año de sentencia en `metadata.anio`
- Ranking juris: bonos full_text/host gated por cobertura; penaliza 0 tokens coincidentes
- Legislación: cobertura 2 términos exige ambos; stages SPARQL/buscador también filtran por cobertura
- Integridad: warning distinto para demotion por host vs sin texto
- Citas: CPP/CPC/COT/etc. + bluebook/iso sin `No. PENAL`
- Texto scrapeado: `&apos;`, mojibake ü/ç/º, `stripHtml` normaliza
- Agencia/BCN: soft-fail 429/circuito/401 (sin `isError`); DT extract exige `DT_HOSTS`; warnings web juris conservan HTTP 429

### Added
- Tests de lookalike host, ranking 1-token/2-términos, softAgencyFailure, citas bluebook código

## [1.23.2] — 2026-08-10

### Fixed
- HTTP 429 de LeyChile ya **no abre el circuit breaker** (solo cooling-down); evita cascada de soft-fails tras rate-limit

### Added
- `scripts/integrity-probe.mjs` — regresión de procedencia CGR, TC 787, citas y fail rápido idNorma

## [1.23.1] — 2026-08-10

### Fixed
- Ranking legislación: filtro por cobertura de términos tras SPARQL OR (menos ruido tipo “mamografías” en consultas de responsabilidad médica)
- Ranking jurisprudencia: penaliza TC off-topic con baja cobertura; bonus de bigramas; reduce flat bonus `tc_buscador`
- LeyChile tools (`obtener_articulo` / texto / inciso): timeout 12s y 1 reintento (falla antes del tope del cliente)
- Doctrina: `fixMojibake` + `normalizeScrapedText` en títulos/abstracts

## [1.23.0] — 2026-08-10

### Fixed
- **Procedencia CGR/DT/SERNAC/CMF:** allowlist de dominios oficiales; SERP contaminada (RAE, SpanishDict, Nexus Mods, etc.) se descarta; nunca `publisher=Contraloría` ni `verified` fuera de host oficial
- **Considerandos TC:** rechaza números espurios (p.ej. 787 de OCR/página); headers arábigos solo con marca ordinal `º/°`
- **LeyChile:** mensajes explícitos para HTTP 401/403/404 (CloudFront/WAF) en vez de timeout genérico
- **Citas:** `Código Penal` / `Código Civil` ya no salen como `Código N° PENAL`
- **Doctrina:** decode de entidades HTML en títulos/abstracts
- **TC search:** no usa año del ROL como año de sentencia en la cita

### Added
- `src/sources/hostAllowlist.ts` + tests `provenanceIntegrity.test.mjs`
- Regla anti-alucinación: no tratar web genérica como dictamen oficial

## [1.22.1] — 2026-08-10

### Fixed
- `resolver_norma_frecuente` acepta `alias` además de `consulta`; markdown con integrity + siguiente paso
- `siguiente_paso`: `estado` opcional e inferencia desde consulta libre del abogado
- Soft-degrade de red/timeout LeyChile (sin `isError`) para no tumbar clientes MCP
- `asesorar` usa pack `perfil=fast` para respuesta inicial más ágil

### Added
- Script `scripts/lawyer-probe.mjs` — batería de flujos abogado (laboral, CPR, civil, DT, TC, workflow)

## [1.22.0] — 2026-08-10

### Added
- Roadmap Fases 0–6 integrado sobre main (sin romper PJUD causas, workflow/study ni administrativo)
- `verificar_cita`, `importar_fallo` (+ `falloCache`), `mapa_norma`, `comparar_version_norma`
- DT / SERNAC / CMF: dictámenes y circulares + `SourceAdapter` + circuitos `dt`/`sernac`/`cmf`
- `buscar_reglamentos`, `buscar_tratados`, `investigar_norma_relacionada`
- Pack `investigar_tema(area, perfil=fast|default|deep)` + `PACK_PROFILE`
- Honesty: `enforceVerifiedHasText` (verified sin texto → candidate)
- `DEMO_MODE`, warmup rotativo (`src/warmup.ts`), smoke CI prod, `docs/ROADMAP.md`
- Suite fase0–fase6 + fixtures VCR / lawyer-queries

### Changed
- Catálogo HOT: unión de aliases/áreas con ids ya presentes en 1.21.x
- Resources MCP: se conservan URIs `legalchile://` de workflow + contenido de honestidad/SLO

[Unreleased]: https://github.com/gabrielperezibacache/mcp-legal-chile/compare/v1.22.0...HEAD
[1.22.0]: https://github.com/gabrielperezibacache/mcp-legal-chile/compare/v1.21.2...v1.22.0
