/* ===================== prefs.js — wersjonowanie bloba ustawień `codemap_settings` ===================== */
// Blob z chrome.js (suwaki, kolory, filtry, układ, motyw) trafia do localStorage i — przez sync.js — na inne urządzenia,
// więc może przyjść w starszym formacie. migrate() doprowadza go do bieżącej wersji: stare nazwy pól, układ spoza
// listy (20 usuniętych w fazie 8) → domyślny, pola po usuniętych kontrolkach wypadają. Czyste (testy w Node).
CM.Prefs = (function(){
  const VERSION = 2;
  // o: {ids: bieżące identyfikatory kontrolek, layouts: układy z listy w UI, defaultLayout}
  function migrate(s, o){
    o = o || {};
    if(!s || typeof s !== 'object' || Array.isArray(s)) return null;
    const out = Object.assign({}, s), v = +out._v || 1;
    if(v < 2){   // v1 (bez numeru): _menuTint → _menuRgb (odcień okien sprzed presetów)
      if(out._menuTint && !out._menuRgb) out._menuRgb = out._menuTint;
      delete out._menuTint;
    }
    if(o.layouts && out['sel-layout'] != null && !o.layouts.includes(String(out['sel-layout']))) out['sel-layout'] = o.defaultLayout || 'pack';
    if(o.ids) for(const k of Object.keys(out)) if(!k.startsWith('_') && !o.ids.includes(k)) delete out[k];
    for(const k of ['_theme']) if(out[k] != null && !/^(light|dark)$/.test(out[k])) delete out[k];
    out._v = VERSION;
    return out;
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {VERSION, migrate, same};
})();
