from types import SimpleNamespace

from function_app import _power_state


def test_power_state_extracts_runtime_code():
    statuses = [SimpleNamespace(code="ProvisioningState/succeeded"), SimpleNamespace(code="PowerState/running")]
    assert _power_state(statuses) == "running"


def test_power_state_falls_back_to_unknown():
    assert _power_state([]) == "unknown"
    assert _power_state(None) == "unknown"
