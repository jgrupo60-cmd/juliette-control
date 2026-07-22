PR-004.3 - Python runtime publish fix

Reemplaza la carpeta scripts del proyecto y ejecuta nuevamente:

Set-ExecutionPolicy -Scope Process Bypass
.\scripts\deploy-pr004.ps1

El despliegue ahora indica explícitamente a Azure Functions Core Tools que el proyecto usa Python.
