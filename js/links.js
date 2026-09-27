/* ===================== links.js — deep-linki i publiczne linki do map (Faza 4) ===================== */
// Otwieranie linków #repo= / #gist= / #share= (start aplikacji, zmiana hasha, #v= z mapą z Gista lub linku),
// okno „Udostępnij publiczny link…" (tylko z backendem i po zalogowaniu) oraz lista linków w Ustawienia → Konto.
// Parsowanie, walidacja i pobieranie: CM.DeepLink (js/deeplink.js). Dopisuje się do CM.App (A).
// Linki NIGDY nie używają tokenu GitHub/GitLab/Bitbucket z okna „Wczytaj…" — tylko publiczny dostęp.
(function(){
  const A=CM.App, U=CM.util, $=U.$, el=U.el, I=CM.i18n, DL=CM.DeepLink;
  const state=A.state;
  const T=(k,f)=>I.t(k,f);
  state.linkSrc=null;   // {type:'gist'|'share', id} — źródło bieżącej mapy; serializeView dopisuje je do #v=

  // klucze dynamiczne (błędy) i data-i18n potrzebują wpisu także w słowniku PL
  I.extend('pl', {
    'project.share':'Udostępnij publiczny link…',
    'dl.bad.repo':'Nieprawidłowy link #repo= — obsługiwane są tylko github.com, gitlab.com, bitbucket.org i skrót owner/nazwa[@gałąź[/podkatalog]].',
    'dl.bad.gist':'Nieprawidłowy link #gist= — oczekiwano identyfikatora gista (20–40 znaków 0-9 a-f).',
    'dl.bad.share':'Nieprawidłowy publiczny link (#share=).',
    'dl.e.net':'brak połączenia.','dl.e.gist-notfound':'gist nie istnieje albo został usunięty (404).',
    'dl.e.gist-rate':'wyczerpany limit zapytań GitHub API (60 na godzinę bez logowania) — spróbuj później.',
    'dl.e.gist-forbidden':'GitHub odmówił dostępu (403).','dl.e.gist-http':'błąd GitHub API',
    'dl.e.gist-notmap':'gist nie zawiera mapy CodeMap (plik .json z "format":"codemap").',
    'dl.e.raw-host':'niedozwolony adres pliku gista.','dl.e.too-big':'mapa jest za duża (limit 25 MB).',
    'dl.e.notmap':'to nie jest mapa CodeMap.','dl.e.badmap':'plik mapy jest uszkodzony.',
    'dl.e.share-notfound':'link wygasł, został unieważniony albo ten serwer nie obsługuje publicznych linków.',
    'dl.e.share-rate':'zbyt wiele zapytań — spróbuj za chwilę.','dl.e.share-http':'błąd serwera',
    'dl.e.gist-id':'nieprawidłowy identyfikator gista.','dl.e.share-id':'nieprawidłowy identyfikator linku.',
  });
  I.extend('en', {
    'project.share':'Share a public link…',
    'dl.bad.repo':'Invalid #repo= link — only github.com, gitlab.com, bitbucket.org and the owner/name[@branch[/subdir]] shorthand are supported.',
    'dl.bad.gist':'Invalid #gist= link — expected a gist id (20–40 characters 0-9 a-f).',
    'dl.bad.share':'Invalid public link (#share=).',
    'dl.e.net':'no connection.','dl.e.gist-notfound':'the gist does not exist or was deleted (404).',
    'dl.e.gist-rate':'GitHub API rate limit exhausted (60 per hour without login) — try again later.',
    'dl.e.gist-forbidden':'GitHub denied access (403).','dl.e.gist-http':'GitHub API error',
    'dl.e.gist-notmap':'the gist does not contain a CodeMap map (a .json file with "format":"codemap").',
    'dl.e.raw-host':'disallowed gist file address.','dl.e.too-big':'the map is too large (25 MB limit).',
    'dl.e.notmap':'this is not a CodeMap map.','dl.e.badmap':'the map file is corrupted.',
    'dl.e.share-notfound':'the link expired, was revoked, or this server does not support public links.',
    'dl.e.share-rate':'too many requests — try again in a moment.','dl.e.share-http':'server error',
    'dl.e.gist-id':'invalid gist id.','dl.e.share-id':'invalid link id.',
    'dl.gistLoading':'Fetching the map from the Gist…','dl.shareLoading':'Fetching the shared map…',
    'dl.gistOpened':'Opened the map from a Gist: ','dl.shareOpened':'Opened the shared map: ','dl.repoOpened':'Opened from link: ',
    'dl.gistFail':'Could not open the map from the Gist: ','dl.shareFail':'Could not open the shared map: ',
    'dl.confirmReplace':'Open the map from the link? It replaces the current map (the last session is saved automatically).',
    'dl.badView':'The view link contains an invalid repository source — skipped.',
    'dl.localView':'🔗 View link copied. Note: this map is local — the link carries only the view; to share the map itself use a Gist or a public link.',
    'ca.gistDoneLink':'✅ Gist created — link to open the map in CodeMap copied:','ca.gistDoneLinkNoClip':'✅ Gist created — link to open the map in CodeMap:',
    'ca.gistView':'view the gist',
    'share.title':'Public map link','share.name':'Name','share.expires':'Expires after',
    'share.d1':'1 day','share.d7':'7 days','share.d30':'30 days','share.d90':'90 days','share.d365':'1 year','share.never':'never (until revoked)',
    'share.noPreview':'Without file content previews (recommended)','share.noEmails':'Without author e-mail addresses from git history',
    'share.warn':'Anyone who has the link can see this map without logging in: file names and paths, metrics, dependencies and — unless you switch them off above — up to 1500 characters of each file\'s content and git history data. You can revoke the link in Settings → Account.',
    'share.create':'Create link','share.cancel':'Cancel','share.close':'Close','share.copy':'Copy link','share.copied':'Link copied.',
    'share.done':'🔗 Public link created and copied to the clipboard.','share.doneNoClip':'🔗 Public link created.',
    'share.resultHead':'Link created — anyone who has it can open the map:','share.resultNote':'You can revoke it any time in Settings → Account.',
    'share.needLogin':'Log in to create public links.','share.errBig':'The map is too large for a public link (25 MB limit). Keep “without file content previews” on or collapse the project.',
    'share.errQuota':'Not enough storage left on the account.','share.errLimit':'Active link limit reached — revoke old links in Settings → Account.',
    'share.errMap':'The server rejected the map (invalid format).','share.errRate':'Too many attempts — try again later.',
    'share.errNet':'No connection to the server.','share.err':'Could not create the link: ',
    'share.listHead':'Public map links','share.listEmpty':'No active links. Create one in Project → Share a public link….',
    'share.listFail':'Could not load the list of links.','share.loading':'Loading…',
    'share.created':'created ','share.expiresOn':'expires ','share.noExpiry':'no expiry','share.viewsLbl':'views: ',
    'share.revoke':'Revoke','share.revokeConfirm':'Revoke this link? Everyone who has it loses access to the map.','share.revoked':'Link revoked.',
  });

  const appUrl=()=>location.origin+location.pathname;
  const shareUrl=(id)=>appUrl()+'#share='+id;
  async function copyText(s){
    try{ if(navigator.clipboard && navigator.clipboard.writeText){ await navigator.clipboard.writeText(s); return true; } }catch(e){ /* brak zgody na schowek → false */ }
    return false;
  }
  function errText(e){
    let s=I.t('dl.e.'+((e&&e.code)||''), '') || (e&&e.message) || '?';
    if(e && e.status) s+=' (HTTP '+e.status+')';
    return s;
  }

  // ---------------- otwieranie map z linków ----------------
  // mapa (już zwalidowana) → aplikacja; hash (#gist= / #share= / #v=) opisuje TEN projekt, więc resetProjectState
  // go nie kasuje (_restoring), a źródło trafia do state.linkSrc dopiero po udanym wczytaniu
  function applyMap(obj, src, onLoaded){
    A._restoring=true;
    let ok=false;
    try{ ok=A.loadFromJSON(obj, {toast:false}); }
    finally{ A._restoring=false; }
    if(!ok) return false;
    state.linkSrc=src;
    // kamera z #v= po fit() z loadFromJSON — ta sama kolejka requestAnimationFrame, więc zawsze po nim
    if(onLoaded) requestAnimationFrame(()=>{ try{ onLoaded(); }catch(e){ console.warn('[CodeMap] widok z linku', e); } });
    return true;
  }
  async function openMapFrom(kind, id, opts){
    opts=opts||{};
    const gen=++A._ingestGen;   // Anuluj albo nowsze wczytanie unieważnia to pobieranie
    A.showLoading(kind==='gist' ? T('dl.gistLoading','Pobieranie mapy z Gista…') : T('dl.shareLoading','Pobieranie udostępnionej mapy…'));
    try{
      const r=kind==='gist' ? await DL.fetchGistMap(id) : await DL.fetchShareMap(id);
      if(gen!==A._ingestGen) return false;
      A.hideLoading();
      if(!applyMap(r.map, {type:kind, id}, opts.onLoaded)) return false;
      const name=(A.graph.meta && A.graph.meta.name) || id;
      U.toast(kind==='gist'
        ? T('dl.gistOpened','Otwarto mapę z Gista: ')+'<b>'+name+'</b>'+(r.owner?' (@'+r.owner+')':'')
        : T('dl.shareOpened','Otwarto udostępnioną mapę: ')+'<b>'+name+'</b>', 'success', 6000);
      return true;
    }catch(e){
      if(gen!==A._ingestGen) return false;
      A.hideLoading();
      U.toast((kind==='gist' ? T('dl.gistFail','Nie udało się otworzyć mapy z Gista: ') : T('dl.shareFail','Nie udało się otworzyć udostępnionej mapy: '))+errText(e), 'error', 8000);
      return false;
    }
  }
  function openGist(id, opts){
    id=String(id||'').toLowerCase();
    if(!DL.isGistId(id)){ U.toast(T('dl.bad.gist'),'error',7000); return Promise.resolve(false); }
    return openMapFrom('gist', id, opts);
  }
  function openShare(id, opts){
    id=String(id||'');
    if(!DL.isShareId(id)){ U.toast(T('dl.bad.share'),'error',7000); return Promise.resolve(false); }
    return openMapFrom('share', id, opts);
  }
  // repozytorium z linku: publiczny dostęp (bez tokenu), z treścią plików, opcjonalnie podkatalog i układ
  async function openRepoLink(spec, layout, pr){
    if(layout) A.setLayoutSelect(layout);
    A._restoring=true;
    let ok=false;
    try{
      ok=await A.ingest((p,s)=>CM.Loaders.fromRepoURL(spec.url, {branch:spec.branch||undefined, sub:spec.sub||undefined, fetchContent:true}, p, s),
        T('ca.connectingToRepo','Łączenie z repozytorium…'));
    }finally{ A._restoring=false; }
    if(ok) U.toast(T('dl.repoOpened','Otwarto z linku: ')+'<b>'+DL.label(spec)+'</b>', 'success', 5000);
    if(ok && pr && CM.PR) CM.PR.run(pr);   // #repo=…&pr=N → mapa wpływu PR
    return !!ok;
  }
  // #repo= / #gist= / #share= → wczytanie; false dla innych hashy i błędów (czytelny toast)
  async function openDeepLink(hash, opts){
    opts=opts||{};
    const r=DL.parseHash(hash==null ? location.hash : hash);
    if(!r || r.kind==='demo' || r.kind==='view') return false;
    if(r.kind==='error'){ U.toast(T('dl.bad.'+r.type),'error',8000); return false; }
    if(r.kind==='tour') return CM.TourUI ? CM.TourUI.openEncoded(r.tour) : false;   // trasa na już wczytaną mapę
    if(opts.confirmReplace && state.counts.nodes>0 && !confirm(T('dl.confirmReplace','Otworzyć mapę z linku? Zastąpi bieżącą mapę (ostatnia sesja jest zapisana automatycznie).'))) return false;
    const ok=r.kind==='gist' ? await openGist(r.id, opts) : r.kind==='share' ? await openShare(r.id, opts) : await openRepoLink(r.spec, r.layout, r.pr);
    if(ok && r.tour && CM.TourUI) setTimeout(()=>{ CM.TourUI.openEncoded(r.tour); }, 400);
    return ok;
  }
  // link wklejony w pasek adresu otwartej już aplikacji (zmienia się tylko hash — bez przeładowania strony)
  window.addEventListener('hashchange', ()=>{ if(DL.isDeepLink(location.hash)) openDeepLink(location.hash, {confirmReplace:true}).catch(()=>{}); });

  // ---------------- „Udostępnij publiczny link…" ----------------
  function shareErr(e){
    if(!e) return '?';
    if(e.code==='net') return T('share.errNet','Brak połączenia z serwerem.');
    if(e.status===401) return T('share.needLogin','Zaloguj się, aby tworzyć publiczne linki.');
    if(e.status===413) return T('share.errBig','Mapa jest za duża na publiczny link (limit 25 MB). Zostaw włączone „bez podglądu treści plików" albo zwiń projekt.');
    if(e.status===507) return T('share.errQuota','Brak miejsca na koncie.');
    if(e.status===409) return T('share.errLimit','Osiągnięto limit aktywnych linków — unieważnij stare w Ustawienia → Konto.');
    if(e.status===429) return T('share.errRate','Zbyt wiele prób — spróbuj później.');
    if(e.status===400 || e.status===415) return T('share.errMap','Serwer odrzucił mapę (nieprawidłowy format).');
    return T('share.err','Nie udało się utworzyć linku: ')+(e.message||'?');
  }
  // okno z ui-kit.js (identyfikatory share-title / share-body / share-foot bez zmian)
  function closeModal(){ CM.UIKit.modal('modal-share','share-modal','share').close(); }
  function ensureModal(){ return CM.UIKit.modal('modal-share','share-modal','share').el; }
  const EXPIRY=[['1','share.d1','1 dzień'],['7','share.d7','7 dni'],['30','share.d30','30 dni'],['90','share.d90','90 dni'],
    ['365','share.d365','1 rok'],['','share.never','nigdy (do unieważnienia)']];
  function openShareDialog(){
    if(!CM.Auth || !CM.Auth.isLoggedIn()){ U.toast(T('share.needLogin','Zaloguj się, aby tworzyć publiczne linki.'),'error'); return; }
    if(!state.counts.nodes){ U.toast(T('ca.noMapToExport','Brak mapy do eksportu.'),'error'); return; }
    const m=ensureModal(), body=$('#share-body'), foot=$('#share-foot');
    $('#share-title').textContent=T('share.title','Publiczny link do mapy');
    body.innerHTML=''; foot.innerHTML='';
    const g=A.graph, meta=g.meta||{};
    const name=el('input',{type:'text',id:'share-name',maxlength:'200',autocomplete:'off'}); name.value=String(meta.name||'').slice(0,200);
    const exp=el('select',{id:'share-exp',class:'share-select'});
    for(const [v,k,f] of EXPIRY) exp.appendChild(el('option',{value:v,text:T(k,f)}));
    exp.value='30';
    const np=el('input',{type:'checkbox',id:'share-nopreview',checked:''});
    const hasGit=!!(g.gitInfo && Array.isArray(g.gitInfo.authors) && g.gitInfo.authors.length);
    const ne=hasGit ? el('input',{type:'checkbox',id:'share-noemails',checked:''}) : null;
    const err=el('p',{class:'auth-err hidden',role:'alert'});
    const parts=[
      el('label',{class:'field-label','for':'share-name',text:T('share.name','Nazwa')}), name,
      el('label',{class:'field-label','for':'share-exp',text:T('share.expires','Wygasa po')}), exp,
      el('label',{class:'chk mt'}, np, el('span',{text:T('share.noPreview','Bez podglądu treści plików (zalecane)')})),
      ne ? el('label',{class:'chk'}, ne, el('span',{text:T('share.noEmails','Bez adresów e-mail autorów z historii git')})) : null,
      el('p',{class:'share-warn',text:T('share.warn','Każdy, kto ma link, zobaczy tę mapę bez logowania: nazwy i ścieżki plików, metryki, zależności oraz — jeśli nie wyłączysz tego wyżej — do 1500 znaków treści każdego pliku i dane z historii git. Link unieważnisz w Ustawienia → Konto.')}),
      err,
    ];
    for(const p of parts) if(p) body.appendChild(p);
    const go=el('button',{class:'tb-btn primary',type:'button',id:'share-go',text:T('share.create','Utwórz link')});
    foot.appendChild(el('button',{class:'tb-btn',type:'button',text:T('share.cancel','Anuluj'),onclick:closeModal}));
    foot.appendChild(go);
    const showErr=(msg)=>{ err.textContent=msg||''; err.classList.toggle('hidden', !msg); };
    go.onclick=async ()=>{
      showErr('');
      if(!A.graph || !state.counts.nodes){ showErr(T('ca.noMapToExport','Brak mapy do eksportu.')); return; }
      const obj=DL.prepareShare(A.graph.toJSON(), {noPreview:np.checked, noEmails:ne ? ne.checked : true});
      const payload=JSON.stringify(obj);
      if(new Blob([payload]).size>DL.MAX_MAP_BYTES){ showErr(T('share.errBig','Mapa jest za duża na publiczny link (limit 25 MB). Zostaw włączone „bez podglądu treści plików" albo zwiń projekt.')); return; }
      const qs=new URLSearchParams();
      const nm=name.value.trim().slice(0,200); if(nm) qs.set('name', nm);
      if(exp.value) qs.set('expiresInDays', exp.value);
      go.disabled=true; go.classList.add('busy');
      try{
        const r=await CM.Auth.api('/api/shares?'+qs.toString(), {method:'POST', body:payload, headers:{'Content-Type':'application/json'}});
        if(!r || !DL.isShareId(r.id)) throw new Error('?');
        const url=shareUrl(r.id), copied=await copyText(url);
        showResult(url, r.expiresAt);
        U.toast(copied ? T('share.done','🔗 Utworzono publiczny link (skopiowany do schowka).') : T('share.doneNoClip','🔗 Utworzono publiczny link.'),'success',5000);
        try{ CM.Auth.refresh(); }catch(e){ /* licznik konta — refresh() sam łapie błędy sieci */ }
      }catch(e){ showErr(shareErr(e)); }
      finally{ go.disabled=false; go.classList.remove('busy'); }
    };
    m.classList.remove('hidden');
    setTimeout(()=>{ try{ name.focus(); name.select(); }catch(e){ /* okno zamknięte przed fokusem */ } }, 30);
  }
  function showResult(url, expiresAt){
    const body=$('#share-body'), foot=$('#share-foot'); if(!body || !foot) return;
    body.innerHTML=''; foot.innerHTML='';
    const inp=el('input',{type:'text',id:'share-url',readonly:'',class:'share-url'}); inp.value=url;
    body.appendChild(el('p',{class:'auth-info',text:T('share.resultHead','Link utworzony — każdy, kto go ma, otworzy mapę:')}));
    body.appendChild(inp);
    body.appendChild(el('p',{class:'muted small',text:(expiresAt ? T('share.expiresOn','wygasa ')+U.fmtDate(expiresAt) : T('share.noExpiry','bez wygasania'))+' · '+T('share.resultNote','Unieważnisz go w każdej chwili w Ustawienia → Konto.')}));
    foot.appendChild(el('button',{class:'tb-btn',type:'button',text:T('share.copy','Kopiuj link'),
      onclick:()=>copyText(url).then(ok=>{ if(ok) U.toast(T('share.copied','Skopiowano link.'),'success',2500); else { inp.focus(); inp.select(); } })}));
    foot.appendChild(el('button',{class:'tb-btn primary',type:'button',text:T('share.close','Zamknij'),onclick:closeModal}));
    setTimeout(()=>{ try{ inp.focus(); inp.select(); }catch(e){ /* okno zamknięte przed fokusem */ } }, 30);
  }

  // ---------------- Ustawienia → Konto: moje publiczne linki ----------------
  function renderAccountSection(c){
    if(!CM.Auth || !CM.Auth.isLoggedIn()) return;
    c.appendChild(el('div',{class:'set-label',text:T('share.listHead','Publiczne linki do map')}));
    const box=el('div',{class:'share-list'}, el('p',{class:'muted small',text:T('share.loading','Wczytywanie…')}));
    c.appendChild(box);
    CM.Auth.api('/api/shares').then(list=>fillList(box, Array.isArray(list) ? list : []))
      .catch(()=>{ box.innerHTML=''; box.appendChild(el('p',{class:'muted small',text:T('share.listFail','Nie udało się pobrać listy linków.')})); });
  }
  function fillList(box, list){
    box.innerHTML='';
    list=list.filter(s=>s && DL.isShareId(s.id));
    if(!list.length){ box.appendChild(el('p',{class:'muted small',text:T('share.listEmpty','Brak aktywnych linków. Utworzysz je w menu Projekt → Udostępnij publiczny link….')})); return; }
    for(const s of list){
      const url=shareUrl(s.id);
      const info=[T('share.created','utworzono ')+U.fmtDate(s.createdAt),
        s.expiresAt ? T('share.expiresOn','wygasa ')+U.fmtDate(s.expiresAt) : T('share.noExpiry','bez wygasania'),
        T('share.viewsLbl','wyświetlenia: ')+U.fmtNum(s.views||0), U.fmtBytes(s.size||0)].join(' · ');
      const revoke=el('button',{class:'tb-btn danger',type:'button',text:T('share.revoke','Unieważnij')});
      const row=el('div',{class:'share-row'},
        el('div',{class:'share-row-main'}, el('div',{class:'share-row-name',text:s.name||'—',title:url}), el('div',{class:'muted small',text:info})),
        el('div',{class:'share-row-act'},
          el('button',{class:'tb-btn',type:'button',text:T('share.copy','Kopiuj link'),
            onclick:()=>copyText(url).then(ok=>U.toast(ok ? T('share.copied','Skopiowano link.') : url, ok ? 'success' : '', ok ? 2500 : 9000))}),
          revoke));
      revoke.onclick=async ()=>{
        if(!confirm(T('share.revokeConfirm','Unieważnić ten link? Każdy, kto go ma, straci dostęp do mapy.'))) return;
        revoke.disabled=true;
        try{ await CM.Auth.api('/api/shares/'+encodeURIComponent(s.id), {method:'DELETE'}); }
        catch(e){ if(e.status!==404){ revoke.disabled=false; U.toast(shareErr(e),'error'); return; } }   // 404 = już wygasł / usunięty
        row.remove(); U.toast(T('share.revoked','Link unieważniony.'),'success');
        if(!box.querySelector('.share-row')) fillList(box, []);
        try{ CM.Auth.refresh(); }catch(e){ /* licznik konta — refresh() sam łapie błędy sieci */ }
      };
      box.appendChild(row);
    }
  }

  // pozycja menu tylko dla zalogowanych (bez backendu nikt nie jest zalogowany — auth.js ukrywa też „Konto")
  function syncMenu(){ const b=$('#btn-share'); if(b) b.classList.toggle('hidden', !(CM.Auth && CM.Auth.isLoggedIn())); }
  document.addEventListener('cm-auth-change', syncMenu);
  function wire(){ const b=$('#btn-share'); if(b) b.onclick=()=>openShareDialog(); syncMenu(); }
  setTimeout(wire, 0);

  Object.assign(A, {openDeepLink, openGist, openShare, openRepoLink, openShareDialog});
  CM.Links={openDeepLink, openShareDialog, renderAccountSection, shareUrl};
})();
