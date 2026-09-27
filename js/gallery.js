/* ===================== gallery.js — galeria przykładowych repozytoriów (faza 8) ===================== */
// Znane, niewielkie repozytoria (50–320 plików, 7 języków) otwierane jednym kliknięciem przez deep-link #repo= —
// żeby zobaczyć CodeMap na prawdziwym kodzie bez szukania projektu. „Z trasą" po wczytaniu układa trasę po kodzie
// (tour-ui.js). Wejścia: przycisk „Przykłady" na ekranie startowym, Wczytaj → „Przykładowe repozytoria…", akcja
// ChatBota `gallery`. Dane i budowanie linku są czyste (testy w Node); okno i przyciski — tylko w przeglądarce.
CM.Gallery = (function(){
  const ITEMS = [
    {repo:'expressjs/express', lang:'JavaScript', files:214, pl:'Minimalistyczny framework HTTP dla Node.js — router, middleware, odpowiedzi.', en:'Minimalist HTTP framework for Node.js — router, middleware, responses.'},
    {repo:'preactjs/preact', lang:'JavaScript', files:301, pl:'Lekka alternatywa Reacta: wirtualny DOM, komponenty, hooki.', en:'Lightweight React alternative: virtual DOM, components, hooks.'},
    {repo:'sindresorhus/ky', lang:'TypeScript', files:104, pl:'Klient HTTP na fetch — mały, czytelny kod TypeScript z testami.', en:'HTTP client on top of fetch — small, readable TypeScript with tests.'},
    {repo:'vuejs/petite-vue', lang:'TypeScript', files:53, pl:'Vue w 6 kB: reaktywność i dyrektywy — dobry na pierwszą trasę po kodzie.', en:'Vue in 6 kB: reactivity and directives — a good first code tour.'},
    {repo:'pallets/flask', lang:'Python', files:236, path:'src/flask', pl:'Mikroframework webowy Pythona — aplikacja, konteksty, blueprinty.', en:'Python web microframework — app, contexts, blueprints.'},
    {repo:'gin-gonic/gin', lang:'Go', files:130, pl:'Framework HTTP w Go — silnik, kontekst, wiązanie i renderowanie.', en:'HTTP framework in Go — engine, context, binding and rendering.'},
    {repo:'serde-rs/json', lang:'Rust', files:92, pl:'Serializacja JSON dla Rusta (serde) — parser, wartości, makra.', en:'JSON serialization for Rust (serde) — parser, values, macros.'},
    {repo:'google/gson', lang:'Java', files:313, path:'gson/src/main', pl:'Biblioteka Google do JSON w Javie — adaptery typów, refleksja.', en:"Google's JSON library for Java — type adapters, reflection."},
    {repo:'ruby/rake', lang:'Ruby', files:127, path:'lib', pl:'Make dla Rubiego — zadania, zależności, pliki reguł.', en:'Make for Ruby — tasks, dependencies, rule files.'},
  ];
  // #repo=owner/nazwa[&path=podkatalog] — ten sam format co „Kopiuj link do mapy" (deeplink.js)
  function hashFor(it){ return '#repo='+it.repo+(it.path?'&path='+encodeURIComponent(it.path):''); }
  function find(q){ q=String(q||'').toLowerCase().trim(); if(!q) return null;
    return ITEMS.find(it=>it.repo.toLowerCase()===q) || ITEMS.find(it=>it.repo.toLowerCase().split('/')[1]===q) || ITEMS.find(it=>it.repo.toLowerCase().includes(q)) || null; }

  // ---------------- przeglądarka: okno, przyciski, akcja ----------------
  function ui(){
    const A=CM.App, U=CM.util, $=U.$, el=U.el, I=CM.i18n;
    const STR={
      pl:{'gal.title':'Przykładowe repozytoria','gal.desc':'Prawdziwe, niewielkie projekty open source — mapa buduje się w przeglądarce z publicznego API GitHuba (bez tokenu: limit 60 zapytań na godzinę, jedno repozytorium to kilka zapytań).',
        'gal.open':'Otwórz','gal.tour':'🧭 Z trasą','gal.files':'plików','gal.link':'Kopiuj link','gal.copied':'Skopiowano link.','gal.btn':'Przykłady','gal.menu':'Przykładowe repozytoria…','gal.run':'Otwieram przykład: '},
      en:{'gal.title':'Example repositories','gal.desc':'Real, small open-source projects — the map is built in the browser from the public GitHub API (without a token: 60 requests per hour, one repository takes a few).',
        'gal.open':'Open','gal.tour':'🧭 With a tour','gal.files':'files','gal.link':'Copy link','gal.copied':'Link copied.','gal.btn':'Examples','gal.menu':'Example repositories…','gal.run':'Opening example: '}};
    I.extend('pl', STR.pl); I.extend('en', STR.en);
    const t=(k)=>I.t(k, STR.pl[k]), pl=()=>I.getLang()!=='en';
    const dlg=()=>CM.UIKit.modal('modal-gallery','share-modal gallery-modal','gal');
    async function openItem(it, withTour){
      dlg().close();
      const ok=A.openDeepLink ? await A.openDeepLink(hashFor(it), {confirmReplace:true}) : false;
      if(ok && withTour && CM.TourUI) setTimeout(()=>{ CM.TourUI.makeAuto(true); }, 600);
      return ok;
    }
    function open(){
      const d=dlg(); $('#gal-title').textContent='🧭 '+t('gal.title'); d.clear(); d.open();
      d.body.appendChild(el('p',{class:'muted small', text:t('gal.desc')}));
      const grid=el('div',{class:'gal-grid'});
      for(const it of ITEMS){
        const card=el('div',{class:'gal-card'});
        const head=el('div',{class:'gal-head'}, el('b',{text:it.repo}), el('span',{class:'gal-lang', text:it.lang}));
        card.appendChild(head);
        card.appendChild(el('div',{class:'gal-desc', text:pl()?it.pl:it.en}));
        card.appendChild(el('div',{class:'muted small', text:'~'+it.files+' '+t('gal.files')+(it.path?' · '+it.path+'/':'')}));
        const row=el('div',{class:'gal-row'});
        row.appendChild(el('button',{class:'tb-btn primary', type:'button', text:t('gal.open'), onclick:()=>openItem(it, false)}));
        row.appendChild(el('button',{class:'tb-btn', type:'button', text:t('gal.tour'), onclick:()=>openItem(it, true)}));
        row.appendChild(el('button',{class:'tb-btn', type:'button', title:t('gal.link'), text:'🔗', onclick:async()=>{ const url=location.origin+location.pathname+hashFor(it);
          try{ await navigator.clipboard.writeText(url); U.toast(t('gal.copied'),'success',2000); }catch(e){ U.toast(url,'',8000); } }}));
        card.appendChild(row); grid.appendChild(card);
      }
      d.body.appendChild(grid);
    }
    function wire(){
      const demo=$('#empty-demo');
      if(demo && !$('#empty-gallery')){ const b=el('button',{class:'tb-btn', id:'empty-gallery', type:'button', 'data-ic':'layers', 'data-i18n':'gal.btn', text:t('gal.btn'), onclick:open});
        demo.parentNode.insertBefore(b, demo.nextSibling); if(CM.icons&&CM.icons.hydrate) CM.icons.hydrate(b.parentNode); }
      const gh=$('#btn-load-github');
      if(gh && !$('#btn-gallery')){ const m=el('button',{class:'menu-item', id:'btn-gallery', type:'button', 'data-ic':'layers', 'data-i18n':'gal.menu', text:t('gal.menu'),
          onclick:()=>{ document.querySelectorAll('.menu-panel').forEach(p=>p.classList.remove('open')); open(); }});
        gh.parentNode.insertBefore(m, gh.nextSibling); if(CM.icons&&CM.icons.hydrate) CM.icons.hydrate(m.parentNode); }
    }
    if(A.registerAction) A.registerAction({name:'gallery', sig:'{repo?, tour?:boolean}',
      desc:'open the gallery of example repositories, or load one of them (express, preact, ky, petite-vue, flask, gin, serde json, gson, rake), optionally with a code tour',
      descPl:'galeria przykładowych repozytoriów albo wczytanie jednego z nich (opcjonalnie z trasą)', auto:false,
      run:(a)=>{ const it=a&&a.repo?find(a.repo):null; if(!it){ open(); return t('gal.title'); } openItem(it, !!(a&&a.tour)); return t('gal.run')+it.repo; }});
    setTimeout(wire, 0);
    return {open, openItem};
  }
  const api={ITEMS, hashFor, find};
  if(typeof document!=='undefined' && document.getElementById && CM.App && CM.UIKit) Object.assign(api, ui());
  return api;
})();
