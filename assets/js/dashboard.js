import { sidebar } from '../../components/sidebar.js';
import { topbar } from '../../components/topbar.js';
import { toastMarkup, showToast } from '../../components/toast.js';
import { accessModalMarkup, openAccessModal, closeAccessModal } from '../../components/access-modal.js';
import { getStatus } from '../../services/status.js';
import {
  startVirtualMachine,
  stopVirtualMachine,
  restartVirtualMachine,
  fetchBridgeHealth,
  fetchRuntimeStatus,
  fetchRuntimeLogs,
  updateRuntime,
  fetchAudit,
} from '../../services/azure.js';
import {
  getAccessToken,
  setAccessToken,
  getStaffName,
  setStaffName,
} from '../../services/api.js';
import { APP_CONFIG } from '../../config/app.js';

const shell = document.getElementById('appShell');
shell.innerHTML = `<div class="app-layout">${sidebar()}<main class="content">${topbar()}
<section class="mission-hero"><div><p class="eyebrow">Infraestructura en vivo</p><h1>Mission Control</h1><p>Estado real de Azure, Docker, Git y despliegues de Juliette desde un solo lugar.</p></div><div class="hero-sync"><span id="heroStateDot"></span><div><small>Última sincronización</small><strong id="heroCheckedAt">—</strong></div><button class="icon-button" id="refreshButton" aria-label="Actualizar">↻</button></div></section>
<section class="mission-grid"><article class="card command-card"><div class="command-head"><div><small>Servidor principal</small><h2>Juliette Runtime</h2></div><span class="status status-unknown" id="vmStatusBadge">Consultando</span></div><div class="command-state"><span class="server-orb" id="runtimeIcon" data-state="unknown"><i></i><i></i><i></i></span><div><small>Estado actual</small><h3 id="runtimeTitle">Consultando Azure…</h3><p id="runtimeDescription">Obteniendo el estado real.</p></div></div><div class="command-metrics"><div><span>Región</span><strong id="region">—</strong></div><div><span>Máquina virtual</span><strong id="vmName">—</strong></div><div><span>Versión</span><strong>v${APP_CONFIG.version}</strong></div></div><div class="command-actions"><button class="button button-primary" id="startButton">Encender</button><button class="button button-ghost" id="restartButton">Reiniciar</button><button class="button button-danger" id="stopButton">Apagar</button></div><div class="live-strip"><span><i id="bridgeDot"></i><b id="bridgeState">Azure Bridge</b></span><span>Próxima consulta en <b id="pollCountdown">—</b></span></div></article>
<article class="card service-board"><div class="section-head"><div><small>Estado del sistema</small><h2>Servicios</h2></div><span class="health-score" id="healthScore">0/4</span></div>${[
  ['AZ','Azure VM','Compute · North Central US','vmService'],
  ['DB','Dashboard','HTTP + contenedor kyodobot-dashboard','dashboardService'],
  ['BT','Juliette Bot','Contenedor kyodobot','botService'],
  ['BR','Azure Bridge','Functions · Managed Identity','bridgeService'],
].map(x=>`<div class="service-tile"><span class="service-icon">${x[0]}</span><div><strong>${x[1]}</strong><small>${x[2]}</small></div><em id="${x[3]}">—</em></div>`).join('')}<div class="quick-links"><a class="button button-ghost" id="dashboardLink" href="${APP_CONFIG.dashboardUrl}" target="_blank" rel="noopener">Abrir Dashboard</a><a class="button button-ghost" href="https://portal.azure.com" target="_blank" rel="noopener">Azure Portal</a></div></article></section>
<section class="runtime-grid"><article class="card metrics-card"><div class="section-head"><div><small>Telemetría interna</small><h2>Salud de la VM</h2></div><button class="text-button" id="runtimeRefresh">Actualizar</button></div><div class="metric-grid"><div><span>Memoria</span><strong id="memoryMetric">—</strong><meter id="memoryMeter" min="0" max="100" value="0"></meter><small id="memoryDetail">—</small></div><div><span>Disco</span><strong id="diskMetric">—</strong><meter id="diskMeter" min="0" max="100" value="0"></meter><small id="diskDetail">—</small></div><div><span>Carga 1m</span><strong id="loadMetric">—</strong><small>Promedio del sistema</small></div><div><span>Uptime</span><strong id="uptimeMetric">—</strong><small>Desde el último arranque</small></div><div><span>Git</span><strong id="gitMetric">—</strong><small id="gitDetail">—</small></div><div><span>Latencia</span><strong id="bridgeLatency">—</strong><small id="latencyQuality">Azure Bridge</small></div></div><div class="trend-wrap"><span>Disponibilidad observada en esta pestaña</span><div class="trend" id="availabilityTrend"></div></div></article>
<article class="card deploy-card"><div class="section-head"><div><small>Operaciones</small><h2>Despliegue y diagnóstico</h2></div><span class="status status-unknown" id="staffSession">Sin sesión</span></div><p>Ejecuta el actualizador oficial y consulta logs reales sin entrar por SSH.</p><div class="deploy-actions"><button class="button button-primary" id="updateButton">Actualizar desde Git</button><button class="button button-ghost" id="logsButton">Cargar logs</button></div><pre id="logsOutput">Inicia sesión para consultar los logs protegidos.</pre></article></section>
<section class="operations-row"><article class="card telemetry-card"><div class="section-head"><div><small>Conectividad</small><h2>Azure Bridge</h2></div><span class="status status-unknown" id="bridgeBadge">Comprobando</span></div><div class="telemetry-list"><div><span>API</span><strong>Producción</strong></div><div><span>Identidad</span><strong>Managed Identity</strong></div><div><span>Autorización</span><strong>Token + atribución</strong></div><div><span>Estado</span><strong id="bridgeSummary">—</strong></div></div></article><article class="card activity-card"><div class="section-head"><div><small>Auditoría central</small><h2>Actividad reciente</h2></div><button class="text-button" id="auditRefresh">Actualizar</button></div><div class="activity-list" id="activityList"><div class="activity-empty-compact"><span>◎</span><p>Inicia sesión para consultar la auditoría.</p></div></div></article></section>
</main>${toastMarkup()}${accessModalMarkup()}</div>`;

