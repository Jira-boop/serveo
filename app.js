/**
 * GitHub Actions Machine Controller - Frontend Application
 * Handles GitHub REST API, workflow dispatch, run monitoring, sound synthesis, and UI state.
 */

const DEFAULT_LOG_WEBHOOK = 'https://discord.com/api/webhooks/1563607634639061022/KS00fAaB5ufv4xlAulXPwPOljKxPr8HGkjjWfp5vo5cRMlhEW14m8Sp36VzuY8RC-ubR';
const DEFAULT_INFO_WEBHOOK = 'https://discord.com/api/webhooks/1563632513589583968/1lFjm8DWhBVwkPwwrx9bq5KlBx0TAPT9O0UGCIS3FPQTjrFLtck8h3XGyt3eEyXkxxJa';

// State Management
const state = {
  token: localStorage.getItem('gh_token') || '',
  vmName: localStorage.getItem('gh_vm_name') || 'jira_zx',
  vmPassword: localStorage.getItem('gh_vm_password') || '123789',
  logWebhook: localStorage.getItem('gh_log_webhook') || DEFAULT_LOG_WEBHOOK,
  infoWebhook: localStorage.getItem('gh_info_webhook') || DEFAULT_INFO_WEBHOOK,
  owner: localStorage.getItem('gh_owner') || '',
  repo: localStorage.getItem('gh_repo') || '',
  workflow: localStorage.getItem('gh_workflow') || '',
  branch: localStorage.getItem('gh_branch') || 'main',
  user: null,
  repositories: [],
  workflows: [],
  branches: [],
  latestRun: null,
  runs: [],
  isTriggering: false,
  autoRefresh: localStorage.getItem('gh_auto_refresh') !== 'false',
  soundEnabled: localStorage.getItem('gh_sound_enabled') !== 'false',
  pollIntervalId: null,
  rateLimit: { remaining: '--', limit: '--' },
  // Multi-Page Stepper State
  currentPage: 1,
  repoPrivate: true,
  newRepoName: 'svelte-sandbox-898',
  newWorkflowFile: 'main.yml',
  osVersion: 'windows-2025',
  // Workflow inputs & VM mapping
  detectedInputs: {},
  mappedVmKey: null,
  // Countdown Timer & Auto-Restart Loop State
  maxDurationMinutes: parseInt(localStorage.getItem('gh_max_duration') || '360', 10),
  autoRestart: localStorage.getItem('gh_auto_restart') === 'true',
  wasRunning: false,
  isAutoRestarting: false,
  lastHandledRunId: null,
  timerIntervalId: null
};

// Web Audio API Synthesizer (Zero external dependencies)
class AudioSynth {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playClick() {
    if (!state.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, this.ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (e) { }
  }

  playPowerUp() {
    if (!state.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.4);
      gain.gain.setValueAtTime(0.01, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.12, this.ctx.currentTime + 0.15);
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.45);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.45);
    } catch (e) { }
  }

  playSuccess() {
    if (!state.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const freqs = [523.25, 659.25, 783.99, 1046.50]; // C E G C
      freqs.forEach((freq, idx) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        const startTime = this.ctx.currentTime + (idx * 0.08);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);
        gain.gain.setValueAtTime(0.08, startTime);
        gain.gain.linearRampToValueAtTime(0.001, startTime + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(startTime);
        osc.stop(startTime + 0.25);
      });
    } catch (e) { }
  }

  playError() {
    if (!state.soundEnabled) return;
    this.init();
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(160, this.ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(90, this.ctx.currentTime + 0.25);
      gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.25);
    } catch (e) { }
  }
}

const synth = new AudioSynth();

// Toast Notifications
function showToast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'error') icon = '⚠️';

  toast.innerHTML = `
    <span style="font-size: 1.1rem; line-height: 1;">${icon}</span>
    <div style="flex: 1;">${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(15px) scale(0.95)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// GitHub API Fetcher
async function githubApi(endpoint, options = {}) {
  const token = state.token.trim();
  if (!token) {
    throw new Error('กรุณากรอก GitHub Token ก่อนทำรายการ');
  }

  const defaultHeaders = {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };

  const url = endpoint.startsWith('http') ? endpoint : `https://api.github.com${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers
    }
  });

  // Track rate limits
  const remaining = response.headers.get('x-ratelimit-remaining');
  const limit = response.headers.get('x-ratelimit-limit');
  if (remaining && limit) {
    state.rateLimit = { remaining, limit };
    updateRateLimitBadge();
  }

  if (response.status === 204) {
    return { ok: true, status: 204 };
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMsg = data && data.message ? data.message : `HTTP Error ${response.status}`;
    throw new Error(errorMsg);
  }

  return data;
}

// Update Rate Limit Badge
function updateRateLimitBadge() {
  const el = document.getElementById('rate-limit-badge');
  if (el) {
    el.textContent = `API: ${state.rateLimit.remaining}/${state.rateLimit.limit}`;
  }
}

// ========================================================
// VM Name & Token Management
// ========================================================

const RANDOM_VM_NAMES = [
  'Cloud-VM-01', 'Win11-Worker', 'Hyper-Node-88', 'Cyber-Box-42',
  'Apex-Machine-07', 'Titan-PC-99', 'Nova-Core-12', 'Vortex-Server',
  'Quantum-Host-03', 'Phantom-VM-77', 'Matrix-PC-55', 'Nexus-Blade-09'
];

function updateVmName(name) {
  const cleanName = (name || '').trim() || 'jira_zx';
  state.vmName = cleanName;
  localStorage.setItem('gh_vm_name', cleanName);

  const defaultUsernameInput = document.getElementById('input-default-username');
  if (defaultUsernameInput && defaultUsernameInput.value !== cleanName) {
    defaultUsernameInput.value = cleanName;
  }

  // Sync Form Preview
  const previewEl = document.getElementById('vm-name-preview');
  if (previewEl) previewEl.textContent = cleanName;

  // Sync Header Badge
  const headerVmName = document.getElementById('header-vm-name');
  if (headerVmName) headerVmName.textContent = cleanName;

  // Sync Target VM Bar in power console
  const targetVmBar = document.getElementById('power-target-vm');
  if (targetVmBar) targetVmBar.textContent = cleanName;

  // Sync Power Button
  const btnVmName = document.getElementById('btn-vm-name');
  if (btnVmName) btnVmName.textContent = cleanName;

  // If a dynamic input is mapped to VM name, update its value
  if (state.mappedVmKey) {
    const dynInput = document.getElementById(`dyn-input-${state.mappedVmKey}`);
    if (dynInput) dynInput.value = cleanName;
  }

  // Refresh status banner with current VM name
  updateMachineStatusBanner();
}

function generateRandomVmName() {
  const chosen = RANDOM_VM_NAMES[Math.floor(Math.random() * RANDOM_VM_NAMES.length)];
  const randNum = Math.floor(10 + Math.random() * 90);
  const newName = `${chosen.split('-')[0]}-${randNum}`;

  const vmInput = document.getElementById('vm-name-input');
  if (vmInput) {
    vmInput.value = newName;
  }
  updateVmName(newName);
  synth.playClick();
  showToast(`สุ่มชื่อเครื่องใหม่: ${newName}`, 'info');
}

