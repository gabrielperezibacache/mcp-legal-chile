# Flujo de estudio — MCP Legal Chile

Guía operativa para usar el conector como copiloto en un estudio chileno.
No sustituye asesoría jurídica. Respeta siempre la matriz de honestidad
(`verified` / `candidate` / `portal_stub`).

## Arranque rápido

| Situación | Tool de entrada |
|---|---|
| No sé por dónde empezar | `catalogo_flujos` o `asesorar` (`modo=auto`) |
| Memo / escrito nuevo | `preparar_entregable` |
| Solo quiero el plan | `flujo_estudio` |
| Me trabé a mitad de camino | `siguiente_paso` |
| Día completo (mañana/tarde) | resource `legalchile://guia/dia-tipico` |

## Cadenas recomendadas

### 1. Consulta → memo IRAC

1. `asesorar` modo `memo` o `auto`
2. `lista_prueba_normativa` → `obtener_articulo` / `citar_texto_legal`
3. Jurisprudencia TC: `obtener_fallo_tc` / `citar_jurisprudencia`
4. PJUD: pegar texto → `indice_considerandos` → `pegar_fallo_pjud`
5. `anexo_citas` + redacción IRAC + «Qué falta verificar»

### 2. Escrito / demanda / recurso

1. `preparar_entregable` (infiere `tipo_escrito` si omites el parámetro)
2. Completa blockquotes verified
3. `plantilla_escrito` si necesitas rearmar la estructura
4. `anexo_citas`
5. Checklists: `checklist_*` (protección, laboral, tutela, ejecutivo, familia, CGR, nulidad, casación)

### 3. Seguimiento de causa → cliente

1. `obtener_causa_pjud` / `buscar_causa_pjud` (o datos pegados de OJV)
2. `comparar_actuaciones` si hay snapshot previo
3. `aviso_desde_causa` o `borrador_mensaje_cliente`
4. Contrastar en Oficina Judicial Virtual antes de enviar  
   (todo dato PJUD es `candidate`)

### 4. Carpeta / antecedentes

1. `lista_antecedentes` por materia
2. `borrador_mensaje_cliente` tipo `solicitud_antecedentes`
3. Cuando lleguen documentos → `asesorar` / `preparar_entregable`

### 5. Norma frecuente sin pegarle a BCN aún

1. `resolver_norma_frecuente` (“código del trabajo”, “19.880”, “CPR”…)
2. o `listar_normas_frecuentes`
3. `obtener_articulo` / `citar_texto_legal` con el `idNorma` devuelto

## Resources MCP

| URI | Contenido |
|---|---|
| `legalchile://guia/memo` | Plan memo |
| `legalchile://guia/escrito` | Plan escrito |
| `legalchile://guia/seguimiento` | Plan causa → cliente |
| `legalchile://guia/honestidad` | Reglas anti-alucinación |
| `legalchile://guia/dia-tipico` | Encadenamiento de una jornada |

## Reglas que no se negocian

- No cites ratio ni dictámenes desde `link_only` / `portal_stub`.
- Fallos CS/CA: hay que **pegar** el texto (`pegar_fallo_pjud`).
- Dictámenes CGR: igual (`citar_dictamen_pegado`).
- Montos, plazos y ROL no aportados por tools/usuario → no inventar.
- Todo mensaje al cliente con datos PJUD debe advertir verificación en el portal.
