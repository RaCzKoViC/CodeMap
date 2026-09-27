// Mapa CodeMap w panelu webview: HTML aplikacji z app/index.html (adresy przez asWebviewUri, CSP z nonce,
// <base> na katalog aplikacji) oraz panel z protokołem wiadomości do mostka js/vscode-bridge.js:
//   webview → rozszerzenie: codemap:ready, codemap:loaded {rev, ok}, codemap:focused, codemap:open {path, line?}
//   rozszerzenie → webview: codemap:load {rev, map, lang, focus?, keepView?}, codemap:focus {path}
// Decyzje:
//  - script-src tylko 'nonce-…': każdy <script src> z index.html dostaje nonce; skrypty wstrzykiwane w locie
//    (biblioteki z CDN: rough.js, tree-sitter, WebLLM, php-wasm) są blokowane — te funkcje w webview nie działają.
//  - style-src z 'unsafe-inline': aplikacja ustawia atrybuty style= (także w innerHTML); dotyczy tylko stylów.
//  - <base href> = katalog aplikacji: względne adresy liczone w locie (Web Workery, sw.js) wskazują zasoby
//    rozszerzenia z INNEGO originu niż dokument webview, więc `new Worker(...)` rzuca SecurityError od razu,
//    a aplikacja przechodzi na ścieżki zapasowe (fizyka, analiza na wątku głównym) zamiast czekać na błąd.
//  - manifest, ikony i meta PWA usunięte (w webview zbędne, a manifest-src łamałby CSP).
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DROP_LINKS = /<link\b[^>]*\brel="(?:manifest|icon|shortcut icon|apple-touch-icon)"[^>]*>[ \t]*\r?\n?/gi;
const DROP_META = /<meta\b[^>]*\bname="apple-mobile-web-app-[\w-]+"[^>]*>[ \t]*\r?\n?/gi;   // PWA na iOS; w webview tylko ostrzeżenie w konsoli
const ABS_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|$)/i;

const makeNonce = () => crypto.randomBytes(18).toString('base64');

/** Polityka CSP webview (cspSource = webview.cspSource). */
function cspFor(cspSource, nonce) {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src ${cspSource} 'unsafe-inline'`,
    `img-src ${cspSource} data: blob:`,
    `font-src ${cspSource} data:`,
    `connect-src ${cspSource}`,
    `worker-src ${cspSource}`,
    `base-uri ${cspSource}`,
    "form-action 'none'",
  ].join('; ');
}

/**
 * @param {string} html  treść app/index.html
 * @param {{resource:(rel:string)=>string, base:string, cspSource:string, nonce:string}} o
 *   resource(rel) = adres webview pliku aplikacji (webview.asWebviewUri), base = adres katalogu aplikacji z '/'
 */
function buildWebviewHtml(html, o) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  let out = String(html).replace(DROP_LINKS, '').replace(DROP_META, '');
  out = out.replace(/(\s(?:src|href)=")([^"]*)(")/gi, (m, a, v, b) => {
    if (ABS_URL.test(v)) return m;
    const [, p, rest] = /^([^?#]*)(.*)$/.exec(v);
    const segs = p.split('/');
    if (segs.includes('..') || p.includes('\\')) throw new Error('CodeMap webview: niedozwolony adres zasobu ' + v);
    return a + esc(o.resource(segs.filter((s) => s && s !== '.').join('/')) + rest) + b;
  });
  out = out.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${esc(o.nonce)}"`);
  const head = `\n<meta http-equiv="Content-Security-Policy" content="${esc(cspFor(o.cspSource, o.nonce))}">\n<base href="${esc(o.base)}">`;
  const charset = /<meta\s+charset=[^>]*>/i.exec(out);
  if (charset) return out.slice(0, charset.index + charset[0].length) + head + out.slice(charset.index + charset[0].length);
  const h = /<head\b[^>]*>/i.exec(out);
  if (!h) throw new Error('CodeMap webview: index.html bez <head>');
  return out.slice(0, h.index + h[0].length) + head + out.slice(h.index + h[0].length);
}

/**
 * Panel mapy. vscode wstrzykiwany (testy: atrapa). onOpen(msg) — prośba o otwarcie pliku z mapy
 * (walidacja w extension.js); onMessage(m) — pozostałe wiadomości (log). Jeden panel na rozszerzenie.
 */
