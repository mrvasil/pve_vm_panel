const form = document.getElementById("create-form");
const submitBtn = document.getElementById("submit-btn");
const statusPill = document.getElementById("status-pill");
const stepsEl = document.getElementById("steps");
const errorBox = document.getElementById("error-box");
const copyBtn = document.getElementById("copy-password");
const genBtn = document.getElementById("gen-pass");
const passInput = document.getElementById("password");

const resultName = document.getElementById("result-name");
const resultVmid = document.getElementById("result-vmid");
const resultIp = document.getElementById("result-ip");
const resultUser = document.getElementById("result-user");
const resultPass = document.getElementById("result-pass");

let currentJobId = null;
let pollTimer = null;
let lastPassword = "";

const DEFAULT_STEPS = [
    { key: "clone", label: "Clone template", status: "pending", message: "" },
    { key: "cloudinit", label: "Apply cloud-init", status: "pending", message: "" },
    { key: "hardware", label: "Resize hardware", status: "pending", message: "" },
    { key: "start", label: "Start VM", status: "pending", message: "" },
    { key: "ip", label: "Detect IP", status: "pending", message: "" },
];

function setStatus(state, text) {
    statusPill.textContent = text;
    statusPill.classList.remove("is-running", "is-done", "is-error");
    if (state === "running") statusPill.classList.add("is-running");
    if (state === "done") statusPill.classList.add("is-done");
    if (state === "error") statusPill.classList.add("is-error");
}

function setError(message) {
    if (message) {
        errorBox.textContent = message;
        errorBox.classList.add("is-visible");
    } else {
        errorBox.textContent = "";
        errorBox.classList.remove("is-visible");
    }
}

function renderSteps(steps) {
    stepsEl.innerHTML = steps
        .map((step) => {
            const status = step.status || "pending";
            const message = step.message || "";
            const stateLabel = status.toUpperCase();
            return `
                <div class="step step--${status}">
                    <div class="step-left">
                        <span class="step-dot"></span>
                        <div>
                            <div class="step-title">${step.label}</div>
                            <div class="step-msg">${message}</div>
                        </div>
                    </div>
                    <div class="step-state">${stateLabel}</div>
                </div>
            `;
        })
        .join("");
}

function resetResults() {
    resultName.textContent = "-";
    resultVmid.textContent = "-";
    resultIp.textContent = "-";
    resultUser.textContent = "-";
    resultPass.textContent = "-";
    copyBtn.disabled = true;
    lastPassword = "";
}

function updateResults(result) {
    if (!result) return;
    if (result.name) resultName.textContent = result.name;
    if (result.vmid) resultVmid.textContent = result.vmid;
    if (result.ip) resultIp.textContent = result.ip;
    if (result.username) resultUser.textContent = result.username;
    if (result.password) {
        resultPass.textContent = result.password;
        lastPassword = result.password;
        copyBtn.disabled = false;
    }
}

function generatePassword(length = 16) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    const array = new Uint32Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, (x) => alphabet[x % alphabet.length]).join("");
}

function stopPolling() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

function schedulePoll() {
    stopPolling();
    pollTimer = setTimeout(pollJob, 2000);
}

function pollJob() {
    if (!currentJobId) return;
    fetch(`/api/status/${currentJobId}`)
        .then((response) => response.json())
        .then((data) => {
            if (data.error) {
                setError(data.error);
                setStatus("error", "Error");
                submitBtn.disabled = false;
                submitBtn.textContent = "Create VM";
                stopPolling();
                return;
            }
            renderSteps(data.steps || DEFAULT_STEPS);
            updateResults(data.result || {});

            if (data.status === "done") {
                setStatus("done", "Done");
                submitBtn.disabled = false;
                submitBtn.textContent = "Create VM";
                stopPolling();
            } else if (data.status === "error") {
                setStatus("error", "Error");
                setError(data.error || "Provisioning failed");
                submitBtn.disabled = false;
                submitBtn.textContent = "Create VM";
                stopPolling();
            } else {
                setStatus("running", "Running");
                schedulePoll();
            }
        })
        .catch((err) => {
            setError(`Network error: ${err.message}`);
            setStatus("error", "Error");
            submitBtn.disabled = false;
            submitBtn.textContent = "Create VM";
            stopPolling();
        });
}

form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = {
        vm_name: formData.get("vm_name"),
        username: formData.get("username"),
        password: formData.get("password"),
        preset: formData.get("preset"),
    };

    setError("");
    resetResults();
    renderSteps(DEFAULT_STEPS);
    setStatus("running", "Queued");
    submitBtn.disabled = true;
    submitBtn.textContent = "Provisioning...";

    fetch("/api/create", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
    })
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) {
                const message = data.error || "Request failed";
                throw new Error(message);
            }
            currentJobId = data.job_id;
            schedulePoll();
        })
        .catch((err) => {
            setError(err.message);
            setStatus("error", "Error");
            submitBtn.disabled = false;
            submitBtn.textContent = "Create VM";
        });
});

genBtn.addEventListener("click", () => {
    passInput.value = generatePassword();
});

