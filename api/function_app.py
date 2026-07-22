"""Juliette Control Azure Bridge.

HTTP endpoints:
- GET  /api/health
- GET  /api/vm/status
- POST /api/vm/start (Bearer token required until PR-004)
"""
from __future__ import annotations

import hmac
import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import azure.functions as func
from azure.core.exceptions import AzureError, HttpResponseError
from azure.identity import DefaultAzureCredential
from azure.mgmt.compute import ComputeManagementClient

app = func.FunctionApp(http_auth_level=func.AuthLevel.ANONYMOUS)


def _required_setting(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required app setting: {name}")
    return value


def _allowed_origins() -> set[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "https://jgrupo60-cmd.github.io")
    return {item.strip().rstrip("/") for item in raw.split(",") if item.strip()}


def _cors_headers(req: func.HttpRequest) -> dict[str, str]:
    origin = (req.headers.get("Origin") or "").rstrip("/")
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Vary": "Origin",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    }
    if origin in _allowed_origins():
        headers["Access-Control-Allow-Origin"] = origin
    return headers


def _json(req: func.HttpRequest, payload: dict[str, Any], status: int = 200) -> func.HttpResponse:
    return func.HttpResponse(
        json.dumps(payload, ensure_ascii=False),
        status_code=status,
        headers=_cors_headers(req),
        mimetype="application/json",
    )


def _preflight(req: func.HttpRequest) -> func.HttpResponse | None:
    if req.method == "OPTIONS":
        return func.HttpResponse(status_code=204, headers=_cors_headers(req))
    origin = (req.headers.get("Origin") or "").rstrip("/")
    if origin and origin not in _allowed_origins():
        return _json(req, {"error": "ORIGIN_NOT_ALLOWED"}, 403)
    return None


def _authorized(req: func.HttpRequest) -> bool:
    configured = _required_setting("CONTROL_ACCESS_TOKEN")
    supplied = req.headers.get("Authorization", "")
    if not supplied.startswith("Bearer "):
        return False
    return hmac.compare_digest(supplied.removeprefix("Bearer ").strip(), configured)


def _client() -> ComputeManagementClient:
    return ComputeManagementClient(DefaultAzureCredential(), _required_setting("AZURE_SUBSCRIPTION_ID"))


def _vm_settings() -> tuple[str, str]:
    return _required_setting("AZURE_RESOURCE_GROUP"), _required_setting("AZURE_VM_NAME")


def _power_state(statuses: list[Any] | None) -> str:
    for status in statuses or []:
        code = str(getattr(status, "code", ""))
        if code.lower().startswith("powerstate/"):
            return code.split("/", 1)[1].lower()
    return "unknown"


@app.route(route="health", methods=["GET", "OPTIONS"])
def health(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight(req):
        return response
    return _json(req, {
        "ok": True,
        "service": "juliette-control-azure-bridge",
        "version": "0.3.0",
        "checkedAt": datetime.now(timezone.utc).isoformat(),
    })


@app.route(route="vm/status", methods=["GET", "OPTIONS"])
def vm_status(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight(req):
        return response
    try:
        group, name = _vm_settings()
        view = _client().virtual_machines.instance_view(group, name)
        state = _power_state(view.statuses)
        return _json(req, {
            "vm": state,
            "powerState": state,
            "vmName": name,
            "region": os.getenv("AZURE_VM_REGION", "North Central US"),
            "checkedAt": datetime.now(timezone.utc).isoformat(),
        })
    except RuntimeError as exc:
        logging.exception("Azure Bridge configuration error")
        return _json(req, {"error": "BRIDGE_NOT_CONFIGURED", "detail": str(exc)}, 503)
    except HttpResponseError as exc:
        logging.exception("Azure rejected VM status request")
        return _json(req, {"error": "AZURE_STATUS_FAILED", "detail": exc.message}, exc.status_code or 502)
    except AzureError:
        logging.exception("Azure SDK failure while reading VM status")
        return _json(req, {"error": "AZURE_UNAVAILABLE"}, 502)


@app.route(route="vm/start", methods=["POST", "OPTIONS"])
def vm_start(req: func.HttpRequest) -> func.HttpResponse:
    if response := _preflight(req):
        return response
    try:
        if not _authorized(req):
            return _json(req, {"error": "UNAUTHORIZED"}, 401)
        group, name = _vm_settings()
        client = _client()
        current = _power_state(client.virtual_machines.instance_view(group, name).statuses)
        if current == "running":
            return _json(req, {"ok": True, "powerState": "running", "message": "Juliette ya está encendida."})
        if current in {"starting", "stopping", "deallocating"}:
            return _json(req, {"ok": False, "powerState": current, "message": "La VM ya tiene una operación en curso."}, 409)

        client.virtual_machines.begin_start(group, name)
        logging.info("VM start accepted for %s/%s", group, name)
        return _json(req, {
            "ok": True,
            "powerState": "starting",
            "message": "Azure aceptó la solicitud de encendido.",
            "requestedAt": datetime.now(timezone.utc).isoformat(),
        }, 202)
    except RuntimeError as exc:
        logging.exception("Azure Bridge configuration error")
        return _json(req, {"error": "BRIDGE_NOT_CONFIGURED", "detail": str(exc)}, 503)
    except HttpResponseError as exc:
        logging.exception("Azure rejected VM start request")
        return _json(req, {"error": "AZURE_START_FAILED", "detail": exc.message}, exc.status_code or 502)
    except AzureError:
        logging.exception("Azure SDK failure while starting VM")
        return _json(req, {"error": "AZURE_UNAVAILABLE"}, 502)
