const cmdInput = document.querySelector('#cmd');
const sendButton = document.querySelector('#send');
const log = document.querySelector('#log');
const health = document.querySelector('#health');

function appendLog(text) {
  const time = new Date().toLocaleTimeString();
  log.textContent += `[${time}] ${text}\n`;
  log.scrollTop = log.scrollHeight;
}

async function refreshHealth() {
  try {
    const res = await fetch('/api/health');
    const data = await res.json();
    const uptimeMs = data.uptimeMs ?? data.uptime_ms ?? 0;
    const freeHeap = data.freeHeap ?? data.heap ?? 0;
    const version = data.firmwareVersion ? ` | ${data.firmwareVersion}` : '';
    const build = data.buildDate && data.buildTime ? ` | ${data.buildDate} ${data.buildTime}` : '';
    const wifi = data.wifiMode && data.ipAddress ? ` | WiFi ${data.wifiMode} ${data.ipAddress}` : '';
    const seconds = Math.floor(uptimeMs / 1000);
    health.textContent = `${data.firmware}${version}${build}${wifi} | ${data.baudrate} baud | ${seconds}s uptime | ${freeHeap} heap`;
  } catch (err) {
    health.textContent = 'Offline';
  }
}

async function sendCommand(cmd) {
  const value = cmd.trim();
  if (!value) {
    return;
  }

  appendLog(`> ${value}`);
  sendButton.disabled = true;

  try {
    const res = await fetch('/api/cmd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: value }),
    });
    const data = await res.json();
    if (data.ok) {
      appendLog(data.response || '(no response)');
    } else {
      appendLog(`Error: ${data.error || 'command failed'}`);
    }
  } catch (err) {
    appendLog(`Error: ${err.message}`);
  } finally {
    sendButton.disabled = false;
    cmdInput.focus();
  }
}

sendButton.addEventListener('click', () => sendCommand(cmdInput.value));

cmdInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendCommand(cmdInput.value);
  }
});

document.querySelectorAll('[data-cmd]').forEach((button) => {
  button.addEventListener('click', () => {
    cmdInput.value = button.dataset.cmd;
    sendCommand(button.dataset.cmd);
  });
});

refreshHealth();
setInterval(refreshHealth, 5000);
