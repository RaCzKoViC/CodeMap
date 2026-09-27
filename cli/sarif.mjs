// Raport SARIF 2.1.0 z wyniku CM.Inspect.run (GitHub code scanning, SARIF Viewer w VS Code).
// Decyzje:
//  - ruleId = identyfikator reguły Inspect (cycles, god, archviolation…) — ten sam co w --fail-on i w JSON;
//    w `rules` tylko reguły, które dały wynik; opisy w języku --lang.
//  - jeden wynik na zapamiętaną pozycję znaleziska (Inspect trzyma do 60 na regułę; nadwyżka jest w
//    run.properties.truncated), level wg ważności POZYCJI: high → error, med → warning, low/info → note.
//  - URI względne (bez ścieżek absolutnych) z uriBaseId %SRCROOT% = korzeń repozytorium git, gdy analizowany
//    katalog leży w repozytorium (wtedy z prefiksem podkatalogu — tak jak ścieżki w checkout na GitHubie),
//    inaczej sam analizowany katalog. Segmenty kodowane encodeURIComponent.
//  - region.startLine zawsze (GitHub go wymaga): dla cykli i naruszeń architektury linia importu pliku
//    docelowego znaleziona heurystycznie w treści, w pozostałych przypadkach 1 (znalezisko dotyczy pliku).
//  - cykle: relatedLocations = pozostałe pliki cyklu (do 100); duplikaty: drugi plik pary; naruszenia: cel importu.
//  - znaleziska folderów (deep, crowded) są POMIJANE: konsumenci SARIF zakotwiczają alerty w plikach i liniach,
//    katalog nie jest artefaktem, który da się pokazać — zostają w JSON/Markdown, liczba w run.properties.
//  - partialFingerprints["codemap/v1"] = sha256(reguła, ścieżka, posortowane ścieżki powiązane[, szczegół bez
//    cyfr dla archviolation]) — niezależne od języka raportu i od zmieniających się liczb (linie, CC, zmiany).
import { createHash } from 'node:crypto';

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
export const INFO_URI = 'https://github.com/RaCzKoViC/CodeMap';
const LEVEL = { high: 'error', med: 'warning', low: 'note', info: 'note' };
const TAGS = {
  archviolation: ['architecture'], cycles: ['architecture'], god: ['architecture'], unstable: ['architecture'],
  fanout: ['architecture'], gitHotspot: ['maintainability', 'git'], huge: ['maintainability'], complex: ['maintainability'],
  lowcov: ['testing'], untested: ['testing'], silo: ['maintainability', 'git'], risky: ['security'],
  dupcode: ['maintainability', 'duplication'], orphan: ['maintainability', 'dead-code'], unusedexport: ['maintainability', 'dead-code'], emptycatch: ['reliability'],
  debug: ['maintainability'], todo: ['maintainability'], deep: ['structure'], crowded: ['structure'],
  minified: ['build-artifact'], archrules: ['configuration'],
};
const DEP = new Set(['import', 'reference']);

const encodeUri = (p) => String(p).split('/').map(encodeURIComponent).join('/');
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Linia (1…) importu pliku `dst` w treści `src` — heurystyka na node.preview; null, gdy nie znaleziono. */
export function importLine(graph, src, dst) {
  const text = src && src.preview;
  if (!text || !dst || dst.type !== 'file') return null;
  let stem = String(dst.name || '').replace(/\.[^.]+$/, '');
  if (/^(index|__init__|mod)$/i.test(stem)) { const p = graph.nodes.get(dst.parent); if (p && p.type === 'folder' && p.path) stem = p.name; }
  if (!stem) return null;
  const e = escRe(stem);
  // „./lib/util", '../app.js', "util.h", <x/util.h>, '@/config' — nazwa na końcu ścieżki w cudzysłowie
  const quoted = new RegExp(`['"\`<](?:[^'"\`<>\\n]*[/\\\\.:@])?${e}(?:\\.[\\w]+)?(?:/index(?:\\.[\\w]+)?)?['"\`>]`);
  // from .helpers import x · import com.x.util.Helper · use crate::util · #include util
  const bare = new RegExp(`^\\s*(?:from|import|use|using|require|include|#include|mod)\\b[^\\n]*\\b${e}\\b`);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) if (quoted.test(lines[i]) || bare.test(lines[i])) return i + 1;
  return null;
}

