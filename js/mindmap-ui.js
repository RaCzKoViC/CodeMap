/* ===================== mindmap-ui.js — widżety interfejsu MindMap =====================
   CM.MindMapUI — ogólne elementy bez wiedzy o modelu mapy: okno wpisywania tekstu (zamiast
   natywnego prompt(), działa też w PWA), popover, menu pionowe przy węźle, menu kontekstowe
   przy kursorze (zawsze jedno otwarte naraz) oraz przyciski pierścienia narzędzi wokół węzła.
   create(ctx) — ctx z mindmap.js: {root, canvas, anchorRect()} (anchorRect = zaznaczony węzeł
   albo środek widoku, w układzie współrzędnych #mindmap-root). */
CM.MindMapUI = (function(){
  const U = CM.util, I = CM.i18n;

  // przycisk z etykietą (górny / dolny pasek pierścienia)
  function sBtn(ic,label,fn,cls){ const b=U.el('button',{class:'mm-sb '+(cls||''),title:label});
    b.onmousedown=(e)=>e.stopPropagation(); b.onclick=(e)=>{ e.stopPropagation(); fn(); };
    CM.icons.set(b, ic, {size:18}); b.appendChild(U.el('span',{class:'mm-sb-lbl',text:label})); return b; }
  // sama ikona (wąskie kolumny lewa / prawa — etykieta w podpowiedzi)
  function sIcon(ic,label,fn,cls){ const b=U.el('button',{class:'mm-si '+(cls||''),title:label});
    b.onmousedown=(e)=>e.stopPropagation(); b.onclick=(e)=>{ e.stopPropagation(); fn(); };
    CM.icons.set(b, ic, {size:19}); return b; }
  function sBar(side, btns){ const bar=U.el('div',{class:'mm-sbar mm-sbar-'+side}); btns.forEach(b=>bar.appendChild(b)); return bar; }

  function create(ctx){
    // okno tekstu w aplikacji; Promise z wpisanym tekstem albo null po anulowaniu
    function input(title, value, opts){ opts=opts||{};
      return new Promise(resolve=>{
        let done=false; const finish=(v)=>{ if(done)return; done=true; ov.remove(); document.removeEventListener('keydown',onKey,true); resolve(v); };
        const ov=U.el('div',{id:'mm-input-modal',class:'mm-sl-modal'});   // styl okna zapisu / wczytania
        ov.addEventListener('pointerdown',(e)=>{ if(e.target===ov) finish(null); });
        const box=U.el('div',{class:'mm-sl-box',style:'max-width:'+(opts.mono?'620px':'440px')});
        const head=U.el('div',{class:'mm-sl-head'});
        head.appendChild(U.el('h3',{text:title}));
        head.appendChild(U.el('button',{class:'mm-sl-head-x',html:CM.icons.svg('x',{size:15}),onclick:()=>finish(null)}));
        const body=U.el('div',{class:'mm-sl-body'});
        const field = opts.multiline ? U.el('textarea',{class:'mm-input-field'+(opts.mono?' mm-input-mono':''),rows:opts.mono?'12':'4',spellcheck:'false'}) : U.el('input',{class:'mm-input-field',type:'text'});
        if(opts.placeholder) field.setAttribute('placeholder',opts.placeholder);
        field.value=value||'';
        if(opts.mono){ field.addEventListener('keydown',(e)=>{
          if(e.key==='Tab'){ e.preventDefault(); const s=field.selectionStart, en=field.selectionEnd; field.value=field.value.slice(0,s)+'  '+field.value.slice(en); field.selectionStart=field.selectionEnd=s+2; }
          else if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); finish(field.value); }
        }); }
        const foot=U.el('div',{class:'mm-input-foot'});
        foot.appendChild(U.el('button',{class:'mm-ld-btn',text:I.t('cm.btnCancel','Anuluj'),onclick:()=>finish(null)}));
        foot.appendChild(U.el('button',{class:'mm-ld-btn primary',text:I.t('cm.btnOk','OK'),onclick:()=>finish(field.value)}));
        body.appendChild(field); body.appendChild(foot);
        box.appendChild(head); box.appendChild(body); ov.appendChild(box);
        (ctx.canvas||document.body).appendChild(ov);
        const onKey=(e)=>{ if(e.key==='Escape'){ e.stopPropagation(); finish(null); } else if(e.key==='Enter'&&!opts.multiline){ e.stopPropagation(); finish(field.value); } };
        document.addEventListener('keydown',onKey,true);
        setTimeout(()=>{ field.focus(); field.select&&field.select(); },50);
      });
    }

    // ---- popover (kolor / kształt / szerokość / odstępy) i menu — jedno otwarte naraz ----
    let popEl=null;
    function closePop(){ if(popEl){ popEl.remove(); popEl=null; } }
    function anchorPop(el, above){
      const r=ctx.anchorRect();
      let left=U.clamp(r.cx, el.offsetWidth/2+8, r.rootW-el.offsetWidth/2-8);
      let top=above? r.top-el.offsetHeight-58 : (r.top+r.h+58);
      if(top<10) top=r.top+r.h+58; if(top+el.offsetHeight>r.rootH-10) top=Math.max(10,r.top-el.offsetHeight-58);
      el.style.left=left+'px'; el.style.top=top+'px';
    }
    function popover(title, build){
      closePop();
      popEl=U.el('div',{class:'mm-popover'});
      if(title) popEl.appendChild(U.el('div',{class:'mm-pop-title',text:title}));
      const box=U.el('div',{class:'mm-pop-body'}); popEl.appendChild(box); build(box);
      ctx.root.appendChild(popEl); anchorPop(popEl, true);
      const close=(e)=>{ if(popEl&&!popEl.contains(e.target)){ closePop(); document.removeEventListener('mousedown',close,true); } };
      setTimeout(()=>document.addEventListener('mousedown',close,true),0);
    }
    // pionowe menu ikon z listy pozycji {ic,t,fn,danger,primary} | {sep} | {head}
    function buildMenuEl(items){
      const el=U.el('div',{class:'mm-menu'});
      for(const it of items){
        if(it.sep){ el.appendChild(U.el('div',{class:'mm-menu-sep'})); continue; }
        if(it.head){ el.appendChild(U.el('div',{class:'mm-menu-head',text:it.head})); continue; }
        const b=U.el('button',{class:'mm-menu-item'+(it.danger?' danger':'')+(it.primary?' primary':'')});
        CM.icons.set(b, it.ic||'box', {size:it.primary?20:19}); b.appendChild(U.el('span',{text:it.t}));
        b.onmousedown=(e)=>e.stopPropagation(); b.onclick=(e)=>{ e.stopPropagation(); closePop(); it.fn(); };
        el.appendChild(b);
      }
      return el;
    }
    function armClose(){ const close=(e)=>{ if(popEl&&!popEl.contains(e.target)){ closePop(); document.removeEventListener('mousedown',close,true); document.removeEventListener('contextmenu',close,true); } };
      setTimeout(()=>{ document.addEventListener('mousedown',close,true); document.addEventListener('contextmenu',close,true); },0); }
    // menu zaczepione przy zaznaczonym węźle (podmenu „Schemat” / „Więcej”, eksport, Markdown)
    function menu(items){
      const root=ctx.root;
      closePop(); popEl=buildMenuEl(items); root.appendChild(popEl);
      const r=ctx.anchorRect();
      popEl.style.left=U.clamp(r.cx-popEl.offsetWidth/2, 10, r.rootW-popEl.offsetWidth-10)+'px';
      popEl.style.top=U.clamp(r.top, 10, r.rootH-popEl.offsetHeight-10)+'px';
      armClose();
    }
    // menu kontekstowe w stylu systemowym, otwierane przy kursorze (prawy przycisk)
    function contextMenu(clientX, clientY, items){
      const root=ctx.root;
      closePop(); popEl=buildMenuEl(items); root.appendChild(popEl);
      const rr=root.getBoundingClientRect(); let x=clientX-rr.left, y=clientY-rr.top;
      x=U.clamp(x, 8, rr.width-popEl.offsetWidth-8); y=U.clamp(y, 8, rr.height-popEl.offsetHeight-8);
      popEl.style.left=x+'px'; popEl.style.top=y+'px';
      armClose();
    }
    return { input, popover, menu, contextMenu, closePop };
  }

  return { create, sBtn, sIcon, sBar };
})();
