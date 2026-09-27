/* ===================== dsm-ui.js — okno „Macierz zależności (DSM)" ===================== */
// Macierz jednostek (pakiety monorepo albo foldery; CM.DSM): wiersz zależy od kolumny, kolejność dostawcy → konsumenci,
// więc zdrowa architektura ma liczby tylko POD przekątną — komórki nad nią (czerwone) to zależności „pod prąd" = cykle.
// Klik w komórkę podświetla na mapie pliki tej zależności i wypisuje pary importów; klik w nagłówek wiersza — pliki
// jednostki. Pozycja w menu Projekt (po „Wykryj cykle") i akcja ChatBota `dependencyMatrix`.
(function(){
  const A=CM.App, U=CM.util, el=U.el, I=CM.i18n, D=CM.DSM;
  const STR={
    pl:{'dsm.menu':'Macierz zależności (DSM)','dsm.title':'Macierz zależności','dsm.units':'Jednostki','dsm.pk':'pakiety ({n})','dsm.f1':'foldery — poziom 1','dsm.f2':'foldery — poziom 2',
      'dsm.sum':'jednostki: {u} · zależności: {d} · cykle: {c} · nad przekątną: {a}','dsm.hint':'Wiersz zależy od kolumny (liczba importów). Kolejność: dostawcy u góry, konsumenci niżej — zdrowe zależności leżą pod przekątną; czerwone komórki nad nią to zależności „pod prąd", czyli cykle. Klik w komórkę: pliki na mapie i pary importów.',
      'dsm.none':'Brak zależności między jednostkami.','dsm.many':'Za dużo jednostek ({n}) — wybierz płytszy poziom.','dsm.pairs':'{a} → {b}: importy ({n})','dsm.files':'pliki','dsm.outside':'(poza pakietami)','dsm.root':'(korzeń)',
      'dsm.cycle':'cykl','dsm.act':'Macierz zależności: ','dsm.noProject':'Najpierw wczytaj projekt (CodeMap).'},
    en:{'dsm.menu':'Dependency matrix (DSM)','dsm.title':'Dependency matrix','dsm.units':'Units','dsm.pk':'packages ({n})','dsm.f1':'folders — level 1','dsm.f2':'folders — level 2',
      'dsm.sum':'units: {u} · dependencies: {d} · cycles: {c} · above the diagonal: {a}','dsm.hint':'A row depends on a column (number of imports). Order: providers at the top, consumers below — healthy dependencies sit below the diagonal; red cells above it are upstream dependencies, i.e. cycles. Click a cell: files on the map and the import pairs.',
      'dsm.none':'No dependencies between units.','dsm.many':'Too many units ({n}) — pick a shallower level.','dsm.pairs':'{a} → {b}: imports ({n})','dsm.files':'files','dsm.outside':'(outside packages)','dsm.root':'(root)',
      'dsm.cycle':'cycle','dsm.act':'Dependency matrix: ','dsm.noProject':'Load a project first (CodeMap).'},
  };
  const t=(k,sub)=>{ const l=(I&&I.getLang&&I.getLang())==='en'?'en':'pl'; let s=(STR[l]&&STR[l][k])||STR.pl[k]||k; if(sub) for(const p in sub) s=s.split('{'+p+'}').join(sub[p]); return s; };
  const MAX_UNITS=80;
  let opts={mode:null, depth:1};

  const uname=(u)=>u.id===D.OUTSIDE ? t(u.name==='(korzeń)'?'dsm.root':'dsm.outside') : u.name;
  function unitFiles(g, m, id){
    const U2=D.units(g, {mode:m.mode, depth:opts.depth}), ids=new Set();
    for(const n of g.nodes.values()) if(n.type==='file'&&n.path&&(!n.gid||n.gid==='base')&&U2.of(n)===id) ids.add(n.id);
    return ids;
  }
  function highlight(ids){ if(A.renderer&&A.renderer.setHighlight) A.renderer.setHighlight(ids); }

  function render(dlg){
    const g=A.graph; dlg.clear();
    const pk=(g.packages||[]).length;
    const m=D.matrix(g, {mode:opts.mode||undefined, depth:opts.depth});
    // wybór jednostek
    const sel=el('select',{class:'share-select dsm-sel', onchange:()=>{ const v=sel.value; opts=v==='packages'?{mode:'packages', depth:1}:{mode:'folders', depth:+v.slice(1)}; render(dlg); }});
    if(pk>=2) sel.appendChild(el('option',{value:'packages',text:t('dsm.pk',{n:pk})}));
    sel.appendChild(el('option',{value:'f1',text:t('dsm.f1')})); sel.appendChild(el('option',{value:'f2',text:t('dsm.f2')}));
    sel.value=m.mode==='packages'?'packages':'f'+opts.depth;
    const deps=m.cells.reduce((s,r)=>s+r.reduce((a,x)=>a+(x?1:0),0),0);
    dlg.body.appendChild(el('div',{class:'dsm-top'}, el('label',{class:'muted small',text:t('dsm.units')+': '}), sel,
      el('span',{class:'muted small dsm-sum', text:t('dsm.sum',{u:m.units.length, d:deps, c:m.cycles.length, a:m.above})})));
    dlg.body.appendChild(el('div',{class:'muted small dsm-hint', text:t('dsm.hint')}));
    if(m.units.length>MAX_UNITS){ dlg.body.appendChild(el('div',{class:'dsm-empty', text:t('dsm.many',{n:m.units.length})})); return; }
    if(!deps){ dlg.body.appendChild(el('div',{class:'dsm-empty', text:t('dsm.none')})); }
    const inCycle=new Set(m.cycles.flat());
    const max=Math.max(1,...m.cells.flat());
    const pairsBox=el('div',{class:'dsm-pairs'});
    const table=el('table',{class:'dsm'});
    const head=el('tr',{}, el('th',{class:'dsm-corner'}));
    m.units.forEach((u,j)=>head.appendChild(el('th',{class:'dsm-col', title:uname(u), text:String(j+1)})));
    table.appendChild(head);
    let selCell=null;
    m.units.forEach((u,i)=>{
      const tr=el('tr',{});
      tr.appendChild(el('th',{class:'dsm-row'+(inCycle.has(u.id)?' cyc':''), title:uname(u)+(u.dir?' — '+u.dir:'')+' · '+u.files+' '+t('dsm.files'),
        onclick:()=>highlight(unitFiles(A.graph, m, u.id))}, el('span',{class:'dsm-i',text:String(i+1)}), el('span',{class:'dsm-n',text:uname(u)}),
        inCycle.has(u.id)?el('span',{class:'tag hot',text:t('dsm.cycle')}):null));
      m.cells[i].forEach((n,j)=>{
        if(i===j){ tr.appendChild(el('td',{class:'diag'})); return; }
        if(!n){ tr.appendChild(el('td',{})); return; }
        const up=j>i, a=0.14+0.55*Math.log(1+n)/Math.log(1+max);
        const td=el('td',{class:'dep'+(up?' up':''), title:t('dsm.pairs',{a:uname(u), b:uname(m.units[j]), n}), text:String(n),
          style:up?'':'background:rgba(34,211,238,'+a.toFixed(2)+')',
          onclick:()=>{
            if(selCell) selCell.classList.remove('sel'); selCell=td; td.classList.add('sel');
            const list=m.pairs.get(i+'>'+j)||[], ids=new Set();
            list.forEach(([s,tg])=>{ ids.add(s); ids.add(tg); }); highlight(ids);
            pairsBox.innerHTML='';
            pairsBox.appendChild(el('div',{class:'field-label', text:t('dsm.pairs',{a:uname(u), b:uname(m.units[j]), n})}));
            for(const [s,tg] of list.slice(0,40)){
              const sn=A.graph.nodes.get(s), tn=A.graph.nodes.get(tg);
              pairsBox.appendChild(el('div',{class:'dsm-pair', onclick:()=>{ if(A.focusNode) A.focusNode(s); }},
                el('span',{text:sn?sn.path:s}), el('span',{class:'muted',text:' → '}), el('span',{text:tn?tn.path:tg})));
            }
          }});
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
    dlg.body.appendChild(el('div',{class:'dsm-wrap'}, table));
    dlg.body.appendChild(pairsBox);
  }

  function open(o){
    if(!A.graph||!A.state||!A.state.counts||!A.state.counts.nodes) throw new Error(t('dsm.noProject'));
    if(o) opts=Object.assign({mode:null, depth:1}, o);
    const dlg=CM.UIKit.modal('modal-dsm','share-modal dsm-modal','dsm').title(t('dsm.title'));
    render(dlg); dlg.open();
    return dlg;
  }

  function wire(){
    const after=document.getElementById('btn-cycles');
    if(after && !document.getElementById('btn-dsm')){
      const b=el('button',{class:'menu-item', id:'btn-dsm', type:'button', 'data-ic':'layers', text:t('dsm.menu'),
        onclick:()=>{ document.querySelectorAll('.menu-panel').forEach(p=>p.classList.remove('open')); try{ open(); }catch(e){ if(A.toast) A.toast(e.message); } }});
      after.parentNode.insertBefore(b, after.nextSibling); if(CM.icons&&CM.icons.hydrate) CM.icons.hydrate(b.parentNode);
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wire); else setTimeout(wire, 0);

  if(A.registerAction) A.registerAction({name:'dependencyMatrix', sig:'{mode?:"packages"|"folders", depth?}',
    desc:'open the dependency structure matrix (DSM) of packages (monorepo) or folders: units ordered providers → consumers, dependencies above the diagonal are cycles; returns the order, cycles and upstream dependencies',
    descPl:'Macierz zależności (DSM) pakietów albo folderów: kolejność warstw, cykle, zależności pod prąd', auto:true, info:true,
    run:(a)=>{
      const o={mode:a&&(a.mode==='packages'||a.mode==='folders')?a.mode:null, depth:Math.max(1,Math.min(3,+(a&&a.depth)||1))};
      open(o);
      const m=D.matrix(A.graph, {mode:o.mode||undefined, depth:o.depth});
      const up=[]; m.cells.forEach((r,i)=>r.forEach((n,j)=>{ if(n&&j>i) up.push(uname(m.units[i])+' → '+uname(m.units[j])+' ('+n+')'); }));
      return t('dsm.act')+m.units.map((u,i)=>(i+1)+'. '+uname(u)).join(', ')
        +(m.cycles.length?' · '+t('dsm.cycle')+': '+m.cycles.map(c=>c.map(id=>uname(m.units.find(u=>u.id===id))).join(' ↔ ')).join('; '):'')
        +(up.length?' · ↑ '+up.slice(0,10).join(', '):'');
    }});
  CM.DSMUI={open};
})();
