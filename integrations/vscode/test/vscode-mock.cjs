// Atrapa modułu `vscode` dla testów (node:test): tylko API używane przez rozszerzenie, z zapisem wywołań
// w `state`. createVscodeMock({folders, settings, language}) → {vscode, state, fire}.
'use strict';
const path = require('node:path');

class Uri {
  constructor(scheme, fsPath, str) { this.scheme = scheme; this.fsPath = fsPath; this._s = str; }
  get path() { return this.scheme === 'file' ? '/' + this.fsPath.split(path.sep).join('/').replace(/^\/+/, '') : this._s.replace(/^[a-z]+:\/\/[^/]*/i, ''); }
  toString() { return this._s != null ? this._s : 'file://' + this.path; }
  static file(p) { return new Uri('file', path.resolve(p)); }
  static parse(s) { const m = /^([a-z][a-z0-9+.-]*):/i.exec(s); return new Uri(m ? m[1] : 'file', null, s); }
  static joinPath(base, ...segs) {
    if (base.scheme === 'file') return Uri.file(path.join(base.fsPath, ...segs));
    return Uri.parse(base.toString().replace(/\/?$/, '/') + segs.join('/'));
  }
}
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) {
    if (a instanceof Position) { this.start = a; this.end = b; }
    else { this.start = new Position(a, b); this.end = new Position(c, d); }
  }
}
class Selection extends Range { constructor(anchor, active) { super(anchor, active); this.anchor = anchor; this.active = active; } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
class Diagnostic { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } }
class DiagnosticRelatedInformation { constructor(location, message) { this.location = location; this.message = message; } }
class CodeLens { constructor(range, command) { this.range = range; this.command = command; } }
class MarkdownString { constructor(value, supportThemeIcons) { this.value = value; this.supportThemeIcons = !!supportThemeIcons; } }
class ThemeColor { constructor(id) { this.id = id; } }
class EventEmitter {
  constructor() { this.listeners = []; this.fired = 0; this.event = (fn) => { this.listeners.push(fn); return { dispose: () => { this.listeners = this.listeners.filter((x) => x !== fn); } }; }; }
  fire(v) { this.fired++; for (const fn of this.listeners.slice()) fn(v); }
  dispose() { this.listeners = []; }
}

