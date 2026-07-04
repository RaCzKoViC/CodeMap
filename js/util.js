/* ===================== util.js — helpers ===================== */
window.CM = window.CM || {};

CM.util = (function(){

  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs={}, ...kids){
    const n = document.createElement(tag);
    for(const k in attrs){
      if(k === 'class') n.className = attrs[k];
      else if(k === 'html') n.innerHTML = attrs[k];
      else if(k === 'text') n.textContent = attrs[k];
      else if(k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if(attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for(const kid of kids){
      if(kid == null) continue;
      n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return n;
  }

  function debounce(fn, ms){
    let t; return function(...a){ clearTimeout(t); t = setTimeout(()=>fn.apply(this,a), ms); };
  }
  function throttle(fn, ms){
    let last = 0, queued;
    return function(...a){
      const now = performance.now();
      if(now - last >= ms){ last = now; fn.apply(this,a); }
      else { clearTimeout(queued); queued = setTimeout(()=>{ last = performance.now(); fn.apply(this,a); }, ms-(now-last)); }
    };
  }

  // fast non-crypto hash (FNV-1a -> hex). Stable across sessions for diffing.
  function hashString(str){
    if(str == null) return '0';
    let h = 0x811c9dc5;
    for(let i=0;i<str.length;i++){
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8,'0');
  }

  function fmtBytes(b){
    if(b == null) return '—';
    if(b < 1024) return b + ' B';
    const u = ['KB','MB','GB','TB']; let i=-1;
    do { b/=1024; i++; } while(b>=1024 && i<u.length-1);
    return b.toFixed(b<10?1:0) + ' ' + u[i];
  }
  function _locale(){ return (CM.i18n && CM.i18n.getLang && CM.i18n.getLang()==='en') ? 'en-US' : 'pl-PL'; }
  function fmtNum(n){
    if(n == null) return '—';
    return n.toLocaleString(_locale());
  }
  function fmtDate(ts){
    if(!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString(_locale(),{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }
  function relTime(ts){
    const T = (k,f)=> (CM.i18n && CM.i18n.t) ? CM.i18n.t(k,f) : f;
    const s = (Date.now()-ts)/1000;
    if(s<60) return T('cl.relJustNow','przed chwilą');
    if(s<3600) return Math.floor(s/60)+T('cl.relMinAgo',' min temu');
    if(s<86400) return Math.floor(s/3600)+T('cl.relHourAgo',' godz. temu');
    return Math.floor(s/86400)+T('cl.relDayAgo',' dni temu');
  }

  const clamp = (v,a,b)=> v<a?a:(v>b?b:v);
  const lerp  = (a,b,t)=> a+(b-a)*t;
  const dist2 = (x1,y1,x2,y2)=>{ const dx=x2-x1, dy=y2-y1; return dx*dx+dy*dy; };

  // color helpers ----------------------------------------------------------
  function hexToRgb(hex){
    hex = hex.replace('#','');
    if(hex.length===3) hex = hex.split('').map(c=>c+c).join('');
    const n = parseInt(hex,16);
    return [ (n>>16)&255, (n>>8)&255, n&255 ];
  }
  function rgba(hex, a){
    const [r,g,b] = hexToRgb(hex);
    return `rgba(${r},${g},${b},${a})`;
  }
  function mix(h1,h2,t){
    const a=hexToRgb(h1), b=hexToRgb(h2);
    return `rgb(${Math.round(lerp(a[0],b[0],t))},${Math.round(lerp(a[1],b[1],t))},${Math.round(lerp(a[2],b[2],t))})`;
  }
  // deterministic color from string (HSL) for unknown types
  function colorFromString(s){
    let h=0; for(let i=0;i<s.length;i++) h = (h*31 + s.charCodeAt(i))>>>0;
    return `hsl(${h%360},58%,58%)`;
  }

  // download a blob ----------------------------------------------------------
  function download(filename, text, type='application/json'){
    const blob = new Blob([text],{type});
    const url = URL.createObjectURL(blob);
    const a = el('a',{href:url,download:filename});
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 4000);
  }

  // toast ----------------------------------------------------------
  // SAFE BY DEFAULT: the message is escaped, then ONLY <b>/</b> emphasis is re-enabled. This keeps our
  // own "Wczytano <b>N</b>…" strings bold while neutralising any HTML smuggled in through interpolated
  // repo/file/project names (a loaded repo is untrusted input). Pass {html:true} to opt into raw HTML.
  let toastWrap;
  function toastSafe(msg){
    return String(msg)
      .replace(/[<>&]/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))
      .replace(/&lt;(\/?)b&gt;/g, '<$1b>');   // re-allow only <b> and </b>
  }
  function toast(msg, kind='', ms=3200){
    if(!toastWrap){ toastWrap = el('div',{id:'toast-wrap'}); document.body.appendChild(toastWrap); }
    const raw = (kind && typeof kind==='object') ? !!kind.html : false;   // {html:true} → trusted raw HTML
    const t = el('div',{class:'toast '+(raw ? (kind.kind||'') : kind), html: raw ? msg : toastSafe(msg)});
    toastWrap.appendChild(t);
    setTimeout(()=>{ t.style.opacity='0'; t.style.transition='opacity .3s'; setTimeout(()=>t.remove(),300); }, ms);
  }

  // limited-concurrency async map ----------------------------------------------------------
  async function pMap(items, fn, concurrency=12, onProgress){
    const results = new Array(items.length);
    let idx = 0, done = 0;
    async function worker(){
      while(idx < items.length){
        const i = idx++;
        try { results[i] = await fn(items[i], i); } catch(e){ results[i] = undefined; }
        done++;
        if(onProgress) onProgress(done, items.length);
      }
    }
    const n = Math.min(concurrency, items.length) || 0;
    await Promise.all(Array.from({length:n}, worker));
    return results;
  }

  // ---- 2D camera with pan / zoom / rotation (+ optional pseudo-3D tilt) ----
  function makeCamera(){
    return {
      x:0, y:0,          // world point at screen center
      zoom:1,
      rot:0,             // radians
      tilt:0,            // pseudo-3D vertical squash (0..~0.6)
      _c:null, _ci:null, _k:'',   // cached matrix / inverse / cache key
      // build (and cache) the world->screen matrix for a viewport of size (w,h)
      matrix(w,h){
        const k = this.x+'|'+this.y+'|'+this.zoom+'|'+this.rot+'|'+this.tilt+'|'+w+'|'+h;
        if(this._k === k && this._c) return this._c;
        const m = new DOMMatrix();
        m.translateSelf(w/2, h/2);
        m.scaleSelf(this.zoom, this.zoom * (1 - this.tilt));
        m.rotateSelf(this.rot * 180/Math.PI);
        m.translateSelf(-this.x, -this.y);
        this._c = m; this._ci = null; this._k = k;
        return m;
      },
      matrixInverse(w,h){
        const m = this.matrix(w,h);
        if(!this._ci) this._ci = m.inverse();
        return this._ci;
      },
      // screen -> world
      toWorld(sx, sy, w, h){
        const p = this.matrixInverse(w,h).transformPoint(new DOMPoint(sx, sy));
        return {x:p.x, y:p.y};
      },
      toScreen(wx, wy, w, h){
        const p = this.matrix(w,h).transformPoint(new DOMPoint(wx, wy));
        return {x:p.x, y:p.y};
      }
    };
  }

  return {$,$$,el,debounce,throttle,hashString,fmtBytes,fmtNum,fmtDate,relTime,
          clamp,lerp,dist2,hexToRgb,rgba,mix,colorFromString,download,toast,pMap,makeCamera};
})();
