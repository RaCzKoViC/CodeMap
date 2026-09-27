// Serwer MCP (Model Context Protocol) — `codemap mcp [ścieżka]`: ta sama analiza co `codemap analyze` jako narzędzia dla
// agentów AI (Claude Code, Cursor, …): przegląd projektu, zależne pliki i wpływ zmiany, hotspoty, znaleziska, cykle,
// właściciele, testy, sprzężenie zmian, pytania o mapę, szkielety testów, wyszukiwanie w kodzie (BM25). Tylko odczyt;
// sieć wyłącznie z --osv (podatne zależności: do api.osv.dev idą same nazwy i wersje pakietów). Transport: stdio,
// JSON-RPC 2.0, jeden obiekt na linię; na stdout tylko protokół, logi na stderr. Analiza startuje od razu,
// `refresh` liczy ją od nowa (po zmianach w plikach).
import readline from 'node:readline';
import { runAnalysis } from './analyze.mjs';
import { MCP_MODULES } from './runtime.mjs';
import { architectureMarkdown } from './architecture.mjs';
import { stagedCheckText } from './check.mjs';
import { proposeRules, proposalText } from './propose-rules.mjs';
import { vulnSummary } from './report.mjs';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const S = (props = {}, required = []) => ({ type: 'object', properties: props, required });
const str = (description) => ({ type: 'string', description });
const int = (description) => ({ type: 'integer', description });

export const TOOLS = [
  { name: 'project_overview', description: 'Overview of the analysed project: size, languages, health score, findings by severity and rule, hotspots, packages, tests, git owners and bus factor. Start here.', inputSchema: S() },
  { name: 'find_files', description: 'Files whose path contains a text fragment (max 30).', inputSchema: S({ query: str('path fragment') }, ['query']) },
  { name: 'code_search', description: 'Keyword search (BM25) over the project source; returns numbered snippets with file:lines.', inputSchema: S({ query: str('identifiers or concepts'), k: int('max snippets 1-8') }, ['query']) },
  { name: 'file_info', description: 'Facts about one file: lines, complexity, symbols, git owner and change count, tests and coverage, import counts.', inputSchema: S({ path: str('file path (or a unique suffix)') }, ['path']) },
  { name: 'dependencies', description: 'Files the given file imports.', inputSchema: S({ path: str('file path') }, ['path']) },
  { name: 'dependents', description: 'Files that import the given file, directly and one level further (who is affected when it changes).', inputSchema: S({ path: str('file path') }, ['path']) },
  { name: 'change_impact', description: 'Risk of changing a set of files (like a PR review): per-file risk with reasons (churn, complexity, dependents, weak tests, size), all impacted dependents, suggested reviewers. Pass paths, or base (a git ref) to diff base...HEAD.', inputSchema: S({ paths: { type: 'array', items: { type: 'string' }, description: 'changed files' }, base: str('git ref to compare with, e.g. main') }) },
  { name: 'hotspots', description: 'Riskiest files: change frequency × complexity (git history) or size × dependents × complexity.', inputSchema: S({ n: int('how many, 1-20') }) },
  { name: 'findings', description: 'Static-analysis findings (cycles, god files, duplication, untested complex files, unused exports, hidden change coupling, vulnerable dependencies, CODEOWNERS drift…), filterable.', inputSchema: S({ rule: str('rule id, e.g. cycles, dupcode, untested'), severity: str('high | med | low'), path: str('only findings for paths containing this'), limit: int('max items, default 40') }) },
  { name: 'cycles', description: 'Import cycles between files and cycles between monorepo packages.', inputSchema: S() },
  { name: 'owners', description: 'Who owns the project, a folder or a file according to git history (authors, shares, bus factor).', inputSchema: S({ path: str('file or folder; omit for the whole project') }) },
  { name: 'tests', description: 'Which tests cover a file or folder; without a path: a project summary with the most complex untested files.', inputSchema: S({ path: str('file or folder') }) },
  { name: 'change_coupling', description: 'Files changed together in git history (degree and shared commits); marks pairs without an import between them (hidden dependency). Without a path: the strongest pairs.', inputSchema: S({ path: str('file path') }) },
  { name: 'ask_map', description: 'Natural-language question about the map answered from the graph, e.g. "untested files with complexity over 50 in src", "top 5 most changed files", "files in cycles".', inputSchema: S({ question: str('the question') }, ['question']) },
  { name: 'test_skeleton', description: 'Test file skeleton for a code file following the project conventions (framework, location, imports, cases ordered by complexity).', inputSchema: S({ path: str('file path') }, ['path']) },
  { name: 'architecture', description: 'ARCHITECTURE.md of the project generated from the map: layers in dependency order (with upstream dependencies = cycles), packages, entry points, core modules, hotspots, ownership, test conventions, rules and cycles.', inputSchema: S() },
  { name: 'propose_rules', description: 'Proposed .codemap.rules.json from the dependency-matrix layers: a provider must not depend on its consumers; only pairs with no upstream dependency today are forbidden (the rules pass now and block new ones), existing upstream dependencies are listed as exceptions to fix.', inputSchema: S({ mode: str('packages | folders (default: packages when the project has 2+)'), depth: int('folder depth 1-3') }) },
  { name: 'staged_check', description: 'Pre-commit check of the staged changes (git index) against HEAD: risk, dependents, health score change and NEW findings; reports BLOCKING architecture problems (forbidden layer dependencies, import cycles, package cycles) the commit would introduce. Run after `git add`, before committing.', inputSchema: S() },
  { name: 'refresh', description: 'Re-run the analysis after files changed on disk.', inputSchema: S() },
];
const OSV_TOOL = { name: 'vulnerable_dependencies', description: 'Known vulnerabilities of the project dependencies from OSV.dev (lockfile / manifest versions; only package names and versions are sent).', inputSchema: S() };

