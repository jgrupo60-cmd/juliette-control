# Juliette Control Center — PR-004

PR-004 convierte Azure Bridge en una integración desplegable y conecta el frontend con la URL real de Azure Functions. El despliegue incluye validaciones estrictas para sesión, suscripción, Function App, variables de entorno, CORS y publicación.

## Incluye

- `GET /api/health`
- `GET /api/vm/status`
- `POST /api/vm/start`
- Managed Identity mediante `DefaultAzureCredential`
- Bearer token temporal para acciones de escritura
- CORS limitado al origen configurado
- polling de estado en el dashboard
- manejo de errores y `requestId`
- script PowerShell para publicar y actualizar `config/app.js`

## Requisitos ya preparados

- Function App: `juliette-control-api`
- Resource Group de la Function: `JULIETTE-CONTROL`
- Identidad administrada activada
- rol `Colaborador de la máquina virtual` sobre `kyodobot-server`
- variables de entorno:
  - `AZURE_SUBSCRIPTION_ID`
  - `AZURE_RESOURCE_GROUP`
  - `AZURE_VM_NAME`
  - `AZURE_VM_RESOURCE_ID`
  - `ALLOWED_ORIGINS`
  - `CONTROL_ACCESS_TOKEN`

`AZURE_VM_RESOURCE_ID` queda disponible para próximas operaciones, aunque PR-004 usa grupo y nombre con el SDK de Compute.

## Despliegue

Desde la raíz del repositorio, en PowerShell:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\deploy-pr004.ps1
```

El script:

1. comprueba Azure CLI y Functions Core Tools;
2. usa la sesión activa de Azure o abre `az login`;
3. selecciona explícitamente `Azure for Students`;
4. verifica que exista la Function App y que estén las seis variables requeridas;
5. configura CORS de forma idempotente;
6. publica `api/` con compilación remota;
7. obtiene nuevamente el hostname y actualiza `config/app.js`.

## Prueba segura

```powershell
.\scripts\test-pr004.ps1
```

Este script prueba salud y estado, pero no enciende la VM.

Para probar el encendido desde la web, abre el Control Center, pulsa **Encender servidor** e ingresa el valor de `CONTROL_ACCESS_TOKEN`. El token se guarda únicamente en `sessionStorage` y se elimina al cerrar la pestaña.

## GitHub Pages

Después del despliegue y las pruebas:

```powershell
git add .
git commit -m "PR-004: deploy Azure Bridge and connect production frontend"
git push origin main
```

No subas `local.settings.json`, `.venv` ni el token del staff.


## Corrección del despliegue

El script corregido no intenta leer propiedades de una respuesta vacía. Cada llamada a Azure CLI comprueba su código de salida, valida JSON y detiene el proceso con un mensaje concreto cuando falta sesión, recurso o configuración. Los mensajes del script usan texto ASCII para evitar caracteres dañados en Windows PowerShell 5.1.
