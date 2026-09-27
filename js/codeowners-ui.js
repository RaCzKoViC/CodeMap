/* ===================== codeowners-ui.js — CODEOWNERS w panelu, nakładka i akcja ChatBota ===================== */
// Sekcja „CODEOWNERS" w panelu szczegółów pliku (deklarowani właściciele, linia reguły, właściciel z historii git
// i oznaczenie rozjazdu / braku właściciela), nakładka „Właściciel (CODEOWNERS)" kolorująca pliki wg pierwszego
// deklarowanego właściciela i akcja ChatBota `codeOwners`. Logika: codeowners.js (czysta, testowana w Node).
(function(){
  const A=CM.App, U=CM.util, el=U.el, I=CM.i18n, CO=CM.CodeOwners, OV=CM.Overlays;
  const STR={
    pl:{'co.title':'CODEOWNERS','co.none':'bez właściciela','co.rule':'reguła {p} (linia {l})','co.git':'git: {who} {s} %','co.drift':'rozjazd z historią',
      'co.ov':'Właściciel (CODEOWNERS)','co.ovNone':'bez właściciela','co.ovNote':'Pierwszy deklarowany właściciel wg pliku {f} (ostatnia pasująca reguła). Kliknij, aby podświetlić pliki.',
      'co.unavail':'Brak pliku CODEOWNERS (.github/, korzeń, docs/ albo .gitlab/).','co.sum':'CODEOWNERS ({f}): reguły {r}, pliki kodu bez właściciela {u}, rozjazdy z git {d}. Najwięcej plików: {top}',
      'co.file':'{p}: {o} (reguła {pat}, linia {l})','co.fileNone':'{p}: brak właściciela w CODEOWNERS','co.others':'inni'},
    en:{'co.title':'CODEOWNERS','co.none':'no owner','co.rule':'rule {p} (line {l})','co.git':'git: {who} {s} %','co.drift':'drift from history',
      'co.ov':'Owner (CODEOWNERS)','co.ovNone':'no owner','co.ovNote':'First declared owner per {f} (last matching rule). Click to highlight the files.',
      'co.unavail':'No CODEOWNERS file (.github/, root, docs/ or .gitlab/).','co.sum':'CODEOWNERS ({f}): rules {r}, code files without an owner {u}, drifts from git {d}. Most files: {top}',
      'co.file':'{p}: {o} (rule {pat}, line {l})','co.fileNone':'{p}: no owner in CODEOWNERS','co.others':'others'},
  };
  const t=(k,sub)=>{ const l=(I&&I.getLang&&I.getLang())==='en'?'en':'pl'; let s=(STR[l]&&STR[l][k])||STR.pl[k]||k; if(sub) for(const p in sub) s=s.split('{'+p+'}').join(sub[p]); return s; };
  // analiza raz na graf i jego stan historii (gitInfo podmieniany po „Historia git")
  let memo={g:null, gi:null, res:null};
  function analysis(g){ if(memo.g!==g || memo.gi!==g.gitInfo){ memo={g, gi:g.gitInfo, res:CO.analyze(g)}; } return memo.res; }

  if(CM.UI && CM.UI.addDetailSection) CM.UI.addDetailSection((node, g)=>{
    if(!node || node.type!=='file' || !g || !g.nodes || (node.gid && node.gid!=='base')) return null;
    const co=analysis(g); if(!co) return null;
    const hit=co.byFile.get(node.id);
    const sec=el('div',{class:'det-section det-codeowners'}, el('h5',{}, t('co.title')));
    const tags=el('div',{});
    if(hit && hit.owners.length) hit.owners.forEach(o=>tags.appendChild(el('span',{class:'tag',text:o})));
    else tags.appendChild(el('span',{class:'tag hot',text:t('co.none')}));
    const dr=co.drift.find(x=>x.id===node.id);
    if(dr) tags.appendChild(el('span',{class:'tag hot',title:t('co.git',{who:(g.gitInfo.authors[dr.own]||{}).name||'?', s:Math.round(dr.share*100)}),text:t('co.drift')}));
    sec.appendChild(tags);
    if(hit) sec.appendChild(el('div',{class:'muted small',text:t('co.rule',{p:hit.pattern, l:hit.line})+' · '+co.file}));
    if(node.git && node.git.own!=null && g.gitInfo && g.gitInfo.authors) sec.appendChild(el('div',{class:'muted small',text:t('co.git',{who:(g.gitInfo.authors[node.git.own]||{}).name||'?', s:Math.round(node.git.share*100)})}));
    return sec;
  });

  if(OV && OV.register) OV.register({id:'codeowners', order:24, label:()=>t('co.ov'), available:(g)=>!!(g && CO.find(g)), unavailable:()=>t('co.unavail'),
    compute(g){
      const co=analysis(g), groups=new Map(), none=new Set();
      for(const [id,hit] of co.byFile){ const o=hit&&hit.owners.length?hit.owners[0]:null; if(!o){ none.add(id); continue; } if(!groups.has(o)) groups.set(o,new Set()); groups.get(o).add(id); }
      const ranked=[...groups.entries()].sort((a,b)=>b[1].size-a[1].size), color=new Map(), items=[], other=new Set();
      ranked.forEach(([o,ids],i)=>{ if(i<11){ const pal=(OV.PALETTE||['#22d3ee']).filter(x=>x!=='#f87171'), c=pal[i%pal.length]; color.set(o,c); items.push({color:c, label:o, count:ids.size, ids}); } else ids.forEach(x=>other.add(x)); });
      if(other.size) items.push({color:'#94a3b8', label:t('co.others'), count:other.size, ids:other});
      if(none.size) items.push({color:'#ef4444', label:t('co.ovNone'), count:none.size, ids:none});
      return {colorOf:(n)=>{ if(n.type!=='file') return n.type==='folder'?OV.FOLDER:OV.NONE; const h=co.byFile.get(n.id), o=h&&h.owners.length?h.owners[0]:null;
          return o?(color.get(o)||'#94a3b8'):'#ef4444'; },
        legend:{items, note:t('co.ovNote',{f:co.file})}};
    }});

  function find(g, q){ q=String(q||'').toLowerCase().trim(); let best=null, bs=-1;
    for(const n of g.nodes.values()){ if(n.type!=='file') continue; const nm=(n.name||'').toLowerCase(), p=(n.path||'').toLowerCase();
      const s=p===q||nm===q?3:p.endsWith('/'+q)?2:nm.includes(q)||p.includes(q)?1:-1; if(s>bs){ bs=s; best=n; } }
    return bs>0?best:null; }
  if(A.registerAction) A.registerAction({name:'codeOwners', sig:'{query?}',
    desc:'CODEOWNERS vs real ownership from git history: owners of a file, or a summary (code files without an owner, drift where the declared owner has barely touched the file); colors the map by declared owner',
    descPl:'CODEOWNERS a własność z historii git — właściciele pliku albo podsumowanie', auto:true, info:true,
    run:(a)=>{
      const g=A.graph; if(!g) throw new Error(I.t('cb.noProject','Najpierw wczytaj projekt (CodeMap).'));
      const co=analysis(g); if(!co) throw new Error(t('co.unavail'));
      const q=a&&(a.query||a.path||a.file);
      if(q){ const n=find(g,q); if(!n) throw new Error(I.t('cb.notFound','Nie znaleziono: ')+q); if(A.focusNode) A.focusNode(n.id);
        const h=co.byFile.get(n.id); return h&&h.owners.length?t('co.file',{p:n.path, o:h.owners.join(' '), pat:h.pattern, l:h.line}):t('co.fileNone',{p:n.path}); }
      try{ OV.set('codeowners'); }catch(e){ /* nakładka niedostępna w tym widoku — samo podsumowanie */ }
      const cnt=new Map(); for(const h of co.byFile.values()) if(h&&h.owners.length) cnt.set(h.owners[0],(cnt.get(h.owners[0])||0)+1);
      const top=[...cnt.entries()].sort((x,y)=>y[1]-x[1]).slice(0,6).map(([o,c])=>o+' ('+c+')').join(', ')||'—';
      return t('co.sum',{f:co.file, r:co.rules.length, u:co.unowned.length, d:co.drift.length, top});
    }});
})();
