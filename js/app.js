/* ===================== app.js — bootstrap ===================== */
// Cienki rozruch: start aplikacji (CM.App.boot w DOMContentLoaded, jak dotąd) i window.CMApp — publiczne API
// używane przez chatbot.js, drive.js, inspect.js i tools/smoke.mjs (te same klucze co przed podziałem).
// Cała logika żyje w modułach CM.App: app-core.js, chrome.js, repo-hosts.js, compare.js, navigation.js, ai-bridge.js.
(function(){
  const A=CM.App;
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', A.boot);
  else A.boot();
  window.CMApp={get graph(){return A.graph;}, apply:A.apply, focusNode:A.focusNode, loadDemo:A.loadDemo, toggleImpact:A.toggleImpact,
    copyViewLink:A.copyViewLink, serializeView:A.serializeView,
    impactState:()=>A.impactOn,
    loadFiles:(files,meta)=>A.ingest(()=>Promise.resolve({files,meta}),'test'),
    loadFromJSON:A.loadFromJSON,
    hasMap:()=>A.state.counts.nodes>0,
    mapName:()=>(A.graph&&A.graph.meta&&(A.graph.meta.name||A.graph.meta.source))||'mapa',
    mapJSON:()=>(A.graph&&A.state.counts.nodes>0)?A.graph.toJSON():null,
    appState:A.appState, exec:A.exec,     // ← ChatBot uses these
    renderer:()=>A.renderer};
})();
