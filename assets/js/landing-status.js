import { APP_CONFIG } from '../../config/app.js';
import { fetchVirtualMachineStatus } from '../../services/azure.js';

const labels = {
  running: { badge: 'Online', title: 'Servidor encendido', description: 'La VM está operativa en Azure.' },
  starting: { badge: 'Iniciando', title: 'Servidor iniciando', description: 'Azure está arrancando la máquina virtual.' },
  deallocated: { badge: 'Offline', title: 'Servidor apagado', description: 'La VM está desasignada y lista para iniciarse.' },
  stopped: { badge: 'Detenido', title: 'Servidor detenido', description: 'La VM está detenida.' },
  stopping: { badge: 'Deteniendo', title: 'Servidor deteniéndose', description: 'Azure está procesando el apagado.' },
  deallocating: { badge: 'Apagando', title: 'Servidor apagándose', description: 'Azure está desasignando la VM.' },
  unknown: { badge: 'Sin conexión', title: 'Estado no disponible', description: 'No fue posible consultar Azure Bridge.' },
};

function normalize(status) {
  return String(status?.powerState || status?.vm || 'unknown').toLowerCase().replace('powerstate/', '');
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function render(status) {
  const state = normalize(status);
  const copy = labels[state] || labels.unknown;
  const badge = document.getElementById('landingVmBadge');
  const glyph = document.getElementById('landingServerGlyph');
  if (badge) {
    badge.textContent = copy.badge;
    badge.className = `status status-${state}`;
  }
  if (glyph) glyph.dataset.state = state;
  setText('landingVmTitle', copy.title);
  setText('landingVmDescription', copy.description);
  setText('landingRegion', status?.region || 'North Central US');
  setText('landingVmName', status?.vmName || 'kyodobot-server');
  setText('landingVersion', `v${APP_CONFIG.version}`);
  setText('landingVmService', copy.badge);
  setText('landingDashboardService', state === 'running' ? 'Acceso disponible' : 'Sin conexión');
  setText('landingBotService', state === 'running' ? 'No verificado' : 'Sin conexión');
}

async function refresh() {
  try {
    render(await fetchVirtualMachineStatus());
  } catch {
    render({ powerState: 'unknown' });
  }
}

await refresh();
window.setInterval(refresh, APP_CONFIG.statusPollMs);
