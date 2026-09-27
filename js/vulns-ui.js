/* ===================== vulns-ui.js — okno „Podatne zależności (OSV.dev)" ===================== */
// Na żądanie: najpierw pokazuje, co dokładnie wyjdzie do api.osv.dev (nazwy i wersje pakietów — bez kodu, ścieżek
// i nazwy projektu), dopiero przycisk wysyła zapytanie. Wynik: tabela podatnych pakietów (ważność, identyfikatory
// z linkami do osv.dev, wersja z poprawką, bezpośrednia / przechodnia), zapis na grafie (graph.vulnInfo — reguła
// Inspect „vulndep", zapis mapy), nakładka „Podatności" i sekcja przy węźle zależności. Logika: vulns.js.
(function(){
  const A=CM.App, U=CM.util, el=U.el, I=CM.i18n, V=CM.Vulns, OV=CM.Overlays;
  const STR={
    pl:{'vu.menu':'Podatne zależności (OSV.dev)…','vu.title':'Podatne zależności (OSV.dev)',
      'vu.send':'Do api.osv.dev zostaną wysłane wyłącznie nazwy i wersje pakietów (liczba: {n}; {eco}) — bez kodu, ścieżek plików i nazwy projektu.',
      'vu.lower':'Część wersji pochodzi z manifestów bez pliku blokady — to dolna granica zakresu, więc wynik jest przybliżony.',
      'vu.none':'Brak zależności z wersjami do sprawdzenia (package.json, requirements.txt, Cargo.toml, go.mod albo pliki blokad).',
      'vu.check':'Sprawdź w OSV.dev','vu.again':'Sprawdź ponownie','vu.checking':'Sprawdzanie… {d} / {n}','vu.err':'Nie udało się: ',
      'vu.sum':'Sprawdzono: {c} · podatne: {v}','vu.clean':'Żaden ze sprawdzonych pakietów nie ma znanych podatności.','vu.at':'wynik z {d}',
      'vu.pkg':'pakiet','vu.ver':'wersja','vu.lvl':'ważność','vu.ids':'podatności','vu.fix':'poprawka','vu.tr':'przechodnia','vu.dir':'bezpośrednia',
      'vu.sec':'Podatności (OSV.dev)','vu.ov':'Podatności (OSV.dev)','vu.ovNote':'Węzły zależności i pliki manifestów z podatnymi pakietami — kolor wg najwyższej ważności.',
      'vu.unavail':'Najpierw sprawdź podatne zależności (Projekt → Podatne zależności).','vu.act':'Podatne zależności: ','vu.trunc':'Szczegóły pobrano dla części podatności (limit zapytań).'},
    en:{'vu.menu':'Vulnerable dependencies (OSV.dev)…','vu.title':'Vulnerable dependencies (OSV.dev)',
      'vu.send':'Only package names and versions (count: {n}; {eco}) will be sent to api.osv.dev — no code, file paths or project name.',
      'vu.lower':'Some versions come from manifests without a lockfile — they are the lower bound of a range, so the result is approximate.',
      'vu.none':'No dependencies with versions to check (package.json, requirements.txt, Cargo.toml, go.mod or lockfiles).',
      'vu.check':'Check on OSV.dev','vu.again':'Check again','vu.checking':'Checking… {d} / {n}','vu.err':'Failed: ',
      'vu.sum':'Checked: {c} · vulnerable: {v}','vu.clean':'None of the checked packages has known vulnerabilities.','vu.at':'result from {d}',
      'vu.pkg':'package','vu.ver':'version','vu.lvl':'severity','vu.ids':'vulnerabilities','vu.fix':'fixed in','vu.tr':'transitive','vu.dir':'direct',
      'vu.sec':'Vulnerabilities (OSV.dev)','vu.ov':'Vulnerabilities (OSV.dev)','vu.ovNote':'Dependency nodes and manifest files with vulnerable packages — colored by the highest severity.',
      'vu.unavail':'Check vulnerable dependencies first (Project → Vulnerable dependencies).','vu.act':'Vulnerable dependencies: ','vu.trunc':'Details were fetched for part of the vulnerabilities (request limit).'},
  };
  const t=CM.UIKit.strings(STR);
  // link zawsze z identyfikatora — vulnInfo może pochodzić z cudzej, udostępnionej mapy
  const osvUrl=(v)=>'https://osv.dev/vulnerability/'+encodeURIComponent(String(v&&v.id||''));
  const COL={CRITICAL:'#dc2626', HIGH:'#f97316', MODERATE:'#facc15', LOW:'#60a5fa'};
  const lvlTag=(l)=>el('span',{class:'tag vu-lvl', style:'border-color:'+(COL[l]||'#94a3b8')+';color:'+(COL[l]||'#94a3b8'), text:l||'?'});
  let busy=null;

  function results(dlg, g){
    const vi=g.vulnInfo, items=vi.items;
    dlg.body.appendChild(el('div',{class:'vu-sum'}, el('b',{text:t('vu.sum',{c:vi.checked, v:items.length})}), el('span',{class:'muted small', text:' · '+t('vu.at',{d:new Date(vi.at).toLocaleString()})})));
    if(vi.truncated) dlg.body.appendChild(el('div',{class:'muted small', text:t('vu.trunc')}));
    if(!items.length){ dlg.body.appendChild(el('div',{class:'vu-clean', text:t('vu.clean')})); return; }
    const table=el('table',{class:'vu-table'}, el('tr',{}, ...['vu.pkg','vu.ver','vu.lvl','vu.ids','vu.fix'].map(k=>el('th',{text:t(k)}))));
    for(const it of items){
      const ids=el('td',{class:'vu-ids'});
      it.vulns.slice(0,6).forEach(v=>ids.appendChild(el('a',{href:osvUrl(v), target:'_blank', rel:'noopener noreferrer', title:v.summary||v.id, text:v.id})));
      if(it.vulns.length>6) ids.appendChild(el('span',{class:'muted', text:' +'+(it.vulns.length-6)}));
      table.appendChild(el('tr',{class:'vu-row', onclick:(e)=>{ if(e.target.tagName==='A') return; const n=g.nodes.get('ext:'+it.name)||g.nodes.get(it.file);
          if(n && A.focusNode) A.focusNode(n.id); if(n && n.importers && A.renderer && A.renderer.setHighlight) A.renderer.setHighlight(new Set([n.id, ...n.importers])); }},
        el('td',{}, el('b',{text:it.name}), el('span',{class:'muted small', text:' '+it.ecosystem+' · '+(it.direct===false?t('vu.tr'):t('vu.dir'))})),
        el('td',{text:it.version+(it.exact?'':' ≥')}), el('td',{}, lvlTag(it.level)), ids, el('td',{text:it.fixed||'—'})));
    }
    dlg.body.appendChild(el('div',{class:'vu-wrap'}, table));
  }

  function render(dlg){
    const g=A.graph; dlg.clear();
    const list=V.collect(g);
    if(g.vulnInfo) results(dlg, g);
    if(!list.length){ dlg.body.appendChild(el('div',{class:'muted', text:t('vu.none')})); return; }
    const eco={}; list.forEach(p=>eco[p.ecosystem]=(eco[p.ecosystem]||0)+1);
    dlg.body.appendChild(el('div',{class:'vu-send', text:t('vu.send',{n:list.length, eco:Object.entries(eco).map(([k,v])=>k+' '+v).join(', ')})}));
    if(list.some(p=>!p.exact)) dlg.body.appendChild(el('div',{class:'muted small', text:t('vu.lower')}));
    const status=el('div',{class:'muted small vu-status'});
    const btn=el('button',{class:'tb-btn primary', type:'button', text:g.vulnInfo?t('vu.again'):t('vu.check'), onclick:async()=>{
      if(busy) return; btn.disabled=true; busy=new AbortController();
      try{
        const r=await V.query(list, {signal:busy.signal, onProgress:(d,n)=>{ status.textContent=t('vu.checking',{d,n}); }});
        V.applyToGraph(g, r);
        try{ if(OV && OV.set) OV.set('vulns'); }catch(e){ /* nakładka niedostępna — wynik i tak w oknie */ }
        render(dlg);
      }catch(e){ status.textContent=t('vu.err')+(e&&e.message||e); btn.disabled=false; }
      finally{ busy=null; }
    }});
    dlg.foot.appendChild(status); dlg.foot.appendChild(btn);
  }

  function open(){
    if(!A.graph||!A.state||!A.state.counts||!A.state.counts.nodes) throw new Error(I.t('cb.noProject','Najpierw wczytaj projekt (CodeMap).'));
    const dlg=CM.UIKit.modal('modal-vulns','share-modal vu-modal','vu').title(t('vu.title'));
    render(dlg); dlg.open(); return dlg;
  }

  CM.UIKit.menuItem({id:'btn-vulns', after:'btn-inspect', icon:'target', text:()=>t('vu.menu'), open:()=>open()});

  // podatne pakiety przy węźle: zależność zewnętrzna po nazwie, plik manifestu / blokady po ścieżce
  const itemsFor=(g,n)=>!g.vulnInfo?[]:g.vulnInfo.items.filter(it=>(n.type==='external'&&it.name===n.name)||(n.type==='file'&&it.file===n.path));
  if(CM.UI && CM.UI.addDetailSection) CM.UI.addDetailSection((node, g)=>{
    if(!node || !g || !g.vulnInfo || (node.type!=='external' && node.type!=='file')) return null;
    const list=itemsFor(g, node); if(!list.length) return null;
    const sec=el('div',{class:'det-section det-vulns'}, el('h5',{}, t('vu.sec'), el('span',{class:'muted', text:list.length})));
    for(const it of list.slice(0,12)){
      const row=el('div',{class:'vu-det'}, lvlTag(it.level), el('b',{text:' '+it.name+' '+it.version}), el('span',{class:'muted small', text:it.fixed?' → '+it.fixed:''}));
      it.vulns.slice(0,4).forEach(v=>row.appendChild(el('a',{href:osvUrl(v), target:'_blank', rel:'noopener noreferrer', class:'vu-id', title:v.summary||'', text:v.id})));
      sec.appendChild(row);
    }
    return sec;
  });

  if(OV && OV.register) OV.register({id:'vulns', order:26, label:()=>t('vu.ov'), available:(g)=>!!(g&&g.vulnInfo), unavailable:()=>t('vu.unavail'),
    compute(g){
      const lvl=new Map(), R=V.RANK;
      for(const it of g.vulnInfo.items) for(const key of ['ext:'+it.name, it.file]){ if(!key) continue; const cur=lvl.get(key); if(!cur || (R[it.level]||0)>(R[cur]||0)) lvl.set(key, it.level||'MODERATE'); }
      const items=[];
      for(const l of ['CRITICAL','HIGH','MODERATE','LOW']){ const ids=new Set([...lvl].filter(([,v])=>v===l).map(([k])=>k).filter(k=>g.nodes.has(k))); if(ids.size) items.push({color:COL[l], label:l, count:ids.size, ids}); }
      return {colorOf:(n)=>lvl.has(n.id)?COL[lvl.get(n.id)]||COL.MODERATE:(n.type==='folder'?OV.FOLDER:OV.NONE), legend:{items, note:t('vu.ovNote')}};
    }});

  if(A.registerAction) A.registerAction({name:'vulnerabilities', sig:'',
    desc:'open the vulnerable-dependencies window (OSV.dev): shows exactly what would be sent (package names and versions only) and lets the user run the check; if a result exists, returns it',
    descPl:'Podatne zależności (OSV.dev) — okno z potwierdzeniem wysyłki; zwraca wynik, jeśli już jest', auto:false,
    run:()=>{ open(); const g=A.graph; if(!g.vulnInfo) return t('vu.act')+t('vu.send',{n:V.collect(g).length, eco:'…'});
      return t('vu.act')+t('vu.sum',{c:g.vulnInfo.checked, v:g.vulnInfo.items.length})+(g.vulnInfo.items.length?': '+g.vulnInfo.items.slice(0,10).map(it=>it.name+' '+it.version+' ('+(it.level||'?')+(it.fixed?' → '+it.fixed:'')+')').join(', '):''); }});
  CM.VulnsUI={open};
})();
