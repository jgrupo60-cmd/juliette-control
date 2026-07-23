import { APP_CONFIG } from '../config/app.js';

const SESSION_TOKEN_KEY = 'juliette_control_session_token';
const STAFF_NAME_KEY = 'juliette_control_staff_name';
const SESSION_EXPIRY_KEY = 'juliette_control_session_expiry';

export function isApiConfigured() { return Boolean(APP_CONFIG.apiBaseUrl?.startsWith('https://')); }
export function getAccessToken() { return sessionStorage.getItem(SESSION_TOKEN_KEY) || ''; }
export function getStaffName() { return sessionStorage.getItem(STAFF_NAME_KEY) || ''; }
export function getSessionExpiry() { return sessionStorage.getItem(SESSION_EXPIRY_KEY) || ''; }
export function setSession({token,staff,expiresAt}) {
  sessionStorage.setItem(SESSION_TOKEN_KEY,String(token||''));
  sessionStorage.setItem(STAFF_NAME_KEY,String(staff||'Staff').slice(0,40));
  sessionStorage.setItem(SESSION_EXPIRY_KEY,String(expiresAt||''));
}
export function clearStaffSession(){
  sessionStorage.removeItem(SESSION_TOKEN_KEY);
  sessionStorage.removeItem(STAFF_NAME_KEY);
  sessionStorage.removeItem(SESSION_EXPIRY_KEY);
}
export function hasLocalSession(){
  const expiry=Date.parse(getSessionExpiry());
  return Boolean(getAccessToken() && expiry && expiry>Date.now());
}

export async function apiRequest(path, options = {}) {
  if (!isApiConfigured()) throw new Error('API_NOT_CONFIGURED');
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token=getAccessToken();
  if(token) headers.set('Authorization',`Bearer ${token}`);
  const controller=new AbortController();
  const timeout=window.setTimeout(()=>controller.abort(),options.timeoutMs||APP_CONFIG.apiTimeoutMs||70000);
  try{
    const response=await fetch(`${APP_CONFIG.apiBaseUrl}${path}`,{...options,headers,signal:controller.signal,cache:'no-store',mode:'cors'});
    let payload={}; try{payload=await response.json()}catch{}
    if(!response.ok){const error=new Error(payload.error||`API_${response.status}`);error.status=response.status;error.payload=payload;throw error}
    return payload;
  }catch(error){if(error.name==='AbortError')throw new Error('API_TIMEOUT');if(error instanceof TypeError)throw new Error('API_UNREACHABLE');throw error}finally{clearTimeout(timeout)}
}

export async function login(username,password){
  return apiRequest('/api/auth/login',{method:'POST',body:JSON.stringify({username,password}),timeoutMs:15000});
}
export async function verifySession(){ return apiRequest('/api/auth/session',{method:'GET',timeoutMs:15000}); }