function createVscodeMock({ folders = [], settings = {}, language = 'en', responses = {} } = {}) {
  const state = {
    messages: [], output: [], commands: new Map(), executed: [], progress: [], panels: [], opened: [], shown: [],
    collections: [], statusItems: [], lensProviders: [], activeEditor: null, pickFolder: null, settings: { ...settings },
    openFail: new Set(),
  };
  const events = { save: new EventEmitter(), config: new EventEmitter(), folders: new EventEmitter(), editor: new EventEmitter() };
  const wsFolders = folders.map((f, i) => ({ uri: Uri.file(f), name: path.basename(f), index: i }));

  const msg = (level) => (text, ...items) => { state.messages.push({ level, text, items }); return Promise.resolve(responses[level]); };

  function createDiagnosticCollection(name) {
    const m = new Map();
    const c = {
      name, map: m,
      set(uri, list) { m.set(uri.toString(), { uri, list }); },
      delete(uri) { m.delete(uri.toString()); },
      clear() { m.clear(); },
      get(uri) { const e = m.get(uri.toString()); return e && e.list; },
      forEach(fn) { for (const { uri, list } of m.values()) fn(uri, list, c); },
      dispose() { m.clear(); },
    };
    state.collections.push(c);
    return c;
  }

  function createWebviewPanel(viewType, title, showOptions, options) {
    const recv = new EventEmitter(), disp = new EventEmitter();
    const panel = {
      viewType, title, options, viewColumn: typeof showOptions === 'object' ? (showOptions.viewColumn === -2 ? 2 : showOptions.viewColumn) : showOptions,
      visible: true, revealed: 0, disposed: false, iconPath: null,
      webview: {
        html: '', cspSource: 'https://mock.vscode-cdn.net', posted: [],
        asWebviewUri: (uri) => Uri.parse('https://mock.vscode-cdn.net' + uri.path),
        postMessage(m) { this.posted.push(JSON.parse(JSON.stringify(m))); return Promise.resolve(true); },
        onDidReceiveMessage: recv.event,
      },
      reveal() { panel.revealed++; },
      onDidDispose: disp.event,
      dispose() { if (panel.disposed) return; panel.disposed = true; disp.fire(); },
      receive(m) { recv.fire(m); },   // test: webview → rozszerzenie
    };
    state.panels.push(panel);
    return panel;
  }

  const vscode = {
    Uri, Position, Range, Selection, Location, Diagnostic, DiagnosticRelatedInformation, CodeLens, MarkdownString, ThemeColor, EventEmitter,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
    env: { language },
    languages: {
      createDiagnosticCollection,
      registerCodeLensProvider(selector, provider) { state.lensProviders.push({ selector, provider }); return { dispose() {} }; },
    },
    window: {
      get activeTextEditor() { return state.activeEditor; },
      createStatusBarItem(id, alignment, priority) {
        const it = { id, alignment, priority, text: '', tooltip: '', command: null, backgroundColor: undefined, visible: false,
          show() { it.visible = true; }, hide() { it.visible = false; }, dispose() {} };
        state.statusItems.push(it);
        return it;
      },
      createOutputChannel(name) { return { name, appendLine: (s) => state.output.push(s), show() {}, dispose() {} }; },
      withProgress(opts, task) {
        const cancel = new EventEmitter();
        const rec = { opts, cancel: () => cancel.fire() };
        state.progress.push(rec);
        return task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: cancel.event });
      },
      showInformationMessage: msg('info'), showWarningMessage: msg('warn'), showErrorMessage: msg('error'),
      showWorkspaceFolderPick() { return Promise.resolve(state.pickFolder); },
      createWebviewPanel,
      showTextDocument(doc, opts) {
        const ed = { document: doc, opts, selection: null, revealed: [], revealRange(r, t) { ed.revealed.push({ r, t }); } };
        state.shown.push(ed);
        return Promise.resolve(ed);
      },
      onDidChangeActiveTextEditor: events.editor.event,
    },
    workspace: {
      get workspaceFolders() { return wsFolders.length ? wsFolders : undefined; },
      getWorkspaceFolder(uri) {
        let best = null;
        for (const f of wsFolders) {
          const r = path.relative(f.uri.fsPath, uri.fsPath);
          if ((r === '' || (!r.startsWith('..') && !path.isAbsolute(r))) && (!best || f.uri.fsPath.length > best.uri.fsPath.length)) best = f;
        }
        return best || undefined;
      },
      getConfiguration(section) {
        return { get: (k, def) => { const v = state.settings[section + '.' + k]; return v === undefined ? def : v; } };
      },
      openTextDocument(uri) {
        state.opened.push(uri);
        if (state.openFail.has(uri.fsPath)) return Promise.reject(new Error('binary'));
        return Promise.resolve({ uri });
      },
      onDidSaveTextDocument: events.save.event,
      onDidChangeConfiguration: events.config.event,
      onDidChangeWorkspaceFolders: events.folders.event,
    },
    commands: {
      registerCommand(id, fn) { state.commands.set(id, fn); return { dispose() { state.commands.delete(id); } }; },
      executeCommand(id, ...args) {
        state.executed.push({ id, args });
        const fn = state.commands.get(id);
        return Promise.resolve(fn ? fn(...args) : undefined);
      },
    },
  };

  const fire = {
    save: (fsPath) => events.save.fire({ uri: Uri.file(fsPath) }),
    config: (keys) => events.config.fire({ affectsConfiguration: (k) => keys.some((x) => x === k || x.startsWith(k + '.')) }),
    folders: (e) => events.folders.fire(e),
  };
  return { vscode, state, fire, folders: wsFolders };
}

/** Kontekst rozszerzenia dla activate(). */
function createContext(extensionPath) {
  return { subscriptions: [], extensionUri: Uri.file(extensionPath), extensionPath };
}

module.exports = { createVscodeMock, createContext, Uri, Range, Position };