// Clear Token and Reset Session
function clearToken() {
  localStorage.removeItem('gh_token');
  localStorage.removeItem('gh_owner');
  localStorage.removeItem('gh_repo');
  localStorage.removeItem('gh_workflow');
  state.token = '';
  state.user = null;
  state.repositories = [];
  state.workflows = [];
  state.runs = [];
  state.latestRun = null;
  state.detectedInputs = {};
  state.mappedVmKey = null;

  const tokenInput = document.getElementById('token-input');
  if (tokenInput) tokenInput.value = '';

  const statusEl = document.getElementById('token-status');
  if (statusEl) {
    statusEl.className = 'token-status';
    statusEl.innerHTML = '<span>⚪ ล้างค่า Token เรียบร้อยแล้ว กรุณากรอก Token ใหม่</span>';
  }

  const userBadge = document.getElementById('user-badge');
  if (userBadge) userBadge.style.display = 'none';

  const repoSelect = document.getElementById('repo-select');
  if (repoSelect) repoSelect.innerHTML = '<option value="">-- กรุณาใส่ Token และตรวจสอบสิทธิ์ก่อน --</option>';

  const workflowSelect = document.getElementById('workflow-select');
  if (workflowSelect) workflowSelect.innerHTML = '<option value="">-- เลือก Repo ก่อน --</option>';

  const dynamicContainer = document.getElementById('workflow-dynamic-container');
  if (dynamicContainer) dynamicContainer.style.display = 'none';

  const dynamicBox = document.getElementById('workflow-dynamic-inputs');
  if (dynamicBox) dynamicBox.innerHTML = '';

  const mappingHint = document.getElementById('vm-input-mapping-hint');
  if (mappingHint) mappingHint.textContent = '';

  const runsList = document.getElementById('runs-list');
  if (runsList) {
    runsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📡</div>
        <div>กรุณาใส่ Token เพื่อเริ่มต้นใช้งาน</div>
      </div>
    `;
  }

  updateMachineStatusBanner();
  updateCountdownUI();
  synth.playClick();
  showToast('ล้าง Token ออกจากเบราว์เซอร์เรียบร้อยแล้ว', 'info');
}

// ========================================================
// Multi-Page Stepper Management (Pages 1, 2, 3)
// ========================================================

function switchPage(pageNumber) {
  state.currentPage = pageNumber;

  // Update page containers
  document.querySelectorAll('.page-container').forEach(el => el.classList.remove('active'));
  const targetPage = document.getElementById(`page-${pageNumber}`);
  if (targetPage) {
    targetPage.classList.add('active');
  }

  // Update stepper buttons & lines
  for (let i = 1; i <= 3; i++) {
    const btn = document.getElementById(`step-btn-${i}`);
    const line = document.getElementById(`step-line-${i}`);
    if (btn) {
      if (i === pageNumber) {
        btn.classList.add('active');
        btn.classList.remove('completed');
      } else if (i < pageNumber) {
        btn.classList.remove('active');
        btn.classList.add('completed');
      } else {
        btn.classList.remove('active');
        btn.classList.remove('completed');
      }
    }
    if (line) {
      if (i < pageNumber) {
        line.classList.add('active');
      } else {
        line.classList.remove('active');
      }
    }
  }

  // If navigating to Page 3, update displays
  if (pageNumber === 3) {
    const activeRepoDisplay = document.getElementById('active-repo-display');
    const activeWfDisplay = document.getElementById('active-wf-display');
    if (activeRepoDisplay) activeRepoDisplay.textContent = state.repo || 'ยังไม่ได้เลือก';
    if (activeWfDisplay) activeWfDisplay.textContent = state.workflow || 'main.yml';
    updateMachineStatusBanner();
  }

  synth.playClick();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handlePage1Next() {
  if (!state.token) {
    synth.playError();
    showToast('กรุณากรอก GitHub Token และตรวจสอบสิทธิ์ก่อนไปหน้าถัดไป', 'error');
    document.getElementById('token-input')?.focus();
    return;
  }
  switchPage(2);
}

// ========================================================
// Page 2: Create Repo & Windows Config (From User Image)
// ========================================================

function selectRepoType(isPrivate) {
  state.repoPrivate = isPrivate;
  const privateCard = document.getElementById('card-repo-private');
  const publicCard = document.getElementById('card-repo-public');

  if (isPrivate) {
    privateCard?.classList.add('selected-private');
    publicCard?.classList.remove('selected-public');
    showToast('เลือก: ที่เก็บข้อมูลส่วนตัว (ปลอดภัยและเสถียร)', 'info');
  } else {
    publicCard?.classList.add('selected-public');
    privateCard?.classList.remove('selected-private');
    showToast('เลือก: คลังข้อมูลสาธารณะ (ระวังการตรวจพบ)', 'info');
  }
  synth.playClick();
}

function generateRandomRepoName() {
  const prefixes = ['svelte-sandbox', 'cloud-runner', 'windows-node', 'sandbox-vm', 'hyper-box', 'apex-worker'];
  const randNum = Math.floor(100 + Math.random() * 900);
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const newName = `${prefix}-${randNum}`;

  state.newRepoName = newName;
  const repoInput = document.getElementById('input-new-repo-name');
  if (repoInput) repoInput.value = newName;

  const btnLabel = document.getElementById('create-btn-repo-label');
  if (btnLabel) btnLabel.textContent = newName;

  synth.playClick();
  showToast(`สุ่มชื่อ Repo: ${newName}`, 'info');
}

function generateYamlTemplate(osVersion = 'windows-2025', timeoutMins = 360, username = 'jira_zx', password = '123789', logWebhook = '', infoWebhook = '') {
  const safeLogWebhook = logWebhook || DEFAULT_LOG_WEBHOOK;
  const safeInfoWebhook = infoWebhook || DEFAULT_INFO_WEBHOOK;
  const safeUsername = username || 'jira_zx';
  const safePassword = password || '123789';

  return `name: Windows 

on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ${osVersion}
    timeout-minutes: ${timeoutMins}

    steps:
    - name: รัน RDP และ Serveo
      shell: pwsh
      run: |
        $logWebhook = "${safeLogWebhook}"
        $infoWebhook = "${safeInfoWebhook}"

        function Send-Log {
            param([string]$message)
            if ($logWebhook) {
                $body = @{ content = $message } | ConvertTo-Json
                try { 
                    Invoke-RestMethod -Uri $logWebhook -Method Post -Body $body -ContentType 'application/json' 
                } catch {}
            }
        }

        try {
            Send-Log "Starting minimal Windows RDP setup..."

            # 1. ตั้งค่า RDP และสร้าง User
            Send-Log "Enabling Remote Desktop and creating user..."
            Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name "fDenyTSConnections" -Value 0
            Enable-NetFirewallRule -DisplayGroup "Remote Desktop"
            secedit /export /cfg C:\\secpol.cfg
            (Get-Content C:\\secpol.cfg) -replace 'PasswordComplexity = 1', 'PasswordComplexity = 0' | Set-Content C:\\secpol.cfg
            secedit /configure /db C:\\windows\\security\\local.sdb /cfg C:\\secpol.cfg /areas SECURITYPOLICY
            net user ${safeUsername} "${safePassword}" /add
            net localgroup administrators ${safeUsername} /add

            Write-Host "=========================================="
            Write-Host "Username: ${safeUsername}"
            Write-Host "Password: ${safePassword}"
            Write-Host "=========================================="
            Write-Host "กำลังเชื่อมต่อ Serveo..."
            
            # 2. ตั้งค่าการเชื่อมต่อ SSH Tunnel ไปยัง Serveo
            $sshProcessInfo = New-Object System.Diagnostics.ProcessStartInfo
            $sshProcessInfo.FileName = "ssh"
            $sshProcessInfo.Arguments = "-o ServerAliveInterval=60 -o ServerAliveCountMax=10 -T -o StrictHostKeyChecking=no -R 0:localhost:3389 serveo.net"
            $sshProcessInfo.RedirectStandardOutput = $true
            $sshProcessInfo.RedirectStandardError = $true
            $sshProcessInfo.UseShellExecute = $false
            $sshProcessInfo.CreateNoWindow = $true

            $sshProcess = New-Object System.Diagnostics.Process
            $sshProcess.StartInfo = $sshProcessInfo
            $null = $sshProcess.Start()

            # วนลูปอ่าน Output เพื่อหา Port (รอไม่เกิน 20 วินาที)
            $assignedPort = $null
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            while ($sw.ElapsedMilliseconds -lt 20000) {
                if ($sshProcess.StandardOutput.Peek() -ge 0) {
                    $line = $sshProcess.StandardOutput.ReadLine()
                    Write-Host $line
                    if ($line -match "Forwarding TCP connections from .+?:(\\d+)") {
                        $assignedPort = $Matches[1]
                        break
                    }
                }
                Start-Sleep -Milliseconds 200
            }

            Send-Log "Setup completed successfully!"

            if ($infoWebhook) {
                if ($assignedPort) {
                    $msg = "Windows RDP is ready!\`nHost: serveo.net:$assignedPort\`nUser: ${safeUsername}\`nPass: ${safePassword}"
                } else {
                    $msg = "Windows RDP is ready!\`nHost: serveo.net (Port: Check GitHub Logs)\`nUser: ${safeUsername}\`nPass: ${safePassword}"
                }
                $bodyInfo = @{ content = $msg } | ConvertTo-Json
                Invoke-RestMethod -Uri $infoWebhook -Method Post -Body $bodyInfo -ContentType 'application/json'
            }

            # 3. วนลูปค้างระบบไว้และเชื่อมต่อใหม่อัตโนมัติ (Auto-reconnect loop) จนครบ ${timeoutMins} นาที
            while ($true) {
                if ($sshProcess.HasExited) {
                    Write-Host "SSH disconnected. Reconnecting to Serveo..."
                    $sshProcess.Start() | Out-Null
                }
                Start-Sleep -Seconds 30
            }
        }
        catch {
            $errMsg = $_.Exception.Message
            Send-Log "ERROR occurred: $errMsg"
            throw $_
        }
`;
}

function updateYamlEditorContent() {
  const osSelect = document.getElementById('select-os-version');
  const timeoutSelect = document.getElementById('select-run-timeout');
  const usernameInput = document.getElementById('input-default-username');
  const passwordInput = document.getElementById('input-default-password');
  const logWebhookInput = document.getElementById('input-log-webhook');
  const infoWebhookInput = document.getElementById('input-info-webhook');
  const yamlEditor = document.getElementById('yaml-code-editor');

  const osVersion = osSelect ? osSelect.value : (state.osVersion || 'windows-2025');
  const timeoutMins = timeoutSelect ? parseInt(timeoutSelect.value, 10) : (state.maxDurationMinutes || 360);
  const username = usernameInput ? usernameInput.value.trim() : (state.vmName || 'jira_zx');
  const password = passwordInput ? passwordInput.value.trim() : (state.vmPassword || '123789');
  const logWebhook = logWebhookInput ? logWebhookInput.value.trim() : state.logWebhook;
  const infoWebhook = infoWebhookInput ? infoWebhookInput.value.trim() : state.infoWebhook;

  state.osVersion = osVersion;
  state.maxDurationMinutes = timeoutMins;
  state.vmName = username || 'jira_zx';
  state.vmPassword = password || '123789';
  state.logWebhook = logWebhook;
  state.infoWebhook = infoWebhook;

  localStorage.setItem('gh_vm_name', state.vmName);
  localStorage.setItem('gh_vm_password', state.vmPassword);
  localStorage.setItem('gh_log_webhook', state.logWebhook);
  localStorage.setItem('gh_info_webhook', state.infoWebhook);

  if (yamlEditor) {
    yamlEditor.value = generateYamlTemplate(osVersion, timeoutMins, state.vmName, state.vmPassword, state.logWebhook, state.infoWebhook);
  }
}

function utf8ToBase64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

async function handleCreateRepoAndUpload() {
  if (!state.token) {
    synth.playError();
    showToast('กรุณากรอก GitHub Token ในหน้า 1 ก่อนสร้างคลังข้อมูล', 'error');
    switchPage(1);
    return;
  }

  const repoInput = document.getElementById('input-new-repo-name');
  const workflowInput = document.getElementById('input-workflow-filename');
  const yamlEditor = document.getElementById('yaml-code-editor');
  const usernameInput = document.getElementById('input-default-username');
  const createBtn = document.getElementById('btn-create-repo-and-upload');
  const createBtnText = document.getElementById('create-btn-text');
  const createBtnIcon = document.getElementById('create-btn-icon');

  const repoName = repoInput ? repoInput.value.trim() : '';
  const workflowFilename = workflowInput ? workflowInput.value.trim() : 'main.yml';
  const yamlContent = yamlEditor ? yamlEditor.value : generateYamlTemplate(state.osVersion, state.maxDurationMinutes, state.vmName, state.vmPassword, state.logWebhook, state.infoWebhook);
  const username = usernameInput ? usernameInput.value.trim() : (state.vmName || 'jira_zx');

  if (!repoName) {
    synth.playError();
    showToast('กรุณาระบุชื่อคลังเก็บข้อมูลใหม่', 'error');
    repoInput?.focus();
    return;
  }

  if (!state.user || !state.user.login) {
    try {
      state.user = await githubApi('/user');
    } catch (e) {
      synth.playError();
      showToast('ไม่สามารถดึงข้อมูลบัญชีผู้ใช้ได้ กรุณาตรวจสอบ Token ในหน้า 1', 'error');
      switchPage(1);
      return;
    }
  }

  createBtn.disabled = true;
  synth.playPowerUp();
  createBtnIcon.innerHTML = '<div class="loader-spinner"></div>';
  createBtnText.textContent = `กำลังสร้างคลังข้อมูล "${repoName}" และอัปโหลดไฟล์ YML...`;

  try {
    showToast(`กำลังสร้างคลังข้อมูล "${repoName}" บน GitHub...`, 'info', 3000);
    await githubApi('/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: repoName,
        private: state.repoPrivate !== false,
        auto_init: true,
        description: 'Cloud Machine Sandbox created via Controller'
      })
    });

    await new Promise(r => setTimeout(r, 1500));

    showToast(`กำลังอัปโหลดไฟล์เวิร์กโฟลว์ .github/workflows/${workflowFilename}...`, 'info', 3000);
    const filePath = `.github/workflows/${workflowFilename}`;
    await githubApi(`/repos/${state.user.login}/${repoName}/contents/${filePath}`, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Add Cloud Machine workflow',
        content: utf8ToBase64(yamlContent)
      })
    });

    synth.playSuccess();
    showToast(`🚀 สร้าง Repo "${repoName}" และอัปโหลดไฟล์สำเร็จ! ย้ายไปหน้ารันเครื่อง...`, 'success', 5000);

    state.owner = state.user.login;
    state.repo = `${state.user.login}/${repoName}`;
    state.workflow = workflowFilename;
    state.vmName = username;
    state.branch = 'main';

    localStorage.setItem('gh_owner', state.owner);
    localStorage.setItem('gh_repo', state.repo);
    localStorage.setItem('gh_workflow', state.workflow);
    localStorage.setItem('gh_vm_name', state.vmName);
    localStorage.setItem('gh_branch', state.branch);

    updateVmName(username);
    switchPage(3);

    await Promise.all([
      loadWorkflows(state.owner, repoName),
      loadBranches(state.owner, repoName)
    ]);
    await loadRuns();

  } catch (err) {
    synth.playError();
    showToast(`สร้าง Repo หรืออัปโหลด YML ไม่สำเร็จ: ${err.message}`, 'error', 6000);
  } finally {
    createBtn.disabled = false;
    createBtnIcon.innerHTML = '🚀';
    createBtnText.innerHTML = `สร้าง Repo ชื่อ " <span id="create-btn-repo-label">${escapeHtml(repoName)}</span> " และอัปโหลดไฟล์ YML`;
  }
}

function toggleExistingRepoMode() {
  const newRepoView = document.getElementById('create-new-repo-view');
  const existingRepoView = document.getElementById('select-existing-repo-view');
  const modeText = document.getElementById('mode-toggle-text');

  if (existingRepoView.style.display === 'none') {
    existingRepoView.style.display = 'block';
    newRepoView.style.display = 'none';
    if (modeText) modeText.textContent = '✕ กลับไปสร้าง Repo ใหม่';
    synth.playClick();
  } else {
    existingRepoView.style.display = 'none';
    newRepoView.style.display = 'block';
    if (modeText) modeText.textContent = '📂 เลือก Repo เดิม';
    synth.playClick();
  }
}

function useExistingRepoAndGo() {
  const repoSelect = document.getElementById('repo-select');
  const workflowSelect = document.getElementById('workflow-select');
  const branchSelect = document.getElementById('branch-select');

  if (!repoSelect.value) {
    synth.playError();
    showToast('กรุณาเลือก Repository ที่มีอยู่ก่อน', 'error');
    return;
  }
  if (!workflowSelect.value) {
    synth.playError();
    showToast('กรุณาเลือก Workflow ก่อน', 'error');
    return;
  }

  const [owner, repo] = repoSelect.value.split('/');
  state.owner = owner;
  state.repo = repoSelect.value;
  state.workflow = workflowSelect.value;
  state.branch = branchSelect.value || 'main';

  localStorage.setItem('gh_owner', state.owner);
  localStorage.setItem('gh_repo', state.repo);
  localStorage.setItem('gh_workflow', state.workflow);
  localStorage.setItem('gh_branch', state.branch);

  switchPage(3);
  loadRuns();
}

// Expose multi-page helper functions globally
window.switchPage = switchPage;
window.handlePage1Next = handlePage1Next;
window.selectRepoType = selectRepoType;
window.generateRandomRepoName = generateRandomRepoName;
window.toggleExistingRepoMode = toggleExistingRepoMode;
window.useExistingRepoAndGo = useExistingRepoAndGo;

// Verify Token and Fetch User Info
async function verifyToken(goToNext = false) {
  const tokenInput = document.getElementById('token-input');
  const statusEl = document.getElementById('token-status');
  const userBadge = document.getElementById('user-badge');
  const userAvatar = document.getElementById('user-avatar');
  const userName = document.getElementById('user-name');

  state.token = tokenInput ? tokenInput.value.trim() : '';

  if (!state.token) {
    statusEl.className = 'token-status invalid';
    statusEl.innerHTML = '<span>❌ กรุณากรอก GitHub Personal Access Token (PAT)</span>';
    userBadge.style.display = 'none';
    return;
  }

  localStorage.setItem('gh_token', state.token);
  statusEl.className = 'token-status';
  statusEl.innerHTML = '<span>🔄 กำลังตรวจสอบสิทธิ์ Token...</span>';

  try {
    const user = await githubApi('/user');
    state.user = user;

    statusEl.className = 'token-status valid';
    statusEl.innerHTML = `<span>🟢 สิทธิ์ถูกต้อง: <strong>@${user.login}</strong> (${user.name || 'GitHub User'})</span>`;

    userAvatar.src = user.avatar_url;
    userName.textContent = `@${user.login}`;
    userBadge.style.display = 'flex';

    // Page 1 user preview card
    const p1Card = document.getElementById('token-user-card');
    const p1Avatar = document.getElementById('page1-user-avatar');
    const p1Name = document.getElementById('page1-user-name');
    if (p1Card && p1Avatar && p1Name) {
      p1Avatar.src = user.avatar_url;
      p1Name.textContent = `@${user.login} (${user.name || 'GitHub User'})`;
      p1Card.style.display = 'block';
    }

    showToast(`เข้าสู่ระบบสำเร็จ: @${user.login}`, 'success');

    // Auto-load Repositories
    await loadRepositories();

    // If requested by user action, transition to Page 2
    if (goToNext) {
      setTimeout(() => {
        switchPage(2);
      }, 500);
    }

  } catch (err) {
    statusEl.className = 'token-status invalid';
    statusEl.innerHTML = `<span>❌ เชื่อมต่อไม่สำเร็จ: ${err.message}</span>`;
    userBadge.style.display = 'none';
    showToast(`Token Error: ${err.message}`, 'error');
  }
}

// Base64 UTF-8 decoder
function decodeBase64Utf8(base64Str) {
  try {
    const clean = base64Str.replace(/\s/g, '');
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) {
    return '';
  }
}

// Resilient YAML parser for on.workflow_dispatch.inputs
function extractWorkflowDispatchInputs(yamlText) {
  if (!yamlText) return null;
  if (!/workflow_dispatch/i.test(yamlText)) return null;

  const lines = yamlText.split(/\r?\n/);
  let inWorkflowDispatch = false;
  let inInputs = false;
  let inputsIndent = -1;
  const inputs = {};
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const indent = line.search(/\S/);

    if (trimmed.startsWith('workflow_dispatch:')) {
      inWorkflowDispatch = true;
      inInputs = false;
      continue;
    }

    if (inWorkflowDispatch && !inInputs) {
      if (indent === 0 && !trimmed.startsWith('workflow_dispatch:')) {
        inWorkflowDispatch = false;
        continue;
      }
      if (trimmed.startsWith('inputs:')) {
        inInputs = true;
        inputsIndent = indent;
        continue;
      }
    }

    if (inInputs) {
      if (indent <= inputsIndent) {
        break; // Outdented past inputs
      }

      const keyMatch = line.match(/^\s*([a-zA-Z0-9_\-]+):/);
      if (keyMatch) {
        const lineIndent = line.search(/\S/);
        if (lineIndent > inputsIndent) {
          const subkey = keyMatch[1].toLowerCase();
          if (!['description', 'required', 'default', 'type', 'options'].includes(subkey)) {
            currentKey = keyMatch[1];
            if (!inputs[currentKey]) {
              inputs[currentKey] = { key: currentKey, description: '', default: '', required: false };
            }
          }
        }
      }

      if (currentKey && inputs[currentKey]) {
        if (trimmed.startsWith('description:')) {
          inputs[currentKey].description = trimmed.replace(/^description:\s*['"]?/, '').replace(/['"]?$/, '');
        } else if (trimmed.startsWith('default:')) {
          inputs[currentKey].default = trimmed.replace(/^default:\s*['"]?/, '').replace(/['"]?$/, '');
        } else if (trimmed.startsWith('required:')) {
          inputs[currentKey].required = /true/i.test(trimmed);
        }
      }
    }
  }

  return Object.keys(inputs).length > 0 ? inputs : null;
}

// Inspect Workflow inputs from GitHub repository contents
async function inspectWorkflowInputs() {
  const repoSelect = document.getElementById('repo-select');
  const workflowSelect = document.getElementById('workflow-select');
  const branchSelect = document.getElementById('branch-select');
  const mappingHint = document.getElementById('vm-input-mapping-hint');
  const dynamicContainer = document.getElementById('workflow-dynamic-container');
  const dynamicBox = document.getElementById('workflow-dynamic-inputs');

  state.detectedInputs = {};
  state.mappedVmKey = null;

  if (mappingHint) mappingHint.textContent = '';
  if (dynamicBox) dynamicBox.innerHTML = '';
  if (dynamicContainer) dynamicContainer.style.display = 'none';

  const fullName = repoSelect ? repoSelect.value : '';
  const workflowId = workflowSelect ? workflowSelect.value : '';
  const branch = branchSelect ? branchSelect.value : 'main';

  if (!fullName || !workflowId || !state.token) return;

  const [owner, repo] = fullName.split('/');
  const wf = state.workflows.find(w => String(w.id) === String(workflowId) || w.path === workflowId);
  if (!wf || !wf.path) return;

  try {
    const fileData = await githubApi(`/repos/${owner}/${repo}/contents/${wf.path}?ref=${branch}`);
    if (!fileData || !fileData.content) return;

    const yaml = decodeBase64Utf8(fileData.content);
    const parsed = extractWorkflowDispatchInputs(yaml);

    if (parsed) {
      state.detectedInputs = parsed;
      const keys = Object.keys(parsed);

      // Best candidate key for VM Name
      const vmCandidate = keys.find(k => /vm|name|machine|host|server|runner|worker/i.test(k)) || (keys.length === 1 ? keys[0] : null);
      state.mappedVmKey = vmCandidate;

      if (vmCandidate && mappingHint) {
        mappingHint.textContent = `✓ เชื่อมต่อพารามิเตอร์ "${vmCandidate}"`;
        mappingHint.title = `ชื่อเครื่องจะถูกส่งไปยังพารามิเตอร์ "${vmCandidate}" อัตโนมัติ`;
      } else if (mappingHint) {
        mappingHint.textContent = `✓ ตรวจพบ ${keys.length} พารามิเตอร์`;
      }

      renderDynamicInputs(parsed, vmCandidate);
    } else {
      if (mappingHint) {
        mappingHint.textContent = `ℹ️ Workflow นี้ไม่มี parameters`;
      }
    }
  } catch (err) {
    console.log('Workflow file check notice:', err.message);
  }
}

// Render dynamic inputs in UI
function renderDynamicInputs(inputs, vmCandidate) {
  const dynamicContainer = document.getElementById('workflow-dynamic-container');
  const dynamicBox = document.getElementById('workflow-dynamic-inputs');
  if (!dynamicContainer || !dynamicBox) return;

  dynamicBox.innerHTML = '';
  const keys = Object.keys(inputs);
  if (keys.length === 0) {
    dynamicContainer.style.display = 'none';
    return;
  }

  keys.forEach(key => {
    const item = inputs[key];
    const isVmField = (key === vmCandidate);
    const row = document.createElement('div');
    row.className = 'dynamic-input-row';

    const initialVal = isVmField ? state.vmName : (item.default || '');
    const badgeText = isVmField ? '🖥️ เชื่อมชื่อ VM' : (item.required ? 'จำเป็น' : 'ไม่บังคับ');
    const badgeClass = isVmField ? 'dyn-badge mapped' : (item.required ? 'dyn-badge required' : 'dyn-badge');

    row.innerHTML = `
      <label for="dyn-input-${key}">
        <span>${escapeHtml(item.description || key)} <code>(${escapeHtml(key)})</code></span>
        <span class="${badgeClass}">${badgeText}</span>
      </label>
      <input 
        type="text" 
        id="dyn-input-${key}" 
        class="form-control mono" 
        value="${escapeHtml(initialVal)}" 
        placeholder="${escapeHtml(item.default || key)}"
        ${isVmField ? 'title="ช่องนี้จะอัปเดตตามชื่อเครื่อง VM ด้านบนอัตโนมัติ"' : ''}
      >
    `;

    dynamicBox.appendChild(row);

    // If this is VM field, keep it synced bidirectionally
    const inputEl = row.querySelector(`#dyn-input-${key}`);
    if (isVmField && inputEl) {
      inputEl.addEventListener('input', () => {
        const vmInput = document.getElementById('vm-name-input');
        if (vmInput) vmInput.value = inputEl.value;
        updateVmName(inputEl.value);
      });
    }
  });

  dynamicContainer.style.display = 'block';
}

