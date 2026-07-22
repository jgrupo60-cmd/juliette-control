export function sidebar(){return `
<aside class="sidebar" id="sidebar">
  <a class="brand" href="index.html"><span class="brand-mark">J</span><span><strong>Juliette</strong><small>Mission Control</small></span></a>
  <nav class="sidebar-nav">
    <a class="nav-link active" href="#overview"><i>OV</i>Resumen</a>
    <a class="nav-link" href="#services"><i>SV</i>Servicios</a>
    <a class="nav-link" href="#operations"><i>OP</i>Operaciones</a>
    <a class="nav-link" href="#activity"><i>AC</i>Actividad</a>
  </nav>
  <div class="sidebar-system">
    <span class="system-light" id="sidebarBridgeLight"></span>
    <div><strong id="sidebarBridgeText">Azure Bridge</strong><small id="sidebarBridgeDetail">Comprobando conexión</small></div>
  </div>
  <div class="sidebar-footer"><strong>Mission Control</strong><small>PR-009 · v0.9.0</small></div>
</aside>`}
