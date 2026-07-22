import { sidebar } from '../../components/sidebar.js';
import { topbar } from '../../components/topbar.js';
import { toastMarkup, showToast } from '../../components/toast.js';
import { accessModalMarkup, openAccessModal, closeAccessModal } from '../../components/access-modal.js';
import { getStatus } from '../../services/status.js';
import { startVirtualMachine, stopVirtualMachine, restartVirtualMachine, fetchBridgeHealth } from '../../services/azure.js';
import { getAccessToken, setAccessToken, isApiConfigured } from '../../services/api.js';
import { APP_CONFIG } from '../../config/app.js';

const shell = document.getElementById('appShell');
shell.innerHTML = `<div class="app-layout">${sidebar()}<main class="content">${topbar()}
<section class="mission-hero" id="overview">
  <div><p class="eyebrow">Infraestructura en vivo</p><h1>Mission Control</h1><p>Supervisa y controla la infraestructura principal de Juliette desde un solo lugar.</p></div>
  <div class="hero-sync"><span id="heroStateDot"></span><div><small>Última sincronización</small><strong id="heroCheckedAt">—</strong></div><button class="icon-button" id="refreshButton" aria-label="Actualizar estado">↻</button></div>
</section>

<section class="mission-grid">
  <article class="card command-card">
    <div class="command-head"><div><small>Servidor principal</small><h2>Juliette Runtime</h2></div><span class="status status-unknown" id="vmStatusBadge">Consultando</span></div>
    <div class="command-state"><span class="server-orb" id="runtimeIcon" data-state="unknown"><i></i><i></i><i></i></span><div><small>Estado actual</small><h3 id="runtimeTitle">Consultando Azure…</h3><p id="runtimeDescription">Obteniendo el estado real de la máquina virtual.</p></div></div>
    <div class="command-metrics"><div><span>Región</span><strong id="region">—</strong></div><div><span>Máquina virtual</span><strong id="vmName">—</strong></div><div><span>Versión</span><strong>v${APP_CONFIG.version}</strong></div></div>
    <div class="command-actions" id="operations">
      <button class="button button-primary" id="startButton">Encender</button>
      <button class="button button-ghost" id="restartButton">Reiniciar</button>
      <button class="button button-danger" id="stopButton">Apagar</button>
    </div>
    <div class="live-strip"><span><i id="bridgeDot"></i><b id="bridgeState">Azure Bridge</b></span><span>Próxima consulta en <b id="pollCountdown">—</b></span></div>
  </article>

  <article class="card service-board" id="services">
    <div class="section-head"><div><small>Estado del sistema</small><h2>Servicios</h2></div><span class="health-score" id="healthScore">0/4</span></div>
    <div class="service-tile"><span class="service-icon">AZ</span><div><strong>Azure VM</strong><small>Compute · North Central US</small></div><em id="vmService">—</em></div>
    <div class="service-tile"><span class="service-icon">DB</span><div><strong>Dashboard</strong><small>Puerto 5000 · Panel administrativo</small></div><em id="dashboardService">—</em></div>
    <div class="service-tile"><span class="service-icon">BT</span><div><strong>Juliette Bot</strong><small>Telemetría interna pendiente</small></div><em id="botService">—</em></div>
    <div class="service-tile"><span class="service-icon">BR</span><div><strong>Azure Bridge</strong><small>Functions · Managed Identity</small></div><em id="bridgeService">—</em></div>
    <div class="quick-links"><a class="button button-ghost disabled-link" id="dashboardLink" href="${APP_CONFIG.dashboardUrl}" target="_blank" rel="noopener" aria-disabled="true">Abrir Dashboard</a><a class="button button-ghost" href="https://portal.azure.com" target="_blank" rel="noopener">Azure Portal</a></div>
  </article>
</section>

<section class="operations-row">
  <article class="card telemetry-card"><div class="section-head"><div><small>Conectividad</small><h2>Azure Bridge</h2></div><span class="status status-unknown" id="bridgeBadge">Comprobando</span></div><div class="telemetry-list"><div><span>API</span><strong id="apiEndpoint">Producción</strong></div><div><span>Identidad</span><strong>Managed Identity</strong></div><div><span>Autorización</span><strong>Token temporal</strong></div><div><span>Latencia</span><strong id="bridgeLatency">—</strong></div></div></article>
  <article class="card activity-card" id="activity"><div class="section-head"><div><small>Registro local</small><h2>Actividad reciente</h2></div><button class="text-button" id="clearActivity">Limpiar</button></div><div class="activity-list" id="activityList"></div></article>
</section>
</main>${toastMarkup()}${accessModalMarkup()}</div>`;

