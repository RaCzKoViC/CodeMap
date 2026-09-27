// Czysta logika rozszerzenia (bez modułu `vscode`): ważności i progi, ścieżki z SARIF i z webview,
// SARIF → opisy diagnostyk, pasek stanu i tooltip, CodeLens, debounce analizy przy zapisie, teksty PL/EN.
// extension.js zamienia opisy na obiekty VS Code — dzięki temu całość jest testowalna w node:test.
'use strict';
const nodePath = require('node:path');

const SEVS = ['high', 'med', 'low', 'info'];
const SEV_RANK = { info: 0, low: 1, med: 2, high: 3 };
const LEVEL_SEV = { error: 'high', warning: 'med', note: 'low', none: 'info' };
const DEFAULTS = Object.freeze({ analyzeOnSave: false, minSeverity: 'low', git: true, exclude: [], lang: 'auto', codeLens: true });
const SAVE_DELAY = 1500;
// kody reguł w Problems prowadzą do opisu reguł Inspect w README
const RULE_DOC = 'https://github.com/RaCzKoViC/CodeMap#inspect--analiza-statyczna';
const LINE_END = 1e6;             // zakres „cała linia" — VS Code przycina kolumnę do długości linii
const LENS_RULES = new Set(['gitHotspot', 'silo']);

// ---------------- teksty ----------------
const STR = {
  pl: {
    analyzing: 'CodeMap: analiza „{name}"…',
    done: 'CodeMap: {name} — health score {score}/100, znalezisk: {n} (w Problems: {shown}).',
    openMap: 'Otwórz mapę', problems: 'Pokaż Problems',
    cancelled: 'CodeMap: analiza anulowana.',
    failed: 'CodeMap: analiza nie powiodła się — {msg}',
    noFolder: 'CodeMap: otwórz folder lub workspace, aby przeanalizować projekt.',
    pickFolder: 'Który folder przeanalizować w CodeMap?',
    notInWorkspace: 'CodeMap: plik {p} leży poza workspace.',
    badPath: 'CodeMap: odrzucono ścieżkę spoza workspace: {p}',
    openFail: 'CodeMap: nie można otworzyć {p} — {msg}',
    panelTitle: 'CodeMap — {name}',
    statusName: 'CodeMap — health score',
    tHead: 'CodeMap — **{name}**: health score **{score}/100**',
    tFindings: 'Znaleziska: {list}', tNoFindings: 'Brak znalezisk.',
    tBus: 'Bus factor: **{v}**{who}', tNoGit: 'Bus factor: brak historii git.',
    tHot: 'Hotspoty (zmiany × złożoność):', tHotItem: '{path} — {c} × {cx}',
    tClick: 'Kliknij, aby otworzyć mapę.', tIdle: 'CodeMap — kliknij, aby przeanalizować projekt i otworzyć mapę.',
    tRunning: 'CodeMap — analiza w toku…',
    sev: { high: 'wysokie', med: 'średnie', low: 'niskie', info: 'info' },
    changes: ['zmiana', 'zmiany', 'zmian'],
    lens: 'CodeMap: {c} {changes} × złożoność {cx}', lensOwner: ' · właściciel {owner} ({share} %)', lensHot: ' · hotspot #{rank}',
    rel: { cycles: 'cykl: {name}', dupcode: 'duplikat: {name}', archviolation: 'cel importu: {name}', _: 'powiązany plik: {name}' },
    warn: 'ostrzeżenie',
  },
  en: {
    analyzing: 'CodeMap: analyzing "{name}"…',
    done: 'CodeMap: {name} — health score {score}/100, findings: {n} (in Problems: {shown}).',
    openMap: 'Open map', problems: 'Show Problems',
    cancelled: 'CodeMap: analysis cancelled.',
    failed: 'CodeMap: analysis failed — {msg}',
    noFolder: 'CodeMap: open a folder or workspace to analyze a project.',
    pickFolder: 'Which folder should CodeMap analyze?',
    notInWorkspace: 'CodeMap: {p} is outside the workspace.',
    badPath: 'CodeMap: rejected a path outside the workspace: {p}',
    openFail: 'CodeMap: cannot open {p} — {msg}',
    panelTitle: 'CodeMap — {name}',
    statusName: 'CodeMap — health score',
    tHead: 'CodeMap — **{name}**: health score **{score}/100**',
    tFindings: 'Findings: {list}', tNoFindings: 'No findings.',
    tBus: 'Bus factor: **{v}**{who}', tNoGit: 'Bus factor: no git history.',
    tHot: 'Hotspots (changes × complexity):', tHotItem: '{path} — {c} × {cx}',
    tClick: 'Click to open the map.', tIdle: 'CodeMap — click to analyze the project and open the map.',
    tRunning: 'CodeMap — analysis in progress…',
    sev: { high: 'high', med: 'medium', low: 'low', info: 'info' },
    changes: ['change', 'changes', 'changes'],
    lens: 'CodeMap: {c} {changes} × complexity {cx}', lensOwner: ' · owner {owner} ({share}%)', lensHot: ' · hotspot #{rank}',
    rel: { cycles: 'cycle: {name}', dupcode: 'duplicate: {name}', archviolation: 'import target: {name}', _: 'related file: {name}' },
    warn: 'warning',
  },
};

