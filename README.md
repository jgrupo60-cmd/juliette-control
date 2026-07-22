# Juliette Control Center — PR-005

Panel estático conectado a Azure Functions para consultar el estado real de `kyodobot-server` y solicitar su encendido mediante Managed Identity.

## PR-005

- Landing conectada a `/api/vm/status`.
- Dashboard sin estado simulado de la VM.
- Consulta automática cada 15 segundos.
- Consulta acelerada durante transiciones.
- Botón real de encendido protegido por `CONTROL_ACCESS_TOKEN`.
- Indicador de conexión, hora de última consulta y cuenta regresiva.
- Dashboard y bot se muestran honestamente como no verificados hasta incorporar telemetría interna.

## Publicación

El frontend se publica mediante GitHub Pages. La Function ya desplegada permanece en Azure.

```powershell
git add .
git commit -m "PR-005: connect live operations frontend"
git push origin main
```

No subas `CONTROL_ACCESS_TOKEN` al repositorio.

## PR-006 · Mission Control

- Nuevo dashboard operativo compacto con navegación lateral.
- Estado real de Azure VM y Azure Bridge.
- Controles protegidos para encender, reiniciar y apagar/desasignar la VM.
- Endpoints nuevos: `POST /api/vm/restart` y `POST /api/vm/stop`.
- Registro local de operaciones por navegador.
- Acceso inteligente al Dashboard solo cuando la VM está encendida.

### Publicación del backend

Desde `api` con el entorno Python 3.11 activo:

```powershell
func azure functionapp publish juliette-control-api --python --build remote
```

Después publica el frontend con GitHub Pages:

```powershell
git add .
git commit -m "PR-006: Mission Control and VM operations"
git push origin main
```

## PR-008 — Operations Suite

Añade telemetría interna mediante Azure VM Run Command, logs remotos, ejecución protegida de `/opt/kyodobot/update.sh`, atribución de acciones por nombre de staff y auditoría persistente en Azure Table Storage.

> La sesión actual usa un token compartido más nombre declarado. Esto permite atribución y auditoría, pero todavía no equivale a autenticación individual criptográficamente verificada.


## PR-008 — Real Runtime Telemetry

Telemetría de solo lectura sin sesión, estado HTTP real del Dashboard, métricas detalladas de memoria/disco, salud de contenedores, reinicios y estado Git. Las operaciones y logs continúan protegidos por token.


## PR-009 — Password Login

Mission Control now requires a backend-validated staff password. The browser receives a signed, expiring session token; the password is never stored in the repository or browser storage.

Required Function App setting: `CONTROL_LOGIN_PASSWORD_HASH`. Generate it with `scripts/set-login-password.ps1`.
