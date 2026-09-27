/* ===================== analysis-cache.js — pamięć wyników analizy plików (OPFS) =====================
   Ponowne wczytanie tego samego projektu nie analizuje od nowa plików, które się nie zmieniły: wynik
   (metryki, importy, symbole) jest zapamiętany per ścieżka razem z rozmiarem, skrótem treści i tożsamością
   pliku (data modyfikacji z dysku albo sha bloba git) — zgodna tożsamość = trafienie bez liczenia skrótu,
   sam zgodny rozmiar = worker analizy liczy skrót i porównuje. Jeden plik na projekt w OPFS (gzip, gdy przeglądarka
   ma CompressionStream), indeks z datą użycia — najstarsze projekty wypadają po przekroczeniu limitów.
   Wersja = stempel zasobów (?v=…): po zmianie analizatora stara pamięć jest ignorowana i nadpisywana.
   Tylko metryki i nazwy (bez treści plików); „Wyczyść dane" usuwa katalog. Bez OPFS (tryb prywatny,
   file://) — cicho wyłączone. */
CM.AnalysisCache = (function(){
  const U = CM.util;
  const DIR = 'codemap-analysis', INDEX = 'index.json', MAX_PROJECTS = 12, MAX_BYTES = 200e6;
  let off = false, last = null;

  async function dir(){
    if(off) return null;
    try{ const root = await navigator.storage.getDirectory(); return await root.getDirectoryHandle(DIR, {create:true}); }
    catch(e){ off = true; return null; }
  }
  // klucz projektu: źródło (folder / repozytorium + gałąź + podkatalog) — nie treść
  function projectKey(meta){
    if(!meta) return null;
    const parts = [meta.kind||'', meta.host||'', meta.repo||'', meta.branch||'', meta.sub||'', meta.source||'', meta.name||''];
    return 'p' + U.hashString(parts.join('|')) + '-' + U.hashString(parts.reverse().join('#'));
  }
  const gz = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';
  async function readText(fh){
    const file = await fh.getFile();
    if(gz && /\.gz$/.test(fh.name)) return await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    return await file.text();
  }
  async function writeText(d, name, text){
    const fh = await d.getFileHandle(name, {create:true});
    const w = await fh.createWritable();
    if(gz && /\.gz$/.test(name)){ const blob = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob(); await w.write(blob); }
    else await w.write(text);
    await w.close();
    return (await fh.getFile()).size;
  }
  async function readIndex(d){ try{ return JSON.parse(await readText(await d.getFileHandle(INDEX))) || {}; }catch(e){ return {}; } }
  const fileName = (k) => k + (gz ? '.json.gz' : '.json');

  // → Map ścieżka → {s: rozmiar, h: skrót, m, d, y, i: tożsamość} albo null (brak pamięci / inna wersja analizatora)
  async function load(meta, version){
    const k = projectKey(meta), d = k && await dir(); if(!d) return null;
    try{
      const data = JSON.parse(await readText(await d.getFileHandle(fileName(k))));
      if(!data || data.v !== version || !data.files) return null;
      const m = new Map();
      for(const p in data.files){ const e = data.files[p]; m.set(p, {s:e[0], h:e[1], m:e[2], d:e[3], y:e[4], i:e[5]||''}); }
      last = {key:k, files:m.size, at:data.at};
      return m;
    }catch(e){ return null; }
  }

  // wyniki analizy (Map ścieżka → {metrics, deps, symbols, hash}) + rozmiary treści i tożsamości plików → zapis w tle
  async function save(meta, version, results, sizes, ids){
    const k = projectKey(meta), d = k && await dir(); if(!d || !results || !results.size) return false;
    try{
      const files = {};
      for(const [p, r] of results){ if(!r || r.error || r.hash == null) continue; const s = sizes.get(p); if(s == null) continue;
        files[p] = [s, r.hash, r.metrics, r.deps, r.symbols, (ids && ids.get(p)) || '']; }
      const bytes = await writeText(d, fileName(k), JSON.stringify({v:version, at:Date.now(), name:meta.name||'', files}));
      const idx = await readIndex(d); idx[k] = {at:Date.now(), bytes, name:meta.name||'', files:Object.keys(files).length};
      // limity: najstarsze projekty wypadają (liczba i łączny rozmiar)
      const keys = Object.keys(idx).sort((a, b) => idx[b].at - idx[a].at); let total = 0;
      for(let i = 0; i < keys.length; i++){ total += idx[keys[i]].bytes || 0;
        if(i >= MAX_PROJECTS || total > MAX_BYTES){ try{ await d.removeEntry(fileName(keys[i])); }catch(e){} delete idx[keys[i]]; } }
      await writeText(d, INDEX, JSON.stringify(idx));
      return true;
    }catch(e){ return false; }
  }

  async function stats(){
    const d = await dir(); if(!d) return {available:false, projects:0, bytes:0};
    const idx = await readIndex(d); const ks = Object.keys(idx);
    return {available:true, projects:ks.length, bytes:ks.reduce((a, k) => a + (idx[k].bytes || 0), 0), last};
  }
  async function clear(){
    try{ const root = await navigator.storage.getDirectory(); await root.removeEntry(DIR, {recursive:true}); }catch(e){}
    last = null; return true;
  }

  return {load, save, stats, clear, projectKey, get available(){ return !off; }};
})();