copyBtn.addEventListener("click", async () => {
    if (!lastPassword) return;
    try {
        await navigator.clipboard.writeText(lastPassword);
        copyBtn.textContent = "Copied";
        setTimeout(() => {
            copyBtn.textContent = "Copy password";
        }, 1500);
    } catch (err) {
        setError("Clipboard blocked in this browser");
    }
});

renderSteps(DEFAULT_STEPS);

const tabButtons = document.querySelectorAll(".tab-btn");
const tabCreate = document.getElementById("tab-create");
const tabManage = document.getElementById("tab-manage");
const refreshVmsBtn = document.getElementById("refresh-vms");
const vmListEl = document.getElementById("vm-list");
const vmDetailsEl = document.getElementById("vm-details");
const vmEmptyEl = document.getElementById("vm-empty");
const vmTitle = document.getElementById("vm-title");
const vmMeta = document.getElementById("vm-meta");
const vmDiskCurrent = document.getElementById("vm-disk-current");
const vmNetCurrent = document.getElementById("vm-net-current");
const vmUpdateForm = document.getElementById("vm-update-form");
const vmUpdateError = document.getElementById("vm-update-error");
const vmUsername = document.getElementById("vm-username");
const vmPassword = document.getElementById("vm-password");
const vmCores = document.getElementById("vm-cores");
const vmRam = document.getElementById("vm-ram");
const vmDiskAdd = document.getElementById("vm-disk-add");
const vmNetIface = document.getElementById("vm-net-iface");
const vmNetBridge = document.getElementById("vm-net-bridge");
const vmGenPass = document.getElementById("vm-gen-pass");
const vmStartBtn = document.getElementById("vm-start");
const vmRebootBtn = document.getElementById("vm-reboot");
const vmStopBtn = document.getElementById("vm-stop");

let selectedVmid = null;
let networkOptions = [];
let netMap = {};

function setTab(tabName) {
    if (!tabCreate || !tabManage) return;
    const isManage = tabName === "manage";
    tabCreate.hidden = isManage;
    tabManage.hidden = !isManage;
    tabButtons.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === tabName);
    });
    if (isManage && vmListEl && vmListEl.children.length === 0) {
        loadVmList();
    }
}

tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
});

if (tabCreate && tabManage) {
    setTab("manage");
}

function setVmMessage(message, isError) {
    if (!vmUpdateError) return;
    vmUpdateError.textContent = message || "";
    vmUpdateError.classList.toggle("is-visible", !!message);
    vmUpdateError.classList.toggle("is-success", !isError && !!message);
}

function statusClass(status) {
    if (status === "running") return "status--running";
    if (status === "stopped") return "status--stopped";
    if (status === "paused") return "status--paused";
    return "status--unknown";
}

function loadNetworks() {
    return fetch("/api/networks")
        .then((response) => response.json())
        .then((data) => {
            networkOptions = (data.bridges || []).filter((entry) => entry.iface);
        })
        .catch(() => {
            networkOptions = [];
        });
}

function renderNetworkSelects(currentIface, currentBridge) {
    if (!vmNetIface || !vmNetBridge) return;
    vmNetIface.innerHTML = "";
    Object.keys(netMap).forEach((iface) => {
        const option = document.createElement("option");
        option.value = iface;
        option.textContent = iface.toUpperCase();
        option.selected = iface === currentIface;
        vmNetIface.appendChild(option);
    });

    vmNetBridge.innerHTML = "";
    networkOptions.forEach((bridge) => {
        const option = document.createElement("option");
        option.value = bridge.iface;
        option.textContent = bridge.iface + (bridge.active ? " · up" : " · down");
        option.selected = bridge.iface === currentBridge;
        vmNetBridge.appendChild(option);
    });
}

function renderVmList(vms) {
    if (!vmListEl) return;
    vmListEl.innerHTML = "";
    if (!vms.length) {
        vmListEl.innerHTML = "<div class=\"vm-empty\">No VMs found.</div>";
        return;
    }
    vms.forEach((vm) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `vm-card ${statusClass(vm.status)}`;
        if (vm.vmid === selectedVmid) card.classList.add("active");
        card.innerHTML = `
            <div class="vm-card-top">
                <span class="status-dot"></span>
                <div class="vm-card-id">#${vm.vmid}</div>
            </div>
            <div class="vm-card-name">${vm.name || "Unnamed VM"}</div>
            <div class="vm-card-ip">${vm.ip || ""}</div>
            <div class="vm-card-specs">
                <span>${vm.maxcpu || "-"} vCPU</span>
                <span>${vm.maxmem_mb ? Math.round(vm.maxmem_mb / 1024) : "-"} GB RAM</span>
            </div>
        `;
        card.addEventListener("click", () => selectVm(vm.vmid));
        vmListEl.appendChild(card);
    });
}

function loadVmList() {
    if (!vmListEl) return;
    vmListEl.innerHTML = "<div class=\"vm-empty\">Loading...</div>";
    fetch("/api/vms")
        .then((response) => response.json())
        .then((data) => {
            renderVmList(data.vms || []);
        })
        .catch((err) => {
            vmListEl.innerHTML = `<div class="vm-empty">Failed to load: ${err.message}</div>`;
        });
}

