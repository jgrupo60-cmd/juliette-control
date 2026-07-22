export function accessModalMarkup() {
  return `<div class="modal-backdrop" id="accessModal" hidden>
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="accessModalTitle">
      <button class="modal-close" id="closeAccessModal" type="button" aria-label="Cerrar">×</button>
      <p class="modal-kicker">Acción protegida</p>
      <h2 id="accessModalTitle">Código del staff</h2>
      <p>Ingresa el código temporal del Control Center. Se conserva únicamente durante esta pestaña.</p>
      <label for="accessToken">Código de acceso</label>
      <input id="accessToken" type="password" autocomplete="current-password" placeholder="••••••••••••">
      <div class="modal-actions">
        <button class="button button-ghost" id="cancelAccess" type="button">Cancelar</button>
        <button class="button button-primary" id="confirmAccess" type="button">Continuar</button>
      </div>
      <small>PR-004 reemplazará este código compartido por inicio de sesión individual.</small>
    </section>
  </div>`;
}

export function openAccessModal() {
  const modal = document.getElementById('accessModal');
  modal.hidden = false;
  document.getElementById('accessToken').focus();
}

export function closeAccessModal() {
  const modal = document.getElementById('accessModal');
  modal.hidden = true;
}
