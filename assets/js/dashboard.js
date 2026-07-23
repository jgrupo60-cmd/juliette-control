import { getStatus } from '../../services/status.js';
import { startVirtualMachine } from '../../services/azure.js';
import { hasLocalSession, verifySession, clearStaffSession } from '../../services/api.js';
import { APP_CONFIG } from '../../config/app.js';

if (!hasLocalSession()) window.location.replace('login.html');
try {
  await verifySession();
} catch {
  clearStaffSession();
  window.location.replace('login.html');
  throw new Error('UNAUTHORIZED');
}

const $ = (id) => document.getElementById(id);
const startButton = $('startButton');
const runningMessage = $('runningMessage');
const actionMessage = $('actionMessage');
let busy = false;

const labels = {
  running: ['Encendida', 'Juliette está funcionando normalmente.'],
  starting: ['Iniciando', 'Azure está iniciando la máquina virtual.'],
  deallocated: ['Apagada', 'La máquina virtual está apagada.'],
  stopped: ['Apagada', 'La máquina virtual está detenida.'],
  stopping: ['Apagándose', 'Azure está procesando una operación.'],
  deallocating: ['Apagándose', 'Azure está desasignando la máquina virtual.'],
  unknown: ['No disponible', 'No fue posible consultar el estado de Azure.'],
};

function stateOf(status) {
  return String(status?.powerState || status?.vm || 'unknown').toLowerCase().replace('powerstate/', '');
}

function relativeTime(value) {
  if (!value) return 'recién';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return 'ahora';
  if (seconds < 60) return `hace ${seconds} segundos`;
  const minutes = Math.floor(seconds / 60);
  return `hace ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

function render(status) {
  const state = stateOf(status);
  const [title, description] = labels[state] || labels.unknown;
  $('stateTitle').textContent = title;
  $('stateDescription').textContent = description;
  $('stateDot').dataset.state = state;
  $('lastChecked').dataset.at = status?.checkedAt || new Date().toISOString();
  $('lastChecked').textContent = relativeTime($('lastChecked').dataset.at);

  const isRunning = state === 'running';
  const canStart = ['deallocated', 'stopped'].includes(state);
  startButton.hidden = !canStart;
  startButton.disabled = busy;
  runningMessage.hidden = !isRunning;
}

async function refresh() {
  try {
    render(await getStatus());
  } catch {
    render({ powerState: 'unknown', checkedAt: new Date().toISOString() });
  }
}

startButton.addEventListener('click', async () => {
  busy = true;
  startButton.disabled = true;
  startButton.textContent = 'Solicitando encendido…';
  actionMessage.hidden = true;
  try {
    const result = await startVirtualMachine();
    actionMessage.textContent = result.message || 'Azure aceptó la solicitud de encendido.';
    actionMessage.hidden = false;
    await refresh();
  } catch (error) {
    if (error.status === 401) {
      clearStaffSession();
      window.location.replace('login.html');
      return;
    }
    actionMessage.textContent = error.payload?.detail || 'No fue posible encender Juliette.';
    actionMessage.hidden = false;
  } finally {
    busy = false;
    startButton.disabled = false;
    startButton.textContent = 'Encender Juliette';
  }
});

$('logoutButton').addEventListener('click', () => {
  clearStaffSession();
  window.location.replace('login.html');
});

setInterval(() => {
  const el = $('lastChecked');
  if (el.dataset.at) el.textContent = relativeTime(el.dataset.at);
}, 1000);

await refresh();
setInterval(refresh, APP_CONFIG.statusPollMs);
