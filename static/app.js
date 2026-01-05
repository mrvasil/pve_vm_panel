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
