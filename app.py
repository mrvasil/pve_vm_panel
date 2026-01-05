import copy
import re
import secrets
import string
import threading
import time
import uuid
from functools import wraps
from urllib.parse import urlparse

import requests

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from proxmoxer import ProxmoxAPI

import config

app = Flask(__name__)
app.secret_key = config.APP_SECRET_KEY

JOBS = {}
JOBS_LOCK = threading.Lock()

STEP_ORDER = [
    {"key": "clone", "label": "Clone template"},
    {"key": "cloudinit", "label": "Apply cloud-init"},
    {"key": "hardware", "label": "Resize hardware"},
    {"key": "start", "label": "Start VM"},
    {"key": "ip", "label": "Detect IP"},
]

NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{2,30}$")


def _now():
    return int(time.time())


def _generate_password(length=16):
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _new_job():
    return {
        "id": uuid.uuid4().hex,
        "status": "queued",
        "steps": [
            {
                "key": step["key"],
                "label": step["label"],
                "status": "pending",
                "message": "",
            }
            for step in STEP_ORDER
        ],
        "result": {},
        "error": "",
        "created_at": _now(),
        "updated_at": _now(),
    }


def _update_job(job_id, **fields):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job.update(fields)
        job["updated_at"] = _now()


def _update_step(job_id, key, status, message=None):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        for step in job["steps"]:
            if step["key"] == key:
                step["status"] = status
                if message is not None:
                    step["message"] = message
                job["updated_at"] = _now()
                return


def _set_result(job_id, **fields):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        job["result"].update(fields)
        job["updated_at"] = _now()


