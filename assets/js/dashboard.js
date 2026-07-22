import {sidebar} from '../../components/sidebar.js';
import {topbar} from '../../components/topbar.js';
import {toastMarkup,showToast} from '../../components/toast.js';
import {getStatus} from '../../services/status.js';
import {APP_CONFIG} from '../../config/app.js';

const shell=document.getElementById('appShell');
shell.innerHTML=`<div class="app-layout">${sidebar()}<main class="content">${topbar()}
<section class="dashboard-grid" id="overview">
  <article class="card panel">
    <div class="panel-head"><div><small>Servidor principal</small><h2>Juliette Runtime</h2></div><span class="status status-offline">Offline</span></div>
    <div class="runtime-state"><span class="icon"><i></i><i></i><i></i></span><div><small>Estado actual</small><h3>Servidor apagado</h3><p>La conexión real con Azure se incorporará en el siguiente bloque.</p></div></div>
    <div class="metric-grid"><div class="metric"><span>Región</span><strong id="region">—</strong></div><div class="metric"><span>Máquina virtual</span><strong id="vmName">—</strong></div><div class="metric"><span>Versión</span><strong>${APP_CONFIG.version}</strong></div></div>
    <div class="action-row"><button class="button button-primary" id="startButton">Encender servidor</button><button class="button button-ghost" id="refreshButton">Actualizar estado</button></div>
  </article>
  <div class="stack">
    <article class="card panel"><div class="panel-head"><div><small>Servicios</small><h2>Disponibilidad</h2></div></div><div class="service-list">
      <div class="service"><b>VM</b><span><strong>Azure VM</strong><small>Infraestructura principal</small></span><em>Offline</em></div>
      <div class="service"><b>DB</b><span><strong>Dashboard</strong><small>Panel administrativo</small></span><em>No disponible</em></div>
      <div class="service"><b>BT</b><span><strong>Juliette Bot</strong><small>Conexión con Kyodo</small></span><em>No disponible</em></div>
    </div></article>
    <article class="card panel"><div class="panel-head"><div><small>Acceso rápido</small><h2>Herramientas</h2></div></div><div class="action-row"><a class="button button-ghost" href="${APP_CONFIG.dashboardUrl}" target="_blank" rel="noopener">Dashboard</a><a class="button button-ghost" href="https://github.com/jgrupo60-cmd/juliette-control" target="_blank" rel="noopener">GitHub</a></div></article>
  </div>
</section>
<section class="card activity-panel" id="activity"><div class="panel-head"><div><small>Actividad</small><h2>Registro reciente</h2></div><span class="status status-pending">Próximamente</span></div><div class="activity-empty"><span>◎</span><div><h3>Aún no hay acciones registradas</h3><p>Las acciones del staff aparecerán aquí cuando conectemos la API.</p></div></div></section>
</main>${toastMarkup()}</div>`;

const status=await getStatus();
document.getElementById('region').textContent=status.region;
document.getElementById('vmName').textContent=status.vmName;
document.getElementById('startButton').addEventListener('click',()=>showToast('Modo demostración','El botón quedó preparado para la API de Azure del PR-003.'));
document.getElementById('refreshButton').addEventListener('click',()=>showToast('Estado actualizado','Se cargaron los datos locales de demostración.'));
document.getElementById('menuButton').addEventListener('click',()=>document.getElementById('sidebar').classList.toggle('open'));
