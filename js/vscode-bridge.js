/* ===================== vscode-bridge.js — most do rozszerzenia VS Code ===================== */
// Ładowany zawsze, ale poza webview VS Code (brak window.acquireVsCodeApi) nic nie robi. W webview
// (integrations/vscode/): wiadomości z rozszerzenia codemap:load → CMApp.loadFromJSON, codemap:focus →
// CMApp.focusNode; do rozszerzenia codemap:ready / codemap:loaded / codemap:focused oraz codemap:open
// {path, line?} po dwukliku pliku lub symbolu i z pozycji „Otwórz w edytorze" w menu kontekstowym węzła.
(function(){
  if(typeof window.acquireVsCodeApi!=='function') return;
  const vscode=window.acquireVsCodeApi();   // wolno wywołać tylko raz na stronę
  const A=CM.App, U=CM.util, I=CM.i18n;
  I.extend('pl', {'vsc.open':'Otwórz w edytorze', 'vsc.notOnMap':'Tego elementu nie ma na mapie: '});
  I.extend('en', {'vsc.open':'Open in editor', 'vsc.notOnMap':'Not on the map: '});
  const post=(m)=>{ try{ vscode.postMessage(m); }catch(e){ /* panel webview zamknięty — brak odbiorcy */ } };

  // węzeł → {path, line?}: plik = jego ścieżka; symbol (tree-sitter) = plik-rodzic + linia definicji
  function target(n){
    if(!n) return null;
    if(n.type==='file' && n.path) return {path:n.path};
    if(n.type==='symbol'){
      const f=A.graph.nodes.get(n.parent);
      if(f && f.type==='file' && f.path) return Number.isInteger(n.line) && n.line>0 ? {path:f.path, line:n.line} : {path:f.path};
    }
    return null;
  }
  function openInEditor(n){ const t=target(n); if(t) post(Object.assign({type:'codemap:open'}, t)); }

  function focus(path){
    const n=typeof path==='string' && path ? A.graph.nodes.get(path) : null;
    const ok=!!(n && (n.type==='file' || n.type==='folder'));
    if(ok) CMApp.focusNode(n.id); else if(path) U.toast(I.t('vsc.notOnMap')+path, '', 3500);
    post({type:'codemap:focused', path, ok});
  }

  function load(d){
    if(d.lang && d.lang!==I.getLang()) I.setLang(d.lang);
    const r=A.renderer, keep=!!(d.keepView && !d.focus && r && A.state.counts.nodes>0);
    const cam=keep ? {x:r.cam.x, y:r.cam.y, zoom:r.cam.zoom, rot:r.cam.rot, tilt:r.cam.tilt} : null;
    const sel=keep && r.selected ? r.selected.id : null;
    // odświeżenie po ponownej analizie: loadFromJSON dopasowuje widok (renderer.fit w requestAnimationFrame,
    // z animacją) — jednorazowo zastępujemy to dopasowanie przywróceniem kamery i zaznaczenia
    if(keep) r.fit=function(){
      delete r.fit;
      Object.assign(r.cam, cam);
      const n=sel && A.graph.nodes.get(sel); if(n) A.select(n);
      r.onChange(); r.kick();
    };
    let ok=false;
    try{ ok=!!CMApp.loadFromJSON(d.map, {toast:false}); }catch(e){ console.warn('codemap:load', e); }
    if(!ok && keep) delete r.fit;
    post({type:'codemap:loaded', rev:d.rev, ok, nodes:ok ? A.graph.nodes.size : 0});
    if(ok && d.focus) focus(d.focus);
  }

  function onMessage(ev){
    const d=ev.data; if(!d || typeof d!=='object') return;
    if(d.type==='codemap:load' && d.map) load(d);
    else if(d.type==='codemap:focus') focus(d.path);
  }

  function wire(){
    const r=A.renderer; if(!r) return;
    const dbl=r.onDblFile;
    r.onDblFile=(n)=>{ dbl(n); openInEditor(n); };
    (A.ctxExtra=A.ctxExtra||[]).push((n)=>target(n) ? {ic:'file', label:I.t('vsc.open'), action:()=>openInEditor(n)} : null);
    window.addEventListener('message', onMessage);
    post({type:'codemap:ready', version:CM.VERSION});
  }
  // po CM.App.boot (app.js rejestruje go wcześniej na tym samym zdarzeniu)
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
