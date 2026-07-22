import { sidebar } from '../../components/sidebar.js';
import { topbar } from '../../components/topbar.js';
import { toastMarkup, showToast } from '../../components/toast.js';
import { accessModalMarkup, openAccessModal, closeAccessModal } from '../../components/access-modal.js';
import { getStatus } from '../../services/status.js';
import { startVirtualMachine } from '../../services/azure.js';
import { getAccessToken, setAccessToken, isApiConfigured } from '../../services/api.js';
import { APP_CONFIG } from '../../config/app.js';

const shell = document.getElementById('appShell');
shell.innerHTML = `<div class="app-layout">${sidebar()}<main class="content">${topbar()}
<section class="dashboard-grid" id="overview">
  <article class="card panel">
    <div class="panel-head"><div><small>Servidor principal</small><h2>Juliette Runtime</h2></div><span class="status status-unknown" id="vmStatusBadge">Sin conexión</span></div>
    <div class="runtime-state"><span class="icon" id="runtimeIcon"><i></i><i></i><i></i></span><div><small>Estado actual</small><h3 id="runtimeTitle">Consultando estado…</h3><p id="runtimeDescription">Preparando Azure Bridge.</p></div></div>
    <div class="metric-grid"><div class="metric"><span>Región</span><strong id="region">—</strong></div><div class="metric"><span>Máquina virtual</span><strong id="vmName">—</strong></div><div class="metric"><span>Última comprobación</span><strong id="checkedAt">—</strong></div></div>
    <div class="action-row"><button class="button button-primary" id="startButton">Encender servidor</button><button class="button button-ghost" id="refreshButton">Actualizar estado</button></div>
    <p class="bridge-note" id="bridgeNote"></p>
  </article>
  <div class="stack">
    <article class="card panel"><div class="panel-head"><div><small>Servicios</small><h2>Disponibilidad</h2></div></div><div class="service-list">
      <div class="service"><b>VM</b><span><strong>Azure VM</strong><small>Infraestructura principal</small></span><em id="vmService">—</em></div>
      <div class="service"><b>DB</b><span><strong>Dashboard</strong><small>Panel administrativo</small></span><em id="dashboardService">—</em></div>
      <div class="service"><b>BT</b><span><strong>Juliette Bot</strong><small>Conexión con Kyodo</small></span><em id="botService">—</em></div>
    </div></article>
    <article class="card panel"><div class="panel-head"><div><small>Acceso rápido</small><h2>Herramientas</h2></div></div><div class="action-row"><a class="button button-ghost disabled-link" id="dashboardLink" href="${APP_CONFIG.dashboardUrl}" target="_blank" rel="noopener" aria-disabled="true">Dashboard</a><a class="button button-ghost" href="https://github.com/jgrupo60-cmd/juliette-control" target="_blank" rel="noopener">GitHub</a></div></article>
  </div>
</section>
<section class="card activity-panel" id="activity"><div class="panel-head"><div><small>Actividad</small><h2>Registro reciente</h2></div><span class="status status-pending">PR-004</span></div><div class="activity-empty"><span>◎</span><div><h3>Azure Bridge preparado</h3><p>El historial individual se activará junto con la autenticación del staff.</p></div></div></section>
</main>${toastMarkup()}${accessModalMarkup()}</div>`;

const els = {
  badge: document.getElementById('vmStatusBadge'), title: document.getElementById('runtimeTitle'),
  description: document.getElementById('runtimeDescription'), icon: document.getElementById('runtimeIcon'),
  region: document.getElementById('region'), vmName: document.getElementById('vmName'), checkedAt: document.getElementById('checkedAt'),
  vmService: document.getElementById('vmService'), dashboardService: document.getElementById('dashboardService'), botService: document.getElementById('botService'),
  start: document.getElementById('startButton'), refresh: document.getElementById('refreshButton'), note: document.getElementById('bridgeNote'),
  dashboardLink: document.getElementById('dashboardLink'), token: document.getElementById('accessToken'),
};

let latestStatus = null;
let pendingStart = false;

const labels = {
  running: ['Online', 'Servidor encendido', 'Azure informa que la máquina virtual está en ejecución.'],
  starting: ['Iniciando', 'Servidor iniciando', 'Azure aceptó la solicitud. Esto puede tardar alrededor de un minuto.'],
  deallocated: ['Offline', 'Servidor apagado', 'La máquina virtual está desasignada y lista para iniciarse.'],
  stopped: ['Detenido', 'Servidor detenido', 'La máquina está detenida, pero podría seguir asignando recursos.'],
  stopping: ['Deteniendo', 'Servidor deteniéndose', 'Espera a que finalice la operación antes de iniciarlo.'],
  deallocating: ['Apagando', 'Servidor apagándose', 'Azure está desasignando la máquina virtual.'],
  unknown: ['Sin conexión', 'Estado no disponible', 'No fue posible determinar el estado actual.'],
};

