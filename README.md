# Juliette Control Center

Panel independiente para operar Juliette/KyodoBot aunque la VM principal esté apagada.

## PR-002 — Application Architecture

Este bloque transforma la landing inicial en una aplicación estática modular preparada para crecer.

### Incluye

- Landing renovada.
- Dashboard independiente.
- Pantalla de acceso demostrativa.
- Sidebar responsive.
- Componentes reutilizables de navegación y notificaciones.
- Servicios separados para estado, autenticación, API y Azure.
- Configuración centralizada.
- Preparación del botón de encendido para una API real.

### Estructura

```text
index.html
login.html
dashboard.html
assets/
  css/
  js/
components/
services/
config/
```

## Publicación

GitHub Pages:

- Rama: `main`
- Carpeta: `/ (root)`

## Seguridad

No almacenar credenciales, tokens, secretos ni claves de Azure en este repositorio público.

## Próximo bloque

PR-003 — Azure Bridge:

- API independiente.
- Estado real de la VM.
- Inicio real de `kyodobot-server`.
- CORS restringido al dominio de GitHub Pages.
- Identidad administrada y permisos mínimos.