const $ = (id) => document.getElementById(id);
let latest = null;
let runtimeLatest = null;
let pendingAction = null;
let pending = false;
let nextPoll = Date.now() + APP_CONFIG.statusPollMs;
const history = [];

const labels = {
  running: ['Online','Servidor encendido','Azure informa que la VM está en ejecución.'],
  starting: ['Iniciando','Servidor iniciando','Azure está procesando el encendido.'],
  restarting: ['Reiniciando','Servidor reiniciando','Azure está reiniciando la VM.'],
  deallocated: ['Offline','Servidor apagado','La VM está desasignada y no consume cómputo.'],
  stopped: ['Detenido','Servidor detenido','La VM está detenida.'],
  stopping: ['Deteniendo','Servidor deteniéndose','Azure está deteniendo la VM.'],
  deallocating: ['Apagando','Servidor apagándose','Azure está desasignando la VM.'],
  unknown: ['Sin conexión','Estado no disponible','No fue posible determinar el estado.'],
};

const stateOf = (s) => String(s?.powerState || s?.vm || 'unknown').toLowerCase().replace('powerstate/','');
const transition = (s) => ['starting','restarting','stopping','deallocating'].includes(s);
const time = (v) => v ? new Intl.DateTimeFormat('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(v)) : '—';
const healthyContainer = (c) => c?.status === 'running' && !['unhealthy','starting'].includes(c?.health);

function needSession(action) {
  pendingAction = action;
  if (!getAccessToken() || !getStaffName()) { openAccessModal(); return true; }
  return false;
}
function human(error) {
  if (error.status === 401) return 'Código o sesión no válidos.';
  if (error.message === 'API_TIMEOUT') return 'La operación demoró demasiado.';
  return error.payload?.detail || error.payload?.message || 'Operación no disponible.';
}
function renderTrend(ok) {
  history.push(ok); if (history.length > 24) history.shift();
  $('availabilityTrend').innerHTML = history.map(v=>`<i class="${v?'up':'down'}"></i>`).join('');
}
function service(el, text, ok, pendingState=false) {
  el.textContent = text;
  el.className = `service-state ${ok ? 'state-running' : pendingState ? 'state-starting' : 'state-deallocated'}`;
}
function updateHealthScore() {
  const vm = stateOf(latest) === 'running';
  const bridgeOk = $('bridgeService').textContent === 'Online';
  const bot = healthyContainer(runtimeLatest?.bot);
  const dash = healthyContainer(runtimeLatest?.dashboard) && Boolean(runtimeLatest?.dashboardHttp?.reachable);
  $('healthScore').textContent = `${[vm,dash,bot,bridgeOk].filter(Boolean).length}/4`;
}
function renderVm(s) {
  latest = s;
  const st = stateOf(s), [badge,title,desc] = labels[st] || labels.unknown;
  const online = st === 'running';
  $('vmStatusBadge').textContent = badge; $('vmStatusBadge').className = `status status-${st}`;
  $('runtimeTitle').textContent = title; $('runtimeDescription').textContent = desc; $('runtimeIcon').dataset.state = st;
  $('region').textContent = s.region || 'North Central US'; $('vmName').textContent = s.vmName || 'kyodobot-server';
  $('heroCheckedAt').textContent = time(s.checkedAt); $('heroStateDot').className = online ? 'online' : transition(st) ? 'pending' : '';
  service($('vmService'), badge, online, transition(st));
  $('startButton').hidden = online; $('startButton').disabled = transition(st) || pending;
  $('restartButton').hidden = !online; $('restartButton').disabled = transition(st) || pending;
  $('stopButton').hidden = !online; $('stopButton').disabled = transition(st) || pending;
  $('dashboardLink').classList.toggle('disabled-link', !online || !runtimeLatest?.dashboardHttp?.reachable);
  renderTrend(online); updateHealthScore();
}
async function bridge() {
  const t = performance.now();
  try {
    const h = await fetchBridgeHealth(); const ms = Math.round(performance.now()-t);
    $('bridgeLatency').textContent = `${ms} ms`;
    $('bridgeLatency').dataset.quality = ms < 180 ? 'good' : ms < 500 ? 'warn' : 'bad';
    $('latencyQuality').textContent = ms < 180 ? 'Excelente' : ms < 500 ? 'Aceptable' : 'Alta';
    $('bridgeSummary').textContent = `v${h.version} · ${ms} ms`;
    $('bridgeBadge').textContent='Online'; $('bridgeBadge').className='status status-running';
    service($('bridgeService'),'Online',true); $('bridgeDot').className='online'; $('bridgeState').textContent='Azure Bridge conectado';
    updateHealthScore(); return true;
  } catch {
    $('bridgeBadge').textContent='Offline'; $('bridgeBadge').className='status status-deallocated';
    service($('bridgeService'),'Offline',false); $('bridgeDot').className=''; $('bridgeState').textContent='Azure Bridge sin conexión';
    updateHealthScore(); return false;
  }
}
function uptime(sec) {
  sec=Number(sec||0); const d=Math.floor(sec/86400), h=Math.floor(sec%86400/3600), m=Math.floor(sec%3600/60);
  return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
}
function resetRuntime(message='VM no disponible') {
  runtimeLatest = null;
  ['memoryMetric','diskMetric','loadMetric','uptimeMetric','gitMetric'].forEach(id=>$(id).textContent='—');
  $('memoryDetail').textContent=message; $('diskDetail').textContent=message; $('gitDetail').textContent=message;
  $('memoryMeter').value=0; $('diskMeter').value=0;
  service($('botService'),'No disponible',false); service($('dashboardService'),'No disponible',false);
  updateHealthScore();
}
async function runtime(quiet=false) {
  try {
    const r = await fetchRuntimeStatus(); runtimeLatest = r;
    if (!r.available) { resetRuntime(`VM ${r.powerState || 'apagada'}`); return; }
    $('memoryMetric').textContent=`${r.memoryPercent}%`; $('memoryMeter').value=r.memoryPercent;
    $('memoryDetail').textContent=`${r.memoryUsedMb} / ${r.memoryTotalMb} MB`;
    $('diskMetric').textContent=`${r.diskPercent}%`; $('diskMeter').value=r.diskPercent;
    $('diskDetail').textContent=`${r.diskUsedGb} / ${r.diskTotalGb} GB`;
    $('loadMetric').textContent=String(r.load1); $('uptimeMetric').textContent=uptime(r.uptimeSeconds);
    $('gitMetric').textContent=`${r.branch} · ${r.commit}`;
    $('gitDetail').textContent=r.dirty ? 'Cambios locales pendientes' : r.behind ? `${r.behind} commit(s) detrás` : 'Repositorio limpio';
    const botOk=healthyContainer(r.bot), dashContainer=healthyContainer(r.dashboard), dashHttp=Boolean(r.dashboardHttp?.reachable);
    service($('botService'), botOk ? (r.bot.health==='healthy'?'Healthy':'Contenedor online') : (r.bot?.status||'No disponible'), botOk);
    const dashText = dashContainer && dashHttp ? `Healthy · ${r.dashboardHttp.latencyMs} ms` : dashContainer ? 'HTTP no responde' : (r.dashboard?.status||'No disponible');
    service($('dashboardService'),dashText,dashContainer&&dashHttp);
    $('dashboardLink').classList.toggle('disabled-link', !(dashContainer&&dashHttp));
    updateHealthScore();
    if(!quiet) showToast('Telemetría actualizada','Recursos, Docker, Dashboard y Git consultados dentro de la VM.');
  } catch(e) {
    resetRuntime('Consulta fallida'); if(!quiet) showToast('Telemetría no disponible',human(e));
  }
}
async function audit() {
  if(!getAccessToken()) return;
  try {
    const data=await fetchAudit();
    $('activityList').innerHTML=data.items.length?data.items.map(i=>`<div class="activity-item"><span class="activity-mark ${i.ok?'success':'error'}"></span><div><strong>${i.staff} · ${i.action}</strong><small>${i.detail}</small></div><time>${time(i.at)}</time></div>`).join(''):'<div class="activity-empty-compact"><span>◎</span><p>No hay acciones registradas.</p></div>';
  } catch(e) { $('activityList').innerHTML=`<div class="activity-empty-compact"><span>!</span><p>${human(e)}</p></div>`; }
}
async function refresh(quiet=true) {
  $('refreshButton').disabled=true;
  try { renderVm(await getStatus()); await bridge(); }
  catch(e) { renderVm({powerState:'unknown',checkedAt:new Date().toISOString()}); if(!quiet)showToast('Consulta fallida',human(e)); }
  finally { $('refreshButton').disabled=false; nextPoll=Date.now()+APP_CONFIG.statusPollMs; }
}
async function fullRefresh(quiet=true) { await refresh(quiet); await runtime(true); }
async function operation(action) {
  const map={start:startVirtualMachine,restart:restartVirtualMachine,stop:stopVirtualMachine};
  if(needSession(action))return; if(action!=='start'&&!confirm(`¿Confirmas la operación ${action}?`))return;
  pending=true; renderVm(latest);
  try { const r=await map[action](); showToast('Operación aceptada',r.message||'Azure aceptó la solicitud.'); setTimeout(()=>fullRefresh(true),5000); await audit(); }
  catch(e) { if(e.status===401){setAccessToken('');openAccessModal()} showToast('Operación rechazada',human(e)); }
  finally { pending=false; renderVm(latest); }
}

$('startButton').onclick=()=>operation('start'); $('restartButton').onclick=()=>operation('restart'); $('stopButton').onclick=()=>operation('stop');
$('refreshButton').onclick=()=>fullRefresh(false); $('runtimeRefresh').onclick=()=>runtime(false); $('auditRefresh').onclick=()=>{if(needSession('audit'))return;audit()};
$('logsButton').onclick=async()=>{if(needSession('logs'))return;$('logsOutput').textContent='Consultando logs reales…';try{const r=await fetchRuntimeLogs();$('logsOutput').textContent=r.logs||'Sin salida';await audit()}catch(e){$('logsOutput').textContent=human(e)}};
$('updateButton').onclick=async()=>{if(needSession('update'))return;if(!confirm('Esto ejecutará /opt/kyodobot/update.sh y reiniciará servicios. ¿Continuar?'))return;$('updateButton').disabled=true;$('logsOutput').textContent='Actualizando KyodoBot…';try{const r=await updateRuntime();$('logsOutput').textContent=r.output||r.message;showToast('Actualización completada',r.message);await audit();setTimeout(()=>fullRefresh(true),5000)}catch(e){$('logsOutput').textContent=human(e);showToast('Actualización fallida',human(e))}finally{$('updateButton').disabled=false}};
$('closeAccessModal').onclick=closeAccessModal; $('cancelAccess').onclick=closeAccessModal;
$('confirmAccess').onclick=()=>{const name=$('staffName').value.trim(),token=$('accessToken').value.trim();if(!name||!token)return showToast('Datos requeridos','Ingresa nombre y código.');setStaffName(name);setAccessToken(token);$('staffSession').textContent=name;$('staffSession').className='status status-running';closeAccessModal();const action=pendingAction;pendingAction=null;if(['start','restart','stop'].includes(action))operation(action);else if(action==='logs')$('logsButton').click();else if(action==='update')$('updateButton').click();else if(action==='audit')audit()};
$('staffName').value=getStaffName(); if(getStaffName()){$('staffSession').textContent=getStaffName();$('staffSession').className='status status-running'}
setInterval(()=>{$('pollCountdown').textContent=`${Math.max(0,Math.ceil((nextPoll-Date.now())/1000))}s`},1000);
await fullRefresh(true); if(getAccessToken()) await audit();
setInterval(()=>refresh(true),APP_CONFIG.statusPollMs);
setInterval(()=>runtime(true),APP_CONFIG.runtimePollMs || 60000);