function normalizeState(status) {
  return String(status.powerState || status.vm || 'unknown').toLowerCase().replace('powerstate/', '');
}

function renderStatus(status) {
  latestStatus = status;
  const state = normalizeState(status);
  const [badge, title, description] = labels[state] || labels.unknown;
  els.badge.textContent = badge;
  els.badge.className = `status status-${state}`;
  els.title.textContent = title;
  els.description.textContent = description;
  els.icon.dataset.state = state;
  els.region.textContent = status.region || 'North Central US';
  els.vmName.textContent = status.vmName || 'kyodobot-server';
  els.checkedAt.textContent = status.checkedAt ? new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(status.checkedAt)) : 'Sin datos';
  els.vmService.textContent = badge;
  els.vmService.className = `service-state state-${state}`;
  const online = state === 'running';
  els.dashboardService.textContent = online ? 'Verificando' : 'No disponible';
  els.botService.textContent = online ? 'Verificando' : 'No disponible';
  els.start.disabled = ['running', 'starting', 'stopping', 'deallocating'].includes(state) || pendingStart;
  els.start.textContent = state === 'running' ? 'Servidor encendido' : state === 'starting' ? 'Iniciando…' : 'Encender servidor';
  els.dashboardLink.classList.toggle('disabled-link', !online);
  els.dashboardLink.setAttribute('aria-disabled', String(!online));
  els.note.textContent = status.apiConfigured ? 'Conectado a Azure Bridge.' : 'Falta configurar la URL de Azure Functions en config/app.js.';
}

async function refreshStatus({ quiet = false } = {}) {
  els.refresh.disabled = true;
  try {
    const status = await getStatus();
    renderStatus(status);
    if (!quiet) showToast('Estado actualizado', status.apiConfigured ? 'La información se obtuvo directamente desde Azure.' : 'La API todavía no tiene una URL configurada.');
  } catch (error) {
    renderStatus({ ...(latestStatus || {}), powerState: 'unknown', checkedAt: new Date().toISOString(), apiConfigured: true });
    if (!quiet) showToast('No fue posible consultar Azure', humanizeError(error));
  } finally {
    els.refresh.disabled = false;
  }
}

function humanizeError(error) {
  if (error.message === 'API_NOT_CONFIGURED') return 'Falta pegar la URL HTTPS de Azure Functions.';
  if (error.message === 'API_TIMEOUT') return 'Azure Bridge demoró demasiado en responder.';
  if (error.status === 401) return 'El código del staff no es válido.';
  if (error.status === 403) return 'La identidad de la Function no tiene permisos sobre la VM.';
  return 'Revisa la Function App y vuelve a intentarlo.';
}

async function executeStart() {
  pendingStart = true;
  els.start.disabled = true;
  els.start.textContent = 'Enviando solicitud…';
  try {
    const result = await startVirtualMachine();
    showToast('Inicio solicitado', result.message || 'Azure aceptó la solicitud de encendido.');
    latestStatus = { ...(latestStatus || {}), powerState: result.powerState || 'starting', checkedAt: new Date().toISOString(), apiConfigured: true };
    renderStatus(latestStatus);
    window.setTimeout(() => refreshStatus({ quiet: true }), 5000);
  } catch (error) {
    if (error.status === 401) {
      setAccessToken('');
      openAccessModal();
    }
    showToast('No se pudo encender', humanizeError(error));
  } finally {
    pendingStart = false;
    if (latestStatus) renderStatus(latestStatus);
  }
}

els.start.addEventListener('click', () => {
  if (!isApiConfigured()) return showToast('Azure Bridge sin configurar', 'Primero crea la Function App y pega su URL en config/app.js.');
  if (!getAccessToken()) return openAccessModal();
  executeStart();
});
els.refresh.addEventListener('click', () => refreshStatus());
document.getElementById('menuButton').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('closeAccessModal').addEventListener('click', closeAccessModal);
document.getElementById('cancelAccess').addEventListener('click', closeAccessModal);
document.getElementById('confirmAccess').addEventListener('click', () => {
  if (!els.token.value.trim()) return showToast('Código requerido', 'Ingresa el código temporal entregado al staff.');
  setAccessToken(els.token.value);
  els.token.value = '';
  closeAccessModal();
  executeStart();
});
els.token.addEventListener('keydown', (event) => { if (event.key === 'Enter') document.getElementById('confirmAccess').click(); });
document.getElementById('accessModal').addEventListener('click', (event) => { if (event.target.id === 'accessModal') closeAccessModal(); });

await refreshStatus({ quiet: true });
window.setInterval(() => refreshStatus({ quiet: true }), APP_CONFIG.statusPollMs);
