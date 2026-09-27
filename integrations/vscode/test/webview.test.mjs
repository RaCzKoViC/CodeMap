// HTML panelu (src/webview.js) na prawdziwym index.html aplikacji: każdy względny src/href przez asWebviewUri,
// CSP z nonce bez 'unsafe-inline' / 'unsafe-eval' dla skryptów, <base> na katalog aplikacji, bez manifestu PWA;
// oraz protokół wiadomości panelu (ready → load → focus, odświeżenie z zachowaniem widoku, przeładowanie webview).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { require, REPO, tmpBundle, rmDir } from './helpers.mjs';

const { buildWebviewHtml, cspFor, makeNonce, MapPanel } = require('../src/webview.js');
const { createVscodeMock, createContext } = require('./vscode-mock.cjs');

const ORIGIN = 'https://file+.vscode-resource.vscode-cdn.net';
const APP = '/d%3A/ext/app';
const opts = (nonce = 'N0nce+/=') => ({ resource: (rel) => ORIGIN + APP + '/' + rel, base: ORIGIN + APP + '/', cspSource: ORIGIN, nonce });
const INDEX = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');

describe('HTML webview', () => {
  const html = buildWebviewHtml(INDEX, opts());
  const attrs = [...html.matchAll(/\s(src|href)="([^"]*)"/gi)].map((m) => m[2]);

  test('każdy lokalny src/href przez asWebviewUri (z zachowanym ?v=), nic względnego nie zostaje', () => {
    const local = attrs.filter((v) => !/^https?:\/\/(?!file\+)/.test(v) && !v.startsWith('#') && !v.startsWith('mailto:'));
    assert.ok(local.length > 40, 'skrypty i style aplikacji');
    for (const v of local) assert.ok(v.startsWith(ORIGIN + APP + '/'), v);
    assert.ok(attrs.includes(ORIGIN + APP + '/css/styles.css?v=' + /styles\.css\?v=([\w.-]+)/.exec(INDEX)[1]));
    const srcCount = (INDEX.match(/<script\b[^>]*\ssrc="/gi) || []).length;
    assert.equal((html.match(/<script\b[^>]*\ssrc="https:\/\/file\+/gi) || []).length, srcCount);
    assert.ok(html.includes(ORIGIN + APP + '/js/vscode-bridge.js?v='), 'mostek VS Code ładowany');
  });

  test('CSP: nonce dla skryptów, bez unsafe-inline/unsafe-eval w script-src, default-src none; meta przed zasobami', () => {
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html);
    assert.ok(csp, 'meta CSP');
    const policy = csp[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const dir = Object.fromEntries(policy.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    assert.deepEqual(dir['default-src'], ["'none'"]);
    assert.deepEqual(dir['script-src'], ["'nonce-N0nce+/='"]);
    assert.ok(!/unsafe-inline|unsafe-eval|\*/.test(dir['script-src'].join(' ')));
    assert.ok(dir['style-src'].includes(ORIGIN));
    assert.deepEqual(dir['connect-src'], [ORIGIN]);
    assert.deepEqual(dir['base-uri'], [ORIGIN]);
    assert.ok(!('frame-src' in dir) && !('manifest-src' in dir), 'iframe i manifest zablokowane przez default-src');
    // meta CSP i <base> tuż po <meta charset>, przed każdym zasobem
    const at = html.indexOf('Content-Security-Policy');
    assert.ok(at > html.indexOf('<meta charset') && at < html.indexOf('<link') && at < html.indexOf('<script'));
    assert.match(html, new RegExp(`<base href="${(ORIGIN + APP + '/').replace(/[.+]/g, '\\$&')}">`));
  });

  test('każdy <script> ma nonce; manifest i ikony PWA usunięte', () => {
    const scripts = html.match(/<script\b[^>]*>/gi);
    assert.ok(scripts.length > 40);
    for (const s of scripts) assert.match(s, /nonce="N0nce\+\/="/, s);
    assert.ok(!/rel="manifest"|rel="icon"|apple-touch-icon/.test(html));
    assert.ok(INDEX.includes('rel="manifest"'), 'oryginał ma manifest');
  });

  test('odrzuca adresy wychodzące poza katalog aplikacji; bez <head> = błąd', () => {
    assert.throws(() => buildWebviewHtml('<head><script src="../secret.js"></script></head>', opts()), /niedozwolony/);
    assert.throws(() => buildWebviewHtml('<head><img src="a\\b.png"></head>', opts()), /niedozwolony/);
    assert.throws(() => buildWebviewHtml('<body></body>', opts()), /<head>/);
    const h = buildWebviewHtml('<html><head><title>x</title></head><body><a href="https://x.org">x</a><a href="#top">t</a><img src="data:image/png;base64,AA"></body></html>', opts());
    assert.match(h, /<head>\n<meta http-equiv/);
    assert.match(h, /href="https:\/\/x\.org"/);
    assert.match(h, /href="#top"/);
    assert.match(h, /src="data:image\/png;base64,AA"/);
  });

  test('nonce losowy, CSP składana z cspSource', () => {
    assert.notEqual(makeNonce(), makeNonce());
    assert.match(makeNonce(), /^[A-Za-z0-9+/=]{24}$/);
    assert.match(cspFor("'self' https://*.vscode-cdn.net", 'abc'), /img-src 'self' https:\/\/\*\.vscode-cdn\.net data: blob:/);
  });
});

describe('panel mapy — protokół wiadomości', () => {
  let ext = null;
  before(() => { ext = tmpBundle(); });
  after(() => rmDir(ext));

  const state = (v, key = '/w/a') => ({ key, name: path.basename(key), map: { format: 'codemap', version: 2, nodes: [], v }, lang: 'pl', version: v });

  test('ready → load (+focus), potem focus osobno, odświeżenie z keepView, przeładowanie webview, zamknięcie', () => {
    const { vscode, state: S } = createVscodeMock({ folders: ['/w/a'] });
    const opened = [], other = [];
    const ctx = createContext(ext);
    const p = new MapPanel(vscode, { extensionUri: ctx.extensionUri, onOpen: (m) => opened.push(m), onMessage: (m) => other.push(m), title: (n) => 'Mapa ' + n });
    p.show(state(1), { focus: 'src/a.js' });
    const panel = S.panels[0], web = panel.webview;
    assert.equal(panel.title, 'Mapa a');
    assert.equal(panel.options.enableScripts, true);
    assert.equal(panel.options.retainContextWhenHidden, true);
    assert.deepEqual(panel.options.localResourceRoots.map((u) => u.fsPath), [path.join(ext, 'app')]);
    assert.match(web.html, /Content-Security-Policy/);
    assert.match(web.html, /<base href="https:\/\/mock\.vscode-cdn\.net\/.*\/app\/">/);
    assert.equal(web.posted.length, 0, 'nic przed codemap:ready');

    panel.receive({ type: 'codemap:ready' });
    assert.equal(web.posted.length, 1);
    assert.deepEqual({ ...web.posted[0], map: undefined }, { type: 'codemap:load', rev: 1, lang: 'pl', keepView: false, focus: 'src/a.js', map: undefined });
    assert.equal(web.posted[0].map.v, 1);
    panel.receive({ type: 'codemap:loaded', rev: 1, ok: true, nodes: 10 });

    p.focus('src/b.js');
    assert.deepEqual(web.posted[1], { type: 'codemap:focus', path: 'src/b.js' });

    // ta sama mapa ponownie → bez ponownego wczytania
    p.show(state(1));
    assert.equal(web.posted.length, 2);
    assert.equal(panel.revealed, 1);

    // nowy wynik analizy tego folderu → load z keepView
    assert.equal(p.update(state(2)), true);
    assert.equal(web.posted[2].type, 'codemap:load');
    assert.equal(web.posted[2].keepView, true);
    assert.equal(web.posted[2].map.v, 2);
    assert.equal(p.update(state(3, '/w/other')), false, 'inny folder nie podmienia mapy w panelu');

    // inny folder przez show → load bez keepView
    p.show(state(1, '/w/b'));
    assert.equal(web.posted[3].keepView, false);
    assert.equal(panel.title, 'Mapa b');

    // przeładowanie webview (np. „Aktualizuj" w ustawieniach aplikacji) → ponowny load bieżącej mapy
    panel.receive({ type: 'codemap:ready' });
    assert.equal(web.posted[4].type, 'codemap:load');
    assert.equal(web.posted[4].map.v, 1);

    // odrzucona mapa → następne show wysyła ją ponownie
    panel.receive({ type: 'codemap:loaded', rev: web.posted[4].rev, ok: false });
    p.show(state(1, '/w/b'));
    assert.equal(web.posted[5].type, 'codemap:load');

    panel.receive({ type: 'codemap:open', path: 'src/a.js', line: 3 });
    panel.receive({ type: 'codemap:focused', path: 'x', ok: false });
    panel.receive(null); panel.receive('str');
    assert.deepEqual(opened, [{ type: 'codemap:open', path: 'src/a.js', line: 3 }]);
    assert.deepEqual(other.map((m) => m.type), ['codemap:ready', 'codemap:loaded', 'codemap:ready', 'codemap:loaded', 'codemap:focused']);

    panel.dispose();
    assert.equal(p.panel, null);
    p.show(state(1));
    assert.equal(S.panels.length, 2, 'po zamknięciu nowy panel');
    assert.equal(S.panels[1].webview.posted.length, 0, 'nowy panel czeka na ready');
  });
});
