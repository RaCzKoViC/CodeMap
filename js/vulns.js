/* ===================== vulns.js — podatne zależności (OSV.dev), bez DOM ===================== */
// Na wyraźne żądanie (aplikacja: okno z potwierdzeniem; CLI: --osv) do api.osv.dev trafiają WYŁĄCZNIE nazwy i wersje
// pakietów — bez kodu, ścieżek i nazwy projektu. Źródła wersji: pliki blokad (graph.lockDeps: package-lock, yarn.lock,
// Cargo.lock, poetry.lock, Pipfile.lock, go.sum — dokładne wersje, także przechodnie), a dla ekosystemu bez pliku
// blokady — manifesty (graph.depVersions; wersja przypięta albo dolna granica zakresu, `exact: false`).
// query(): /v1/querybatch (≤ 1000 zapytań w paczce) → identyfikatory, potem /v1/vulns/{id} (≤ maxDetails, 8 naraz) →
// opis, ważność (GHSA albo wynik CVSS 3 policzony z wektora) i wersja z poprawką. fetch wstrzykiwany (testy bez sieci).
CM.Vulns = (function(){
  const ECO = {npm:'npm', pip:'PyPI', cargo:'crates.io', go:'Go', dart:'Pub'};
  const API = 'https://api.osv.dev/v1';
  const RANK = {CRITICAL:4, HIGH:3, MODERATE:2, MEDIUM:2, LOW:1};

  // wersja nadająca się do zapytania: cyfry z kropkami (+ sufiksy); go z `v`; zakresy, tagi, ścieżki i URL-e — null
  function norm(v, eco){
    v = String(v || '').trim().replace(/^=+/, '');
    if(eco === 'go') return /^v\d+\.\d+\.\d+[\w.+-]*$/.test(v) ? v : null;
    v = v.replace(/^v(?=\d)/, '');
    return /^\d+(\.\d+){0,3}([-+.][\w.+-]*)?$/.test(v) ? v : null;
  }

  function collect(graph){
    const out = new Map(), lockEcos = new Set();
    const lock = graph.lockDeps instanceof Map ? [...graph.lockDeps.values()] : [];
    const dv = graph.depVersions instanceof Map ? graph.depVersions : new Map();
    for(const d of lock) lockEcos.add(d.eco);
    const direct = new Set([...dv].map(([k, v]) => v.source + ':' + k));
    const put = (name, version, eco, exact, file, isDirect) => {
      if(!ECO[eco]) return; const v = norm(version, eco); if(!v) return;
      const key = eco + ':' + name + '@' + v;
      if(!out.has(key)) out.set(key, {name, version:v, eco, ecosystem:ECO[eco], exact, direct:isDirect, file:file || ''});
    };
    for(const d of lock) put(d.name, d.version, d.eco, true, d.file, direct.has(d.eco + ':' + d.name));
    for(const [name, d] of dv) if(!lockEcos.has(d.source)) put(name, d.version, d.source, !!d.exact, d.file, true);
    return [...out.values()].sort((a, b) => (a.eco < b.eco ? -1 : a.eco > b.eco ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  // CVSS 3.x — wynik bazowy z wektora (specyfikacja FIRST), do ważności, gdy baza nie podaje własnej
  function cvss3(vec){
    const m = {}; String(vec || '').split('/').forEach(p => { const [k, v] = p.split(':'); if(k && v) m[k] = v; });
    const AV = {N:0.85, A:0.62, L:0.55, P:0.2}[m.AV], AC = {L:0.77, H:0.44}[m.AC], UI = {N:0.85, R:0.62}[m.UI];
    const S = m.S === 'C', PR = {N:0.85, L:S ? 0.68 : 0.62, H:S ? 0.5 : 0.27}[m.PR];
    const CIA = (x) => ({H:0.56, L:0.22, N:0}[x]);
    const C = CIA(m.C), I = CIA(m.I), A = CIA(m.A);
    if([AV, AC, UI, PR, C, I, A].some(x => x == null)) return null;
    const iss = 1 - (1 - C) * (1 - I) * (1 - A);
    const impact = S ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
    if(impact <= 0) return 0;
    const expl = 8.22 * AV * AC * PR * UI;
    const up = (x) => { const i = Math.round(x * 100000); return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10; };
    return up(Math.min(S ? 1.08 * (impact + expl) : impact + expl, 10));
  }
  const bandOf = (s) => (s == null ? null : s >= 9 ? 'CRITICAL' : s >= 7 ? 'HIGH' : s >= 4 ? 'MODERATE' : s > 0 ? 'LOW' : null);
  function severity(v){
    const ds = v && v.database_specific && v.database_specific.severity;
    if(ds && RANK[String(ds).toUpperCase()]) return {level:String(ds).toUpperCase() === 'MEDIUM' ? 'MODERATE' : String(ds).toUpperCase(), score:null};
    for(const s of (v && v.severity) || []) if(/^CVSS_V3/.test(s.type)){ const sc = cvss3(s.score); if(sc != null) return {level:bandOf(sc), score:sc}; }
    return {level:null, score:null};
  }
  // porównanie wersji po liczbach (1.10.0 > 1.9.9); przedrostek v i sufiksy pomijane
  function cmp(a, b){
    const pa = String(a).replace(/^v/, '').split(/[.+-]/).map(x => parseInt(x, 10)), pb = String(b).replace(/^v/, '').split(/[.+-]/).map(x => parseInt(x, 10));
    for(let i = 0; i < Math.max(pa.length, pb.length); i++){ const x = pa[i] || 0, y = pb[i] || 0; if(isNaN(x) || isNaN(y)) break; if(x !== y) return x < y ? -1 : 1; }
    return 0;
  }
  // najmniejsza wersja z poprawką powyżej bieżącej dla tego pakietu (albo null)
  function fixedFor(v, pkg){
    const fixed = [];
    for(const a of (v && v.affected) || []){
      const p = a.package || {};
      if(String(p.name || '').toLowerCase() !== pkg.name.toLowerCase() || (p.ecosystem && p.ecosystem !== pkg.ecosystem)) continue;
      for(const r of a.ranges || []) for(const e of r.events || []) if(e.fixed) fixed.push(e.fixed);
    }
    const above = fixed.filter(f => cmp(f, pkg.version) > 0).sort(cmp);
    return above[0] || null;
  }

  async function query(list, opts){
    opts = opts || {};
    const f = opts.fetch || (typeof fetch === 'function' ? fetch : null);
    if(!f) throw new Error('fetch niedostępny');
    const t0 = Date.now(), ids = list.map(() => []), sig = opts.signal;
    const json = async (url, init) => { const r = await f(url, Object.assign({signal:sig}, init || {})); if(!r.ok) throw new Error('OSV.dev: HTTP ' + r.status); return r.json(); };
    for(let s = 0; s < list.length; s += 1000){
      const part = list.slice(s, s + 1000);
      const body = {queries:part.map(p => ({package:{name:p.name, ecosystem:p.ecosystem}, version:p.ecosystem === 'Go' ? p.version.replace(/^v/, '') : p.version}))};
      const r = await json(API + '/querybatch', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
      (r.results || []).forEach((x, i) => { ids[s + i] = ((x && x.vulns) || []).map(v => v.id).filter(Boolean); });
      if(opts.onProgress) opts.onProgress(Math.min(list.length, s + 1000), list.length);
    }
    const uniq = [...new Set(ids.flat())], max = opts.maxDetails != null ? opts.maxDetails : 200, details = new Map();
    const todo = uniq.slice(0, max);
    for(let i = 0; i < todo.length; i += 8){
      await Promise.all(todo.slice(i, i + 8).map(id => json(API + '/vulns/' + encodeURIComponent(id)).then(v => details.set(id, v), () => details.set(id, null))));
    }
    const vulnerable = [];
    list.forEach((p, i) => {
      if(!ids[i].length) return;
      const vulns = ids[i].map(id => { const v = details.get(id), sv = severity(v);
        return {id, summary:v && v.summary ? String(v.summary).slice(0, 200) : '', level:sv.level, score:sv.score, fixed:v ? fixedFor(v, p) : null,
          aliases:v && Array.isArray(v.aliases) ? v.aliases.slice(0, 4) : [], url:'https://osv.dev/vulnerability/' + encodeURIComponent(id)}; });
      vulns.sort((a, b) => (RANK[b.level] || 0) - (RANK[a.level] || 0) || (a.id < b.id ? -1 : 1));
      const fixes = vulns.map(v => v.fixed).filter(Boolean).sort(cmp);
      vulnerable.push(Object.assign({}, p, {vulns, level:vulns[0].level, fixed:fixes.length ? fixes[fixes.length - 1] : null}));
    });
    return {checked:list.length, vulnerable, ids:uniq.length, details:details.size, truncated:uniq.length > max, at:Date.now(), ms:Date.now() - t0};
  }

  // wynik na grafie: graph.vulnInfo (zapis mapy, reguła Inspect „vulndep") + n.vulns na węzłach zależności zewnętrznych
  function applyToGraph(graph, res){
    graph.vulnInfo = {at:res.at, checked:res.checked, source:'osv.dev', truncated:!!res.truncated, items:res.vulnerable};
    const by = new Map(); for(const it of res.vulnerable) by.set(it.name, (by.get(it.name) || 0) + it.vulns.length);
    for(const n of graph.nodes.values()) if(n.type === 'external'){ if(by.has(n.name)) n.vulns = by.get(n.name); else delete n.vulns; }
    return res.vulnerable.length;
  }

  return {ECO, API, norm, collect, cvss3, severity, fixedFor, cmp, query, applyToGraph, RANK};
})();
