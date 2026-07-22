"""Juliette Control Center — Azure Bridge.

Endpoints:
- GET  /api/health
- GET  /api/vm/status
- POST /api/vm/start, /api/vm/stop and /api/vm/restart (Bearer token required)

The Function App authenticates to Azure with its system-assigned managed
identity. No Azure client secret is stored in this project.
"""
from __future__ import annotations

import hmac
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any

import azure.functions as func
from azure.core.exceptions import AzureError, ClientAuthenticationError, HttpResponseError
from azure.identity import DefaultAzureCredential
from azure.mgmt.compute import ComputeManagementClient

APP_VERSION = "0.7.0"
app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _required_setting(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required app setting: {name}")
    return value


def _allowed_origins() -> set[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "https://jgrupo60-cmd.github.io")
    return {item.strip().rstrip("/") for item in raw.split(",") if item.strip()}


def _request_origin(req: func.HttpRequest) -> str:
    return (req.headers.get("Origin") or "").strip().rstrip("/")


def _cors_headers(req: func.HttpRequest) -> dict[str, str]:
    origin = _request_origin(req)
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store, max-age=0",
        "Pragma": "no-cache",
        "Vary": "Origin",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Staff-Name",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Max-Age": "600",
    }
    if origin in _allowed_origins():
        headers["Access-Control-Allow-Origin"] = origin
    return headers


def _json(
    req: func.HttpRequest,
    payload: dict[str, Any],
    status: int = 200,
    *,
    request_id: str | None = None,
) -> func.HttpResponse:
    body = dict(payload)
    if request_id:
        body.setdefault("requestId", request_id)
    return func.HttpResponse(
        json.dumps(body, ensure_ascii=False),
        status_code=status,
        headers=_cors_headers(req),
        mimetype="application/json",
    )


def _preflight_or_reject_origin(req: func.HttpRequest) -> func.HttpResponse | None:
    if req.method == "OPTIONS":
        origin = _request_origin(req)
        if origin and origin not in _allowed_origins():
            return _json(req, {"error": "ORIGIN_NOT_ALLOWED"}, 403)
        return func.HttpResponse(status_code=204, headers=_cors_headers(req))

    origin = _request_origin(req)
    if origin and origin not in _allowed_origins():
        return _json(req, {"error": "ORIGIN_NOT_ALLOWED"}, 403)
    return None


def _authorized(req: func.HttpRequest) -> bool:
    configured = _required_setting("CONTROL_ACCESS_TOKEN")
    supplied = req.headers.get("Authorization", "")
    if not supplied.startswith("Bearer "):
        return False
    token = supplied.removeprefix("Bearer ").strip()
    return bool(token) and hmac.compare_digest(token, configured)


@lru_cache(maxsize=1)
def _client() -> ComputeManagementClient:
    # In Azure this resolves to the Function App's managed identity. During
    # local development it can use an authenticated Azure CLI session.
    credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
    return ComputeManagementClient(credential, _required_setting("AZURE_SUBSCRIPTION_ID"))


def _vm_settings() -> tuple[str, str]:
    return _required_setting("AZURE_RESOURCE_GROUP"), _required_setting("AZURE_VM_NAME")


def _power_state(statuses: list[Any] | None) -> str:
    for status in statuses or []:
        code = str(getattr(status, "code", ""))
        if code.lower().startswith("powerstate/"):
            return code.split("/", 1)[1].lower()
    return "unknown"


def _safe_http_detail(exc: HttpResponseError) -> str:
    status = getattr(exc, "status_code", None)
    if status == 403:
        return "La identidad administrada no tiene permisos suficientes sobre la VM."
    if status == 404:
        return "Azure no encontró la máquina virtual configurada."
    if status == 409:
        return "Azure rechazó la operación porque existe otra operación en curso."
    return "Azure rechazó la operación solicitada."


