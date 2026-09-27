/* ===================== ui-kit.js — wspólne elementy UI modułów ===================== */
// Małe klocki, które powtarzały się w git.js, pr.js i links.js (Inspect „zduplikowany kod" wskazał je sam):
//  • pill(cancelTitle, onCancel)  — pigułka postępu w #toast-wrap z przyciskiem × (anulowanie),
//  • modal(id)                    — okno dialogowe .modal-backdrop z nagłówkiem, treścią i stopką (Esc / klik w tło zamyka),
//  • repoToken()                  — token z okna „Wczytaj…" (albo zapamiętany w karcie) dla API hostingu,
//  • fileIndex(graph)             — mapa ścieżka → węzeł pliku projektu bazowego (bez schematów porównawczych),
//  • barRow(label, pct, col, value, attrs) — wiersz wykresu słupkowego .bar-row (git: autorzy, PR: ryzyko, testy: pokrycie).
CM.UIKit = (function(){
  const U=CM.util, el=U.el, $=U.$;

  function pill(cancelTitle, onCancel){
    let node=null;
    return {
      show(text){
        let wrap=$('#toast-wrap'); if(!wrap){ wrap=el('div',{id:'toast-wrap'}); document.body.appendChild(wrap); }
        if(!node){
          node=el('div',{class:'toast sym-pill git-pill'}, el('span',{class:'gp-t'}));
          if(onCancel) node.appendChild(el('button',{class:'gp-x',title:cancelTitle||'×','aria-label':cancelTitle||'×',text:'×',onclick:()=>onCancel()}));
          wrap.appendChild(node);
        }
        node.querySelector('.gp-t').textContent=text;
      },
      hide(){ if(node){ const p=node; node=null; p.style.transition='opacity .3s'; p.style.opacity='0'; setTimeout(()=>p.remove(),300); } },
      get visible(){ return !!node; },
    };
  }

  // prefix: identyfikatory części (prefix-title / -body / -foot); domyślnie id okna
  function modal(id, cls, prefix){
    const P=prefix||id;
    let m=$('#'+id);
    if(!m){
      const close=()=>m.classList.add('hidden');
      m=el('div',{class:'modal-backdrop hidden',id,role:'dialog','aria-modal':'true','aria-labelledby':P+'-title'},
        el('div',{class:'modal '+(cls||'share-modal')},
          el('div',{class:'modal-head'}, el('h3',{id:P+'-title'}), el('button',{class:'modal-x',type:'button','aria-label':'✕',text:'✕',onclick:close})),
          el('div',{class:'modal-body',id:P+'-body'}), el('div',{class:'modal-foot',id:P+'-foot'})));
      m.addEventListener('mousedown',(e)=>{ if(e.target===m) close(); });
      m.addEventListener('keydown',(e)=>{ if(e.key==='Escape') close(); });
      document.body.appendChild(m);
    }
    return {
      el:m, body:$('#'+P+'-body'), foot:$('#'+P+'-foot'),
      title(t){ $('#'+P+'-title').textContent=t; return this; },
      clear(){ this.body.innerHTML=''; this.foot.innerHTML=''; return this; },
      open(){ m.classList.remove('hidden'); return this; },
      close(){ m.classList.add('hidden'); return this; },
    };
  }

  function repoToken(){ const inp=$('#gh-token'); return ((inp&&inp.value.trim())||(CM.App&&CM.App.state&&CM.App.state._ghToken)||'')||undefined; }
  function fileIndex(graph){ const m=new Map(); if(graph&&graph.nodes) for(const n of graph.nodes.values()) if(n.type==='file'&&n.path&&(!n.gid||n.gid==='base')) m.set(n.path,n); return m; }
  // label: tekst (→ span.bl) albo gotowy element etykiety; pct = szerokość paska w %, col = jego kolor, value = tekst z prawej;
  // attrs = atrybuty wiersza (title, onclick, class — domyślnie 'bar-row')
  function barRow(label, pct, col, value, attrs){
    return el('div', Object.assign({class:'bar-row'}, attrs),
      label && typeof label==='object' ? label : el('span',{class:'bl',text:label}),
      el('div',{class:'bar-track'}, el('div',{class:'bar-fill',style:'width:'+pct+'%;background:'+col})),
      el('span',{class:'bv',text:value}));
  }

  return {pill, modal, repoToken, fileIndex, barRow};
})();