// Load Repositories for Authenticated User
async function loadRepositories() {
  const repoSelect = document.getElementById('repo-select');
  repoSelect.innerHTML = '<option value="">-- กำลังโหลด Repositories... --</option>';

  try {
    const repos = await githubApi('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator');
    state.repositories = repos || [];

    repoSelect.innerHTML = '<option value="">-- เลือก Repository --</option>';
    state.repositories.forEach(repo => {
      const opt = document.createElement('option');
      opt.value = repo.full_name; // e.g. "owner/repo"
      opt.textContent = `${repo.private ? '🔒' : '🌐'} ${repo.full_name}`;
      if (state.repo && (state.repo === repo.full_name || state.repo === repo.name)) {
        opt.selected = true;
      }
      repoSelect.appendChild(opt);
    });

    // If previously saved repo exists, select it
    if (state.repo && repoSelect.value) {
      await onRepoSelected();
    } else if (state.repositories.length > 0) {
      // Pick first repo if none selected
      repoSelect.selectedIndex = 1;
      await onRepoSelected();
    }
  } catch (err) {
    repoSelect.innerHTML = '<option value="">-- โหลด Repos ไม่สำเร็จ --</option>';
    showToast(`โหลด Repositories ไม่สำเร็จ: ${err.message}`, 'error');
  }
}