class MapPanel {
  constructor(vscode, { extensionUri, onOpen, onMessage, title }) {
    this.vscode = vscode; this.extensionUri = extensionUri;
    this.onOpen = onOpen || (() => {}); this.onMessage = onMessage || (() => {});
    this.title = title || ((name) => 'CodeMap — ' + name);
    this.panel = null; this.ready = false;
    this.current = null;      // {key, name, map, lang, version} — mapa, którą panel ma pokazywać
    this.sent = null;         // {rev, key, version} — ostatnie codemap:load wysłane do webview
    this.rev = 0; this.pendingFocus = null;
  }

  get appUri() { return this.vscode.Uri.joinPath(this.extensionUri, 'app'); }
  get key() { return this.current && this.current.key; }

  /** Pokazuje panel z mapą (tworzy, gdy trzeba); focus = ścieżka do zaznaczenia po wczytaniu. */
  show(state, { focus = null, column } = {}) {
    const V = this.vscode;
    if (!this.panel) this._create(column != null ? column : V.ViewColumn.Beside);
    else this.panel.reveal(undefined, true);
    this.panel.title = this.title(state.name);
    this.current = state;
    if (focus != null) this.pendingFocus = focus;
    this._sync();
  }

  /** Nowy wynik analizy folderu pokazywanego w panelu (np. po zapisie) — odśwież mapę, zachowując widok. */
  update(state) {
    if (!this.panel || !this.current || this.current.key !== state.key) return false;
    this.current = state;
    this._sync();
    return true;
  }

  dispose() { if (this.panel) this.panel.dispose(); }

  _create(column) {
    const V = this.vscode;
    const panel = this.panel = V.window.createWebviewPanel('codemap.map', 'CodeMap', { viewColumn: column, preserveFocus: false }, {
      enableScripts: true, retainContextWhenHidden: true, enableFindWidget: false, enableCommandUris: false,
      localResourceRoots: [this.appUri],
    });
    panel.iconPath = V.Uri.joinPath(this.appUri, 'icon-192.png');
    const web = panel.webview;
    const html = fs.readFileSync(path.join(this.appUri.fsPath, 'index.html'), 'utf8');
    const res = (rel) => web.asWebviewUri(rel ? V.Uri.joinPath(this.appUri, ...rel.split('/')) : this.appUri).toString();
    web.html = buildWebviewHtml(html, { resource: res, base: res('').replace(/\/?$/, '/'), cspSource: web.cspSource, nonce: makeNonce() });
    web.onDidReceiveMessage((m) => this._receive(m));
    panel.onDidDispose(() => { this.panel = null; this.ready = false; this.sent = null; this.pendingFocus = null; });
  }

  _receive(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'codemap:ready':   // start aplikacji (także po przeładowaniu webview) — wyślij bieżącą mapę
        this.ready = true; this.sent = null; this._sync(); break;
      case 'codemap:loaded':  // mapa odrzucona → następne show() wyśle ją ponownie
        if (!m.ok && this.sent && m.rev === this.sent.rev) this.sent = null;
        break;
      case 'codemap:open': this.onOpen(m); return;
    }
    this.onMessage(m);
  }

  // wiadomości do webview są dostarczane po kolei, więc focus wysłany po load trafia już do nowej mapy
  _sync() {
    if (!this.panel || !this.ready || !this.current) return;
    const c = this.current, s = this.sent, web = this.panel.webview;
    if (!s || s.key !== c.key || s.version !== c.version) {
      const rev = ++this.rev;
      const msg = { type: 'codemap:load', rev, map: c.map, lang: c.lang, keepView: !!(s && s.key === c.key) };
      if (this.pendingFocus != null) { msg.focus = this.pendingFocus; this.pendingFocus = null; }
      this.sent = { rev, key: c.key, version: c.version };
      web.postMessage(msg);
    } else if (this.pendingFocus != null) {
      web.postMessage({ type: 'codemap:focus', path: this.pendingFocus });
      this.pendingFocus = null;
    }
  }

  /** Zaznacz ścieżkę na mapie (od razu albo po wczytaniu mapy). */
  focus(relPath) { this.pendingFocus = relPath; this._sync(); }
}

module.exports = { buildWebviewHtml, cspFor, makeNonce, MapPanel, DROP_LINKS };