const $ = (id) => document.getElementById(id);
const els = {
  badge:$('vmStatusBadge'), title:$('runtimeTitle'), description:$('runtimeDescription'), icon:$('runtimeIcon'),
  region:$('region'), vmName:$('vmName'), vmService:$('vmService'), dashboardService:$('dashboardService'), botService:$('botService'),
  bridgeService:$('bridgeService'), start:$('startButton'), restart:$('restartButton'), stop:$('stopButton'), refresh:$('refreshButton'),
  dashboardLink:$('dashboardLink'), token:$('accessToken'), bridgeDot:$('bridgeDot'), bridgeState:$('bridgeState'), pollCountdown:$('pollCountdown'),
  heroCheckedAt:$('heroCheckedAt'), heroStateDot:$('heroStateDot'), healthScore:$('healthScore'), bridgeBadge:$('bridgeBadge'), bridgeLatency:$('bridgeLatency'),
  sidebarBridgeLight:$('sidebarBridgeLight'), sidebarBridgeText:$('sidebarBridgeText'), sidebarBridgeDetail:$('sidebarBridgeDetail'), activityList:$('activityList')
};

let latestStatus = null;
let pendingOperation = false;
let pendingAction = null;
let nextPollAt = Date.now() + APP_CONFIG.statusPollMs;
let transitionTimer = null;
const ACTIVITY_KEY = 'juliette_mission_activity';

const labels = {
  running:['Online','Servidor encendido','Azure informa que la máquina virtual está en ejecución.'],
  starting:['Iniciando','Servidor iniciando','Azure aceptó la solicitud. Seguiremos comprobando el progreso.'],
  restarting:['Reiniciando','Servidor reiniciando','Azure está reiniciando la máquina virtual.'],
  deallocated:['Offline','Servidor apagado','La máquina virtual está desasignada y lista para iniciarse.'],
  stopped:['Detenido','Servidor detenido','La máquina está detenida, pero podría seguir asignando recursos.'],
  stopping:['Deteniendo','Servidor deteniéndose','Azure está procesando la detención.'],
  deallocating:['Apagando','Servidor apagándose','Azure está desasignando la máquina virtual.'],
  unknown:['Sin conexión','Estado no disponible','No fue posible determinar el estado actual.']
};