/** Język: ustawienie `codemap.lang` (auto|pl|en), auto = język interfejsu VS Code. */
function resolveLang(setting, envLanguage) {
  if (setting === 'pl' || setting === 'en') return setting;
  return /^pl\b/i.test(String(envLanguage || '')) ? 'pl' : 'en';
}

/** tr(lang)('klucz', {zmienne}) — {x} w tekście zastępowane wartościami. */
function tr(lang) {
  const d = STR[lang] || STR.en;
  return (key, vars) => {
    const s = d[key] != null ? d[key] : (STR.en[key] != null ? STR.en[key] : key);
    return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] != null ? String(vars[k]) : m)) : s;
  };
}

/** Odmiana liczebnika: PL [1, 2–4, 5+], EN [1, reszta]. */
function plural(lang, n, forms) {
  if (lang !== 'pl') return n === 1 ? forms[0] : forms[1];
  if (n === 1) return forms[0];
  const d = n % 10, h = n % 100;
  return d >= 2 && d <= 4 && (h < 12 || h > 14) ? forms[1] : forms[2];
}

const fmtNum = (lang, n) => Number(n || 0).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-US');

// ---------------- ważności ----------------
const sevRank = (s) => (s in SEV_RANK ? SEV_RANK[s] : SEV_RANK.low);
/** Ważność wyniku SARIF: properties.severity (high|med|low|info), inaczej z level. */
function resultSeverity(r) {
  const s = r && r.properties && r.properties.severity;
  if (s in SEV_RANK) return s;
  return LEVEL_SEV[r && r.level] || 'low';
}
/** Czy ważność przechodzi próg `codemap.minSeverity`. */
const passes = (sev, min) => sevRank(sev) >= sevRank(min in SEV_RANK ? min : DEFAULTS.minSeverity);

// ---------------- ścieżki ----------------
/** URI z SARIF (względne do %SRCROOT%, segmenty zakodowane) → ścieżka względem analizowanego katalogu ('/'). */
function sarifUriToRel(uri, sub) {
  if (typeof uri !== 'string' || !uri) return null;
  let segs;
  try { segs = uri.split('/').map(decodeURIComponent); } catch { return null; }
  if (segs.some((s) => s === '..' || s === '.' || s === '' || s.includes('\\') || s.includes('\0'))) return null;
  const pre = sub ? String(sub).replace(/^\/+|\/+$/g, '').split('/') : [];
  for (let i = 0; i < pre.length; i++) if (segs[i] !== pre[i]) return null;
  const rest = segs.slice(pre.length);
  return rest.length ? rest.join('/') : null;
}

/** Podkatalog repozytorium z raportu (project.path: '.' albo 'pkg/x'). */
const reportSub = (report) => {
  const p = report && report.project && report.project.path;
  return p && p !== '.' ? p : '';
};

const isWinAbs = (s) => /^[a-zA-Z]:/.test(s) || /^[\\/]{2}/.test(s);

/**
 * Ścieżka z webview/mapy (względna, '/') → ścieżka absolutna w `root`, albo null, gdy wychodzi poza root
 * albo poza foldery workspace (`roots`). Odrzuca: nie-napisy, puste, NUL, ścieżki absolutne (posix, dysk,
 * UNC), segmenty '..'. Separatorem jest też '\' (na każdej platformie).
 */
function resolveMapPath(rel, root, roots, p = nodePath) {
  if (typeof rel !== 'string' || !rel || rel.length > 4096 || rel.includes('\0')) return null;
  if (rel.startsWith('/') || rel.startsWith('\\') || isWinAbs(rel) || p.isAbsolute(rel)) return null;
  const segs = rel.split(/[\\/]+/).filter((s) => s && s !== '.');
  if (!segs.length || segs.includes('..')) return null;
  const abs = p.resolve(root, ...segs);
  if (!isInside(abs, root, p)) return null;
  const list = roots && roots.length ? roots : [root];
  return list.some((r) => isInside(abs, r, p)) ? abs : null;
}

