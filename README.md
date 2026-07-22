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
