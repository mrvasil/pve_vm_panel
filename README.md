# pve_vm_panel

Minimal web panel to provision Proxmox VMs from a cloud-init template.

## Setup

1. Create a virtualenv and install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Export configuration values (example) or put them in `.env` (auto-loaded with python-dotenv):

```bash
export PVE_HOST="https://127.0.0.1:8006"
export PVE_USER="root@pam"
export PVE_PASSWORD="your-password"
export PVE_NODE="pve"
export PVE_TEMPLATE_VMID="100"
export PVE_STORAGE="local-lvm"
```

Example `.env`:

```bash
PVE_HOST="https://127.0.0.1:8006"
PVE_USER="root@pam"
PVE_PASSWORD="your-password"
PVE_NODE="pve"
PVE_TEMPLATE_VMID="100"
PVE_STORAGE="local-lvm"
```

3. Run the app:

```bash
python app.py
```

Open `http://localhost:8080`.

## Environment variables

- `PVE_HOST`: Proxmox host. Accepts `192.168.1.142`, `192.168.1.142:8006`, or a full URL like `https://192.168.1.142:8006`.
- `PVE_USER`: user name, e.g. `root@pam`.
- `PVE_PASSWORD`: user password (ignored if token auth is used).
- `PVE_TOKEN_NAME` / `PVE_TOKEN_VALUE`: API token auth.
- `PVE_VERIFY_SSL`: `true` to verify TLS certs (default false).
- `PVE_NODE`: node name.
- `PVE_TEMPLATE_VMID`: template VMID (default 100).
- `PVE_STORAGE`: storage for full clone (default `local-lvm`).
- `PVE_BASE_DISK_MB`: base disk size of the template (default 8704).
- `PVE_DISK_NAME`: disk ID to resize (default `scsi0`).
- `PVE_ALLOW_RESIZE`: `true` to call the disk resize endpoint.
- PVE 9.0 uses `PUT /nodes/{node}/qemu/{vmid}/resize` (the app tries PUT first, then POST, then extjs fallback).
- `PVE_DEFAULT_USERNAME`: default cloud-init user (default `ubuntu`).
- `PVE_SSH_KEYS`: optional SSH public keys for cloud-init.
- `PVE_REGENERATE_CLOUDINIT`: `true` to call the cloud-init regenerate endpoint.
- PVE 9.0 uses `PUT /nodes/{node}/qemu/{vmid}/cloudinit` (the app tries PUT first, then POST fallback).
- `PVE_START_AFTER_CREATE`: `true` to boot VM after provisioning.
- `PVE_WAIT_FOR_IP`: `true` to poll guest agent for DHCP IP.
- `PVE_IP_WAIT_SECONDS`: max seconds to wait for IP (default 180).
- `PVE_POLL_INTERVAL`: polling interval in seconds (default 5).
- `APP_HOST` / `APP_PORT`: Flask bind address (default 0.0.0.0:8080).
- `APP_DEBUG`: `true` to enable Flask debug mode.
- `APP_PASSWORD`: if set, enables login with this password.
- `APP_SECRET_KEY`: Flask session secret (set in production).

## Notes

- IP detection requires the QEMU guest agent inside the template.
- Disk resizing only grows the disk; shrinking is not attempted.
