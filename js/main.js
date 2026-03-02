// js/main.js
// Базовый путь для GitHub Pages
const BASE_URL = '/esp_zb_h2ncp_s3_host_web_flash';
import { ESPLoader, Transport } from 'https://unpkg.com/esptool-js@0.5.4/bundle.js';

const CHIPS = {
  // === ESP32-S3 (HOST) ===
  /*
  Executing task: C:\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe c:\Espressif\frameworks\v5.5.2\esp-idf\components\esptool_py\esptool\esptool.py 
  -p COM4 -b 460800 --before default_reset --after hard_reset --chip esp32s3 write_flash --flash_mode dio --flash_freq 80m --flash_size 16MB 
  0x0 bootloader/bootloader.bin 
  0x20000 zigbee_ncp_host.bin 
  0x8000 partition_table/partition-table.bin 
  0x1b000 ota_data_initial.bin 
  */
  s3: {
    label: 'ESP32-S3',
    flashSize: '16MB',
    flashMode: 'dio',
    flashFreq: '80m',
    files: [
      { name: 'bootloader.bin',       offset: 0x0,       url: BASE_URL + '/firmware/s3/bootloader.bin' },
      { name: 'partition-table.bin',  offset: 0x8000,    url: BASE_URL + '/firmware/s3/partition-table.bin' },
      { name: 'zigbee_ncp_host.bin',  offset: 0x20000,   url: BASE_URL + '/firmware/s3/zigbee_ncp_host.bin' },
      { name: 'spiffs_ui.bin',        offset: 0x820000,  url: BASE_URL + '/firmware/s3/spiffs_ui.bin' },
      { name: 'spiffs_quirks.bin',    offset: 0xE20000,  url: BASE_URL + '/firmware/s3/spiffs_quirks.bin' },
      { name: 'ota_data_initial.bin',  offset:0x1b000,   url: BASE_URL + '/firmware/s3/ota_data_initial.bin' },
    ],
  },

  // === ESP32-H2 (NCP) ===
  /*
  Executing task: C:\Espressif\python_env\idf5.5_py3.11_env\Scripts\python.exe c:\Espressif\frameworks\v5.5.2\esp-idf\components\esptool_py\esptool\esptool.py
   -p COM5 -b 460800 --before default_reset --after hard_reset --chip esp32h2 write_flash --flash_mode dio --flash_freq 48m --flash_size 4MB 
   0x0 bootloader/bootloader.bin 
   0x30000 zigbee_ncp.bin 
   0x8000 partition_table/partition-table.bin 
   0x29000 ota_data_initial.bin
  */
  h2: {
    label: 'ESP32-H2',
    flashSize: '4MB',
    flashMode: 'dio',
    flashFreq: '48m',
    files: [
      { name: 'bootloader.bin',         offset: 0x0,       url: BASE_URL + '/firmware/h2/bootloader.bin' },
      { name: 'partition-table.bin',    offset: 0x8000,    url: BASE_URL + '/firmware/h2/partition-table.bin' },
      { name: 'zigbee_ncp.bin',         offset: 0x30000,   url: BASE_URL + '/firmware/h2/zigbee_ncp.bin' },
      { name: 'ota_data_initial.bin',   offset: 0x29000,   url: BASE_URL + '/firmware/h2/ota_data_initial.bin' },
    ],
  },
};

const state = {
  s3: { esploader: null, transport: null, fileData: {}, connected: false, flashed: false },
  h2: { esploader: null, transport: null, fileData: {}, connected: false, flashed: false },
};

