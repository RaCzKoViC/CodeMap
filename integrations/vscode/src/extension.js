// Rozszerzenie VS Code „CodeMap": analiza workspace tą samą logiką co aplikacja i CLI (kopia cli/ w wątku
// roboczym) → znaleziska Inspect w Problems, health score w pasku stanu, CodeLens nad hotspotami git
// i mapa w panelu webview (kopia aplikacji z app/) z nawigacją w obie strony (edytor ↔ mapa).
// Moduł `vscode` jest wstrzykiwany do createExtension() — testy podają atrapę; logika czysta w core.js.
'use strict';
const fsp = require('node:fs/promises');
const core = require('./core');
const { MapPanel } = require('./webview');
const analyzer = require('./analyzer');

const COMMANDS = ['codemap.analyze', 'codemap.openMap', 'codemap.revealInMap', 'codemap.clear'];

/** Ważność CodeMap → DiagnosticSeverity. */
function severityOf(V, sev) {
  const S = V.DiagnosticSeverity;
  return sev === 'high' ? S.Error : sev === 'med' ? S.Warning : sev === 'low' ? S.Information : S.Hint;
}

/** Opis z core.sarifToSpecs → vscode.Diagnostic. */
function toDiagnostic(V, s) {
  const d = new V.Diagnostic(new V.Range(s.line, 0, s.line, core.LINE_END), s.message, severityOf(V, s.sev));
  d.source = 'CodeMap';
  d.code = { value: s.rule, target: V.Uri.parse(core.RULE_DOC) };
  if (s.related && s.related.length) {
    d.relatedInformation = s.related.map((r) => new V.DiagnosticRelatedInformation(
      new V.Location(V.Uri.file(r.file), new V.Range(r.line, 0, r.line, core.LINE_END)), r.message));
  }
  return d;
}

/** SARIF → [[Uri, Diagnostic[]]] + liczniki. */
function buildDiagnostics(V, sarif, o) {
  const specs = core.sarifToSpecs(sarif, o);
  const entries = [];
  for (const [file, list] of specs.files) entries.push([V.Uri.file(file), list.map((s) => toDiagnostic(V, s))]);
  return { entries, total: specs.total, shown: specs.shown, hidden: specs.hidden };
}