export function createServer(opts = {}) {
  const lang = opts.lang || 'en', dir = opts.dir || '.';
  const log = opts.log || ((m) => process.stderr.write('codemap mcp: ' + m + '\n'));
  let state = null, pending = null, clientProtocol = PROTOCOLS[0];
  const analyze = () => {
    pending = runAnalysis(dir, { lang, git: opts.git !== false, exclude: opts.exclude || [], gitignore: opts.gitignore !== false, osv: !!opts.osv, modules: MCP_MODULES })
      .then((r) => { state = { ...r, rag: null }; log(`analysis ready — ${r.report.stats.files} files, score ${r.report.score}`); return state; })
      .catch((e) => { log('analysis failed: ' + ((e && e.message) || e)); throw e; });
    return pending;
  };
  analyze();
  const ready = () => pending;
  const tools = () => (opts.osv ? TOOLS.concat([OSV_TOOL]) : TOOLS);

  // leksykalne wyszukiwanie (BM25) z fragmentów plików — jak tryb 📚 bez embeddingów
  function ragOf(st) {
    if (st.rag) return st.rag;
    const R = st.CM.RAG, chunks = [];
    for (const n of st.graph.nodes.values()) if (n.type === 'file' && n.preview) for (const c of R.chunkFile(n)) chunks.push(c);
    const lex = R.buildLexical(chunks);
    st.rag = { search: async (q, o) => ({ hits: R.rank(R.bm25(lex, R.queryTokens(q)), null, (o && o.k) || 4).filter((h) => h.score > 0), s: { chunks } }) };
    return st.rag;
  }
  const agent = (st, name, args) => st.CM.Agent.exec(name, args, { graph: st.graph, rag: name === 'codeSearch' ? ragOf(st) : null, sources: [], gitCore: st.CM.GitCore, testMap: st.CM.TestMap });
  const fileNode = (st, p) => { const n = st.CM.Agent.pathMatch(st.graph, p); if (!n) throw new Error('file not found: ' + p); return n; };

  function overview(st) {
    const { report: r, graph: g, CM } = st, L = [];
    L.push(`${r.project.name}: ${r.stats.files} files, ${r.stats.lines} lines · health score ${r.score}/100`);
    const byLang = new Map(); for (const x of r.stats.languages || []) byLang.set(x.name, (byLang.get(x.name) || 0) + x.files);   // .js i .mjs to jeden język
    L.push('languages: ' + [...byLang].sort((p, q) => q[1] - p[1]).slice(0, 6).map(([k, v]) => `${st.CM.languages.label(k, 'en')} ${v}`).join(', '));
    L.push(`findings: ${r.totals.findings} (high ${r.totals.high}, med ${r.totals.med}, low ${r.totals.low})` + (r.findings.length ? ' — ' + r.findings.slice(0, 10).map((f) => `${f.rule} ${f.count}`).join(', ') : ''));
    const pk = g.packages || [];
    if (pk.length >= 2) { const pc = CM.DSM.packageCycles(g); L.push(`packages: ${pk.length} (${pk.slice(0, 8).map((p) => p.name).join(', ')}${pk.length > 8 ? ', …' : ''})` + (pc.length ? ` · package cycles: ${pc.map((c) => c.map((u) => u.name).join(' ↔ ')).join('; ')}` : '')); }
    const ti = g.testInfo; if (ti && ti.tests) L.push(`tests: ${ti.tests} test files; ${ti.tested} of ${ti.code} code files have tests (${ti.pct}%)`);
    const gi = g.gitInfo; if (gi) { const au = (gi.authors || []).filter((a) => !a.bot); L.push(`git: ${gi.commits} commits, ${au.length} authors, bus factor ${gi.busFactor ? gi.busFactor.value : '?'}`); }
    return L.filter(Boolean).join('\n');
  }

  async function impact(st, a) {
    let files = [];
    if (a.base) {
      if (!st.repoRoot) throw new Error('base needs a git repository');
      const { changedFiles } = await import('./pr.mjs');
      files = changedFiles(st.repoRoot, a.base, st.sub, lang);
    } else files = (Array.isArray(a.paths) ? a.paths : String(a.paths || '').split(/[,\s]+/)).filter(Boolean).map((p) => ({ path: fileNode(st, p).path, status: 'M', add: 0, del: 0 }));
    if (!files.length) throw new Error('pass paths or base');
    const res = st.CM.PRCore.analyze(st.graph, files, {});
    const why = (c) => Object.entries(c.parts || {}).filter(([, v]) => v >= 0.5).map(([k]) => k).join(', ');
    const L = [`risk ${res.level} (${res.risk}/100) · ${res.changed.length} changed files on the map${res.outside.length ? ', ' + res.outside.length + ' outside it (new or skipped)' : ''} · ${res.impacted.size} impacted dependents (${res.direct} direct)`];
    for (const c of res.changed.slice(0, 15)) L.push(`- ${c.path} (${c.status}${c.add || c.del ? `, +${c.add}/−${c.del}` : ''}): risk ${c.risk}${why(c) ? ' — ' + why(c) : ''}${c.importers ? `, imported by ${c.importers}` : ''}`);
    const dep = [...res.impacted.entries()].filter(([id]) => !res.changed.some((c) => c.id === id)).sort((x, y) => x[1] - y[1]).slice(0, 25).map(([id, d]) => (st.graph.nodes.get(id) || {}).path + (d > 1 ? ` (distance ${d})` : ''));
    if (dep.length) L.push('impacted: ' + dep.join(', '));
    if (res.reviewers && res.reviewers.length) L.push('suggested reviewers: ' + res.reviewers.slice(0, 4).map((r) => r.login ? '@' + r.login : r.name).join(', '));
    return L.join('\n');
  }

  function findings(st, a) {
    const lim = Math.max(1, Math.min(200, +a.limit || 40)), L = [];
    for (const f of st.report.findings) {
      if (a.rule && f.rule !== a.rule) continue;
      for (const it of f.items) {
        if (a.severity && it.sev !== a.severity) continue;
        if (a.path && !String(it.path || '').includes(a.path)) continue;
        L.push(`[${it.sev}] ${f.rule} · ${it.path} — ${it.detail}${it.related && it.related.length ? ' (with: ' + it.related.slice(0, 4).join(', ') + ')' : ''}`);
        if (L.length >= lim) break;
      }
      if (L.length >= lim) break;
    }
    return L.length ? L.join('\n') : 'no findings match' + (st.report.findings.length ? '; rules: ' + st.report.findings.map((f) => f.rule).join(', ') : '');
  }

  function cycles(st) {
    const g = st.graph, L = [], res = g.importCycles(), P = (id) => (g.nodes.get(id) || {}).path || id;
    const comps = (res.components || []).slice().sort((a, b) => b.length - a.length);
    L.push(comps.length ? `${comps.length} import cycle(s):` : 'no import cycles between files');
    for (const c of comps.slice(0, 15)) L.push('- ' + c.slice(0, 8).map(P).join(' → ') + (c.length > 8 ? ' → …' : '') + ` (${c.length} files)`);
    const pc = st.CM.DSM.packageCycles(g);
    if ((g.packages || []).length >= 2) L.push(pc.length ? 'package cycles: ' + pc.map((c) => c.map((u) => u.name).join(' ↔ ')).join('; ') : 'no cycles between packages');
    return L.join('\n');
  }

  function coupling(st, a) {
    const g = st.graph, GC = st.CM.GitCore; if (!g.gitInfo) return 'no git history (the project has no .git, or it was started with --no-git)';
    const idx = new Map([...g.nodes.values()].filter((n) => n.type === 'file').map((n) => [n.path, n]));
    const linked = (x, y) => !!(x && y) && ((x.importsOut || []).includes(y.id) || (y.importsOut || []).includes(x.id));
    const pct = (d) => Math.round(d * 100) + '%';
    if (a.path) {
      const n = fileNode(st, a.path), list = GC.couplingFor(g.gitInfo, n.path).slice(0, 15);
      return list.length ? `${n.path} changes together with:\n` + list.map((c) => `- ${c.path} (${pct(c.degree)}, ${c.shared} shared commits${linked(n, idx.get(c.path)) ? '' : ', no import — hidden dependency'})`).join('\n') : `${n.path}: no files changed together often enough`;
    }
    const top = GC.coupling(g.gitInfo).slice(0, 20);
    return top.length ? 'strongest change coupling:\n' + top.map((p) => `- ${p.a} ↔ ${p.b} (${pct(p.degree)}, ${p.shared} shared${linked(idx.get(p.a), idx.get(p.b)) ? '' : ', no import'})`).join('\n') : 'no coupled files in the analysed history';
  }

  async function callTool(name, a) {
    // własna analiza indeksu i HEAD (cli/check.mjs) — nie czeka na analizę katalogu
    if (name === 'staged_check') return stagedCheckText(dir, { lang, git: opts.git !== false, exclude: opts.exclude || [] });
    const st = await ready();
    switch (name) {
      case 'project_overview': return overview(st);
      case 'find_files': return agent(st, 'findFiles', { query: a.query });
      case 'code_search': return agent(st, 'codeSearch', { query: a.query, k: a.k });
      case 'file_info': return agent(st, 'fileInfo', { path: a.path });
      case 'dependencies': return agent(st, 'dependencies', { path: a.path });
      case 'dependents': return agent(st, 'dependents', { path: a.path });
      case 'change_impact': return impact(st, a);
      case 'hotspots': return agent(st, 'hotspots', { n: a.n });
      case 'findings': return findings(st, a);
      case 'cycles': return cycles(st);
      case 'owners': return agent(st, 'owners', { path: a.path });
      case 'tests': return agent(st, 'tests', { path: a.path });
      case 'change_coupling': return coupling(st, a);
      case 'ask_map': { const Q = st.CM.MapQuery, p = Q.parse(a.question, st.graph), r = Q.run(st.graph, p.spec); return Q.describe(r, p.spec, lang === 'pl' ? 'pl' : 'en'); }
      case 'test_skeleton': { const r = st.CM.TestGen.generate(st.graph, fileNode(st, a.path), { lang: lang === 'pl' ? 'pl' : 'en' }); return `proposed file: ${r.path}${r.framework ? ' (' + r.framework + ')' : ''}\n\`\`\`\n${r.code}\`\`\``; }
      case 'architecture': return architectureMarkdown(st.CM, st.graph, st.report, { lang: lang === 'pl' ? 'pl' : 'en', version: opts.version || st.CM.VERSION });
      case 'propose_rules': return proposalText(proposeRules(st.CM, st.graph, { mode: a.mode, depth: a.depth, lang: 'en' }));
      case 'refresh': { const s2 = await analyze(); return `re-analysed: ${s2.report.stats.files} files, health score ${s2.report.score}/100`; }
      case 'vulnerable_dependencies': {
        if (!opts.osv) throw new Error('start the server with --osv to query OSV.dev');
        return vulnSummary(st.graph.vulnInfo);
      }
      default: throw new Error('unknown tool: ' + name);
    }
  }

  // JSON-RPC: zwraca odpowiedź albo null (powiadomienie)
  async function handle(msg) {
    if (!msg || typeof msg !== 'object') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };
    const { id, method, params } = msg, has = id !== undefined && id !== null;
    const ok = (result) => (has ? { jsonrpc: '2.0', id, result } : null);
    switch (method) {
      case 'initialize': {
        const want = params && params.protocolVersion; clientProtocol = PROTOCOLS.includes(want) ? want : PROTOCOLS[0];
        return ok({ protocolVersion: clientProtocol, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'codemap', version: opts.version || '' },
          instructions: 'CodeMap analyses the project graph (imports, git history, tests, static-analysis rules) locally. Start with project_overview; use dependents / change_impact before editing shared files.' });
      }
      case 'notifications/initialized': case 'notifications/cancelled': return null;
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: tools() });
      case 'tools/call': {
        const name = params && params.name, args = (params && params.arguments) || {};
        try { const text = String(await callTool(name, args)); return ok({ content: [{ type: 'text', text }], isError: false }); }
        catch (e) { return ok({ content: [{ type: 'text', text: 'error: ' + ((e && e.message) || e) }], isError: true }); }
      }
      default: return has ? { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found: ' + method } } : null;
    }
  }
  return { handle, ready, tools };
}

/** stdio: linia = jeden obiekt JSON-RPC; kończy się, gdy klient zamknie stdin. */
export function serve(opts = {}) {
  const srv = createServer(opts);
  const out = (o) => { if (o) process.stdout.write(JSON.stringify(o) + '\n'); };
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { out({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }); return; }
    srv.handle(msg).then(out, (e) => out({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: String((e && e.message) || e) } }));
  });
  return new Promise((res) => rl.on('close', res));
}
