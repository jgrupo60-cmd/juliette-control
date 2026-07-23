# Juliette Control Center

Sitio independiente para consultar el estado de la VM de Juliette y encenderla cuando Azure la haya apagado.

## Arquitectura

GitHub Pages → Azure Functions → Managed Identity → Azure Compute API → `kyodobot-server`

## Funciones disponibles

- Inicio de sesión del staff.
- Consulta del estado de la VM.
- Encendido de la VM.
- Cierre de sesión.

## Endpoints

- `POST /api/auth/login`
- `GET /api/auth/session`
- `GET /api/service/status`
- `POST /api/service/start`

La autenticación con Azure continúa usando la Managed Identity de la Function App. No se guardan credenciales de Azure en GitHub Pages.
