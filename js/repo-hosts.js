/* ===================== repo-hosts.js — GitHub / GitLab / Bitbucket ===================== */
// Autorzy/awatary i karta profilu, deep-linki do plików (nodeRepoUrl/repoHostName), ostatnie repozytoria,
// gałęzie/tagi + limit API, porównanie gałęzi (compareBranches), eksport Gist oraz udostępnialny widok
// (#v= — serializeView/restoreView/copyViewLink/updateHash). Dopisuje się do CM.App (A).
(function(){
  const A=CM.App;
  const U=CM.util, $=U.$, el=U.el, I=CM.i18n;
  const Graph=CM.Graph.Graph, Loaders=CM.Loaders, Storage=CM.Storage, UI=CM.UI;
  const state=A.state, filters=A.filters, handlers=A.handlers;   // pola stałe kontekstu (nigdy nie podmieniane)

  // ---------------- GitHub repo author (floating avatar + top-bar badge) ----------------
  state._authors=[];
  function ghAvatarUrl(o){ return o.avatar || ('https://github.com/'+o.login+'.png?size=120'); }
  function refreshAuthors(){
    const cont=$('#gh-avatars'); if(!cont) return; cont.innerHTML=''; state._authors=[];
    const hasGroups=state.groups.length>0;
    // floating avatar (GitHub author) at each schema centre — picture + nick below
    const addAvatar=(gid,owner)=>{ if(!owner||!owner.login) return;
      const a=el('a',{class:'gh-avatar',href:owner.url||('https://github.com/'+owner.login),target:'_blank',rel:'noopener',title:I.t('ca.authorPrefix','Autor: ')+owner.login+I.t('ca.authorShowProfile',' — pokaż profil')});
      const img=el('img',{src:ghAvatarUrl(owner),alt:owner.login});
      img.onerror=()=>{ img.onerror=null; img.src='https://github.com/'+owner.login+'.png?size=120'; };
      a.appendChild(img); a.appendChild(el('span',{class:'gh-avatar-nick',text:owner.login}));
      a.onclick=(e)=>{ e.preventDefault(); openAuthorCard(owner); };
      cont.appendChild(a); state._authors.push({gid,el:a}); };
    if(hasGroups){ for(const g of state.groups) addAvatar(g.gid, g.owner); }
    else addAvatar('base', A.graph.meta && A.graph.meta.owner);
    // small NAME sticker above the centre (single schema; for compared schemas the draggable chip shows the name)
    if(!hasGroups && state.counts.nodes>0){
      const st=el('div',{class:'schema-sticker',text:A.graph.meta.name||I.t('ca.project','projekt')});
      cont.appendChild(st); state._authors.push({gid:'base', el:st, sticker:true});
    }
    // top-bar: ICON-ONLY mini avatars (one per loaded repo, fits 6+), full nick on hover
    const bar=$('#gh-authors'); bar.innerHTML='';
    const owners = hasGroups ? state.groups.map(g=>g.owner).filter(o=>o&&o.login)
                             : (A.graph.meta&&A.graph.meta.owner&&A.graph.meta.owner.login ? [A.graph.meta.owner] : []);
    for(const owner of owners){
      const a=el('a',{class:'gh-author-mini',href:owner.url||('https://github.com/'+owner.login),target:'_blank',rel:'noopener','data-nick':owner.login,title:owner.login});
      const img=el('img',{src:ghAvatarUrl(owner),alt:owner.login}); img.onerror=()=>{ img.onerror=null; img.src='https://github.com/'+owner.login+'.png?size=120'; };
      a.onclick=(e)=>{ e.preventDefault(); openAuthorCard(owner); };
      a.appendChild(img); bar.appendChild(a);
    }
    bar.classList.toggle('hidden', owners.length===0);
    positionAuthors();
  }
  function centroidOf(gid){
    let cx=0,cy=0,n=0;
    for(const nd of state.vis.nodes){ const isBase=!nd.gid||nd.gid==='base'; if(gid==='base'?!isBase:nd.gid!==gid) continue; cx+=nd.x; cy+=nd.y; n++; }
    if(!n) return null; return {x:cx/n,y:cy/n};
  }
  function positionAuthors(){
    if(!state._authors||!state._authors.length) return;
    const W=A.renderer.w, H=A.renderer.h;
    // avatars are tiny by default and scale with the camera: barely-there dots when zoomed far out,
    // a little bigger as you approach the centre. Never huge.
    const s=U.clamp(A.renderer.cam.zoom*0.85, 0.12, 1.2);
    for(const a of state._authors){
      const c=centroidOf(a.gid);
      if(!c){ a.el.style.display='none'; continue; }
      const sp=A.renderer.cam.toScreen(c.x,c.y,W,H);
      if(sp.x<-120||sp.x>W+120||sp.y<-120||sp.y>H+120){ a.el.style.display='none'; continue; }
      a.el.style.display=''; a.el.style.left=sp.x+'px'; a.el.style.top=(sp.y + (a.sticker?-58*s:0))+'px';
      a.el.style.setProperty('--av-scale', s.toFixed(3));
    }
  }

  // ---------------- author profile card (live GitHub mini-profile) ----------------
  state._ghUserCache={};
  function ensureAuthorCard(){
    let card=$('#author-card');
    if(card) return card;
    card=el('div',{id:'author-card',class:'hidden'});
    document.querySelector('#main').appendChild(card);
    return card;
  }
  function closeAuthorCard(){ const c=$('#author-card'); if(c) c.classList.add('hidden'); }
  function fmtJoined(iso){ try{ const d=new Date(iso); return d.toLocaleDateString('pl-PL',{year:'numeric',month:'long'}); }catch(e){ return ''; } }
  function renderAuthorCard(card, u, login, prof, hostLabel){
    prof = safeUrl(prof) || ('https://github.com/'+encodeURIComponent(login));
    const stat=(v,l)=>`<div class="ac-stat"><b>${U.fmtNum(v||0)}</b><span>${l}</span></div>`;
    const row=(ic,txt,href)=> txt? `<div class="ac-row">${CM.icons.svg(ic,{size:14})}<span>${href?`<a href="${escapeHtml(safeUrl(href))}" target="_blank" rel="noopener">${escapeHtml(txt)}</a>`:escapeHtml(txt)}</span></div>`:'';
    const avatar=safeUrl((u&&u.avatar_url)||(u&&u.avatar))||('https://github.com/'+encodeURIComponent(login)+'.png?size=200');
    const name=(u&&u.name)||login, bio=u&&u.bio;
    const blog=u&&u.blog?(/^https?:/.test(u.blog)?u.blog:'https://'+u.blog):'';
    const hasStats = u && (u.public_repos!=null||u.followers!=null||u.following!=null);
    card.innerHTML=`
      <button class="ac-close" title="${I.t('ca.acClose','Zamknij')}">${CM.icons.svg('x',{size:18})}</button>
      <div class="ac-hero">
        <img class="ac-avatar" src="${escapeHtml(avatar)}" alt="${escapeHtml(login)}">
        <div class="ac-id">
          <div class="ac-name">${escapeHtml(name)}</div>
          <a class="ac-login" href="${escapeHtml(prof)}" target="_blank" rel="noopener">@${escapeHtml(login)}</a>
        </div>
      </div>
      ${bio?`<p class="ac-bio">${escapeHtml(bio)}</p>`:''}
      ${hasStats?`<div class="ac-stats">${stat(u.public_repos,I.t('ca.acRepos','repozytoria'))}${stat(u.followers,I.t('ca.acFollowers','obserwujący'))}${stat(u.following,I.t('ca.acFollowing','obserwuje'))}</div>`:''}
      <div class="ac-meta">
        ${row('package', u&&u.company, '')}
        ${row('map', u&&u.location, '')}
        ${row('globe', blog?blog.replace(/^https?:\/\//,''):'', blog)}
        ${u&&u.twitter_username?row('globe','@'+u.twitter_username,'https://twitter.com/'+u.twitter_username):''}
        ${u&&u.created_at?row('clock',I.t('ca.acJoined','Dołączył: ')+fmtJoined(u.created_at),''):''}
        ${u&&u.public_gists!=null?row('file', u.public_gists+I.t('ca.acGists',' gistów'),''):''}
      </div>
      ${u&&u.__err?`<p class="ac-err">${escapeHtml(u.__err)}</p>`:''}
      <a class="ac-open tb-btn primary" href="${escapeHtml(prof)}" target="_blank" rel="noopener">${CM.icons.svg('globe',{size:14})} ${I.t('ca.acOpenProfile','Otwórz pełny profil')}${hostLabel?(I.t('ca.acOnHost',' na ')+hostLabel):''}</a>`;
    card.querySelector('.ac-close').onclick=closeAuthorCard;
  }
  function escapeHtml(s){ return String(s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c])); }
  // only allow http(s) URLs into href/src (blocks javascript:/data: and any attribute-breakout)
  function safeUrl(u){ u=String(u||'').trim(); return /^https?:\/\//i.test(u) ? u : ''; }
  async function openAuthorCard(owner){
    if(!owner||!owner.login) return;
    const login=owner.login, host=owner.host||'github', card=ensureAuthorCard();
    const prof=owner.url||('https://github.com/'+encodeURIComponent(login));
    const hostLabel={github:'GitHub',gitlab:'GitLab',bitbucket:'Bitbucket'}[host]||'';
    card.classList.remove('hidden');
    // GitLab / Bitbucket: no public CORS user API here — show the basic card straight from repo meta
    if(host!=='github'){ renderAuthorCard(card, {avatar:owner.avatar, login}, login, prof, hostLabel); return; }
    renderAuthorCard(card, state._ghUserCache[login]||{avatar_url:owner.avatar, login, __loading:true}, login, prof, hostLabel);
    if(state._ghUserCache[login]){ return; }
    card.classList.add('ac-loading');
    try{
      const tok=($('#gh-token')&&$('#gh-token').value.trim())||'';
      const headers=tok?{Authorization:'token '+tok}:{};
      const res=await fetch('https://api.github.com/users/'+encodeURIComponent(login),{headers});
      if(!res.ok) throw new Error(res.status===403?I.t('ca.ghRateLimit','Limit zapytań GitHub API (dodaj token w oknie „Wczytaj…").'):'GitHub API: '+res.status);
      const u=await res.json(); state._ghUserCache[login]=u;
      card.classList.remove('ac-loading'); renderAuthorCard(card, u, login, prof, hostLabel);
    }catch(e){
      card.classList.remove('ac-loading');
      renderAuthorCard(card, {avatar_url:owner.avatar, login, __err:e.message}, login, prof, hostLabel);
    }
  }

  // ---------------- GitHub / GitLab / Bitbucket deep links ----------------
  const HOST_NAMES={github:'GitHub', gitlab:'GitLab', bitbucket:'Bitbucket'};
  function repoHostName(){ const m=A.graph.meta; return (m&&HOST_NAMES[m.host])||''; }
  // exact web URL of a file/folder node in its source repository, at the loaded branch
  function nodeRepoUrl(node){
    const m=A.graph.meta;
    if(!node || !m || !m.html || !m.host) return null;
    if(node.type==='external') return null;
    if(node.gid && node.gid!=='base') return null;          // only the primary loaded repo (not compare schemas)
    const sub=m.sub ? m.sub.replace(/\/$/,'')+'/' : '';
    const full=(sub+(node.path||'')).replace(/^\/+/,'');
    const enc=full.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const br=encodeURIComponent(m.branch||m.repoInfo&&m.repoInfo.defaultBranch||'main');
    const isFile=node.type==='file';
    if(!enc) return m.html;                                  // root -> repo home
    if(m.host==='gitlab')    return `${m.html}/-/${isFile?'blob':'tree'}/${br}/${enc}`;
    if(m.host==='bitbucket') return `${m.html}/src/${br}/${enc}`;
    return `${m.html}/${isFile?'blob':'tree'}/${br}/${enc}`; // github
  }

  // ---- shareable view: encode src + layout + camera + selection into the URL hash ----
  let _hashT=0; A._restoring=false;   // _restoring czyta też resetProjectState (app-core.js)
  function serializeView(){
    if(A._restoring || !A.graph || !A.graph.nodes || A.graph.nodes.size===0) return '';
    const c=A.renderer.cam, m=A.graph.meta||{};
    const o={ v:1, ly:state.layout, cam:[+c.x.toFixed(1),+c.y.toFixed(1),+c.zoom.toFixed(4),+c.rot.toFixed(4),+c.tilt.toFixed(3)] };
    if(m.html && /^(github|gitlab|bitbucket)$/.test(m.kind||'')){ o.src=m.html; if(m.branch) o.b=m.branch; }
    if(A.renderer.selected) o.sel=A.renderer.selected.id;
    return '#v='+encodeURIComponent(JSON.stringify(o));
  }
  function updateHash(){ clearTimeout(_hashT); _hashT=setTimeout(()=>{
    const h=serializeView(); if(h && h!==location.hash){ try{ history.replaceState(null,'',h); }catch(e){} }
  },450); }
  function copyViewLink(){
    const h=serializeView(); if(!h){ U.toast(I.t('ca.noViewYet','Najpierw wczytaj projekt, aby udostępnić widok.'),'error'); return; }
    const url=location.origin+location.pathname+h;
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(url).then(
      ()=>U.toast(I.t('ca.linkCopied','🔗 Skopiowano link do tego widoku.'),'success'),
      ()=>U.toast(url,'',6000)); }
    else U.toast(url,'',6000);
  }
  async function restoreView(){
    const raw=location.hash; if(!raw || !raw.startsWith('#v=')) return false;
    let o; try{ o=JSON.parse(decodeURIComponent(raw.slice(3))); }catch(e){ return false; }
    if(!o || o.v!==1) return false;
    // camera + selection only — the layout is applied BEFORE ingest (below) so no relayout is dispatched
    // here (dispatching 'change' would trigger a second fit-on-settle that clobbers the restored camera)
    const applyCam=()=>{
      try{
        if(o.sel){ A.revealNode(o.sel); }
        if(o.cam && A.renderer.cam){ const c=A.renderer.cam, a=o.cam; c.x=a[0]; c.y=a[1]; c.zoom=a[2]; c.rot=a[3]||0; c.tilt=a[4]||0; c._k=''; }
        if(o.sel){ const n=A.graph.nodes.get(o.sel); if(n){ A.renderer.setSelected(n); UI.renderDetails(n, A.graph, handlers); A.applyImpact(); } }
        A.renderer.onChange(); A.renderer.kick();
      }catch(e){}
    };
    if(o.src){
      A._restoring=true;
      // set the target layout first — ingest reads #sel-layout for its own (single) layout + refit pass
      if(o.ly){ const s=$('#sel-layout'); if(s && Array.from(s.options).some(op=>op.value===o.ly)){ s.value=o.ly;
        const lbl=$('#layout-menu-label'), opt=s.querySelector('option[value="'+o.ly+'"]'); if(lbl&&opt) lbl.textContent=opt.textContent; } }
      // restore the camera when the layout SETTLES (onSettle) instead of on a fixed timer that lost the race
      state._pendingViewRestore=applyCam;
      try{ await A.ingest((p,s)=>Loaders.fromRepoURL(o.src, {branch:o.b, fetchContent:true}, p, s), I.t('ca.connectingToRepo','Łączenie z repozytorium…')); }
      catch(e){}
      A._restoring=false;
      // fallback for static layouts (no physics settle → onSettle may not fire): apply if still pending
      setTimeout(()=>{ if(state._pendingViewRestore===applyCam){ state._pendingViewRestore=null; state._fitOnSettle=false; applyCam(); } }, 600);
      return true;
    }
    return false;   // local project: cannot reload from a link, only the view params are carried
  }

  // ---------------- recently loaded repositories (quick re-load chips in the GitHub modal) ----------------
  const RECENT_KEY='codemap_recent_repos';
  function recentRepos(){ try{ return JSON.parse(localStorage.getItem(RECENT_KEY)||'[]'); }catch(e){ return []; } }
  function pushRecentRepo(meta){
    if(!meta || !meta.html) return;
    let list=recentRepos().filter(r=>r.url!==meta.html);
    list.unshift({url:meta.html, name:meta.name||meta.repo||meta.html, host:meta.host||meta.kind||'github'});
    try{ localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0,6))); }catch(e){}
  }
  function renderRecentRepos(){
    const wrap=$('#gh-recent'); if(!wrap) return;
    const list=recentRepos(); wrap.innerHTML='';
    if(!list.length){ wrap.classList.add('hidden'); return; }
    wrap.classList.remove('hidden');
    wrap.appendChild(el('div',{class:'gh-recent-lbl',text:CM.i18n.t('gh.recent','Ostatnie repozytoria')}));
    const row=el('div',{class:'gh-recent-row'});
    list.forEach(r=>{
      const chip=el('button',{class:'gh-recent-chip',title:r.url},
        el('span',{class:'gh-recent-ic',html:CM.icons.svg('globe',{size:13})}),
        el('span',{class:'gh-recent-name',text:r.name}));
      chip.onclick=()=>{ $('#gh-url').value=r.url; $('#gh-go').click(); };
      row.appendChild(chip);
    });
    wrap.appendChild(row);
  }

  // ---------------- branch/tag picker + API rate limit ----------------
  function fillRefList(refs){
    const dl=$('#gh-branch-list'); if(!dl) return; dl.innerHTML='';
    (refs.branches||[]).forEach(b=>dl.appendChild(el('option',{value:b})));
    (refs.tags||[]).forEach(t=>dl.appendChild(el('option',{value:t})));
  }
  async function refreshGhRate(){
    const box=$('#gh-rate'); if(!box) return;
    const url=$('#gh-url').value.trim();
    if(url && Loaders.repoHost(url)!=='github'){ box.textContent=''; box.classList.remove('low'); return; }  // rate endpoint is GitHub-only
    box.textContent=CM.i18n.t('gh.rateChecking','Sprawdzanie limitu API…'); box.classList.remove('low');
    const rl=await Loaders.ghRateLimit($('#gh-token').value.trim()||undefined);
    if(!rl){ box.textContent=''; return; }
    const low=rl.remaining<=5;
    box.classList.toggle('low', low);
    box.innerHTML=CM.i18n.t('gh.rateLabel','Limit API GitHub: ')+'<b>'+rl.remaining+' / '+rl.limit+'</b>'+
      (rl.limit<=60 ? (' · '+CM.i18n.t('gh.rateHint','dodaj token, by zwiększyć do 5000')) : '');
  }

  // ---------------- compare two branches/tags as a diff (green=added, red=removed, yellow=changed) ----------------
  async function compareBranches(url, refA, refB, token){
    if(!url){ U.toast(I.t('ca.enterAddress','Podaj adres.'),'error'); return; }
    if(!refA || !refB){ U.toast(I.t('ca.cmpPick','Podaj obie gałęzie/tagi do porównania.'),'error'); return; }
    if(token) state._ghToken=token;
    A.closeModal($('#modal-github'));
    const gen=++A._ingestGen;   // share the ingest generation token: Cancel or a newer load supersedes this
    A.showLoading(I.t('ca.cmpLoading','Porównywanie ')+refA+' → '+refB+'…');
    try{
      await A.tick();
      const sigA=await Loaders.fetchTreeSig(url, refA, token); if(gen!==A._ingestGen) return;
      const sigB=await Loaders.fetchTreeSig(url, refB, token); if(gen!==A._ingestGen) return;
      A.setLoadingText(I.t('ca.buildingMapPre','Analiza i budowanie mapy (')+sigB.fileCount+I.t('ca.buildingMapPost',' plików)…')); await A.tick();
      const {files, meta}=await Loaders.fromRepoURL(url, {branch:refB, token, fetchContent:true}, A.setProgress, A.setLoadingText);
      if(gen!==A._ingestGen) return;
      A.resetProjectState();   // clear stale groups/cycles/selection/diff from a previous project before rebuilding
      A.graph=new Graph(); A.graph.build(files, meta);
      filters.langsOff.clear();
      state.layout=$('#sel-layout').value; state.displayLayout=state.layout;
      A.autoTuneView();
      A.refreshMetricRange(); A.hideEmpty(); A.expandMinimap();
      const diff=CM.Graph.diffSignatures(sigA, sigB); state.lastDiff=diff;
      Storage.applyDiffToGraph(A.graph, diff); A.renderer.diffMode=true;
      A.select(null); A.countsInit(); A.apply({refit:true});
      if(meta.html && /^(github|gitlab|bitbucket)$/.test(meta.kind||'')) pushRecentRepo(meta);
      UI.renderDiff(diff, {label:refA, signature:sigA}, {label:refB, signature:sigB}); A.openModal('modal-diff');
      U.toast(I.t('ca.cmpDone','Porównano ')+refA+' ↔ '+refB+'  (+'+diff.added.length+' / −'+diff.removed.length+' / ~'+diff.modified.length+')','success',6000);
    }catch(e){ if(gen!==A._ingestGen) return; console.error(e); U.toast(I.t('ca.loadError','Błąd wczytywania: ')+e.message,'error',6500); }
    if(gen===A._ingestGen) A.hideLoading();
  }

  // ---------------- export the current map as a GitHub Gist ----------------
  async function exportGist(){
    if(state.counts.nodes===0){ U.toast(I.t('ca.noMapToExport','Brak mapy do eksportu.'),'error'); return; }
    let token=($('#gh-token')&&$('#gh-token').value.trim())||state._ghToken;
    if(!token){ token=prompt(I.t('ca.gistTokenPrompt','Wklej token GitHub z uprawnieniem „gist":')); if(token) token=token.trim(); }
    if(!token) return;
    state._ghToken=token;
    U.toast(I.t('ca.gistUploading','Wysyłanie Gist…'),'',2000);
    try{
      const content=JSON.stringify(A.graph.toJSON());
      const res=await Loaders.createGist(content, 'CodeMap — '+(A.graph.meta.name||'mapa'), token, false);
      try{ navigator.clipboard&&navigator.clipboard.writeText(res.url); }catch(e){}
      U.toast(I.t('ca.gistDone','✅ Gist utworzony (URL skopiowany).'),'success',6000);
      window.open(res.url,'_blank','noopener');
    }catch(e){ U.toast(I.t('ca.gistFail','Gist nie powiódł się: ')+e.message,'error',6500); }
  }

  Object.assign(A, {
    ghAvatarUrl, refreshAuthors, centroidOf, positionAuthors, ensureAuthorCard, closeAuthorCard, fmtJoined, renderAuthorCard,
    escapeHtml, safeUrl, openAuthorCard, repoHostName, nodeRepoUrl, serializeView, updateHash, copyViewLink,
    restoreView, recentRepos, pushRecentRepo, renderRecentRepos, fillRefList, refreshGhRate, compareBranches, exportGist,
  });
})();
