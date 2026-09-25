/* ===================== sw.js — CodeMap service worker (offline app shell) ===================== */
const CACHE = 'codemap-shell-v81';
const CORE = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];
// Version-less fallback list (used only if parsing index.html fails); the fetch handler's
// ignoreSearch fallback makes these serve ?v=... requests offline too.
const ASSET_FALLBACK = ['css/styles.css','js/util.js','js/icons.js','js/i18n.js','js/languages.js',
  'js/analysis.js','js/graph.js','js/layouts.js','js/renderer.js','js/loaders.js','js/storage.js',
  'js/ui.js','js/settings.js','js/drive.js','js/auth.js','js/sync.js','js/inspect.js','js/localai.js','js/ollama.js','js/runner.js','js/mmdraw.js','js/mindmap.js','js/chatbot.js',
  'js/app-core.js','js/chrome.js','js/repo-hosts.js','js/compare.js','js/navigation.js','js/ai-bridge.js','js/app.js','js/sim-worker.js'];

self.addEventListener('install', (e)=>{
  e.waitUntil((async()=>{
    const c = await caches.open(CACHE);
    await c.addAll(CORE).catch(()=>{});
    // Precache EVERY versioned asset referenced by index.html (all js/css + the physics worker),
    // so the app shell works fully offline. The HTML is the single source of truth for versions;
    // if fetching/parsing it fails, fall back to the static version-less list above.
    let assets = [];
    try{
      const html = await (await fetch('index.html', {cache:'no-cache'})).text();
      assets = [...html.matchAll(/(?:src|href)="((?:js|css)\/[^"]+\?v=[^"]+)"/g)].map(m=>m[1]);
      const appV = (html.match(/js\/app\.js\?v=([\w.-]+)/)||[])[1];
      if(appV) assets.push('js/sim-worker.js?v='+appV);   // worker is loaded by app-core.js at the shared ?v= stamp (read off js/app.js in the HTML)
    }catch(_){ }
    if(!assets.length) assets = ASSET_FALLBACK;
    await c.addAll(assets).catch(()=>{});
  })().then(()=>self.skipWaiting()));
});

self.addEventListener('activate', (e)=>{
  // Clean up ONLY our own outdated shell caches. Never touch foreign caches — 'webllm/model'
  // holds hundreds of MB of downloaded local-AI weights; deleting it on every SW update was
  // silently wiping the user's models.
  e.waitUntil(caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k.startsWith('codemap-shell') && k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim()));
});

// SAME-ORIGIN GET only. Cross-origin (GitHub/GitLab APIs, avatars, raw content, fonts) and
// non-GET are left untouched so live data and CORS keep working.
// Strategy split: navigations/HTML are network-first (fresh published index.html lands next load,
// cached shell as offline fallback); versioned assets (?v=...) stay stale-while-revalidate.
self.addEventListener('fetch', (e)=>{
  const req = e.request;
  if(req.method !== 'GET') return;
  let url; try{ url = new URL(req.url); }catch(_){ return; }
  if(url.origin !== self.location.origin) return;
  // API (konto, synchronizacja) NIGDY nie przechodzi przez cache — zawsze świeże dane z sieci.
  if(url.pathname.startsWith('/api/')) return;

  const isHTML = req.mode === 'navigate' || (req.headers.get('accept')||'').includes('text/html');
  if(isHTML){
    // Network-first: serve fresh HTML when online, fall back to cached shell when offline.
    e.respondWith(
      fetch(req).then(res=>{
        if(res && res.ok && res.type === 'basic'){ const cp = res.clone(); caches.open(CACHE).then(c=>c.put(req, cp)); }
        return res;
      }).catch(()=> caches.match(req).then(hit=> hit || caches.match('index.html')).then(hit=> hit || caches.match('./')))
    );
    return;
  }

  // Stale-while-revalidate for versioned assets (immutable per ?v=, so cache-first is correct & fast).
  // Offline with a version mismatch (new HTML cached, old assets): fall back to an ignoreSearch match
  // so SOME copy of the file is served instead of a white page.
  e.respondWith((async()=>{
    const hit = await caches.match(req);
    const net = fetch(req).then(res=>{
      if(res && res.ok && res.type === 'basic'){ const cp = res.clone(); caches.open(CACHE).then(c=>c.put(req, cp)); }
      return res;
    }).catch(()=>null);
    if(hit) return hit;
    const res = await net;
    if(res) return res;
    return (await caches.match(req, {ignoreSearch:true})) || Response.error();
  })());
});