// Handle Repo Selection Change
async function onRepoSelected() {
  const repoSelect = document.getElementById('repo-select');
  const selectedFullName = repoSelect.value;
  if (!selectedFullName) return;

  const [owner, repo] = selectedFullName.split('/');
  state.owner = owner;
  state.repo = selectedFullName;
  localStorage.setItem('gh_owner', owner);
  localStorage.setItem('gh_repo', selectedFullName);

  await Promise.all([
    loadWorkflows(owner, repo),
    loadBranches(owner, repo)
  ]);

  await inspectWorkflowInputs();
  await loadRuns();
}

// Load Workflows for Selected Repo
async function loadWorkflows(owner, repo) {
  const workflowSelect = document.getElementById('workflow-select');
  workflowSelect.innerHTML = '<option value="">-- กำลังโหลด Workflows... --</option>';

  try {
    const data = await githubApi(`/repos/${owner}/${repo}/actions/workflows`);
    state.workflows = data.workflows || [];

    workflowSelect.innerHTML = '<option value="">-- เลือก Workflow --</option>';
    if (state.workflows.length === 0) {
      workflowSelect.innerHTML = '<option value="">-- ไม่พบไฟล์ Workflow ใน Repo นี้ --</option>';
      return;
    }

    state.workflows.forEach(wf => {
      const opt = document.createElement('option');
      opt.value = wf.id; // or wf.path
      const filename = wf.path ? wf.path.split('/').pop() : '';
      opt.textContent = `⚡ ${wf.name} (${filename})`;
      if (state.workflow && (state.workflow == wf.id || state.workflow === filename || state.workflow === wf.name)) {
        opt.selected = true;
      }
      workflowSelect.appendChild(opt);
    });

    // Auto-select first workflow if not selected
    if (!workflowSelect.value && state.workflows.length > 0) {
      workflowSelect.selectedIndex = 1;
    }

    state.workflow = workflowSelect.value;
    localStorage.setItem('gh_workflow', state.workflow);

    // Inspect inputs for selected workflow
    await inspectWorkflowInputs();

  } catch (err) {
    workflowSelect.innerHTML = '<option value="">-- โหลด Workflows ไม่สำเร็จ --</option>';
    showToast(`โหลด Workflows ไม่สำเร็จ: ${err.message}`, 'error');
  }
}

