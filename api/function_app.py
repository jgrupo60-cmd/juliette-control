"""Juliette Control Center — Azure Bridge.

Endpoints:
- GET  /api/health
- GET  /api/vm/status
- POST /api/vm/start (Bearer token required)

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

APP_VERSION = "0.4.0"
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
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
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