function updateMeta(details) {
    if (!vmTitle || !vmMeta) return;
    vmTitle.textContent = details.name ? `${details.name}` : `VM ${details.vmid}`;
    const ipText = details.ip || "IP unavailable";
    const status = details.status || "unknown";
    vmMeta.textContent = `Status: ${status.toUpperCase()} · ${ipText}`;
}

function selectVm(vmid) {
    selectedVmid = vmid;
    loadVmDetails(vmid);
}

function loadVmDetails(vmid) {
    if (!vmDetailsEl || !vmEmptyEl) return;
    setVmMessage("", false);
    vmEmptyEl.hidden = true;
    vmDetailsEl.hidden = false;
    fetch(`/api/vms/${vmid}`)
        .then((response) => response.json())
        .then((details) => {
            updateMeta(details);
            vmUsername.value = details.ciuser || "";
            vmPassword.value = "";
            vmCores.value = details.cores || "";
            vmRam.value = details.memory ? (details.memory / 1024).toFixed(1).replace(/\\.0$/, "") : "";
            vmDiskAdd.value = "";
            vmDiskCurrent.textContent = details.disk_size_mb
                ? `Current: ${(details.disk_size_mb / 1024).toFixed(1).replace(/\\.0$/, "")} GB`
                : "Current: -";
            netMap = details.networks || {};
            const ifaceKeys = Object.keys(netMap);
            const defaultIface = ifaceKeys.includes("net0") ? "net0" : ifaceKeys[0];
            const currentBridge = defaultIface ? netMap[defaultIface]?.bridge : null;
            vmNetCurrent.textContent = defaultIface
                ? `Current: ${defaultIface.toUpperCase()} → ${currentBridge || "unknown"}`
                : "Current: -";
            loadNetworks().finally(() => {
                renderNetworkSelects(defaultIface, currentBridge);
            });
            renderVmListFromSelection();
        })
        .catch((err) => {
            setVmMessage(`Failed to load VM: ${err.message}`, true);
        });
}

function renderVmListFromSelection() {
    if (!vmListEl) return;
    Array.from(vmListEl.children).forEach((child) => {
        if (!(child instanceof HTMLElement)) return;
        const idText = child.querySelector(".vm-card-id")?.textContent || "";
        const vmid = parseInt(idText.replace("#", ""), 10);
        child.classList.toggle("active", vmid === selectedVmid);
    });
}

if (vmNetIface) {
    vmNetIface.addEventListener("change", () => {
        const iface = vmNetIface.value;
        const bridge = netMap[iface]?.bridge || "";
        if (vmNetBridge && bridge) {
            Array.from(vmNetBridge.options).forEach((option) => {
                option.selected = option.value === bridge;
            });
        }
        vmNetCurrent.textContent = iface
            ? `Current: ${iface.toUpperCase()} → ${bridge || "unknown"}`
            : "Current: -";
    });
}

if (refreshVmsBtn) {
    refreshVmsBtn.addEventListener("click", () => loadVmList());
}

if (vmGenPass) {
    vmGenPass.addEventListener("click", () => {
        vmPassword.value = generatePassword();
    });
}

function submitVmUpdate(event) {
    event.preventDefault();
    if (!selectedVmid) return;
    const payload = {};
    if (vmUsername.value) payload.ciuser = vmUsername.value.trim();
    if (vmPassword.value) payload.cipassword = vmPassword.value;
    if (vmCores.value) payload.cores = parseInt(vmCores.value, 10);
    if (vmRam.value) payload.memory_mb = Math.round(parseFloat(vmRam.value) * 1024);
    if (vmDiskAdd.value) payload.disk_add_gb = parseFloat(vmDiskAdd.value);
    if (vmNetIface.value && vmNetBridge.value) {
        payload.net_iface = vmNetIface.value;
        payload.net_bridge = vmNetBridge.value;
    }
    setVmMessage("", false);
    fetch(`/api/vms/${selectedVmid}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    })
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
            if (!ok || data.error) {
                throw new Error(data.error || "Update failed");
            }
            setVmMessage("Changes applied.", false);
            loadVmDetails(selectedVmid);
        })
        .catch((err) => {
            setVmMessage(err.message, true);
        });
}

if (vmUpdateForm) {
    vmUpdateForm.addEventListener("submit", submitVmUpdate);
}

function powerAction(action) {
    if (!selectedVmid) return;
    fetch(`/api/vms/${selectedVmid}/power`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
    })
        .then((response) => response.json())
        .then(() => loadVmDetails(selectedVmid))
        .catch(() => {});
}

if (vmStartBtn) vmStartBtn.addEventListener("click", () => powerAction("start"));
if (vmRebootBtn) vmRebootBtn.addEventListener("click", () => powerAction("reboot"));
if (vmStopBtn) vmStopBtn.addEventListener("click", () => powerAction("stop"));