/* ── Лог ───────────────────────────────────── */
const logEl = document.getElementById('log');
function log(msg, cls = '') {
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = `[${new Date().toISOString().slice(11,19)}] ${msg}\n`;
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

/* ── UI helpers ────────────────────────────── */
function ucChip(c) { return c.toUpperCase(); }

function updateConnStatus(chip, on, text) {
  const el = document.getElementById('connStatus' + ucChip(chip));
  el.innerHTML = '<span class="dot ' + (on ? 'on' : 'off') + '"></span>' + text;
  state[chip].connected = on;
  document.getElementById('btnConnect' + ucChip(chip)).style.display = on ? 'none' : '';
  document.getElementById('btnDisconnect' + ucChip(chip)).style.display = on ? '' : 'none';
  updateFlashBtn(chip);
}

function updateFlashBtn(chip) {
  const cfg = CHIPS[chip];
  const allLoaded = cfg.files.every(f => state[chip].fileData[f.name]);
  document.getElementById('btnFlash' + ucChip(chip)).disabled = !state[chip].connected || !allLoaded;
  document.getElementById('btnErase' + ucChip(chip)).disabled = !state[chip].connected;
}

function setProgress(chip, pct, text) {
  const wrap = document.getElementById('progressWrap' + ucChip(chip));
  const fill = document.getElementById('progressFill' + ucChip(chip));
  const txt = document.getElementById('progressText' + ucChip(chip));
  wrap.style.display = 'block';
  fill.style.width = pct + '%';
  txt.textContent = text;
}

/* ── Manifest ──────────────────────────────── */
async function loadManifest() {
  try {
    const r = await fetch(BASE_URL + '/firmware/manifest.json?t=' + Date.now());
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
}

function applyManifest(m) {
  if (!m) return;
  for (const chip of ['s3', 'h2']) {
    const d = m[chip];
    if (!d || !d.app) continue;
    const f = CHIPS[chip].files.find(f => f.offset === 0x20000);
    if (f) { f.name = d.app; f.url = '/firmware/' + chip + '/' + d.app; }
    const el = document.getElementById('fwInfo' + ucChip(chip));
    let h = '<div class="fw-version">v' + d.version;
    if (d.date) h += ' — ' + d.date;
    if (d.size) h += ' — ' + (d.size / 1024).toFixed(0) + ' KB';
    el.innerHTML = h + '</div>';
  }
}

/* ── Firmware files ────────────────────────── */
function renderFiles(chip) {
  const cfg = CHIPS[chip];
  const el = document.getElementById('fileList' + ucChip(chip));
  el.innerHTML = cfg.files.map(f => {
    const ld = state[chip].fileData[f.name];
    const sz = ld ? (ld.byteLength / 1024).toFixed(1) + ' KB' : '...';
    const st = ld ? 'loaded' : (ld === false ? 'error' : 'pending');
    return `
      <div class="file-row">
        <span class="file-status ${st}"></span>
        <span class="file-offset">0x${f.offset.toString(16).padStart(6,'0')}</span>
        <span class="file-name">${f.name}</span>
        <span class="file-size">${sz}</span>
      </div>`;
  }).join('');
}

async function loadFirmwareFiles(chip) {
  const cfg = CHIPS[chip];
  log(`[${cfg.label}] Loading firmware files...`, 'info');
  renderFiles(chip);
  for (const f of cfg.files) {
    try {
      const r = await fetch(f.url);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      state[chip].fileData[f.name] = await r.arrayBuffer();
      log(`  ${f.name}: ${(state[chip].fileData[f.name].byteLength / 1024).toFixed(1)} KB`, 'ok');
    } catch (e) {
      state[chip].fileData[f.name] = false;
      log(`  ${f.name}: FAILED (${e.message})`, 'err');
    }
    renderFiles(chip);
  }
  const n = cfg.files.filter(f => state[chip].fileData[f.name]).length;
  log(`[${cfg.label}] ${n}/${cfg.files.length} files loaded`, n === cfg.files.length ? 'ok' : 'warn');
  updateFlashBtn(chip);
}

/* ── Connect / Disconnect ──────────────────── */
window.doConnect = async function(chip) {
  const cfg = CHIPS[chip];
  try {
    log(`[${cfg.label}] Requesting serial port...`, 'info');
    const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
    state[chip].transport = new Transport(port, true);
    log(`[${cfg.label}] Connecting...`, 'info');
    state[chip].esploader = new ESPLoader({
      transport: state[chip].transport,
      baudrate: 460800,
      romBaudrate: 115200,
    });
    const det = await state[chip].esploader.main();
    log(`[${cfg.label}] Connected: ${det}`, 'ok');
    updateConnStatus(chip, true, 'Connected: ' + det);
    try {
      const mac = await state[chip].esploader.readMac();
      const info = document.getElementById('chipInfo' + ucChip(chip));
      info.style.display = 'grid';
      info.innerHTML = `
        <div class="chip-item"><span>Chip</span>${det}</div>
        <div class="chip-item"><span>MAC</span>${mac}</div>`;
    } catch (e) {}
  } catch (e) {
    log(`[${cfg.label}] Connection failed: ${e.message}`, 'err');
    updateConnStatus(chip, false, 'Failed');
  }
};

window.doDisconnect = async function(chip) {
  try { if (state[chip].transport) await state[chip].transport.disconnect(); } catch (e) {}
  state[chip].esploader = null;
  state[chip].transport = null;
  updateConnStatus(chip, false, 'Disconnected');
  document.getElementById('chipInfo' + ucChip(chip)).style.display = 'none';
  log(`[${CHIPS[chip].label}] Disconnected`, 'info');
};

/* ── Flash / Erase ─────────────────────────── */
window.doFlash = async function(chip) {
  const cfg = CHIPS[chip], s = state[chip];
  if (!s.esploader) return;
  const btn = document.getElementById('btnFlash' + ucChip(chip));
  btn.disabled = true;
  try {
    if (document.getElementById('chkErase' + ucChip(chip)).checked) {
      log(`[${cfg.label}] Erasing flash...`, 'warn');
      setProgress(chip, 0, 'Erasing...');
      await s.esploader.eraseFlash();
      log(`[${cfg.label}] Flash erased`, 'ok');
    }
    const ff = cfg.files.filter(f => s.fileData[f.name]).map(f => ({
      data: binaryToStr(new Uint8Array(s.fileData[f.name])),
      address: f.offset,
    }));
    log(`[${cfg.label}] Flashing ${ff.length} files...`, 'info');
    const total = ff.reduce((s, f) => s + f.data.length, 0);
    await s.esploader.writeFlash({
      fileArray: ff,
      flashSize: cfg.flashSize,
      flashMode: cfg.flashMode,
      flashFreq: cfg.flashFreq,
      eraseAll: false,
      compress: true,
      reportProgress: (fi, w) => {
        const prev = ff.slice(0, fi).reduce((s, f) => s + f.data.length, 0);
        const pct = Math.round((prev + w) / total * 100);
        setProgress(chip, pct, `Flashing ${cfg.files[fi].name}... ${pct}%`);
      },
    });
    setProgress(chip, 100, 'Success!');
    log(`[${cfg.label}] Flash complete! Resetting...`, 'ok');
    try { await s.esploader.hardReset(); } catch (e) {}
    log(`[${cfg.label}] Device reset.`, 'ok');
    s.flashed = true;
  } catch (e) {
    log(`[${cfg.label}] Flash failed: ${e.message}`, 'err');
    setProgress(chip, 0, 'Failed');
  }
  btn.disabled = false;
  updateFlashBtn(chip);
};

window.doEraseOnly = async function(chip) {
  const cfg = CHIPS[chip], s = state[chip];
  if (!s.esploader) return;
  const btn = document.getElementById('btnErase' + ucChip(chip));
  btn.disabled = true;
  try {
    log(`[${cfg.label}] Erasing flash...`, 'warn');
    setProgress(chip, 0, 'Erasing...');
    await s.esploader.eraseFlash();
    setProgress(chip, 100, 'Erase complete');
    log(`[${cfg.label}] Flash erased`, 'ok');
  } catch (e) {
    log(`[${cfg.label}] Erase failed: ${e.message}`, 'err');
  }
  btn.disabled = false;
  updateFlashBtn(chip);
};

/* ── Init ──────────────────────────────────── */
if (!('serial' in navigator)) {
  log('ERROR: Web Serial API not supported. Use Chrome or Edge.', 'err');
  document.querySelectorAll('button').forEach(b => b.disabled = true);
} else {
  (async () => {
    const m = await loadManifest();
    applyManifest(m);
    loadFirmwareFiles('s3');
    loadFirmwareFiles('h2');
  })();
}

/* ── Utility ───────────────────────────────── */
function binaryToStr(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return s;
}