/** abs leży w dir (lub jest nim) — z uwzględnieniem wielkości liter na Windows. */
function isInside(abs, dir, p = nodePath) {
  const win = p === nodePath.win32;   // na Windows nodePath === nodePath.win32
  const norm = (s) => (win ? s.toLowerCase() : s);
  const r = p.relative(norm(p.resolve(dir)), norm(p.resolve(abs)));
  return r === '' || (!r.startsWith('..') && !p.isAbsolute(r));
}

/** Ścieżka absolutna → względna do root z '/' (do mapy); null poza root. */
function relToRoot(abs, root, p = nodePath) {
  if (!isInside(abs, root, p)) return null;
  const r = p.relative(p.resolve(root), p.resolve(abs));
  return r.split(p.sep).join('/');
}

/** Linia SARIF (1…) → indeks 0…; brak/niepoprawna → 0. */
function lineIndex(startLine) {
  const n = Number(startLine);
  return Number.isInteger(n) && n >= 1 ? n - 1 : 0;
}

// ---------------- SARIF → opisy diagnostyk ----------------
/**
 * @param {object} sarif  dokument SARIF 2.1.0 z analyzeProject
 * @param {{root:string, sub?:string, minSeverity?:string, lang?:string, path?:object}} o
 * @returns {{files: Map<string, Array<{rule,sev,message,line,related:Array<{file,line,message}>}>>, total:number, shown:number, hidden:number}}
 */
function sarifToSpecs(sarif, o) {
  const p = o.path || nodePath, t = tr(o.lang || 'en');
  const rel = t('rel');
  const files = new Map();
  let total = 0, shown = 0, hidden = 0;
  const runs = (sarif && sarif.runs) || [];
  for (const run of runs) {
    for (const r of run.results || []) {
      total++;
      const sev = resultSeverity(r);
      if (!passes(sev, o.minSeverity)) { hidden++; continue; }
      const loc = r.locations && r.locations[0] && r.locations[0].physicalLocation;
      const rp = loc && sarifUriToRel(loc.artifactLocation && loc.artifactLocation.uri, o.sub);
      if (!rp) { hidden++; continue; }
      const file = p.join(o.root, ...rp.split('/'));
      const related = [];
      for (const x of r.relatedLocations || []) {
        const xl = x.physicalLocation, xr = xl && sarifUriToRel(xl.artifactLocation && xl.artifactLocation.uri, o.sub);
        if (!xr) continue;
        const name = (x.message && x.message.text) || xr.split('/').pop();
        related.push({ file: p.join(o.root, ...xr.split('/')), line: lineIndex(xl.region && xl.region.startLine),
          message: (rel[r.ruleId] || rel._).replace('{name}', () => name) });
      }
      const spec = { rule: r.ruleId || 'codemap', sev, message: (r.message && r.message.text) || r.ruleId || 'CodeMap',
        line: lineIndex(loc.region && loc.region.startLine), related };
      if (!files.has(file)) files.set(file, []);
      files.get(file).push(spec);
      shown++;
    }
  }
  return { files, total, shown, hidden };
}

