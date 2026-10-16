# Informe de estado — Medicamentos Pendientes (solo Windows)

## Hecho y verificado (Linux, Node 22)
- Lógica de negocio (`shared/logic.js`): fecha en America/Santo_Domingo, alertas 3/7 días, orden, cambio de estado, búsqueda, estadísticas. 7/7 pruebas pasan (`node --test tests/logic.test.js`).
- Lógica de migración (`shared/migracion.js`): huella estable, duplicados entre computadoras, datos incompletos, empleados sin coincidencia, histórico sin sumar. Cubierta por las mismas pruebas.

## Hecho, NO ejecutado
- `db/migrations/001_init.sql`: esquema PostgreSQL. No se pudo ejecutar (no hay PostgreSQL en este entorno). Hay que validarlo en el workflow de Windows.
- `tools/sistema-antiguo-EXPORTAR.html`: copia del HTML original con un botón para guardar los datos en JSON. No se probó en un navegador.
- `.github/workflows/build-windows.yml`: plantilla, nunca ejecutada.

## Escrito en esta tanda, NO ejecutado
- `server/index.js`: API (setup del primer administrador, login con Argon2id y bloqueo tras 5 intentos, sesiones revocables, roles validados en servidor, medicamentos con control de versión y respuesta 409 ante conflicto, empleados que se desactivan, estadísticas, auditoría, SSE para tiempo real, HTTPS). Solo se comprobó la sintaxis (`node --check`); no corrió contra PostgreSQL.
- `installer/scripts/instalar-servidor.ps1`, `respaldo.ps1`, `winsw/MedPendApi.xml`, `MedicamentosPendientes.iss`: instalación de PostgreSQL propio (puerto 5433, solo local), migraciones, certificado, servicio de Windows, firewall (solo API, solo red local), respaldo diario. Nunca se ejecutaron ni se compilaron.

## NO hecho todavía
Aplicación Electron/React (todas las pantallas, incluida la conexión a la computadora principal y la importación), restauración con asistente, descubrimiento del servidor en la red, URL y hash fijados del instalador de PostgreSQL, endpoint de importación en el servidor, pruebas de integración.

## Sin pruebas en Windows
Ningún instalador existe ni fue probado. No hay `.exe`.
