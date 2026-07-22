# Juliette Control Center

Panel remoto para consultar y encender `kyodobot-server` aunque la VM principal esté apagada.

## PR-003 — Azure Bridge

Incluye:

- Azure Function en Python con identidad administrada.
- `GET /api/health`.
- `GET /api/vm/status` usando Instance View.
- `POST /api/vm/start` usando la operación Start de Azure Compute.
- CORS restringido a GitHub Pages.
- Código temporal del staff conservado solo en `sessionStorage`.
- Estado real, refresco manual y consulta automática cada 15 segundos.
- Estados `running`, `starting`, `deallocated`, `stopped` y transitorios.
- Sin credenciales de Azure en el repositorio.

## Estructura de la API

```text
api/
├── function_app.py
├── host.json
├── requirements.txt
├── local.settings.example.json
└── tests/
```

## Seguridad del PR-003

La Function usa una identidad administrada para hablar con Azure. El endpoint de encendido requiere temporalmente un secreto compartido mediante `Authorization: Bearer ...`. Ese secreto:

- no se guarda en GitHub;
- no se escribe en el JavaScript;
- solo vive durante la pestaña del navegador;
- será reemplazado por autenticación individual en PR-004.

## Configuración pendiente después de subir el código

1. Crear una Function App Python.
2. Activar su identidad administrada.
3. Asignarle un rol personalizado limitado a leer/iniciar `kyodobot-server`.
4. Crear los App Settings indicados en `api/local.settings.example.json`.
5. Desplegar la carpeta `api`.
6. Pegar la URL HTTPS de la Function en `config/app.js`.

## Frontend

GitHub Pages:

`https://jgrupo60-cmd.github.io/juliette-control/`