// ---------------- pasek stanu ----------------
const MD_SPECIAL = /[\\`*_{}[\]()#+\-.!|<>~]/g;
const mdEscape = (s) => String(s == null ? '' : s).replace(MD_SPECIAL, (c) => '\\' + c);

/** Tekst i tooltip (Markdown) paska stanu dla raportu analizy. */
function statusSpec(report, lang, name) {
  const t = tr(lang), sev = t('sev');
  const score = report && typeof report.score === 'number' ? report.score : null;
  if (score == null) return { text: '$(pulse) CodeMap', tooltip: mdEscape(t('tIdle')), warn: false };
  const tot = report.totals || {};
  const list = SEVS.filter((s) => tot[s]).map((s) => `${sev[s]} ${fmtNum(lang, tot[s])}`).join(' · ');
  const lines = [t('tHead', { name: mdEscape(name || (report.project && report.project.name) || ''), score }), ''];
  lines.push(list ? mdEscape(t('tFindings', { list })) : mdEscape(t('tNoFindings')));
  const g = report.git;
  if (g && g.busFactor) {
    const who = (g.busFactor.authors || []).slice(0, 3);
    lines.push('', t('tBus', { v: g.busFactor.value, who: who.length ? ' (' + mdEscape(who.join(', ')) + ')' : '' }));
  } else lines.push('', mdEscape(t('tNoGit')));
  const hot = (report.hotspots || []).slice(0, 5);
  if (hot.length) {
    lines.push('', mdEscape(t('tHot')));
    for (const h of hot) lines.push('- ' + t('tHotItem', { path: mdEscape(h.path), c: fmtNum(lang, h.changes), cx: fmtNum(lang, h.complexity) }));
  }
  lines.push('', '_' + mdEscape(t('tClick')) + '_');
  return { text: `$(pulse) CodeMap ${score}`, tooltip: lines.join('\n'), warn: score < 50 };
}

// ---------------- CodeLens (hotspoty z historii git) ----------------
/** Indeks do CodeLens: węzły plików z danymi git + ranking hotspotów + pliki z regułami gitHotspot/silo. */
function lensIndex(result) {
  const graph = result && result.graph, report = result && result.report;
  const idx = { nodes: new Map(), authors: [], hot: new Map(), flagged: new Set() };
  if (!graph || !report || !report.git) return idx;   // CodeLens tylko z danymi git
  idx.authors = (graph.gitInfo && graph.gitInfo.authors) || [];
  for (const n of graph.nodes || []) if (n.type === 'file' && n.git && n.git.c) idx.nodes.set(n.path, n);
  (report.hotspots || []).forEach((h, i) => idx.hot.set(h.path, i + 1));
  for (const f of report.findings || []) {
    if (!LENS_RULES.has(f.rule)) continue;
    for (const it of f.items || []) if (it.kind === 'file' && it.path) idx.flagged.add(it.path);
  }
  return idx;
}

/** Tytuł CodeLens dla pliku (ścieżka względna) albo null — tylko hotspoty i pliki z ryzykiem git. */
function lensTitle(idx, rel, lang) {
  const n = idx && idx.nodes.get(rel);
  if (!n) return null;
  const rank = idx.hot.get(rel) || 0;
  if (!rank && !idx.flagged.has(rel)) return null;
  const t = tr(lang), c = n.git.c;
  let s = t('lens', { c: fmtNum(lang, c), changes: plural(lang, c, t('changes')), cx: fmtNum(lang, (n.metrics && n.metrics.complexity) || 0) });
  const own = n.git.own != null ? idx.authors[n.git.own] : null;
  if (own && own.name) s += t('lensOwner', { owner: own.name, share: Math.round((n.git.share || 0) * 100) });
  if (rank) s += t('lensHot', { rank });
  return s;
}

// ---------------- analiza przy zapisie: debounce + tylko najnowszy przebieg ----------------
/**
 * trigger() odkłada przebieg o `delay` ms (kolejne wywołania przesuwają termin); gdy termin mija,
 * poprzedni wciąż trwający przebieg jest przerywany (AbortSignal), a nowy startuje: run(signal).
 */
function createScheduler(run, { delay = SAVE_DELAY, timers = globalThis } = {}) {
  let timer = null, ctrl = null, disposed = false;
  const fire = () => {
    timer = null;
    if (ctrl) ctrl.abort();
    const c = ctrl = new AbortController();
    Promise.resolve().then(() => run(c.signal)).catch(() => {}).finally(() => { if (ctrl === c) ctrl = null; });
  };
  return {
    trigger() { if (disposed) return; if (timer) timers.clearTimeout(timer); timer = timers.setTimeout(fire, delay); },
    cancel() { if (timer) { timers.clearTimeout(timer); timer = null; } if (ctrl) { ctrl.abort(); ctrl = null; } },
    dispose() { this.cancel(); disposed = true; },
    get pending() { return !!timer; },
    get running() { return !!ctrl; },
  };
}

// ---------------- wiadomości z webview ----------------
/** Walidacja {type:'codemap:open', path, line?} → {path, line?} albo null. */
function parseOpenMessage(m) {
  if (!m || typeof m !== 'object' || m.type !== 'codemap:open') return null;
  if (typeof m.path !== 'string' || !m.path || m.path.length > 4096) return null;
  const out = { path: m.path };
  const line = Number(m.line);
  if (m.line != null && Number.isInteger(line) && line >= 1 && line <= 1e7) out.line = line;
  return out;
}

module.exports = {
  SEVS, SEV_RANK, DEFAULTS, SAVE_DELAY, RULE_DOC, LINE_END, STR,
  resolveLang, tr, plural, fmtNum, sevRank, resultSeverity, passes,
  sarifUriToRel, reportSub, resolveMapPath, isInside, relToRoot, lineIndex, sarifToSpecs,
  mdEscape, statusSpec, lensIndex, lensTitle, createScheduler, parseOpenMessage,
};