function createExtension(V, deps = {}) {
  const analyze = deps.analyze || analyzer.analyze;
  const timers = deps.timers || globalThis;
  const realpath = deps.realpath || ((p) => fsp.realpath(p));

  let ctx = null, collection = null, status = null, output = null, panel = null, lensEmitter = null;
  const results = new Map();     // fsPath folderu → {key, folder, name, result, lang, version, sub, lens, uris, shown}
  const runs = new Map();        // fsPath → AbortController bieżącego przebiegu
  const inflight = new Map();    // fsPath → Promise<entry|null>
  const schedulers = new Map();  // fsPath → scheduler analizy przy zapisie
  let lastKey = null;

  const conf = (uri) => {
    const c = V.workspace.getConfiguration('codemap', uri);
    const get = (k) => { const v = c.get(k); return v === undefined ? core.DEFAULTS[k] : v; };
    const min = get('minSeverity');
    return {
      analyzeOnSave: !!get('analyzeOnSave'), git: get('git') !== false, codeLens: get('codeLens') !== false,
      minSeverity: min in core.SEV_RANK ? min : core.DEFAULTS.minSeverity,
      exclude: Array.isArray(get('exclude')) ? get('exclude').filter((x) => typeof x === 'string' && x) : [],
      lang: core.resolveLang(get('lang'), V.env.language),
    };
  };
  const lang = (uri) => conf(uri).lang;
  const t = (key, vars, uri) => core.tr(lang(uri))(key, vars);
  const log = (s) => { if (output) output.appendLine(`[${new Date().toLocaleTimeString()}] ${s}`); };
  const folders = () => V.workspace.workspaceFolders || [];

  // ---------------- wybór folderu ----------------
  async function pickFolder(uri) {
    const list = folders();
    if (!list.length) { V.window.showWarningMessage(t('noFolder')); return null; }
    if (uri) { const f = V.workspace.getWorkspaceFolder(uri); if (f) return f; }
    const ed = V.window.activeTextEditor;
    if (ed) { const f = V.workspace.getWorkspaceFolder(ed.document.uri); if (f) return f; }
    if (list.length === 1) return list[0];
    if (panel && panel.key) { const f = list.find((x) => x.uri.fsPath === panel.key); if (f) return f; }
    return (await V.window.showWorkspaceFolderPick({ placeHolder: t('pickFolder') })) || null;
  }
  function currentKey() {
    const ed = V.window.activeTextEditor;
    const f = ed && V.workspace.getWorkspaceFolder(ed.document.uri);
    if (f) return f.uri.fsPath;
    const list = folders();
    return list.length === 1 ? list[0].uri.fsPath : lastKey;
  }

  // ---------------- analiza ----------------
  function analyzeFolder(folder, { silent = false, notify = false, signal } = {}) {
    const key = folder.uri.fsPath;
    const prev = runs.get(key);
    if (prev) prev.abort();
    const ctrl = new AbortController();
    runs.set(key, ctrl);
    if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', () => ctrl.abort(), { once: true }); }
    const c = conf(folder.uri);
    let userCancel = false;
    refreshStatus();
    const task = analyze(key, { lang: c.lang, git: c.git, exclude: c.exclude }, { signal: ctrl.signal });
    const progress = silent
      ? V.window.withProgress({ location: V.ProgressLocation.Window, title: t('analyzing', { name: folder.name }) }, () => task)
      : V.window.withProgress({ location: V.ProgressLocation.Notification, title: t('analyzing', { name: folder.name }), cancellable: true },
        (_p, token) => { token.onCancellationRequested(() => { userCancel = true; ctrl.abort(); }); return task; });
    // przebieg zastąpiony nowszym (przerwany przez prev.abort()) → czekający (openMap) dostają wynik nowszego
    const newer = () => { const q = inflight.get(key); return q && q !== p ? q : null; };
    const p = Promise.resolve(progress).then((result) => {
      if (runs.get(key) !== ctrl) return newer();
      runs.delete(key);
      const entry = apply(folder, result, c);
      if (notify) {
        const rep = result.report;
        V.window.showInformationMessage(t('done', { name: folder.name, score: rep.score, n: rep.totals.findings, shown: entry.shown }), t('openMap'), t('problems'))
          .then((pick) => {
            if (pick === t('openMap')) V.commands.executeCommand('codemap.openMap', folder.uri);
            else if (pick === t('problems')) V.commands.executeCommand('workbench.actions.view.problems');
          }, () => {});
      }
      return entry;
    }, (e) => {
      if (runs.get(key) !== ctrl) return newer();
      runs.delete(key);
      if (e && e.name === 'AbortError') { if (userCancel) V.window.showInformationMessage(t('cancelled')); return null; }
      const msg = (e && e.message) || String(e);
      log(`${folder.name}: ${msg}${e && e.workerStack && !e.cli ? '\n' + e.workerStack : ''}`);
      if (!silent) V.window.showErrorMessage(t('failed', { msg }));
      return null;
    }).finally(() => { if (inflight.get(key) === p) inflight.delete(key); refreshStatus(); });
    inflight.set(key, p);
    return p;
  }

  function apply(folder, result, c) {
    const key = folder.uri.fsPath, prev = results.get(key);
    const entry = { key, folder, name: folder.name, result, lang: c.lang, version: (prev ? prev.version : 0) + 1,
      sub: core.reportSub(result.report), lens: core.lensIndex(result), uris: prev ? prev.uris : [], shown: 0 };
    results.set(key, entry);
    lastKey = key;
    publish(entry);
    const rep = result.report;
    log(`${folder.name}: health score ${rep.score}/100, ${rep.files} files, ${rep.totals.findings} findings `
      + `(${core.SEVS.map((s) => s + ' ' + (rep.totals[s] || 0)).join(', ')}), Problems: ${entry.shown}, ${rep.timing ? rep.timing.totalMs + ' ms' : ''}`);
    for (const w of rep.warnings || []) log(`${folder.name}: ${core.tr(c.lang)('warn')}: ${w}`);
    if (lensEmitter) lensEmitter.fire();
    if (panel) panel.update(stateOf(entry));
    return entry;
  }

  function publish(entry) {
    for (const u of entry.uris) collection.delete(u);
    const d = buildDiagnostics(V, entry.result.sarif, { root: entry.key, sub: entry.sub, minSeverity: conf(entry.folder.uri).minSeverity, lang: entry.lang });
    for (const [uri, list] of d.entries) collection.set(uri, list);
    entry.uris = d.entries.map(([u]) => u);
    entry.shown = d.shown;
  }

  function ensureEntry(folder) {
    const key = folder.uri.fsPath;
    if (results.has(key)) return Promise.resolve(results.get(key));
    return inflight.get(key) || analyzeFolder(folder);
  }

  // ---------------- pasek stanu ----------------
  function refreshStatus() {
    if (!status) return;
    if (!folders().length) { status.hide(); return; }
    const key = currentKey(), entry = key && results.get(key);
    const l = lang(entry ? entry.folder.uri : undefined);
    if (key && runs.has(key)) {
      status.text = '$(sync~spin) CodeMap';
      status.tooltip = core.tr(l)('tRunning');
      status.backgroundColor = undefined;
    } else {
      const s = core.statusSpec(entry ? entry.result.report : null, l, entry && entry.name);
      status.text = s.text;
      const md = new V.MarkdownString(s.tooltip, true);
      md.isTrusted = false;
      status.tooltip = md;
      status.backgroundColor = s.warn ? new V.ThemeColor('statusBarItem.warningBackground') : undefined;
    }
    status.show();
  }

  // ---------------- mapa ----------------
  const stateOf = (entry) => ({ key: entry.key, name: entry.name, map: entry.result.graph, lang: lang(entry.folder.uri), version: entry.version });

  async function openMap(uri) {
    const folder = await pickFolder(uri && uri.fsPath ? uri : undefined);
    if (!folder) return;
    const entry = await ensureEntry(folder);
    if (entry) panel.show(stateOf(entry));
  }

  async function revealInMap(uri) {
    const target = uri && uri.fsPath ? uri : (V.window.activeTextEditor && V.window.activeTextEditor.document.uri);
    if (!target) return openMap();
    const folder = V.workspace.getWorkspaceFolder(target);
    if (!folder) { V.window.showWarningMessage(t('notInWorkspace', { p: target.fsPath })); return; }
    const entry = await ensureEntry(folder);
    if (!entry) return;
    const rel = core.relToRoot(target.fsPath, entry.key);
    panel.show(stateOf(entry), { focus: rel || null });
  }

  // webview → „otwórz plik": tylko ścieżki w analizowanym folderze i w folderach workspace (także po realpath)
  async function openFromMap(msg) {
    const m = core.parseOpenMessage(msg);
    const entry = panel && panel.key && results.get(panel.key);
    if (!m || !entry) return false;
    const roots = folders().map((f) => f.uri.fsPath);
    const abs = core.resolveMapPath(m.path, entry.key, roots);
    const reject = () => { log(t('badPath', { p: m.path })); V.window.showWarningMessage(t('badPath', { p: m.path })); return false; };
    if (!abs) return reject();
    let real;
    try { real = await realpath(abs); } catch (e) { V.window.showWarningMessage(t('openFail', { p: m.path, msg: (e && e.code) || e })); return false; }
    const realRoots = await Promise.all(roots.map((r) => realpath(r).catch(() => r)));
    if (!realRoots.some((r) => core.isInside(real, r))) return reject();
    const uri = V.Uri.file(abs);
    const col = panel.panel && panel.panel.viewColumn === V.ViewColumn.One ? V.ViewColumn.Beside : V.ViewColumn.One;
    try {
      const doc = await V.workspace.openTextDocument(uri);
      const ed = await V.window.showTextDocument(doc, { viewColumn: col, preview: true, preserveFocus: false });
      if (m.line) {
        const pos = new V.Position(m.line - 1, 0);
        ed.selection = new V.Selection(pos, pos);
        ed.revealRange(new V.Range(pos, pos), V.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    } catch (e) {
      // plik binarny (obraz, PDF…) — domyślny edytor VS Code
      try { await V.commands.executeCommand('vscode.open', uri, { viewColumn: col }); }
      catch (e2) { V.window.showWarningMessage(t('openFail', { p: m.path, msg: (e && e.message) || e })); return false; }
    }
    return true;
  }

  // ---------------- CodeLens ----------------
  const lensProvider = {
    onDidChangeCodeLenses: null,
    provideCodeLenses(doc) {
      if (!doc || !doc.uri || doc.uri.scheme !== 'file' || !conf(doc.uri).codeLens) return [];
      const f = V.workspace.getWorkspaceFolder(doc.uri), entry = f && results.get(f.uri.fsPath);
      if (!entry) return [];
      const title = core.lensTitle(entry.lens, core.relToRoot(doc.uri.fsPath, entry.key), lang(doc.uri));
      if (!title) return [];
      return [new V.CodeLens(new V.Range(0, 0, 0, 0), { title, command: 'codemap.revealInMap', arguments: [doc.uri] })];
    },
  };

  // ---------------- zapis → analiza ----------------
  function onSave(doc) {
    if (!doc || !doc.uri || doc.uri.scheme !== 'file') return;
    const folder = V.workspace.getWorkspaceFolder(doc.uri);
    if (!folder || !conf(folder.uri).analyzeOnSave) return;
    const key = folder.uri.fsPath;
    let s = schedulers.get(key);
    if (!s) {
      s = core.createScheduler((signal) => analyzeFolder(folder, { silent: true, signal }), { delay: core.SAVE_DELAY, timers });
      schedulers.set(key, s);
    }
    s.trigger();
  }

  function onConfig(e) {
    if (e.affectsConfiguration('codemap.minSeverity')) for (const entry of results.values()) publish(entry);
    if (e.affectsConfiguration('codemap.codeLens') && lensEmitter) lensEmitter.fire();
    if (e.affectsConfiguration('codemap.analyzeOnSave')) {
      for (const [key, s] of schedulers) {
        const f = folders().find((x) => x.uri.fsPath === key);
        if (!f || !conf(f.uri).analyzeOnSave) { s.dispose(); schedulers.delete(key); }
      }
    }
    if (e.affectsConfiguration('codemap.lang')) refreshStatus();
  }

  function onFolders(e) {
    for (const f of e.removed || []) {
      const key = f.uri.fsPath, entry = results.get(key);
      if (entry) for (const u of entry.uris) collection.delete(u);
      results.delete(key);
      const r = runs.get(key); if (r) r.abort();
      const s = schedulers.get(key); if (s) { s.dispose(); schedulers.delete(key); }
    }
    if (lensEmitter) lensEmitter.fire();
    refreshStatus();
  }

  function clear() {
    for (const r of runs.values()) r.abort();
    runs.clear();
    for (const s of schedulers.values()) s.dispose();
    schedulers.clear();
    collection.clear();
    results.clear();
    if (lensEmitter) lensEmitter.fire();
    refreshStatus();
  }

  // ---------------- aktywacja ----------------
  function activate(context) {
    ctx = context;
    const sub = (d) => { context.subscriptions.push(d); return d; };
    collection = sub(V.languages.createDiagnosticCollection('codemap'));
    output = sub(V.window.createOutputChannel('CodeMap'));
    status = sub(V.window.createStatusBarItem('codemap.status', V.StatusBarAlignment.Left, 50));
    status.name = 'CodeMap';
    status.command = 'codemap.openMap';
    panel = new MapPanel(V, {
      extensionUri: context.extensionUri,
      title: (name) => t('panelTitle', { name }),
      onOpen: (m) => { openFromMap(m).catch((e) => log(String(e && e.stack || e))); },
      onMessage: (m) => { if (m.type === 'codemap:focused' && !m.ok) log(`map: ${m.path} — not on the map`); },
    });
    sub({ dispose: () => panel.dispose() });
    lensEmitter = sub(new V.EventEmitter());
    lensProvider.onDidChangeCodeLenses = lensEmitter.event;
    sub(V.languages.registerCodeLensProvider({ scheme: 'file' }, lensProvider));
    sub(V.commands.registerCommand('codemap.analyze', async (uri) => {
      const folder = await pickFolder(uri && uri.fsPath ? uri : undefined);
      if (folder) return analyzeFolder(folder, { notify: true });
    }));
    sub(V.commands.registerCommand('codemap.openMap', openMap));
    sub(V.commands.registerCommand('codemap.revealInMap', revealInMap));
    sub(V.commands.registerCommand('codemap.clear', clear));
    sub(V.workspace.onDidSaveTextDocument(onSave));
    sub(V.workspace.onDidChangeConfiguration(onConfig));
    sub(V.workspace.onDidChangeWorkspaceFolders(onFolders));
    sub(V.window.onDidChangeActiveTextEditor(() => refreshStatus()));
    refreshStatus();
    return api;
  }

  function deactivate() {
    for (const r of runs.values()) r.abort();
    for (const s of schedulers.values()) s.dispose();
    runs.clear(); schedulers.clear();
  }

  // API zwracane z activate() — dla innych rozszerzeń i testów
  const api = {
    analyzeFolder, openMap, revealInMap, openFromMap, clear, onSave, provideCodeLenses: (d) => lensProvider.provideCodeLenses(d),
    get results() { return results; }, get panel() { return panel; }, get status() { return status; }, get collection() { return collection; },
    get context() { return ctx; }, schedulers,
  };
  return { activate, deactivate, api };
}

// punkt wejścia VS Code (package.json "main"): moduł `vscode` istnieje tylko w hoście rozszerzeń
let instance = null;
function activate(context) { instance = createExtension(require('vscode')); return instance.activate(context); }
function deactivate() { if (instance) instance.deactivate(); instance = null; }

module.exports = { activate, deactivate, createExtension, toDiagnostic, buildDiagnostics, severityOf, COMMANDS };
