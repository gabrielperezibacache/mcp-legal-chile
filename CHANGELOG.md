# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [SemVer](https://semver.org/).

## [Unreleased]

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
