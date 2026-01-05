import os

def _env_bool(name, default="false"):
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name, default):
    try:
        return int(os.getenv(name, str(default)).strip())
    except (TypeError, ValueError):
        return default


PVE_HOST = os.getenv("PVE_HOST", "https://127.0.0.1:8006")
PVE_USER = os.getenv("PVE_USER", "root@pam")
PVE_PASSWORD = os.getenv("PVE_PASSWORD", "")
PVE_TOKEN_NAME = os.getenv("PVE_TOKEN_NAME")
PVE_TOKEN_VALUE = os.getenv("PVE_TOKEN_VALUE")
PVE_VERIFY_SSL = _env_bool("PVE_VERIFY_SSL", "false")

PVE_NODE = os.getenv("PVE_NODE", "pve")
TEMPLATE_VMID = _env_int("PVE_TEMPLATE_VMID", 100)
PVE_STORAGE = os.getenv("PVE_STORAGE", "local-lvm")
BASE_DISK_MB = _env_int("PVE_BASE_DISK_MB", 8704)
PVE_DISK_NAME = os.getenv("PVE_DISK_NAME", "scsi0")
PVE_ALLOW_RESIZE = _env_bool("PVE_ALLOW_RESIZE", "true")

DEFAULT_USERNAME = os.getenv("PVE_DEFAULT_USERNAME", "ubuntu")
PVE_SSH_KEYS = os.getenv("PVE_SSH_KEYS", "")
PVE_REGENERATE_CLOUDINIT = _env_bool("PVE_REGENERATE_CLOUDINIT", "true")

START_AFTER_CREATE = _env_bool("PVE_START_AFTER_CREATE", "true")
WAIT_FOR_IP = _env_bool("PVE_WAIT_FOR_IP", "true")
IP_WAIT_SECONDS = _env_int("PVE_IP_WAIT_SECONDS", 180)
POLL_INTERVAL = _env_int("PVE_POLL_INTERVAL", 5)

APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = _env_int("APP_PORT", 8080)
APP_DEBUG = _env_bool("APP_DEBUG", "false")

PRESETS = [
    {
        "id": "micro",
        "label": "Micro",
        "cores": 1,
        "memory_mb": 1024,
        "disk_gb": 10,
        "note": "1 vCPU | 1 GB RAM | 10 GB disk",
    },
    {
        "id": "starter",
        "label": "Starter",
        "cores": 2,
        "memory_mb": 2048,
        "disk_gb": 20,
        "note": "2 vCPU | 2 GB RAM | 20 GB disk",
    },
    {
        "id": "build",
        "label": "Build",
        "cores": 4,
        "memory_mb": 4096,
        "disk_gb": 40,
        "note": "4 vCPU | 4 GB RAM | 40 GB disk",
    },
    {
        "id": "heavy",
        "label": "Heavy",
        "cores": 6,
        "memory_mb": 8192,
        "disk_gb": 80,
        "note": "6 vCPU | 8 GB RAM | 80 GB disk",
    },
]