function normalizeState(status){return String(status?.powerState||status?.vm||'unknown').toLowerCase().replace('powerstate/','')}
function isTransition(state){return ['starting','restarting','stopping','deallocating'].includes(state)}
function formatTime(value){if(!value)return 'Sin datos';return new Intl.DateTimeFormat('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value))}
function activityItems(){try{return JSON.parse(localStorage.getItem(ACTIVITY_KEY)||'[]')}catch{return []}}
function saveActivity(action,detail,tone='neutral'){
  const items=[{id:crypto.randomUUID?.()||String(Date.now()),action,detail,tone,at:new Date().toISOString()},...activityItems()].slice(0,8);
  localStorage.setItem(ACTIVITY_KEY,JSON.stringify(items));renderActivity();
}
function renderActivity(){
  const items=activityItems();
  els.activityList.innerHTML=items.length?items.map(item=>`<div class="activity-item"><span class="activity-mark ${item.tone}"></span><div><strong>${item.action}</strong><small>${item.detail}</small></div><time>${formatTime(item.at)}</time></div>`).join(''):`<div class="activity-empty-compact"><span>◎</span><p>Las operaciones realizadas desde este navegador aparecerán aquí.</p></div>`;
}

function setBridgeVisual(online, detail='Operativo'){
  els.bridgeDot.className=online?'online':''; els.bridgeState.textContent=online?'Azure Bridge conectado':'Azure Bridge sin conexión';
  els.bridgeService.textContent=online?'Online':'Offline'; els.bridgeService.className=`service-state ${online?'state-running':'state-deallocated'}`;
  els.bridgeBadge.textContent=online?'Online':'Offline'; els.bridgeBadge.className=`status ${online?'status-running':'status-deallocated'}`;
  els.sidebarBridgeLight.className=`system-light ${online?'online':''}`; els.sidebarBridgeText.textContent=online?'Azure Bridge online':'Azure Bridge offline'; els.sidebarBridgeDetail.textContent=detail;
}

function renderStatus(status){
  latestStatus=status; const state=normalizeState(status); const [badge,title,description]=labels[state]||labels.unknown; const online=state==='running'; const transition=isTransition(state);
  els.badge.textContent=badge; els.badge.className=`status status-${state}`; els.title.textContent=title; els.description.textContent=description; els.icon.dataset.state=state;
  els.region.textContent=status.region||'North Central US'; els.vmName.textContent=status.vmName||'kyodobot-server'; els.heroCheckedAt.textContent=formatTime(status.checkedAt); els.heroStateDot.className=online?'online':transition?'pending':'';
  els.vmService.textContent=badge; els.vmService.className=`service-state state-${state}`;
  els.dashboardService.textContent=online?'Disponible':'Sin conexión'; els.dashboardService.className=`service-state ${online?'state-running':'state-deallocated'}`;
  els.botService.textContent=online?'No verificado':'Sin conexión'; els.botService.className=`service-state ${online?'state-unknown':'state-deallocated'}`;
  els.start.disabled=online||transition||pendingOperation; els.restart.disabled=!online||transition||pendingOperation; els.stop.disabled=!online||transition||pendingOperation;
  els.start.textContent=state==='starting'?'Iniciando…':'Encender'; els.restart.textContent=state==='restarting'?'Reiniciando…':'Reiniciar'; els.stop.textContent=['stopping','deallocating'].includes(state)?'Apagando…':'Apagar';
  els.dashboardLink.classList.toggle('disabled-link',!online); els.dashboardLink.setAttribute('aria-disabled',String(!online));
  setBridgeVisual(Boolean(status.apiConfigured),'Functions · Managed Identity');
  const healthy=(online?2:0)+(status.apiConfigured?1:0); els.healthScore.textContent=`${healthy}/4`;
  scheduleTransitionPolling(state);
}

function scheduleTransitionPolling(state){if(transitionTimer)clearTimeout(transitionTimer);transitionTimer=null;if(!isTransition(state))return;transitionTimer=setTimeout(()=>refreshStatus({quiet:true}),APP_CONFIG.transitionPollMs||5000)}
function humanizeError(error){if(error.message==='API_NOT_CONFIGURED')return'Falta configurar la URL HTTPS de Azure Functions.';if(error.message==='API_TIMEOUT')return'Azure Bridge demoró demasiado en responder.';if(error.message==='API_UNREACHABLE')return'No fue posible conectar con Azure Bridge.';if(error.status===401)return'El código temporal del staff no es válido.';if(error.status===403)return'La Function no tiene permisos sobre la VM.';return error.payload?.detail||error.payload?.message||'Revisa Azure Functions y vuelve a intentarlo.'}

async function refreshBridgeHealth(){
  const started=performance.now();
  try{const health=await fetchBridgeHealth();const latency=Math.round(performance.now()-started);els.bridgeLatency.textContent=`${latency} ms`;setBridgeVisual(Boolean(health.ok),`v${health.version} · ${latency} ms`)}catch{els.bridgeLatency.textContent='Sin respuesta';setBridgeVisual(false,'No responde')}
}
async function refreshStatus({quiet=false}={}){
  els.refresh.disabled=true;els.refresh.classList.add('is-loading');
  try{const status=await getStatus();renderStatus(status);await refreshBridgeHealth();if(!quiet)showToast('Estado actualizado','Datos obtenidos directamente desde Azure.');}
  catch(error){renderStatus({...(latestStatus||{}),powerState:'unknown',checkedAt:new Date().toISOString(),apiConfigured:isApiConfigured()});setBridgeVisual(false,'Error de conexión');if(!quiet)showToast('No fue posible consultar Azure',humanizeError(error));}
  finally{els.refresh.disabled=false;els.refresh.classList.remove('is-loading');nextPollAt=Date.now()+APP_CONFIG.statusPollMs;}
}

async function executeOperation(action){
  const operations={start:{call:startVirtualMachine,title:'Encendido solicitado',state:'starting',activity:'Encender servidor'},restart:{call:restartVirtualMachine,title:'Reinicio solicitado',state:'restarting',activity:'Reiniciar servidor'},stop:{call:stopVirtualMachine,title:'Apagado solicitado',state:'deallocating',activity:'Apagar servidor'}};
  const op=operations[action]; pendingOperation=true; document.querySelectorAll('.command-actions button').forEach(b=>b.disabled=true);
  try{const result=await op.call();showToast(op.title,result.message||'Azure aceptó la operación.');saveActivity(op.activity,result.message||'Operación aceptada por Azure','success');renderStatus({...(latestStatus||{}),powerState:result.powerState||op.state,checkedAt:new Date().toISOString(),apiConfigured:true});setTimeout(()=>refreshStatus({quiet:true}),APP_CONFIG.transitionPollMs||5000);}
  catch(error){if(error.status===401){setAccessToken('');pendingAction=action;openAccessModal();}showToast('Operación rechazada',humanizeError(error));saveActivity(`Error: ${op.activity}`,humanizeError(error),'error');}
  finally{pendingOperation=false;if(latestStatus)renderStatus(latestStatus);}
}
function requestOperation(action){if(!isApiConfigured())return showToast('Azure Bridge sin configurar','Revisa config/app.js.');if(!getAccessToken()){pendingAction=action;return openAccessModal();}const copy={start:'encender',restart:'reiniciar',stop:'apagar'}[action];if(action!=='start'&&!window.confirm(`¿Confirmas que deseas ${copy} kyodobot-server?`))return;executeOperation(action)}

els.start.addEventListener('click',()=>requestOperation('start'));els.restart.addEventListener('click',()=>requestOperation('restart'));els.stop.addEventListener('click',()=>requestOperation('stop'));els.refresh.addEventListener('click',()=>refreshStatus());
$('menuButton').addEventListener('click',()=>$('sidebar').classList.toggle('open'));$('closeAccessModal').addEventListener('click',closeAccessModal);$('cancelAccess').addEventListener('click',closeAccessModal);
$('confirmAccess').addEventListener('click',()=>{if(!els.token.value.trim())return showToast('Código requerido','Ingresa el código temporal entregado al staff.');setAccessToken(els.token.value);els.token.value='';closeAccessModal();const action=pendingAction||'start';pendingAction=null;requestOperation(action)});
els.token.addEventListener('keydown',event=>{if(event.key==='Enter')$('confirmAccess').click()});$('accessModal').addEventListener('click',event=>{if(event.target.id==='accessModal')closeAccessModal()});
els.dashboardLink.addEventListener('click',event=>{if(els.dashboardLink.getAttribute('aria-disabled')==='true')event.preventDefault()});$('clearActivity').addEventListener('click',()=>{localStorage.removeItem(ACTIVITY_KEY);renderActivity();});
window.setInterval(()=>{const remaining=Math.max(0,Math.ceil((nextPollAt-Date.now())/1000));els.pollCountdown.textContent=`${remaining}s`},1000);
renderActivity();await refreshStatus({quiet:true});window.setInterval(()=>refreshStatus({quiet:true}),APP_CONFIG.statusPollMs);