/**
 * @param {{CM, graph, rep, lang?:string, uriPrefix?:string}} a  rep = wynik CM.Inspect.run(graph)
 * @returns {object} dokument SARIF 2.1.0
 */
export function toSarif({ CM, graph, rep, lang = 'pl', uriPrefix = '' }) {
  const t = CM.Inspect.text;
  const pre = uriPrefix ? uriPrefix.replace(/\/+$/, '') + '/' : '';
  const loc = (n, line) => ({
    physicalLocation: {
      artifactLocation: { uri: encodeUri(pre + n.path), uriBaseId: '%SRCROOT%' },
      region: { startLine: line || 1 },
    },
  });
  const ruleIdx = new Map(), rules = [], results = [];
  let folderFindings = 0;
  const truncated = {};
  for (const f of rep.findings) {
    if (f.count > f.items.length) truncated[f.rule] = f.count - f.items.length;
    for (const it of f.items) {
      const n = graph.nodes.get(it.id);
      if (!n || n.type !== 'file') { folderFindings++; continue; }
      if (!ruleIdx.has(f.rule)) {
        ruleIdx.set(f.rule, rules.length);
        const title = t('r.' + f.rule), desc = t('r.' + f.rule + '.d');
        const rd = {
          id: f.rule,
          shortDescription: { text: title },
          fullDescription: { text: desc },
          help: { text: desc, markdown: `**${title}**\n\n${desc}` },
          defaultConfiguration: { level: LEVEL[f.sev] || 'note' },
          properties: { tags: ['codemap', ...(TAGS[f.rule] || [])], precision: 'medium' },
        };
        if (f.rule === 'risky') rd.properties['security-severity'] = '5.0';
        rules.push(rd);
      }
      const rel = (it.related || []).map((id) => graph.nodes.get(id)).filter((x) => x && x.type === 'file');
      // linia importu: cykl → pierwszy członek cyklu, do którego ten plik ma krawędź; naruszenie → cel importu
      let line = null;
      if (f.rule === 'cycles' && rel.length) {
        const members = new Set(rel.map((x) => x.id));
        for (const e of graph.edges) {
          if (e.source === n.id && DEP.has(e.type) && members.has(e.target)) { line = importLine(graph, n, graph.nodes.get(e.target)); if (line) break; }
        }
      } else if (f.rule === 'archviolation' && rel.length) line = importLine(graph, n, rel[0]);
      else if (f.rule === 'unusedexport') { const m = /[\w$]:(\d+)/.exec(it.detail || ''); if (m) line = +m[1]; }   // „nazwa:linia" pierwszego eksportu
      const title = t('r.' + f.rule);
      const r = {
        ruleId: f.rule,
        ruleIndex: ruleIdx.get(f.rule),
        level: LEVEL[it.sev || f.sev] || 'note',
        message: { text: it.detail ? `${title}: ${it.detail}` : title },
        locations: [loc(n, line)],
      };
      if (rel.length) r.relatedLocations = rel.map((x, i) => Object.assign({ id: i + 1, message: { text: x.name } }, loc(x, null)));
      const fpParts = [f.rule, n.path, rel.map((x) => x.path).sort().join('\n')];
      if (f.rule === 'archviolation') fpParts.push(String(it.detail || '').replace(/\d+/g, ''));
      r.partialFingerprints = { 'codemap/v1': sha(fpParts.join('\0')) };
      r.properties = { severity: it.sev || f.sev };
      results.push(r);
    }
  }
  const total = rep.findings.reduce((a, f) => a + f.count, 0);
  return {
    $schema: SARIF_SCHEMA,
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'CodeMap', informationUri: INFO_URI, version: CM.VERSION, semanticVersion: CM.VERSION,
          language: lang === 'en' ? 'en-US' : 'pl-PL', rules,
        },
      },
      invocations: [{ executionSuccessful: true }],
      columnKind: 'utf16CodeUnits',
      results,
      properties: { healthScore: rep.score, files: rep.files, findings: total, folderFindings, truncated },
    }],
  };
}
