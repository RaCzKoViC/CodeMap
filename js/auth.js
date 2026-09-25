/* ===================== auth.js — konto użytkownika (rejestracja, logowanie, weryfikacja e-mail) ===================== */
CM.Auth = (function(){
  const U=CM.util, $=U.$, el=U.el, I=CM.i18n;

  // ---------------- strings (PL / EN) ----------------
  const STR={
  pl:{
    'title.login':'Logowanie','title.register':'Rejestracja','title.reset':'Reset hasła','title.newpass':'Nowe hasło',
    'email':'E-mail','password':'Hasło','password2':'Powtórz hasło',
    'login':'Zaloguj się','register':'Utwórz konto','logout':'Wyloguj',
    'noAccount':'Nie masz konta? Zarejestruj się','haveAccount':'Masz już konto? Zaloguj się','forgot':'Nie pamiętasz hasła?',
    'registered':'Konto utworzone. Sprawdź skrzynkę e-mail i kliknij link weryfikacyjny (ważny 24 h).',
    'resendHint':'Mail nie dotarł? Sprawdź spam lub wyślij ponownie.','resend':'Wyślij ponownie',
    'resent':'Wysłano ponownie (jeśli konto czeka na weryfikację).',
    'resetSent':'Jeśli konto istnieje, wysłaliśmy link do resetu hasła (ważny 30 min).',
    'resetGo':'Wyślij link resetujący','resetDo':'Ustaw nowe hasło',
    'resetDone':'Hasło zmienione. Zaloguj się nowym hasłem.',
    'verifiedOk':'E-mail potwierdzony ✅ Możesz się zalogować.','verifiedFail':'Link weryfikacyjny jest nieprawidłowy lub wygasł.',
    'errCredentials':'Nieprawidłowy e-mail lub hasło.','errUnverified':'Konto nie jest jeszcze zweryfikowane — sprawdź skrzynkę e-mail.',
    'errEmail':'Podaj prawidłowy adres e-mail.','errPassword':'Hasło musi mieć co najmniej 10 znaków.',
    'errPassMismatch':'Hasła nie są takie same.','errToken':'Link jest nieprawidłowy lub wygasł.',
    'errRate':'Zbyt wiele prób — odczekaj chwilę.','errNet':'Brak połączenia z serwerem.',
    'loggedIn':'Zalogowano: ','loggedOut':'Wylogowano.',
    'acct.loggedOutDesc':'Zaloguj się, aby synchronizować mapy, migawki, ustawienia i Sejf między urządzeniami.',
    'acct.usage':'Wykorzystane miejsce','acct.since':'Konto od: ',
    'acct.changePass':'Zmień hasło','acct.curPass':'Obecne hasło','acct.newPass':'Nowe hasło',
    'acct.passChanged':'Hasło zmienione. Pozostałe sesje zostały wylogowane.',
    'acct.syncAuto':'Automatyczna synchronizacja','acct.syncNow':'Synchronizuj teraz',
    'acct.delete':'Usuń konto','acct.deleteConfirm':'Usunąć konto i WSZYSTKIE dane na serwerze? Tej operacji nie można cofnąć. Wpisz hasło, aby potwierdzić.',
    'acct.deleted':'Konto usunięte.',
    'btn.title':'Konto',
  },
  en:{
    'title.login':'Log in','title.register':'Sign up','title.reset':'Password reset','title.newpass':'New password',
    'email':'E-mail','password':'Password','password2':'Repeat password',
    'login':'Log in','register':'Create account','logout':'Log out',
    'noAccount':'No account? Sign up','haveAccount':'Already have an account? Log in','forgot':'Forgot password?',
    'registered':'Account created. Check your inbox and click the verification link (valid 24 h).',
    'resendHint':'No mail? Check spam or resend.','resend':'Resend',
    'resent':'Sent again (if the account awaits verification).',
    'resetSent':'If the account exists, we sent a reset link (valid 30 min).',
    'resetGo':'Send reset link','resetDo':'Set new password',
    'resetDone':'Password changed. Log in with the new password.',
    'verifiedOk':'E-mail confirmed ✅ You can log in now.','verifiedFail':'The verification link is invalid or expired.',
    'errCredentials':'Invalid e-mail or password.','errUnverified':'Account not verified yet — check your inbox.',
    'errEmail':'Enter a valid e-mail address.','errPassword':'Password must be at least 10 characters.',
    'errPassMismatch':'Passwords do not match.','errToken':'The link is invalid or expired.',
    'errRate':'Too many attempts — wait a moment.','errNet':'No connection to the server.',
    'loggedIn':'Logged in: ','loggedOut':'Logged out.',
    'acct.loggedOutDesc':'Log in to sync maps, snapshots, settings and the Vault across devices.',
    'acct.usage':'Storage used','acct.since':'Member since: ',
    'acct.changePass':'Change password','acct.curPass':'Current password','acct.newPass':'New password',
    'acct.passChanged':'Password changed. Other sessions were logged out.',
    'acct.syncAuto':'Automatic sync','acct.syncNow':'Sync now',
    'acct.delete':'Delete account','acct.deleteConfirm':'Delete the account and ALL server data? This cannot be undone. Enter your password to confirm.',
    'acct.deleted':'Account deleted.',
    'btn.title':'Account',
  }};
  function t(k){ const d=STR[I.getLang()]||STR.pl; return (k in d)?d[k]:(STR.pl[k]||k); }

  // ---------------- API ----------------
  let user=null;            // {email, quotaBytes, usedBytes, createdAt} lub null
  const isLoggedIn=()=>!!user;

  async function api(path, {method='GET', json, body, headers={}}={}){
    const opt={method, headers:{...headers}, credentials:'same-origin'};
    if(json!==undefined){ opt.headers['Content-Type']='application/json'; opt.body=JSON.stringify(json); }
    else if(body!==undefined){ opt.body=body; }
    let res;
    try{ res=await fetch(path, opt); }
    catch(e){ const err=new Error('net'); err.code='net'; throw err; }
    if(res.status===401 && user){ setUser(null); }
    if(!res.ok){
      let data=null; try{ data=await res.json(); }catch(e){}
      const err=new Error(data?.error||('http'+res.status));
      err.code=data?.error||''; err.status=res.status; err.data=data;
      throw err;
    }
    const ct=res.headers.get('content-type')||'';
    return ct.includes('application/json') ? res.json() : res;
  }

  function setUser(u){
    const changed=(user?.email||null)!==(u?.email||null);   // odświeżenie quoty nie jest zmianą stanu
    user=u;
    const b=$('#btn-account'); if(b) b.classList.toggle('logged-in', !!u);
    if(changed){ try{ document.dispatchEvent(new CustomEvent('cm-auth-change',{detail:{user:u}})); }catch(e){} }
  }

  function errMsg(e){
    if(e.code==='net') return t('errNet');
    if(e.status===429) return t('errRate');
    if(e.code==='credentials') return t('errCredentials');
    if(e.code==='unverified') return t('errUnverified');
    if(e.code==='email') return t('errEmail');
    if(e.code==='password') return t('errPassword');
    if(e.code==='token') return t('errToken');
    return e.message||'?';
  }

  // ---------------- modal (logowanie / rejestracja / reset) ----------------
  function modal(){ return $('#modal-auth'); }
  function open(view){ renderView(view || (user?'account':'login')); modal().classList.remove('hidden'); }
  function close(){ modal().classList.add('hidden'); }

  function field(labelKey, type, id, ph){
    return el('div',{class:'auth-field'},
      el('label',{class:'field-label','for':id,text:t(labelKey)}),
      el('input',{type, id, placeholder:ph||'', autocomplete: type==='password'?'current-password':'email'}));
  }
  function formErr(box, msg){ const e=box.querySelector('.auth-err'); e.textContent=msg||''; e.classList.toggle('hidden',!msg); }
  function busy(btn, on){ btn.disabled=on; btn.classList.toggle('busy',on); }

  function renderView(view, extra){
    const body=$('#auth-body'), head=$('#auth-title');
    if(!body) return;
    body.innerHTML='';
    const box=el('div',{class:'auth-box'});
    box.appendChild(el('div',{class:'auth-err hidden'}));

    if(view==='register'){
      head.textContent=t('title.register');
      box.appendChild(field('email','email','auth-email'));
      box.appendChild(field('password','password','auth-pass'));
      const p2=field('password2','password','auth-pass2'); box.appendChild(p2);
      const go=el('button',{class:'tb-btn primary auth-main',text:t('register')});
      go.onclick=async ()=>{
        const email=$('#auth-email').value.trim(), pass=$('#auth-pass').value;
        if(pass.length<10) return formErr(box,t('errPassword'));
        if(pass!==$('#auth-pass2').value) return formErr(box,t('errPassMismatch'));
        busy(go,true);
        try{ await api('/api/auth/register',{method:'POST',json:{email,password:pass,lang:I.getLang()}}); renderView('registered',{email}); }
        catch(e){ formErr(box,errMsg(e)); }
        finally{ busy(go,false); }
      };
      box.appendChild(go);
      box.appendChild(el('button',{class:'auth-link',text:t('haveAccount'),onclick:()=>renderView('login')}));
    }
    else if(view==='registered'){
      head.textContent=t('title.register');
      box.appendChild(el('p',{class:'auth-info',text:t('registered')}));
      box.appendChild(el('p',{class:'muted small',text:t('resendHint')}));
      const re=el('button',{class:'tb-btn',text:t('resend')});
      re.onclick=async ()=>{ busy(re,true);
        try{ await api('/api/auth/resend-verification',{method:'POST',json:{email:extra?.email||''}}); U.toast(t('resent')); }
        catch(e){ formErr(box,errMsg(e)); }
        finally{ busy(re,false); } };
      box.appendChild(re);
      box.appendChild(el('button',{class:'auth-link',text:t('haveAccount'),onclick:()=>renderView('login')}));
    }
    else if(view==='reset-request'){
      head.textContent=t('title.reset');
      box.appendChild(field('email','email','auth-email'));
      const go=el('button',{class:'tb-btn primary auth-main',text:t('resetGo')});
      go.onclick=async ()=>{ busy(go,true);
        try{ await api('/api/auth/request-reset',{method:'POST',json:{email:$('#auth-email').value.trim()}}); U.toast(t('resetSent')); close(); }
        catch(e){ formErr(box,errMsg(e)); }
        finally{ busy(go,false); } };
      box.appendChild(go);
      box.appendChild(el('button',{class:'auth-link',text:t('haveAccount'),onclick:()=>renderView('login')}));
    }
    else if(view==='reset-confirm'){
      head.textContent=t('title.newpass');
      box.appendChild(field('acct.newPass','password','auth-pass'));
      const p2=field('password2','password','auth-pass2'); box.appendChild(p2);
      const go=el('button',{class:'tb-btn primary auth-main',text:t('resetDo')});
      go.onclick=async ()=>{
        const pass=$('#auth-pass').value;
        if(pass.length<10) return formErr(box,t('errPassword'));
        if(pass!==$('#auth-pass2').value) return formErr(box,t('errPassMismatch'));
        busy(go,true);
        try{ await api('/api/auth/reset',{method:'POST',json:{token:extra?.token||'',password:pass}}); U.toast(t('resetDone'),'success'); renderView('login'); }
        catch(e){ formErr(box,errMsg(e)); }
        finally{ busy(go,false); } };
      box.appendChild(go);
    }
    else { // login
      head.textContent=t('title.login');
      box.appendChild(field('email','email','auth-email'));
      box.appendChild(field('password','password','auth-pass'));
      const go=el('button',{class:'tb-btn primary auth-main',text:t('login')});
      const submit=async ()=>{
        busy(go,true);
        try{
          const u=await api('/api/auth/login',{method:'POST',json:{email:$('#auth-email').value.trim(),password:$('#auth-pass').value}});
          setUser(u); U.toast(t('loggedIn')+u.email,'success'); close();
          // CM.Sync nasłuchuje cm-auth-change i sam uruchamia synchronizację
        }catch(e){ formErr(box,errMsg(e)); }
        finally{ busy(go,false); }
      };
      go.onclick=submit;
      box.addEventListener('keydown',(e)=>{ if(e.key==='Enter') submit(); });
      box.appendChild(go);
      box.appendChild(el('button',{class:'auth-link',text:t('noAccount'),onclick:()=>renderView('register')}));
      box.appendChild(el('button',{class:'auth-link',text:t('forgot'),onclick:()=>renderView('reset-request')}));
    }
    body.appendChild(box);
  }

  // ---------------- zakładka „Konto" w ustawieniach ----------------
  function renderAccount(c){
    if(!user){
      c.appendChild(el('p',{class:'set-desc',text:t('acct.loggedOutDesc')}));
      const row=el('div',{class:'set-btn-row'});
      row.appendChild(el('button',{class:'tb-btn primary',text:t('login'),onclick:()=>{ CM.Settings&&CM.Settings.close&&CM.Settings.close(); open('login'); }}));
      row.appendChild(el('button',{class:'tb-btn',text:t('register'),onclick:()=>{ CM.Settings&&CM.Settings.close&&CM.Settings.close(); open('register'); }}));
      c.appendChild(row);
      return;
    }
    c.appendChild(el('p',{class:'set-desc',text:user.email}));
    c.appendChild(el('p',{class:'muted small',text:t('acct.since')+U.fmtDate(user.createdAt)}));

    // pasek zużycia quoty
    c.appendChild(el('div',{class:'set-label',text:t('acct.usage')}));
    const pct=Math.min(100, Math.round(100*(user.usedBytes||0)/(user.quotaBytes||1)));
    const bar=el('div',{class:'auth-quota'}, el('div',{class:'auth-quota-fill',style:'width:'+pct+'%'}));
    c.appendChild(bar);
    c.appendChild(el('p',{class:'muted small',text:U.fmtBytes(user.usedBytes||0)+' / '+U.fmtBytes(user.quotaBytes||0)+' ('+pct+'%)'}));

    // synchronizacja
    if(CM.Sync){
      const srow=el('div',{class:'set-btn-row'});
      const auto=el('label',{class:'chk'},
        el('input',{type:'checkbox',...(CM.Sync.isAuto()?{checked:''}:{}),onchange:(e)=>CM.Sync.setAuto(e.target.checked)}),
        ' '+t('acct.syncAuto'));
      srow.appendChild(auto);
      srow.appendChild(el('button',{class:'tb-btn',text:t('acct.syncNow'),onclick:(e)=>{ busy(e.target,true); CM.Sync.syncNow().finally(()=>busy(e.target,false)); }}));
      c.appendChild(srow);
    }

    // zmiana hasła
    c.appendChild(el('div',{class:'set-label',text:t('acct.changePass')}));
    const cp=el('div',{class:'auth-box compact'});
    cp.appendChild(el('div',{class:'auth-err hidden'}));
    cp.appendChild(el('input',{type:'password',id:'acct-cur',placeholder:t('acct.curPass'),autocomplete:'current-password'}));
    cp.appendChild(el('input',{type:'password',id:'acct-new',placeholder:t('acct.newPass'),autocomplete:'new-password'}));
    const cpGo=el('button',{class:'tb-btn',text:t('acct.changePass')});
    cpGo.onclick=async ()=>{ busy(cpGo,true);
      try{ await api('/api/auth/change-password',{method:'POST',json:{current:$('#acct-cur').value,next:$('#acct-new').value}});
        U.toast(t('acct.passChanged'),'success'); $('#acct-cur').value=''; $('#acct-new').value=''; formErr(cp,''); }
      catch(e){ formErr(cp,errMsg(e)); }
      finally{ busy(cpGo,false); } };
    cp.appendChild(cpGo);
    c.appendChild(cp);

    // wyloguj + usuń konto
    const brow=el('div',{class:'set-btn-row'});
    brow.appendChild(el('button',{class:'tb-btn',text:t('logout'),onclick:async ()=>{
      try{ await api('/api/auth/logout',{method:'POST',json:{}}); }catch(e){}
      setUser(null); U.toast(t('loggedOut'));
      if(CM.Settings&&CM.Settings.open) CM.Settings.open('account');
    }}));
    brow.appendChild(el('button',{class:'tb-btn danger',text:t('acct.delete'),onclick:async ()=>{
      const pass=prompt(t('acct.deleteConfirm'));
      if(pass==null||pass==='') return;
      try{ await api('/api/auth/account',{method:'DELETE',json:{password:pass}}); setUser(null); U.toast(t('acct.deleted'),'success');
        if(CM.Settings&&CM.Settings.open) CM.Settings.open('account'); }
      catch(e){ U.toast(errMsg(e),'error'); }
    }}));
    c.appendChild(brow);
  }

  // ---------------- init ----------------
  // Bez backendu (GitHub Pages, sam serve.py) przycisk „Konto" znika: 401 = serwer jest, tylko brak
  // sesji; 404 / błąd sieci = nie ma API, więc formularz logowania zawsze by zawiódł.
  function setBackend(on){ const b=$('#btn-account'); if(b) b.classList.toggle('hidden', !on); document.body.classList.toggle('no-backend', !on); }
  async function refresh(){
    if(!navigator.onLine) return;
    try{ setUser(await api('/api/auth/me')); setBackend(true); }
    catch(e){ setBackend(!!(e&&e.status===401)); }
  }

  function init(){
    const b=$('#btn-account'); if(b) b.onclick=()=>open();
    // linki z e-maili: /?verified=1|0 oraz /?reset=<token>
    try{
      const p=new URLSearchParams(location.search);
      if(p.has('verified')){
        const ok=p.get('verified')==='1';
        U.toast(ok?t('verifiedOk'):t('verifiedFail'), ok?'success':'error', 6000);
        if(ok) setTimeout(()=>open('login'),400);
        history.replaceState(null,'',location.pathname+location.hash);
      } else if(p.has('reset')){
        const token=p.get('reset');
        history.replaceState(null,'',location.pathname+location.hash);
        setTimeout(()=>{ renderView('reset-confirm',{token}); modal().classList.remove('hidden'); },200);
      }
    }catch(e){}
    refresh();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  return { init, open, close, isLoggedIn, api, renderAccount, refresh,
    get user(){ return user; } };
})();