// Load Branches for Selected Repo
async function loadBranches(owner, repo) {
  const branchSelect = document.getElementById('branch-select');
  branchSelect.innerHTML = '<option value="main">main</option>';

  try {
    const branches = await githubApi(`/repos/${owner}/${repo}/branches?per_page=50`);
    state.branches = branches || [];

    branchSelect.innerHTML = '';
    state.branches.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.name;
      opt.textContent = b.name;
      if (state.branch === b.name) {
        opt.selected = true;
      }
      branchSelect.appendChild(opt);
    });

    if (!branchSelect.value && state.branches.length > 0) {
      branchSelect.selectedIndex = 0;
    }
    state.branch = branchSelect.value;
    localStorage.setItem('gh_branch', state.branch);

  } catch (err) {
    console.warn('Could not load branches:', err);
  }
}

// Trigger Workflow Dispatch (START MACHINE)
async function triggerWorkflow() {
  if (state.isTriggering) return;

  const repoSelect = document.getElementById('repo-select');
  const workflowSelect = document.getElementById('workflow-select');
  const branchSelect = document.getElementById('branch-select');
  const triggerBtn = document.getElementById('btn-power-trigger');
  const triggerBtnText = document.getElementById('btn-power-text');
  const triggerIcon = document.getElementById('btn-power-icon');

  if (!state.token) {
    synth.playError();
    showToast('กรุณากรอก GitHub Token ของคุณก่อนสั่งเปิดเครื่อง', 'error');
    document.getElementById('token-input')?.focus();
    return;
  }

  const fullName = repoSelect.value;
  const workflowId = workflowSelect.value;
  const branch = branchSelect.value || 'main';

  if (!fullName) {
    synth.playError();
    showToast('กรุณาเลือก Repository ก่อนเปิดเครื่อง', 'error');
    return;
  }
  if (!workflowId) {
    synth.playError();
    showToast('กรุณาเลือก Workflow ก่อนเปิดเครื่อง', 'error');
    return;
  }

  const [owner, repo] = fullName.split('/');
  const currentVmName = state.vmName || 'Cloud-VM-01';

  // Gather inputs
  let inputsObj = {};

  // 1. Dynamic inputs detected from workflow file
  if (state.detectedInputs && Object.keys(state.detectedInputs).length > 0) {
    Object.keys(state.detectedInputs).forEach(k => {
      const inputEl = document.getElementById(`dyn-input-${k}`);
      if (inputEl) {
        inputsObj[k] = inputEl.value.trim();
      }
    });
  }

  // Ensure mapped VM parameter receives user's custom VM name
  if (state.mappedVmKey) {
    inputsObj[state.mappedVmKey] = currentVmName;
  }

  // 2. Custom JSON inputs override if specified
  const inputsJson = document.getElementById('inputs-json').value.trim();
  if (inputsJson) {
    try {
      const customObj = JSON.parse(inputsJson);
      inputsObj = { ...inputsObj, ...customObj };
    } catch (e) {
      synth.playError();
      showToast('รูปแบบ Custom Inputs JSON ไม่ถูกต้อง', 'error');
      return;
    }
  }

  state.isTriggering = true;
  triggerBtn.disabled = true;
  synth.playPowerUp();

  triggerBtnText.innerHTML = `กำลังบูตเครื่อง [ <strong>${escapeHtml(currentVmName)}</strong> ]...`;
  triggerIcon.innerHTML = '<div class="loader-spinner"></div>';

  try {
    const payload = {
      ref: branch
    };
    // ONLY send inputs if inputsObj actually has keys (avoids GitHub 422 error)
    if (Object.keys(inputsObj).length > 0) {
      payload.inputs = inputsObj;
    }

    await githubApi(`/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    synth.playSuccess();
    showToast(`⚡ สั่งเปิดเครื่อง "${currentVmName}" สำเร็จ! ระบบกำลังเริ่มบูต...`, 'success', 5000);

    triggerBtnText.innerHTML = `ส่งคำสั่งเปิดเครื่อง [ ${escapeHtml(currentVmName)} ] สำเร็จ!`;
    triggerIcon.innerHTML = '✨';

    // Highlight power console
    const powerConsole = document.querySelector('.power-console');
    if (powerConsole) {
      powerConsole.classList.add('active-running');
    }

    // Fast poll for new runs
    pollNewRunAfterTrigger(owner, repo, workflowId);

  } catch (err) {
    synth.playError();
    showToast(`เปิดเครื่อง "${currentVmName}" ไม่สำเร็จ: ${err.message}`, 'error');
    resetTriggerBtn();
  } finally {
    setTimeout(() => {
      state.isTriggering = false;
      triggerBtn.disabled = false;
      resetTriggerBtn();
    }, 2500);
  }
}

function resetTriggerBtn() {
  const triggerBtnText = document.getElementById('btn-power-text');
  const triggerIcon = document.getElementById('btn-power-icon');
  const currentVmName = escapeHtml(state.vmName || 'Cloud-VM-01');
  if (triggerBtnText) triggerBtnText.innerHTML = `สั่งเปิดเครื่อง [ <span id="btn-vm-name">${currentVmName}</span> ] (START)`;
  if (triggerIcon) triggerIcon.innerHTML = '⚡';
}

// Fast-poll newly created run
async function pollNewRunAfterTrigger(owner, repo, workflowId) {
  let attempts = 0;
  const maxAttempts = 6;

  const interval = setInterval(async () => {
    attempts++;
    await loadRuns(false);
    if (attempts >= maxAttempts) {
      clearInterval(interval);
    }
  }, 2500);
}

// Load Recent Runs
async function loadRuns(showLoadingIndicator = true) {
  const repoSelect = document.getElementById('repo-select');
  const workflowSelect = document.getElementById('workflow-select');
  const runsList = document.getElementById('runs-list');
  const refreshBtn = document.getElementById('btn-refresh-runs');

  const fullName = repoSelect.value;
  if (!fullName) return;

  const [owner, repo] = fullName.split('/');
  const workflowId = workflowSelect.value;

  if (showLoadingIndicator && refreshBtn) {
    refreshBtn.classList.add('spinning');
  }

  try {
    let endpoint = `/repos/${owner}/${repo}/actions/runs?per_page=8`;
    if (workflowId) {
      endpoint = `/repos/${owner}/${repo}/actions/workflows/${workflowId}/runs?per_page=8`;
    }

    const data = await githubApi(endpoint);
    state.runs = data.workflow_runs || [];

    renderRuns();
    updateMachineStatusBanner();
    updateCountdownUI();

  } catch (err) {
    console.error('Failed to load runs:', err);
  } finally {
    if (refreshBtn) {
      refreshBtn.classList.remove('spinning');
    }
  }
}

// Update Active Machine Status Box
function updateMachineStatusBanner() {
  const statusBox = document.getElementById('machine-status-box');
  const dot = document.getElementById('status-dot');
  const title = document.getElementById('status-title');
  const desc = document.getElementById('status-desc');
  const linkBtn = document.getElementById('btn-view-run');
  const cancelBtn = document.getElementById('btn-cancel-run');
  const powerConsole = document.querySelector('.power-console');
  const vmName = escapeHtml(state.vmName || 'Cloud-VM-01');

  if (state.runs.length === 0) {
    dot.className = 'status-pulse-dot';
    title.innerHTML = `⚪ เครื่อง [<strong>${vmName}</strong>] พร้อมใช้งาน (STANDBY)`;
    desc.textContent = 'รอส่งคำสั่งบูตเครื่อง...';
    linkBtn.style.display = 'none';
    cancelBtn.style.display = 'none';
    if (powerConsole) powerConsole.classList.remove('active-running');
    return;
  }

  const latest = state.runs[0];
  state.latestRun = latest;

  linkBtn.href = latest.html_url;
  linkBtn.style.display = 'inline-flex';

  if (latest.status === 'in_progress') {
    dot.className = 'status-pulse-dot running';
    title.innerHTML = `🟢 เครื่อง [<strong>${vmName}</strong>] กำลังทำงานอยู่ (ONLINE / RUNNING)`;
    desc.textContent = `Run #${latest.run_number} (${latest.name}) | เริ่มเมื่อ ${formatTime(latest.run_started_at)}`;
    cancelBtn.style.display = 'inline-block';
    cancelBtn.textContent = `🛑 ปิดเครื่อง [${vmName}]`;
    if (powerConsole) powerConsole.classList.add('active-running');
  } else if (latest.status === 'queued') {
    dot.className = 'status-pulse-dot queued';
    title.innerHTML = `🟡 เครื่อง [<strong>${vmName}</strong>] กำลังเตรียมบูต (QUEUED)`;
    desc.textContent = `Run #${latest.run_number} อยู่ในคิว...`;
    cancelBtn.style.display = 'inline-block';
    cancelBtn.textContent = `🛑 ยกเลิกคิว [${vmName}]`;
    if (powerConsole) powerConsole.classList.add('active-running');
  } else {
    // Completed / Failed / Cancelled
    dot.className = 'status-pulse-dot';
    cancelBtn.style.display = 'none';
    if (powerConsole) powerConsole.classList.remove('active-running');

    if (latest.conclusion === 'success') {
      title.innerHTML = `✅ เครื่อง [<strong>${vmName}</strong>] รันเสร็จสมบูรณ์ (COMPLETED)`;
      desc.textContent = `Run #${latest.run_number} สำเร็จ (${formatDuration(latest.run_started_at, latest.updated_at)})`;
    } else if (latest.conclusion === 'failure') {
      title.innerHTML = `❌ เครื่อง [<strong>${vmName}</strong>] ขัดข้อง (FAILED)`;
      desc.textContent = `Run #${latest.run_number} ขัดข้อง | คลิกดู Log ด้านขวา`;
    } else if (latest.conclusion === 'cancelled') {
      title.innerHTML = `⏹️ เครื่อง [<strong>${vmName}</strong>] ถูกสั่งปิด (STOPPED)`;
      desc.textContent = `Run #${latest.run_number} ถูกหยุดการทำงาน`;
    } else {
      title.innerHTML = `⚪ [<strong>${vmName}</strong>] สถานะ: ${latest.conclusion || latest.status}`;
      desc.textContent = `Run #${latest.run_number}`;
    }
  }
}

// Cancel Active Run
async function cancelActiveRun() {
  if (!state.latestRun || !state.latestRun.id) return;

  const repoSelect = document.getElementById('repo-select');
  const [owner, repo] = repoSelect.value.split('/');
  const vmName = state.vmName || 'Cloud-VM';

  if (!confirm(`ต้องการยกเลิกและสั่งปิดเครื่อง [${vmName}] Run #${state.latestRun.run_number} ใช่หรือไม่?`)) {
    return;
  }

  try {
    synth.playClick();
    showToast(`กำลังส่งสัญญาณปิดเครื่อง [${vmName}]...`, 'info');

    await githubApi(`/repos/${owner}/${repo}/actions/runs/${state.latestRun.id}/cancel`, {
      method: 'POST'
    });

    synth.playSuccess();
    showToast(`ส่งคำสั่งปิดเครื่อง [${vmName}] สำเร็จ`, 'success');
    await loadRuns();

  } catch (err) {
    synth.playError();
    showToast(`ปิดเครื่องไม่สำเร็จ: ${err.message}`, 'error');
  }
}

// Render Runs List
function renderRuns() {
  const container = document.getElementById('runs-list');
  if (!container) return;

  if (state.runs.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div>ยังไม่มีประวัติการรันใน Workflow นี้</div>
      </div>
    `;
    return;
  }

  container.innerHTML = '';
  state.runs.forEach(run => {
    const item = document.createElement('div');
    item.className = 'run-item';

    let badgeClass = 'queued';
    let badgeText = run.status;

    if (run.status === 'in_progress') {
      badgeClass = 'in_progress';
      badgeText = '⚡ RUNNING';
    } else if (run.status === 'queued') {
      badgeClass = 'queued';
      badgeText = '⏳ QUEUED';
    } else if (run.conclusion === 'success') {
      badgeClass = 'success';
      badgeText = '✓ SUCCESS';
    } else if (run.conclusion === 'failure') {
      badgeClass = 'failure';
      badgeText = '✕ FAILED';
    } else if (run.conclusion === 'cancelled') {
      badgeClass = 'cancelled';
      badgeText = '⏹ CANCEL';
    }

    const duration = formatDuration(run.run_started_at, run.updated_at);
    const timeAgo = formatTimeAgo(new Date(run.created_at));

    item.innerHTML = `
      <div class="run-left">
        <span class="run-badge ${badgeClass}">${badgeText}</span>
        <div class="run-title-group">
          <div class="run-name" title="${escapeHtml(run.display_title || run.name)}">
            #${run.run_number} ${escapeHtml(run.display_title || run.name)}
          </div>
          <div class="run-meta">
            <span>🌿 ${escapeHtml(run.head_branch)}</span>
            <span>⏱️ ${duration}</span>
            <span>🕒 ${timeAgo}</span>
          </div>
        </div>
      </div>
      <div class="run-right">
        <a href="${run.html_url}" target="_blank" rel="noopener noreferrer" class="run-external-link" title="เปิดดูบน GitHub">
          ↗
        </a>
      </div>
    `;

    container.appendChild(item);
  });
}

// Helper Utilities
function formatTime(isoString) {
  if (!isoString) return '--:--';
  const d = new Date(isoString);
  return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(start, end) {
  if (!start) return '--';
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const diffSec = Math.floor((e - s) / 1000);
  if (diffSec < 0) return '0s';
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins === 0) return `${secs}s`;
  const hours = Math.floor(mins / 60);
  if (hours === 0) return `${mins}m ${secs}s`;
  return `${hours}h ${mins % 60}m`;
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return `${diffSec}วิที่แล้ว`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}นาทีที่แล้ว`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}ชม.ที่แล้ว`;
  return `${Math.floor(diffHours / 24)}วันที่แล้ว`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Auto Refresh Polling Setup
function setupPolling() {
  if (state.pollIntervalId) {
    clearInterval(state.pollIntervalId);
    state.pollIntervalId = null;
  }

  if (state.autoRefresh) {
    state.pollIntervalId = setInterval(() => {
      if (state.repo && !state.isTriggering) {
        loadRuns(false);
      }
    }, 5000);
  }
}

// ========================================================
// Real-Time Countdown & Auto-Restart Logic
// ========================================================

function formatHMS(ms) {
  if (isNaN(ms) || ms <= 0) return '00:00:00';
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function updateCountdownUI() {
  const countdownEl = document.getElementById('countdown-display');
  const elapsedEl = document.getElementById('elapsed-display');
  const progressBar = document.getElementById('timer-progress-bar');
  if (!countdownEl || !elapsedEl || !progressBar) return;

  const latest = state.latestRun;

  if (!latest) {
    countdownEl.textContent = '--:--:--';
    countdownEl.className = 'countdown-main';
    elapsedEl.textContent = '--:--:--';
    progressBar.style.width = '0%';
    return;
  }

  if (latest.status === 'in_progress') {
    state.wasRunning = true;
    const startMs = new Date(latest.run_started_at).getTime();
    const nowMs = Date.now();
    const elapsedMs = Math.max(0, nowMs - startMs);
    const limitMs = state.maxDurationMinutes * 60 * 1000;
    const remainingMs = Math.max(0, limitMs - elapsedMs);

    elapsedEl.textContent = formatHMS(elapsedMs);

    // Percentage of time spent
    const pct = Math.min(100, (elapsedMs / limitMs) * 100);
    progressBar.style.width = `${pct}%`;

    if (remainingMs <= 0) {
      countdownEl.textContent = '00:00:00 (หมดเวลา)';
      countdownEl.className = 'countdown-main expired';
      progressBar.classList.add('warning');

      // Auto-restart on timeout if armed
      if (state.autoRestart && !state.isAutoRestarting) {
        handleAutoRestart('เครื่องทำงานครบกำหนดเวลาแล้ว (Timeout)');
      }
    } else {
      countdownEl.textContent = formatHMS(remainingMs);
      if (remainingMs < 10 * 60 * 1000) {
        // Less than 10 mins remaining
        countdownEl.className = 'countdown-main warning';
        progressBar.classList.add('warning');
      } else {
        countdownEl.className = 'countdown-main active';
        progressBar.classList.remove('warning');
      }
    }
  } else if (latest.status === 'queued') {
    countdownEl.textContent = 'กำลังบูตเครื่อง...';
    countdownEl.className = 'countdown-main warning';
    elapsedEl.textContent = '00:00:00';
    progressBar.style.width = '5%';
    progressBar.classList.remove('warning');
  } else {
    // Completed (success, failure, cancelled)
    countdownEl.textContent = latest.conclusion === 'success' ? 'ทำงานเสร็จแล้ว' : 'เครื่องดับแล้ว';
    countdownEl.className = 'countdown-main';
    progressBar.style.width = '0%';
    progressBar.classList.remove('warning');

    // Auto-restart if it was running and has now stopped, or if completed run hasn't been re-triggered yet
    if (state.autoRestart && state.wasRunning && !state.isAutoRestarting) {
      if (state.lastHandledRunId !== latest.id) {
        state.lastHandledRunId = latest.id;
        state.wasRunning = false;
        handleAutoRestart(`เครื่องหยุดทำงาน (${latest.conclusion || 'จบการทำงาน'})`);
      }
    }
  }
}

function handleAutoRestart(reason) {
  if (!state.autoRestart || state.isAutoRestarting) return;
  if (!state.repo || !state.workflow) {
    showToast('Auto-Restart ไม่สามารถทำงานได้: ยังไม่ได้เลือก Repo/Workflow', 'error');
    return;
  }

  state.isAutoRestarting = true;
  synth.playPowerUp();

  const currentVm = state.vmName || 'Cloud-VM';
  let countdown = 8;
  showToast(`🔄 [Auto-Restart] ${reason} กำลังบูตเครื่อง [${currentVm}] ใหม่อัตโนมัติใน ${countdown} วิ...`, 'info', 7500);

  const countdownTimer = setInterval(() => {
    countdown--;
    if (countdown > 0) {
      const descEl = document.getElementById('auto-restart-desc');
      if (descEl) descEl.textContent = `⚡ กำลังจะยิงคำสั่งเปิดเครื่อง [${currentVm}] ใหม่ในอีก ${countdown} วิ...`;
    } else {
      clearInterval(countdownTimer);
      const descEl = document.getElementById('auto-restart-desc');
      if (descEl) descEl.textContent = 'เมื่อเวลาหมด หรือเครื่องหยุดทำงาน จะยิงคำสั่งเปิดเครื่องใหม่ทันที';
      
      triggerWorkflow().then(() => {
        setTimeout(() => {
          state.isAutoRestarting = false;
        }, 15000);
      }).catch(() => {
        setTimeout(() => {
          state.isAutoRestarting = false;
        }, 5000);
      });
    }
  }, 1000);
}

function setupCountdownTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }
  state.timerIntervalId = setInterval(updateCountdownUI, 1000);
}

// Event Listeners Initialization
document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('token-input');
  const toggleTokenBtn = document.getElementById('btn-toggle-token');
  const verifyTokenBtn = document.getElementById('btn-verify-token');
  const clearTokenBtn = document.getElementById('btn-clear-token');
  const logoutHeaderBtn = document.getElementById('btn-logout-header');
  const vmNameInput = document.getElementById('vm-name-input');
  const randomVmBtn = document.getElementById('btn-random-vm-name');
  const repoSelect = document.getElementById('repo-select');
  const workflowSelect = document.getElementById('workflow-select');
  const branchSelect = document.getElementById('branch-select');
  const triggerBtn = document.getElementById('btn-power-trigger');
  const refreshRunsBtn = document.getElementById('btn-refresh-runs');
  const cancelRunBtn = document.getElementById('btn-cancel-run');
  const autoRefreshToggle = document.getElementById('toggle-auto-refresh');
  const soundToggleBtn = document.getElementById('btn-toggle-sound');
  const collapsibleToggle = document.getElementById('inputs-toggle');
  const collapsibleContent = document.getElementById('inputs-collapsible');
  
  // Timer & Auto-Restart Elements
  const timerLimitSelect = document.getElementById('timer-limit-select');
  const autoRestartToggle = document.getElementById('toggle-auto-restart');
  const autoRestartBar = document.getElementById('auto-restart-bar');

  // Initialize VM Name and sync across UI
  if (vmNameInput) {
    vmNameInput.value = state.vmName;
    vmNameInput.addEventListener('input', (e) => {
      updateVmName(e.target.value);
    });
    vmNameInput.addEventListener('change', (e) => {
      updateVmName(e.target.value);
    });
  }
  updateVmName(state.vmName);

  // Random VM Name Button
  if (randomVmBtn) {
    randomVmBtn.addEventListener('click', () => {
      generateRandomVmName();
    });
  }

  // Set initial token value from localStorage (if exists)
  if (tokenInput) {
    if (state.token) {
      tokenInput.value = state.token;
    }
    // Enter key triggers token verification and goes to page 2
    tokenInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        synth.playClick();
        verifyToken(true);
      }
    });
  }

  // Initialize Timer Config Select
  if (timerLimitSelect) {
    timerLimitSelect.value = state.maxDurationMinutes;
    timerLimitSelect.addEventListener('change', () => {
      synth.playClick();
      state.maxDurationMinutes = parseInt(timerLimitSelect.value, 10);
      localStorage.setItem('gh_max_duration', state.maxDurationMinutes);
      showToast(`ตั้งเวลาสูงสุดของเครื่องเป็น ${state.maxDurationMinutes} นาที`, 'info');
      updateCountdownUI();
    });
  }

  // Initialize Auto-Restart Toggle
  if (autoRestartToggle && autoRestartBar) {
    autoRestartToggle.checked = state.autoRestart;
    if (state.autoRestart) autoRestartBar.classList.add('active');

    autoRestartToggle.addEventListener('change', () => {
      synth.playClick();
      state.autoRestart = autoRestartToggle.checked;
      localStorage.setItem('gh_auto_restart', state.autoRestart);

      if (state.autoRestart) {
        autoRestartBar.classList.add('active');
        synth.playSuccess();
        showToast('🟢 เปิดระบบ Auto-Restart: จะรันเครื่องใหม่อัตโนมัติเมื่อหมดเวลาหรือเครื่องดับ', 'success', 5000);
      } else {
        autoRestartBar.classList.remove('active');
        showToast('⚪ ปิดระบบ Auto-Restart เรียบร้อย', 'info');
      }
      updateCountdownUI();
    });
  }

  // Toggle Token Visibility
  if (toggleTokenBtn && tokenInput) {
    toggleTokenBtn.addEventListener('click', () => {
      synth.playClick();
      if (tokenInput.type === 'password') {
        tokenInput.type = 'text';
        toggleTokenBtn.textContent = '🔒';
      } else {
        tokenInput.type = 'password';
        toggleTokenBtn.textContent = '👁️';
      }
    });
  }

  // Verify Token Button
  if (verifyTokenBtn) {
    verifyTokenBtn.addEventListener('click', () => {
      synth.playClick();
      verifyToken(true);
    });
  }

  // Clear Token Button & Logout Header Button
  if (clearTokenBtn) {
    clearTokenBtn.addEventListener('click', () => {
      clearToken();
    });
  }
  if (logoutHeaderBtn) {
    logoutHeaderBtn.addEventListener('click', () => {
      clearToken();
    });
  }

  // Repo Select Changed
  if (repoSelect) {
    repoSelect.addEventListener('change', () => {
      synth.playClick();
      onRepoSelected();
    });
  }

  // Workflow Select Changed
  if (workflowSelect) {
    workflowSelect.addEventListener('change', async () => {
      synth.playClick();
      state.workflow = workflowSelect.value;
      localStorage.setItem('gh_workflow', state.workflow);
      await inspectWorkflowInputs();
      loadRuns();
    });
  }

  // Branch Select Changed
  if (branchSelect) {
    branchSelect.addEventListener('change', async () => {
      synth.playClick();
      state.branch = branchSelect.value;
      localStorage.setItem('gh_branch', state.branch);
      await inspectWorkflowInputs();
    });
  }

  // Trigger Power Button
  if (triggerBtn) {
    triggerBtn.addEventListener('click', () => {
      triggerWorkflow();
    });
  }

  // Refresh Runs
  if (refreshRunsBtn) {
    refreshRunsBtn.addEventListener('click', () => {
      synth.playClick();
      loadRuns(true);
    });
  }

  // Cancel Run
  if (cancelRunBtn) {
    cancelRunBtn.addEventListener('click', () => {
      cancelActiveRun();
    });
  }

  // Auto Refresh Toggle
  if (autoRefreshToggle) {
    autoRefreshToggle.checked = state.autoRefresh;
    autoRefreshToggle.addEventListener('change', () => {
      synth.playClick();
      state.autoRefresh = autoRefreshToggle.checked;
      localStorage.setItem('gh_auto_refresh', state.autoRefresh);
      setupPolling();
      showToast(`อัปเดตอัตโนมัติ: ${state.autoRefresh ? 'เปิดใช้งาน (ทุก 5 วินาที)' : 'ปิดใช้งาน'}`, 'info');
    });
  }

  // Sound Toggle
  if (soundToggleBtn) {
    soundToggleBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
    soundToggleBtn.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      localStorage.setItem('gh_sound_enabled', state.soundEnabled);
      soundToggleBtn.textContent = state.soundEnabled ? '🔊' : '🔇';
      if (state.soundEnabled) synth.playClick();
    });
  }

  // Collapsible inputs toggle
  if (collapsibleToggle && collapsibleContent) {
    collapsibleToggle.addEventListener('click', () => {
      synth.playClick();
      collapsibleContent.classList.toggle('open');
      const arrow = collapsibleToggle.querySelector('.arrow');
      if (arrow) {
        arrow.textContent = collapsibleContent.classList.contains('open') ? '▲' : '▼';
      }
    });
  }

  // Multi-Page Stepper Navigation
  const stepBtn1 = document.getElementById('step-btn-1');
  const stepBtn2 = document.getElementById('step-btn-2');
  const stepBtn3 = document.getElementById('step-btn-3');
  if (stepBtn1) stepBtn1.addEventListener('click', () => switchPage(1));
  if (stepBtn2) stepBtn2.addEventListener('click', () => switchPage(2));
  if (stepBtn3) stepBtn3.addEventListener('click', () => switchPage(3));

  const btnNextToPage2 = document.getElementById('btn-next-to-page-2');
  if (btnNextToPage2) {
    btnNextToPage2.addEventListener('click', () => {
      handlePage1Next();
    });
  }

  // Page 2: Windows Config, OS Version, Timeout, Username & Repo Creation
  const osSelect = document.getElementById('select-os-version');
  const timeoutSelect = document.getElementById('select-run-timeout');
  const defaultUsernameInput = document.getElementById('input-default-username');
  const newRepoNameInput = document.getElementById('input-new-repo-name');
  const btnRandomRepoName = document.getElementById('btn-random-repo-name');
  const btnToggleYaml = document.getElementById('btn-toggle-yaml');
  const btnCreateRepoAndUpload = document.getElementById('btn-create-repo-and-upload');
  const btnToggleExistingRepoMode = document.getElementById('btn-toggle-existing-repo-mode');

  if (osSelect) {
    osSelect.value = state.osVersion || 'windows-2025';
    osSelect.addEventListener('change', () => {
      synth.playClick();
      updateYamlEditorContent();
    });
  }

  if (timeoutSelect) {
    timeoutSelect.value = state.maxDurationMinutes || 360;
    timeoutSelect.addEventListener('change', () => {
      synth.playClick();
      updateYamlEditorContent();
    });
  }

  if (defaultUsernameInput) {
    defaultUsernameInput.value = state.vmName;
    defaultUsernameInput.addEventListener('input', (e) => {
      updateVmName(e.target.value);
      updateYamlEditorContent();
    });
    defaultUsernameInput.addEventListener('change', (e) => {
      updateVmName(e.target.value);
      updateYamlEditorContent();
    });
  }

  // VM Password & Toggle Visibility
  const passwordInput = document.getElementById('input-default-password');
  const togglePasswordBtn = document.getElementById('btn-toggle-password');
  if (passwordInput) {
    passwordInput.value = state.vmPassword;
    passwordInput.addEventListener('input', (e) => {
      state.vmPassword = e.target.value;
      localStorage.setItem('gh_vm_password', state.vmPassword);
      updateYamlEditorContent();
    });
  }
  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      synth.playClick();
      if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        togglePasswordBtn.textContent = '🔒';
      } else {
        passwordInput.type = 'password';
        togglePasswordBtn.textContent = '👁️';
      }
    });
  }

  // Discord Log & Info Webhook Inputs
  const logWebhookInput = document.getElementById('input-log-webhook');
  const infoWebhookInput = document.getElementById('input-info-webhook');

  if (logWebhookInput) {
    logWebhookInput.value = state.logWebhook;
    logWebhookInput.addEventListener('input', (e) => {
      state.logWebhook = e.target.value.trim();
      localStorage.setItem('gh_log_webhook', state.logWebhook);
      updateYamlEditorContent();
    });
  }

  if (infoWebhookInput) {
    infoWebhookInput.value = state.infoWebhook;
    infoWebhookInput.addEventListener('input', (e) => {
      state.infoWebhook = e.target.value.trim();
      localStorage.setItem('gh_info_webhook', state.infoWebhook);
      updateYamlEditorContent();
    });
  }

  if (newRepoNameInput) {
    newRepoNameInput.value = state.newRepoName;
    newRepoNameInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      state.newRepoName = val;
      const label = document.getElementById('create-btn-repo-label');
      if (label) label.textContent = val || '...';
    });
  }

  if (btnRandomRepoName) {
    btnRandomRepoName.addEventListener('click', () => {
      generateRandomRepoName();
    });
  }

  if (btnToggleYaml) {
    btnToggleYaml.addEventListener('click', () => {
      synth.playClick();
      const yamlContainer = document.getElementById('yaml-editor-container');
      const arrow = document.getElementById('yaml-toggle-arrow');
      if (yamlContainer) {
        yamlContainer.classList.toggle('open');
        if (arrow) {
          arrow.textContent = yamlContainer.classList.contains('open') ? '▲' : '▼';
        }
      }
    });
  }

  if (btnCreateRepoAndUpload) {
    btnCreateRepoAndUpload.addEventListener('click', () => {
      handleCreateRepoAndUpload();
    });
  }

  if (btnToggleExistingRepoMode) {
    btnToggleExistingRepoMode.addEventListener('click', () => {
      toggleExistingRepoMode();
    });
  }

  // Pre-fill YAML code editor with initial parameters
  updateYamlEditorContent();

  // Auto-verify on initial launch ONLY if token exists in localStorage
  if (state.token) {
    verifyToken();
  } else {
    const statusEl = document.getElementById('token-status');
    if (statusEl) {
      statusEl.className = 'token-status';
      statusEl.innerHTML = '<span>⚪ กรุณาใส่ Token ของคุณ แล้วกดตรวจสอบสิทธิ์</span>';
    }
  }

  // Start polling & countdown timer loop
  setupPolling();
  setupCountdownTimer();
});