def _job_snapshot(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return None
        return copy.deepcopy(job)


def _cleanup_jobs(max_age=6 * 3600):
    cutoff = _now() - max_age
    with JOBS_LOCK:
        for job_id in list(JOBS.keys()):
            if JOBS[job_id].get("updated_at", 0) < cutoff:
                JOBS.pop(job_id, None)


def _auth_enabled():
    return bool(config.APP_PASSWORD)


def _is_authenticated():
    return session.get("authenticated", False)


def require_auth(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not _auth_enabled():
            return fn(*args, **kwargs)
        if _is_authenticated():
            return fn(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify({"error": "Not authorized"}), 401
        return redirect(url_for("login"))
    return wrapper


def _get_proxmox():
    host, port, path_prefix = _normalize_host()
    if config.PVE_TOKEN_NAME and config.PVE_TOKEN_VALUE:
        return ProxmoxAPI(
            host,
            user=config.PVE_USER,
            token_name=config.PVE_TOKEN_NAME,
            token_value=config.PVE_TOKEN_VALUE,
            verify_ssl=config.PVE_VERIFY_SSL,
            port=port,
            path_prefix=path_prefix,
        )
    if not config.PVE_PASSWORD:
        raise RuntimeError("PVE_PASSWORD is required when token auth is not set")
    return ProxmoxAPI(
        host,
        user=config.PVE_USER,
        password=config.PVE_PASSWORD,
        verify_ssl=config.PVE_VERIFY_SSL,
        port=port,
        path_prefix=path_prefix,
    )


def _unwrap_data(payload):
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def _normalize_host():
    _, host, port, path_prefix = _parse_host()
    return host, port, path_prefix


def _parse_host():
    raw = (config.PVE_HOST or "").strip()
    if not raw:
        raise RuntimeError("PVE_HOST is required")
    if "://" in raw:
        parsed = urlparse(raw)
        if not parsed.hostname:
            raise RuntimeError("PVE_HOST must include a hostname")
        scheme = parsed.scheme or "https"
        path_prefix = parsed.path.strip("/") or None
        return scheme, parsed.hostname, parsed.port, path_prefix
    parsed = urlparse(f"https://{raw}")
    if not parsed.hostname:
        raise RuntimeError("PVE_HOST must include a hostname")
    return "https", parsed.hostname, parsed.port, None


def _api_base(mode="json"):
    scheme, host, port, path_prefix = _parse_host()
    if not port:
        port = 8006
    prefix = f"/{path_prefix}" if path_prefix else ""
    return f"{scheme}://{host}:{port}{prefix}/api2/{mode}"


def _extjs_resize(node, vmid, disk, size_value):
    base_extjs = _api_base("extjs")
    url = f"{base_extjs}/nodes/{node}/qemu/{vmid}/resize"
    payload = {
        "disk": disk,
        "size": size_value,
    }
    headers = {}
    cookies = None
    if config.PVE_TOKEN_NAME and config.PVE_TOKEN_VALUE:
        token = f"{config.PVE_USER}!{config.PVE_TOKEN_NAME}={config.PVE_TOKEN_VALUE}"
        headers["Authorization"] = f"PVEAPIToken={token}"
    else:
        ticket_url = f"{_api_base('json')}/access/ticket"
        resp = requests.post(
            ticket_url,
            data={"username": config.PVE_USER, "password": config.PVE_PASSWORD},
            verify=config.PVE_VERIFY_SSL,
            timeout=15,
        )
        resp.raise_for_status()
        payload_data = _unwrap_data(resp.json())
        ticket = payload_data.get("ticket")
        csrf = payload_data.get("CSRFPreventionToken")
        if not ticket or not csrf:
            raise RuntimeError("Failed to fetch Proxmox auth ticket")
        cookies = {"PVEAuthCookie": ticket}
        headers["CSRFPreventionToken"] = csrf
    response = requests.post(
        url,
        data=payload,
        headers=headers,
        cookies=cookies,
        verify=config.PVE_VERIFY_SSL,
        timeout=30,
    )
    response.raise_for_status()
    data = _unwrap_data(response.json())
    if isinstance(data, dict):
        if data.get("success") is False:
            raise RuntimeError(f"Resize failed: {data}")
        return data.get("data")
    return data


def _parse_size_to_mb(value):
    if not value:
        return None
    match = re.search(r"([0-9.]+)([KMGTP])", value)
    if not match:
        return None
    size = float(match.group(1))
    unit = match.group(2)
    scale = {"K": 1 / 1024, "M": 1, "G": 1024, "T": 1024 * 1024, "P": 1024 * 1024 * 1024}
    return int(size * scale[unit])


def _read_disk_size_mb(proxmox, node, vmid):
    config_data = _unwrap_data(proxmox.nodes(node).qemu(vmid).config.get())
    if not isinstance(config_data, dict):
        return None
    disk_entry = config_data.get(config.PVE_DISK_NAME)
    if not disk_entry:
        return None
    match = re.search(r"size=([^,]+)", str(disk_entry))
    if not match:
        return None
    return _parse_size_to_mb(match.group(1))


def _wait_for_disk_size(proxmox, node, vmid, target_mb, timeout=120):
    deadline = time.time() + timeout
    while time.time() < deadline:
        size = _read_disk_size_mb(proxmox, node, vmid)
        if size and size >= target_mb:
            return size
        time.sleep(config.POLL_INTERVAL)
    return None


def _wait_for_task(proxmox, node, upid, timeout=1800):
    start = time.time()
    while True:
        task = _unwrap_data(proxmox.nodes(node).tasks(upid).status.get())
        if not isinstance(task, dict):
            raise RuntimeError("Unexpected task status response")
        if task.get("status") != "running":
            if task.get("exitstatus") != "OK":
                raise RuntimeError(f"Task failed: {task.get('exitstatus')}")
            return
        if time.time() - start > timeout:
            raise RuntimeError("Task timeout")
        time.sleep(config.POLL_INTERVAL)


def _read_vm_ip(proxmox, node, vmid):
    try:
        data = proxmox.nodes(node).qemu(vmid).agent("network-get-interfaces").get()
    except Exception:
        return None
    data = _unwrap_data(data)
    if isinstance(data, dict):
        interfaces = data.get("result") or data.get("interfaces") or []
    elif isinstance(data, list):
        interfaces = data
    else:
        interfaces = []
    for iface in interfaces:
        if iface.get("name") == "lo":
            continue
        for addr in iface.get("ip-addresses", []):
            if addr.get("ip-address-type") != "ipv4":
                continue
            ip = addr.get("ip-address")
            if ip and not ip.startswith("127."):
                return ip
    return None


def _wait_for_ip(proxmox, node, vmid):
    deadline = time.time() + config.IP_WAIT_SECONDS
    while time.time() < deadline:
        ip = _read_vm_ip(proxmox, node, vmid)
        if ip:
            return ip
        time.sleep(config.POLL_INTERVAL)
    return None


def _apply_preset(proxmox, node, vmid, preset):
    proxmox.nodes(node).qemu(vmid).config.post(
        cores=preset["cores"],
        memory=preset["memory_mb"],
    )
    target_mb = int(preset["disk_gb"] * 1024)
    current_mb = _read_disk_size_mb(proxmox, node, vmid) or config.BASE_DISK_MB
    delta = target_mb - current_mb
    if delta <= 0:
        return f"Disk unchanged ({current_mb}M)"
    if not config.PVE_ALLOW_RESIZE:
        return f"Disk resize skipped (+{delta}M)"
    size_delta = f"+{delta}M"
    size_absolute = f"{target_mb}M"
    result = None

    try:
        result = proxmox.nodes(node).qemu(vmid).resize.put(
            disk=config.PVE_DISK_NAME,
            size=size_delta,
        )
    except Exception as exc:
        message = str(exc)
        if "501" not in message and "Not Implemented" not in message and "404" not in message:
            raise

    if result is None:
        try:
            result = proxmox.nodes(node).qemu(vmid).resize.post(
                disk=config.PVE_DISK_NAME,
                size=size_delta,
            )
        except Exception as exc:
            message = str(exc)
            if "501" not in message and "Not Implemented" not in message and "404" not in message:
                raise

    if result is not None:
        upid = _unwrap_data(result)
        if isinstance(upid, str) and upid.startswith("UPID"):
            _wait_for_task(proxmox, node, upid)
        new_size = _wait_for_disk_size(proxmox, node, vmid, target_mb)
        if new_size:
            return f"Disk {new_size}M"
        return f"Disk resize queued ({size_delta})"

    result = _extjs_resize(node, vmid, config.PVE_DISK_NAME, size_delta)
    if isinstance(result, str) and result.startswith("UPID"):
        _wait_for_task(proxmox, node, result)
    new_size = _wait_for_disk_size(proxmox, node, vmid, target_mb)
    if new_size:
        return f"Disk {new_size}M (extjs)"
    result = _extjs_resize(node, vmid, config.PVE_DISK_NAME, size_absolute)
    if isinstance(result, str) and result.startswith("UPID"):
        _wait_for_task(proxmox, node, result)
    new_size = _wait_for_disk_size(proxmox, node, vmid, target_mb)
    if new_size:
        return f"Disk {new_size}M (extjs-abs)"
    return f"Disk resize pending ({size_delta})"


def _regenerate_cloudinit(proxmox, node, vmid):
    if not config.PVE_REGENERATE_CLOUDINIT:
        return "done", "Cloud-init updated (regen disabled)"
    try:
        proxmox.nodes(node).qemu(vmid).cloudinit.put()
        return "done", "Cloud-init updated"
    except Exception as exc:
        message = str(exc)
        if "501" not in message and "Not Implemented" not in message and "404" not in message:
            raise
    try:
        proxmox.nodes(node).qemu(vmid).cloudinit.post()
        return "done", "Cloud-init updated"
    except Exception as exc:
        message = str(exc)
        if "501" in message or "Not Implemented" in message or "404" in message:
            return "warn", "Cloud-init updated, regenerate not supported"
        raise


def _provision_vm(job_id, vm_name, username, password, preset):
    _update_job(job_id, status="running")
    proxmox = _get_proxmox()
    node = config.PVE_NODE
    clone_name = f"{vm_name}-vm"
    current_step = "clone"

    try:
        _update_step(job_id, current_step, "running", "Cloning template")
        vmid = int(_unwrap_data(proxmox.cluster.nextid.get()))
        _set_result(job_id, vmid=vmid, name=clone_name)

        upid = proxmox.nodes(node).qemu(config.TEMPLATE_VMID).clone.post(
            newid=vmid,
            name=clone_name,
            full=1,
            storage=config.PVE_STORAGE,
        )
        _wait_for_task(proxmox, node, _unwrap_data(upid))
        _update_step(job_id, current_step, "done", "Clone ready")

        current_step = "cloudinit"
        _update_step(job_id, current_step, "running", "Writing cloud-init")
        payload = {
            "ciuser": username,
            "cipassword": password,
            "ipconfig0": "ip=dhcp",
        }
        if config.PVE_SSH_KEYS:
            payload["sshkeys"] = config.PVE_SSH_KEYS
        proxmox.nodes(node).qemu(vmid).config.post(**payload)
        status, message = _regenerate_cloudinit(proxmox, node, vmid)
        _update_step(job_id, current_step, status, message)

        current_step = "hardware"
        _update_step(job_id, current_step, "running", "Applying preset")
        resize_note = _apply_preset(proxmox, node, vmid, preset)
        _update_step(job_id, current_step, "done", resize_note)

        current_step = "start"
        if config.START_AFTER_CREATE:
            _update_step(job_id, current_step, "running", "Starting VM")
            proxmox.nodes(node).qemu(vmid).status.start.post()
            _update_step(job_id, current_step, "done", "VM started")
        else:
            _update_step(job_id, current_step, "skipped", "Start disabled")

        current_step = "ip"
        ip_address = None
        if config.WAIT_FOR_IP and config.START_AFTER_CREATE:
            _update_step(job_id, current_step, "running", "Waiting for DHCP")
            ip_address = _wait_for_ip(proxmox, node, vmid)
            if ip_address:
                _update_step(job_id, current_step, "done", ip_address)
            else:
                _update_step(job_id, current_step, "warn", "IP not detected")
        else:
            _update_step(job_id, current_step, "skipped", "IP check disabled")

        _set_result(
            job_id,
            username=username,
            password=password,
            ip=ip_address,
        )
        _update_job(job_id, status="done")
    except Exception as exc:
        _update_step(job_id, current_step, "error", str(exc))
        _update_job(job_id, status="error", error=str(exc))


@app.route("/")
@require_auth
def index():
    return render_template(
        "index.html",
        presets=config.PRESETS,
        default_username=config.DEFAULT_USERNAME,
        template_vmid=config.TEMPLATE_VMID,
        storage=config.PVE_STORAGE,
        include_app_js=True,
        auth_enabled=_auth_enabled(),
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    if not _auth_enabled():
        return redirect(url_for("index"))
    error = ""
    if request.method == "POST":
        password = (request.form.get("password") or "").strip()
        if password and password == config.APP_PASSWORD:
            session["authenticated"] = True
            return redirect(url_for("index"))
        error = "Invalid password"
    return render_template("login.html", error=error, include_app_js=False)


@app.route("/logout")
def logout():
    session.pop("authenticated", None)
    return redirect(url_for("login"))


@app.route("/api/create", methods=["POST"])
@require_auth
def create_vm():
    payload = request.get_json(silent=True) or {}
    name = (payload.get("vm_name") or "").strip()
    preset_id = (payload.get("preset") or "").strip()
    username = (payload.get("username") or "").strip() or config.DEFAULT_USERNAME
    password = (payload.get("password") or "").strip()

    if not NAME_PATTERN.match(name):
        return jsonify({"error": "Invalid VM name"}), 400

    preset = next((item for item in config.PRESETS if item["id"] == preset_id), None)
    if not preset:
        return jsonify({"error": "Preset not found"}), 400

    if password and len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400

    if not password:
        password = _generate_password()

    job = _new_job()
    _cleanup_jobs()
    with JOBS_LOCK:
        JOBS[job["id"]] = job

    thread = threading.Thread(
        target=_provision_vm,
        args=(job["id"], name, username, password, preset),
        daemon=True,
    )
    thread.start()

    return jsonify({"job_id": job["id"]})


@app.route("/api/status/<job_id>")
@require_auth
def job_status(job_id):
    job = _job_snapshot(job_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


if __name__ == "__main__":
    app.run(host=config.APP_HOST, port=config.APP_PORT, debug=config.APP_DEBUG)
