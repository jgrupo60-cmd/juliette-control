import { login, setSession, hasLocalSession, verifySession, clearStaffSession } from '../../services/api.js';

const form=document.getElementById('loginForm');
const button=document.getElementById('loginButton');
const errorBox=document.getElementById('loginError');

async function existingSession(){
  if(!hasLocalSession()) return;
  try{ await verifySession(); window.location.replace('dashboard.html'); }
  catch{ clearStaffSession(); }
}
await existingSession();

form.addEventListener('submit',async(event)=>{
  event.preventDefault(); errorBox.hidden=true; button.disabled=true; button.textContent='Verificando…';
  try{
    const result=await login(document.getElementById('staffName').value.trim(),document.getElementById('password').value);
    setSession(result); window.location.replace('dashboard.html');
  }catch(error){
    errorBox.textContent=error.status===401?'Contraseña incorrecta.':'No fue posible conectar con Azure Bridge.'; errorBox.hidden=false;
  }finally{button.disabled=false;button.textContent='Iniciar sesión'}
});
