from types import SimpleNamespace

import pytest

from function_app import _allowed_origins, _power_state, _safe_http_detail


def test_power_state_extracts_runtime_code():
    statuses = [SimpleNamespace(code="ProvisioningState/succeeded"), SimpleNamespace(code="PowerState/running")]
    assert _power_state(statuses) == "running"


def test_power_state_is_case_insensitive():
    statuses = [SimpleNamespace(code="POWERSTATE/DEALLOCATED")]
    assert _power_state(statuses) == "deallocated"


def test_power_state_falls_back_to_unknown():
    assert _power_state([]) == "unknown"
    assert _power_state(None) == "unknown"


def test_allowed_origins_are_normalized(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://example.com/, https://staff.example.com")
    assert _allowed_origins() == {"https://example.com", "https://staff.example.com"}


def test_safe_http_detail_hides_provider_message():
    exc = SimpleNamespace(status_code=403)
    assert "permisos" in _safe_http_detail(exc).lower()