@app.route(route="health", methods=["GET", "OPTIONS"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response
    return _json(
        req,
        {
            "ok": True,
            "service": "juliette-control-azure-bridge",
            "version": APP_VERSION,
            "checkedAt": _utc_now(),
        },
    )


@app.route(route="vm/status", methods=["GET", "OPTIONS"])
def vm_status(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response

    request_id = str(uuid.uuid4())
    try:
        group, name = _vm_settings()
        view = _client().virtual_machines.instance_view(group, name)
        state = _power_state(view.statuses)
        return _json(
            req,
            {
                "ok": True,
                "vm": state,
                "powerState": state,
                "vmName": name,
                "region": "North Central US",
                "checkedAt": _utc_now(),
            },
            request_id=request_id,
        )
    except RuntimeError as exc:
        logging.exception("Azure Bridge configuration error request_id=%s", request_id)
        return _json(req, {"error": "BRIDGE_NOT_CONFIGURED", "detail": str(exc)}, 503, request_id=request_id)
    except ClientAuthenticationError:
        logging.exception("Managed identity authentication failed request_id=%s", request_id)
        return _json(req, {"error": "AZURE_AUTH_FAILED"}, 502, request_id=request_id)
    except HttpResponseError as exc:
        logging.exception("Azure rejected VM status request request_id=%s", request_id)
        return _json(
            req,
            {"error": "AZURE_STATUS_FAILED", "detail": _safe_http_detail(exc)},
            getattr(exc, "status_code", None) or 502,
            request_id=request_id,
        )
    except AzureError:
        logging.exception("Azure SDK failure while reading VM status request_id=%s", request_id)
        return _json(req, {"error": "AZURE_UNAVAILABLE"}, 502, request_id=request_id)
    except Exception:
        logging.exception("Unexpected VM status failure request_id=%s", request_id)
        return _json(req, {"error": "INTERNAL_ERROR"}, 500, request_id=request_id)


@app.route(route="vm/start", methods=["POST", "OPTIONS"])
def vm_start(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response

    request_id = str(uuid.uuid4())
    try:
        if not _authorized(req):
            return _json(req, {"error": "UNAUTHORIZED"}, 401, request_id=request_id)

        group, name = _vm_settings()
        client = _client()
        current = _power_state(client.virtual_machines.instance_view(group, name).statuses)

        if current == "running":
            return _json(
                req,
                {"ok": True, "powerState": "running", "message": "Juliette ya está encendida."},
                request_id=request_id,
            )
        if current == "starting":
            return _json(
                req,
                {"ok": True, "powerState": "starting", "message": "Juliette ya se está iniciando."},
                202,
                request_id=request_id,
            )
        if current in {"stopping", "deallocating"}:
            return _json(
                req,
                {
                    "ok": False,
                    "powerState": current,
                    "message": "La VM tiene una operación en curso. Espera unos segundos y vuelve a intentar.",
                },
                409,
                request_id=request_id,
            )

        # Do not wait for the entire boot process. Azure accepts the operation
        # and the frontend polls /vm/status until the VM reports running.
        client.virtual_machines.begin_start(group, name)
        logging.info("VM start accepted for %s/%s request_id=%s", group, name, request_id)
        _write_audit(req, "vm.start", "Solicitó encender kyodobot-server")
        return _json(
            req,
            {
                "ok": True,
                "powerState": "starting",
                "message": "Azure aceptó la solicitud de encendido.",
                "requestedAt": _utc_now(),
            },
            202,
            request_id=request_id,
        )
    except RuntimeError as exc:
        logging.exception("Azure Bridge configuration error request_id=%s", request_id)
        return _json(req, {"error": "BRIDGE_NOT_CONFIGURED", "detail": str(exc)}, 503, request_id=request_id)
    except ClientAuthenticationError:
        logging.exception("Managed identity authentication failed request_id=%s", request_id)
        return _json(req, {"error": "AZURE_AUTH_FAILED"}, 502, request_id=request_id)
    except HttpResponseError as exc:
        logging.exception("Azure rejected VM start request request_id=%s", request_id)
        return _json(
            req,
            {"error": "AZURE_START_FAILED", "detail": _safe_http_detail(exc)},
            getattr(exc, "status_code", None) or 502,
            request_id=request_id,
        )
    except AzureError:
        logging.exception("Azure SDK failure while starting VM request_id=%s", request_id)
        return _json(req, {"error": "AZURE_UNAVAILABLE"}, 502, request_id=request_id)
    except Exception:
        logging.exception("Unexpected VM start failure request_id=%s", request_id)
        return _json(req, {"error": "INTERNAL_ERROR"}, 500, request_id=request_id)


@app.route(route="vm/stop", methods=["POST", "OPTIONS"])
def vm_stop(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response

    request_id = str(uuid.uuid4())
    try:
        if not _authorized(req):
            return _json(req, {"error": "UNAUTHORIZED"}, 401, request_id=request_id)

        group, name = _vm_settings()
        client = _client()
        current = _power_state(client.virtual_machines.instance_view(group, name).statuses)

        if current in {"deallocated", "stopped"}:
            return _json(
                req,
                {"ok": True, "powerState": current, "message": "Juliette ya está apagada."},
                request_id=request_id,
            )
        if current in {"stopping", "deallocating"}:
            return _json(
                req,
                {"ok": True, "powerState": current, "message": "Juliette ya se está apagando."},
                202,
                request_id=request_id,
            )
        if current == "starting":
            return _json(
                req,
                {"ok": False, "powerState": current, "message": "Espera a que finalice el inicio antes de apagar."},
                409,
                request_id=request_id,
            )

        client.virtual_machines.begin_deallocate(group, name)
        logging.info("VM deallocate accepted for %s/%s request_id=%s", group, name, request_id)
        _write_audit(req, "vm.stop", "Solicitó apagar y desasignar kyodobot-server")
        return _json(
            req,
            {"ok": True, "powerState": "deallocating", "message": "Azure aceptó la solicitud de apagado y desasignación.", "requestedAt": _utc_now()},
            202,
            request_id=request_id,
        )
    except RuntimeError as exc:
        logging.exception("Azure Bridge configuration error request_id=%s", request_id)
        return _json(req, {"error": "BRIDGE_NOT_CONFIGURED", "detail": str(exc)}, 503, request_id=request_id)
    except ClientAuthenticationError:
        logging.exception("Managed identity authentication failed request_id=%s", request_id)
        return _json(req, {"error": "AZURE_AUTH_FAILED"}, 502, request_id=request_id)
    except HttpResponseError as exc:
        logging.exception("Azure rejected VM stop request request_id=%s", request_id)
        return _json(req, {"error": "AZURE_STOP_FAILED", "detail": _safe_http_detail(exc)}, getattr(exc, "status_code", None) or 502, request_id=request_id)
    except AzureError:
        logging.exception("Azure SDK failure while stopping VM request_id=%s", request_id)
        return _json(req, {"error": "AZURE_UNAVAILABLE"}, 502, request_id=request_id)
    except Exception:
        logging.exception("Unexpected VM stop failure request_id=%s", request_id)
        return _json(req, {"error": "INTERNAL_ERROR"}, 500, request_id=request_id)


@app.route(route="vm/restart", methods=["POST", "OPTIONS"])
def vm_restart(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response

    request_id = str(uuid.uuid4())
    try:
        if not _authorized(req):
            return _json(req, {"error": "UNAUTHORIZED"}, 401, request_id=request_id)

        group, name = _vm_settings()
        client = _client()
        current = _power_state(client.virtual_machines.instance_view(group, name).statuses)

        if current != "running":
            return _json(
                req,
                {"ok": False, "powerState": current, "message": "La VM debe estar encendida para reiniciarla."},
                409,
                request_id=request_id,
            )

        client.virtual_machines.begin_restart(group, name)
        logging.info("VM restart accepted for %s/%s request_id=%s", group, name, request_id)
        _write_audit(req, "vm.restart", "Solicitó reiniciar kyodobot-server")
        return _json(
            req,
            {"ok": True, "powerState": "restarting", "message": "Azure aceptó la solicitud de reinicio.", "requestedAt": _utc_now()},
            202,
            request_id=request_id,
        )
    except RuntimeError as exc:
        logging.exception("Azure Bridge configuration error request_id=%s", request_id)
        return _json(req, {"error": "BRIDGE_NOT_CONFIGURED", "detail": str(exc)}, 503, request_id=request_id)
    except ClientAuthenticationError:
        logging.exception("Managed identity authentication failed request_id=%s", request_id)
        return _json(req, {"error": "AZURE_AUTH_FAILED"}, 502, request_id=request_id)
    except HttpResponseError as exc:
        logging.exception("Azure rejected VM restart request request_id=%s", request_id)
        return _json(req, {"error": "AZURE_RESTART_FAILED", "detail": _safe_http_detail(exc)}, getattr(exc, "status_code", None) or 502, request_id=request_id)
    except AzureError:
        logging.exception("Azure SDK failure while restarting VM request_id=%s", request_id)
        return _json(req, {"error": "AZURE_UNAVAILABLE"}, 502, request_id=request_id)
    except Exception:
        logging.exception("Unexpected VM restart failure request_id=%s", request_id)
        return _json(req, {"error": "INTERNAL_ERROR"}, 500, request_id=request_id)

# PR-007 · Operations Suite -------------------------------------------------
# Runtime telemetry and maintenance use Azure VM Run Command. These calls are
# intentionally protected by the same bearer token as infrastructure changes.

def _staff_name(req: func.HttpRequest) -> str:
    raw = (req.headers.get("X-Staff-Name") or "Staff").strip()
    cleaned = "".join(ch for ch in raw if ch.isalnum() or ch in " _-.@")[:40]
    return cleaned or "Staff"


def _run_shell(script_lines: list[str]) -> str:
    from azure.mgmt.compute.models import RunCommandInput

    group, name = _vm_settings()
    command = RunCommandInput(command_id="RunShellScript", script=script_lines)
    result = _client().virtual_machines.begin_run_command(group, name, command).result()
    output: list[str] = []
    for item in getattr(result, "value", None) or []:
        message = str(getattr(item, "message", "") or "")
        if message:
            output.append(message)
    return "\n".join(output).strip()


def _parse_marked_json(output: str) -> dict[str, Any]:
    marker = "JULIETTE_JSON="
    for line in reversed(output.splitlines()):
        if marker in line:
            return json.loads(line.split(marker, 1)[1].strip())
    raise ValueError("Runtime response did not contain marked JSON")


def _audit_table():
    from azure.data.tables import TableServiceClient

    connection = _required_setting("AzureWebJobsStorage")
    service = TableServiceClient.from_connection_string(connection)
    table = service.get_table_client("JulietteControlAudit")
    try:
        table.create_table()
    except Exception:
        pass
    return table


def _write_audit(req: func.HttpRequest, action: str, detail: str, ok: bool = True) -> None:
    try:
        now = datetime.now(timezone.utc)
        _audit_table().create_entity({
            "PartitionKey": now.strftime("%Y-%m"),
            "RowKey": f"{now.strftime('%Y%m%dT%H%M%S%f')}-{uuid.uuid4().hex[:8]}",
            "staff": _staff_name(req),
            "action": action[:80],
            "detail": detail[:500],
            "ok": bool(ok),
            "at": now.isoformat(),
        })
    except Exception:
        logging.exception("Could not persist audit event")


@app.route(route="runtime/status", methods=["GET", "OPTIONS"])
def runtime_status(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response
    request_id = str(uuid.uuid4())
    try:
        if not _authorized(req):
            return _json(req, {"error": "UNAUTHORIZED"}, 401, request_id=request_id)
        output = _run_shell([
            "set -u",
            "bot=$(docker inspect -f '{{.State.Status}}' kyodobot 2>/dev/null || echo missing)",
            "dash=$(docker inspect -f '{{.State.Status}}' kyodobot-dashboard 2>/dev/null || echo missing)",
            "bot_health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' kyodobot 2>/dev/null || echo unknown)",
            "dash_health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' kyodobot-dashboard 2>/dev/null || echo unknown)",
            "uptime_s=$(cut -d. -f1 /proc/uptime)",
            "load=$(cut -d' ' -f1 /proc/loadavg)",
            "mem=$(free -m | awk '/Mem:/ {printf \"%d\", ($3*100)/$2}')",
            "disk=$(df -P / | awk 'NR==2 {gsub(/%/,\"\",$5); print $5}')",
            "repo=/opt/kyodobot",
            "branch=$(git -C $repo rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)",
            "commit=$(git -C $repo rev-parse --short HEAD 2>/dev/null || echo unknown)",
            "dirty=$(test -n \"$(git -C $repo status --porcelain 2>/dev/null)\" && echo true || echo false)",
            "printf 'JULIETTE_JSON={\"bot\":\"%s\",\"dashboard\":\"%s\",\"botHealth\":\"%s\",\"dashboardHealth\":\"%s\",\"uptimeSeconds\":%s,\"load1\":\"%s\",\"memoryPercent\":%s,\"diskPercent\":%s,\"branch\":\"%s\",\"commit\":\"%s\",\"dirty\":%s}\\n' \"$bot\" \"$dash\" \"$bot_health\" \"$dash_health\" \"$uptime_s\" \"$load\" \"$mem\" \"$disk\" \"$branch\" \"$commit\" \"$dirty\"",
        ])
        data = _parse_marked_json(output)
        data.update({"ok": True, "checkedAt": _utc_now()})
        return _json(req, data, request_id=request_id)
    except HttpResponseError as exc:
        return _json(req, {"error": "RUNTIME_STATUS_FAILED", "detail": _safe_http_detail(exc)}, getattr(exc, "status_code", None) or 502, request_id=request_id)
    except Exception:
        logging.exception("Runtime status failed request_id=%s", request_id)
        return _json(req, {"error": "RUNTIME_STATUS_FAILED", "detail": "No fue posible consultar Docker dentro de la VM."}, 502, request_id=request_id)


@app.route(route="runtime/logs", methods=["GET", "OPTIONS"])
def runtime_logs(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response
    request_id = str(uuid.uuid4())
    try:
        if not _authorized(req):
            return _json(req, {"error": "UNAUTHORIZED"}, 401, request_id=request_id)
        try:
            lines = max(20, min(300, int(req.params.get("lines", "120"))))
        except ValueError:
            lines = 120
        output = _run_shell([
            f"echo '=== kyodobot (últimas {lines} líneas) ==='",
            f"docker logs kyodobot --tail {lines} 2>&1 || true",
            "echo '=== dashboard (últimas 60 líneas) ==='",
            "docker logs kyodobot-dashboard --tail 60 2>&1 || true",
        ])
        _write_audit(req, "runtime.logs", f"Consultó {lines} líneas de logs")
        return _json(req, {"ok": True, "logs": output[-50000:], "checkedAt": _utc_now()}, request_id=request_id)
    except Exception:
        logging.exception("Runtime logs failed request_id=%s", request_id)
        return _json(req, {"error": "RUNTIME_LOGS_FAILED", "detail": "No fue posible recuperar los logs."}, 502, request_id=request_id)


@app.route(route="runtime/update", methods=["POST", "OPTIONS"])
def runtime_update(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response
    request_id = str(uuid.uuid4())
    try:
        if not _authorized(req):
            return _json(req, {"error": "UNAUTHORIZED"}, 401, request_id=request_id)
        output = _run_shell([
            "set -e",
            "cd /opt/kyodobot",
            "if [ -x ./update.sh ]; then sudo ./update.sh; else echo 'update.sh no existe o no es ejecutable'; exit 12; fi",
        ])
        _write_audit(req, "runtime.update", "Ejecutó /opt/kyodobot/update.sh")
        return _json(req, {"ok": True, "message": "Actualización ejecutada en la VM.", "output": output[-12000:], "completedAt": _utc_now()}, request_id=request_id)
    except Exception as exc:
        logging.exception("Runtime update failed request_id=%s", request_id)
        _write_audit(req, "runtime.update", "La actualización falló", False)
        return _json(req, {"error": "RUNTIME_UPDATE_FAILED", "detail": "La actualización remota falló. Revisa los logs."}, 502, request_id=request_id)


@app.route(route="audit", methods=["GET", "OPTIONS"])
def audit(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight_or_reject_origin(req):
        return response
    request_id = str(uuid.uuid4())
    try:
        if not _authorized(req):
            return _json(req, {"error": "UNAUTHORIZED"}, 401, request_id=request_id)
        try:
            limit = max(1, min(50, int(req.params.get("limit", "20"))))
        except ValueError:
            limit = 20
        entities = list(_audit_table().list_entities())
        entities.sort(key=lambda item: str(item.get("at", "")), reverse=True)
        items = [{"staff": e.get("staff", "Staff"), "action": e.get("action", ""), "detail": e.get("detail", ""), "ok": bool(e.get("ok", True)), "at": e.get("at", "")} for e in entities[:limit]]
        return _json(req, {"ok": True, "items": items}, request_id=request_id)
    except Exception:
        logging.exception("Audit query failed request_id=%s", request_id)
        return _json(req, {"error": "AUDIT_FAILED", "detail": "No fue posible leer la auditoría."}, 502, request_id=request_id)
