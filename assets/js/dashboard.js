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
    <div class="panel-head"><div><small>Servidor principal</small><h2>Juliette Runtime</h2></div><span class="status status-unknown" id="vmStatusBadge">Consultando</span></div>
    <div class="runtime-state"><span class="icon" id="runtimeIcon" data-state="unknown"><i></i><i></i><i></i></span><div><small>Estado actual</small><h3 id="runtimeTitle">Consultando Azure…</h3><p id="runtimeDescription">Obteniendo el estado real de la máquina virtual.</p></div></div>
    <div class="metric-grid"><div class="metric"><span>Región</span><strong id="region">—</strong></div><div class="metric"><span>Máquina virtual</span><strong id="vmName">—</strong></div><div class="metric"><span>Última comprobación</span><strong id="checkedAt">—</strong></div></div>
    <div class="live-strip"><span><i id="bridgeDot"></i><b id="bridgeState">Azure Bridge</b></span><span>Próxima consulta en <b id="pollCountdown">—</b></span></div>
    <div class="action-row"><button class="button button-primary" id="startButton">Encender servidor</button><button class="button button-ghost" id="refreshButton">Actualizar estado</button></div>
    <p class="bridge-note" id="bridgeNote"></p>
  </article>
  <div class="stack">
    <article class="card panel"><div class="panel-head"><div><small>Servicios</small><h2>Disponibilidad</h2></div></div><div class="service-list">
      <div class="service"><b>VM</b><span><strong>Azure VM</strong><small>Estado consultado mediante Azure Compute</small></span><em id="vmService">—</em></div>
      <div class="service"><b>DB</b><span><strong>Dashboard</strong><small>Disponible cuando la VM está encendida</small></span><em id="dashboardService">—</em></div>
      <div class="service"><b>BT</b><span><strong>Juliette Bot</strong><small>Telemetría interna pendiente</small></span><em id="botService">—</em></div>
    </div></article>
    <article class="card panel"><div class="panel-head"><div><small>Acceso rápido</small><h2>Herramientas</h2></div></div><div class="action-row"><a class="button button-ghost disabled-link" id="dashboardLink" href="${APP_CONFIG.dashboardUrl}" target="_blank" rel="noopener" aria-disabled="true">Abrir Dashboard</a><a class="button button-ghost" href="https://github.com/jgrupo60-cmd/juliette-control" target="_blank" rel="noopener">GitHub</a></div></article>
  </div>
