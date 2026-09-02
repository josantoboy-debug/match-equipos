# Protocolo de publicación segura

Este repositorio usa una publicación en dos fases para impedir que un archivo
corrupto, un cambio fuera de alcance o un workflow mal formado llegue a una
rama y dispare GitHub Actions.

## Principios

1. `main` no se modifica durante diagnóstico.
2. Todo incidente parte de un respaldo del SHA exacto de producción y usa una
   única rama `repair/...`.
3. Actions es una barrera, no una herramienta de ensayo y error.
4. Los archivos de código, configuración y workflows se almacenan como UTF-8
   válido con finales de línea LF.
5. Un candidato no se conecta a la rama hasta comprobar integridad de bytes y
   alcance del diff.

## Fase A — candidato desconectado

1. Ejecutar pruebas locales específicas y sintaxis.
2. Ejecutar `python3 scripts/verify_text_integrity.py <archivos cambiados>`.
3. Calcular el Git blob SHA de cada archivo con
   `python3 scripts/git_blob_sha.py <archivos cambiados>`.
4. Al publicar por API/conector, transmitir cada archivo como Base64 de sus
   bytes UTF-8, no como una cadena que pueda ser recodificada.
5. Crear los blobs remotos y exigir que cada SHA devuelto sea idéntico al SHA
   calculado localmente. Si no coincide, abortar.
6. Crear `tree` y `commit` candidato sin mover ninguna referencia de rama.
7. Comparar el candidato contra su padre. Verificar:
   - solo archivos esperados;
   - número de líneas compatible con la hipótesis;
   - ningún binario inesperado;
   - ninguna reescritura masiva para un cambio pequeño.
8. En un clon Git, la misma política puede automatizarse con
   `scripts/verify_diff_scope.py`.

## Fase B — publicación

Solo después de que Fase A esté verde:

1. Mover `repair/<incidente>` al SHA candidato.
2. Revisar alertas de GitHub en Gmail.
3. Esperar las barreras read-only.
4. Abrir PR y exigir todos los checks verdes.
5. Integrar únicamente cuando el PR esté verde.
6. Esperar Pages y verificar la URL pública con caché desactivada, HTTP 200 y
   el marcador de versión correspondiente.

## Reglas de workflow

- Mantener `permissions: contents: read` en gates de validación.
- No incluir secretos en scripts de prueba.
- Browser tests extensos deben vivir en `tests/*.cjs` o `tests/*.js`; el YAML
  solo debe instalar dependencias y ejecutar el archivo.
- Verificar contratos semánticos (`includes`, atributos/IDs dedicados) en vez
  de comparar frases dinámicas completas.
- Los workflows modificados se validan con `actionlint` antes de considerarse
  publicables.

## Señales que obligan a abortar

- SHA local de blob != SHA remoto.
- UTF-8 inválido, BOM YAML, CRLF inesperado, NUL, controles o mojibake.
- Diff con archivos no declarados o magnitud incompatible con el cambio.
- Un gate falla dos veces con commits distintos.
- El diagnóstico nuevo contradice la evidencia de logs.