</section>
<section class="card activity-panel" id="activity"><div class="panel-head"><div><small>Actividad</small><h2>Estado operativo</h2></div><span class="status status-running">PR-005</span></div><div class="activity-empty"><span>◎</span><div><h3 id="activityTitle">Supervisión en tiempo real activa</h3><p id="activityDescription">El panel consulta Azure automáticamente. El historial por integrante llegará con la autenticación del staff.</p></div></div></section>
</main>${toastMarkup()}${accessModalMarkup()}</div>`;

const $ = (id) => document.getElementById(id);
const els = {
  badge: $('vmStatusBadge'), title: $('runtimeTitle'), description: $('runtimeDescription'), icon: $('runtimeIcon'),
  region: $('region'), vmName: $('vmName'), checkedAt: $('checkedAt'), vmService: $('vmService'),
  dashboardService: $('dashboardService'), botService: $('botService'), start: $('startButton'), refresh: $('refreshButton'),
  note: $('bridgeNote'), dashboardLink: $('dashboardLink'), token: $('accessToken'), bridgeDot: $('bridgeDot'),
  bridgeState: $('bridgeState'), pollCountdown: $('pollCountdown'), activityTitle: $('activityTitle'), activityDescription: $('activityDescription'),
};

let latestStatus = null;
let pendingStart = false;
let nextPollAt = Date.now() + APP_CONFIG.statusPollMs;
let transitionTimer = null;

const labels = {
  running: ['Online', 'Servidor encendido', 'Azure informa que la máquina virtual está en ejecución.'],
  starting: ['Iniciando', 'Servidor iniciando', 'Azure aceptó la solicitud. El panel seguirá comprobando el progreso.'],
  deallocated: ['Offline', 'Servidor apagado', 'La máquina virtual está desasignada y lista para iniciarse.'],
  stopped: ['Detenido', 'Servidor detenido', 'La máquina está detenida, pero podría seguir asignando recursos.'],
  stopping: ['Deteniendo', 'Servidor deteniéndose', 'Espera a que finalice la operación.'],
  deallocating: ['Apagando', 'Servidor apagándose', 'Azure está desasignando la máquina virtual.'],
  unknown: ['Sin conexión', 'Estado no disponible', 'No fue posible determinar el estado actual.'],
};

function normalizeState(status) {
  return String(status?.powerState || status?.vm || 'unknown').toLowerCase().replace('powerstate/', '');
}

function isTransition(state) {
  return ['starting', 'stopping', 'deallocating'].includes(state);
}

function formatTime(value) {
  if (!value) return 'Sin datos';
  return new Intl.DateTimeFormat('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}

function renderStatus(status) {
  latestStatus = status;
  const state = normalizeState(status);
  const [badge, title, description] = labels[state] || labels.unknown;
  const online = state === 'running';

  els.badge.textContent = badge;
  els.badge.className = `status status-${state}`;
  els.title.textContent = title;
  els.description.textContent = description;
  els.icon.dataset.state = state;
  els.region.textContent = status.region || 'North Central US';
  els.vmName.textContent = status.vmName || 'kyodobot-server';
  els.checkedAt.textContent = formatTime(status.checkedAt);
  els.vmService.textContent = badge;
  els.vmService.className = `service-state state-${state}`;
  els.dashboardService.textContent = online ? 'Acceso disponible' : 'Sin conexión';
  els.dashboardService.className = `service-state ${online ? 'state-running' : 'state-deallocated'}`;
  els.botService.textContent = online ? 'No verificado' : 'Sin conexión';
  els.botService.className = `service-state ${online ? 'state-unknown' : 'state-deallocated'}`;
  els.start.disabled = online || isTransition(state) || pendingStart;
  els.start.textContent = online ? 'Servidor encendido' : state === 'starting' ? 'Iniciando…' : 'Encender servidor';
  els.dashboardLink.classList.toggle('disabled-link', !online);
  els.dashboardLink.setAttribute('aria-disabled', String(!online));
  els.bridgeDot.className = status.apiConfigured ? 'online' : 'offline';
  els.bridgeState.textContent = status.apiConfigured ? 'Azure Bridge conectado' : 'Azure Bridge sin configurar';
  els.note.textContent = status.apiConfigured ? 'Estado real entregado por Azure Functions y Managed Identity.' : 'Falta configurar la URL de Azure Functions.';
  els.activityTitle.textContent = `${badge} · ${formatTime(status.checkedAt)}`;
  els.activityDescription.textContent = online
    ? 'La VM está activa. El Dashboard puede tardar unos segundos adicionales en responder después del arranque.'
    : state === 'deallocated'
      ? 'La VM está completamente apagada y no genera costo de cómputo.'
      : description;

  scheduleTransitionPolling(state);
}

function scheduleTransitionPolling(state) {
  if (transitionTimer) window.clearTimeout(transitionTimer);
  transitionTimer = null;
  if (!isTransition(state)) return;
  transitionTimer = window.setTimeout(() => refreshStatus({ quiet: true }), APP_CONFIG.transitionPollMs || 5000);
}

async function refreshStatus({ quiet = false } = {}) {
  els.refresh.disabled = true;
  els.refresh.classList.add('is-loading');
  try {
    const status = await getStatus();
    renderStatus(status);
    if (!quiet) showToast('Estado actualizado', 'La información se obtuvo directamente desde Azure.');
  } catch (error) {
    renderStatus({ ...(latestStatus || {}), powerState: 'unknown', checkedAt: new Date().toISOString(), apiConfigured: isApiConfigured() });
    if (!quiet) showToast('No fue posible consultar Azure', humanizeError(error));
  } finally {
    els.refresh.disabled = false;
    els.refresh.classList.remove('is-loading');
    nextPollAt = Date.now() + APP_CONFIG.statusPollMs;
  }
}

function humanizeError(error) {
  if (error.message === 'API_NOT_CONFIGURED') return 'Falta configurar la URL HTTPS de Azure Functions.';
  if (error.message === 'API_TIMEOUT') return 'Azure Bridge demoró demasiado en responder.';
  if (error.message === 'API_UNREACHABLE') return 'No fue posible conectar con Azure Bridge. Revisa CORS o el despliegue.';
  if (error.status === 401) return 'El código temporal del staff no es válido.';
  if (error.status === 403) return 'La identidad de la Function no tiene permisos sobre la VM.';
  return error.payload?.detail || 'Revisa la Function App y vuelve a intentarlo.';
}

async function executeStart() {
  pendingStart = true;
  els.start.disabled = true;
  els.start.textContent = 'Enviando solicitud…';
  try {
    const result = await startVirtualMachine();
    showToast('Inicio solicitado', result.message || 'Azure aceptó la solicitud de encendido.');
    renderStatus({ ...(latestStatus || {}), powerState: result.powerState || 'starting', checkedAt: new Date().toISOString(), apiConfigured: true });
    window.setTimeout(() => refreshStatus({ quiet: true }), APP_CONFIG.transitionPollMs || 5000);
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
  if (!isApiConfigured()) return showToast('Azure Bridge sin configurar', 'Revisa config/app.js.');
  if (!getAccessToken()) return openAccessModal();
  executeStart();
});
els.refresh.addEventListener('click', () => refreshStatus());
$('menuButton').addEventListener('click', () => $('sidebar').classList.toggle('open'));
$('closeAccessModal').addEventListener('click', closeAccessModal);
$('cancelAccess').addEventListener('click', closeAccessModal);
$('confirmAccess').addEventListener('click', () => {
  if (!els.token.value.trim()) return showToast('Código requerido', 'Ingresa el código temporal entregado al staff.');
  setAccessToken(els.token.value);
  els.token.value = '';
  closeAccessModal();
  executeStart();
});
els.token.addEventListener('keydown', (event) => { if (event.key === 'Enter') $('confirmAccess').click(); });
$('accessModal').addEventListener('click', (event) => { if (event.target.id === 'accessModal') closeAccessModal(); });
els.dashboardLink.addEventListener('click', (event) => {
  if (els.dashboardLink.getAttribute('aria-disabled') === 'true') event.preventDefault();
});

window.setInterval(() => {
  const remaining = Math.max(0, Math.ceil((nextPollAt - Date.now()) / 1000));
  els.pollCountdown.textContent = `${remaining}s`;
}, 1000);

await refreshStatus({ quiet: true });
window.setInterval(() => refreshStatus({ quiet: true }), APP_CONFIG.statusPollMs);
