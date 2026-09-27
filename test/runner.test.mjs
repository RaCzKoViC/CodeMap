import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Środowisko uruchomieniowe ChatBota (js/runner.js): składanie dokumentu podglądu (_compose) bez wstrzyknięć
// kodu modelu oraz protokół okna: runner.html → „ready" → postMessage z dokumentem (ramka i nowa karta).
// timery niepodtrzymujące procesu (karta czeka na „ready" do 60 s)
const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };
function load(extra = {}) {
  const doc = miniDocument(), winListeners = {}, toasts = [];
  const CM = loadCM(['util', 'icons', 'i18n', 'runner'], {
    document: doc, setTimeout: setTimeoutUnref, addEventListener: (t, fn) => { winListeners[t] = fn; }, ...extra });
  CM.util.toast = (m, k) => toasts.push([m, k]);
  return { RN: CM.Runner, CM, doc, winListeners, toasts };
}
const EVIL = 'x</script><script>alert(1)</script>';

describe('_compose: dokument podglądu', () => {
  const { RN, CM } = load();
  const C = RN._compose;
  test('HTML: pełny dokument bez zmian, fragment w szkielecie ze stylem bazowym', () => {
    assert.equal(C('<!DOCTYPE html><title>t</title>', 'html'), '<!DOCTYPE html><title>t</title>');
    const f = C('<p>hej</p>', 'HTM');
    assert.match(f, /^<!doctype html><meta charset="utf-8"><style>body\{/);
    assert.ok(f.endsWith('<body><p>hej</p>'));
  });
  test('SVG wyśrodkowany na ciemnym tle; CSS z elementami demonstracyjnymi (PL/EN)', () => {
    assert.match(C('<svg/>', 'svg'), /place-items:center[\s\S]*<body><svg\/>$/);
    const css = C('h1{color:red}', 'css');
    assert.match(css, /<style>h1\{color:red\}<\/style><body><h1>Nagłówek H1<\/h1>/);
    CM.i18n.setLang('en');
    try { assert.match(C('p{}', 'css'), /<h1>Heading H1<\/h1>/); } finally { CM.i18n.setLang('pl'); }
  });
  test('kod w <script> (JS, JSON, Markdown, PHP) jako literał JSON — „</script>" nie zamyka skryptu', () => {
    for (const lang of ['js', '', 'json', 'md', 'markdown', 'php']) {
      const h = C(EVIL, lang);
      assert.ok(!h.includes('</script><script>alert'), lang + ': surowe </script> z kodu');
      assert.ok(h.includes(JSON.stringify(EVIL).replace(/<\//g, '<\\/')), lang + ': kod jako literał JSON');
    }
  });
  test('JS: przechwycona konsola i wynik wyrażenia; PHP: interpreter php-wasm z CDN, dopisanie <?php', () => {
    const js = C('1+1', 'js');
    assert.match(js, /console\.warn=/); assert.match(js, /\(0,eval\)\("1\+1"\)/);
    const php = C('echo 1;', 'php');
    assert.match(php, /import\("https:\/\/cdn\.jsdelivr\.net\/npm\/php-wasm\/PhpWeb\.mjs"\)/);
    assert.match(php, /code="<\?php\\n"\+code/);
  });
  test('Markdown: bezpieczne adresy linków i obrazków (javascript: → #)', () => {
    const md = C('[x](javascript:alert(1))', 'md');
    assert.match(md, /const safeUrl=u=>\/\^\(https\?:/);
    assert.match(md, /safeUrl\(u\)/);
  });
});

describe('okno podglądu', () => {
  test('open: ramka ładuje runner.html, dokument czeka na „ready", potem idzie postMessage; kolejne run od razu', () => {
    const { RN, doc, winListeners } = load();
    RN.open('console.log(1)', 'javascript');
    const win = doc.getElementById('cm-runner');
    assert.ok(win && !win.classList.contains('hidden'));
    assert.equal(win.querySelector('.rn-title').textContent, 'JS · podgląd');
    const frame = win.querySelector('.rn-frame');
    assert.equal(frame.src, 'runner.html');
    assert.equal(RN.state().ready, false); assert.equal(RN.state().posted, 0);
    const got = [];
    frame.contentWindow = { postMessage: (m, origin) => got.push([m, origin]) };
    winListeners.message({ data: { type: 'inny' }, source: frame.contentWindow });
    assert.equal(got.length, 0, 'obce wiadomości ignorowane');
    winListeners.message({ data: { type: 'codemap-runner-ready' }, source: frame.contentWindow });
    assert.equal(got.length, 1);
    assert.equal(got[0][0].type, 'codemap-runner'); assert.equal(got[0][0].title, 'JS · podgląd');
    assert.match(got[0][0].html, /\(0,eval\)\("console\.log\(1\)"\)/);
    RN.open('<b>x</b>', 'html');
    assert.equal(got.length, 2); assert.equal(got[1][0].html.endsWith('<body><b>x</b>'), true);
    assert.deepEqual(host(RN.state()), { ready: true, posted: 2, open: true });
    RN.close();
    assert.equal(RN.state().open, false);
    assert.deepEqual([got[2][0].html, got[2][0].title], ['', ''], 'zamknięcie czyści ramkę');
  });
  test('nowa karta: dokument po jej „ready"; zablokowane okno → komunikat', () => {
    const tab = { posted: [], postMessage(m) { this.posted.push(m); } };
    let opened = null;
    const { RN, doc, winListeners, toasts } = load({ open: (url, target) => { opened = [url, target]; return tab; } });
    RN.open('<i>a</i>', 'html');
    doc.getElementById('cm-runner').querySelectorAll('.rn-btn')[1].click();
    assert.deepEqual(opened, ['runner.html', '_blank']);
    winListeners.message({ data: { type: 'codemap-runner-ready' }, source: tab });
    assert.equal(tab.posted.length, 1); assert.ok(tab.posted[0].html.endsWith('<body><i>a</i>'));
    winListeners.message({ data: { type: 'codemap-runner-ready' }, source: tab });
    assert.equal(tab.posted.length, 1, 'jednorazowo');
    const blocked = load({ open: () => null });
    blocked.RN.open('x', 'js');
    blocked.doc.getElementById('cm-runner').querySelectorAll('.rn-btn')[1].click();
    assert.equal(blocked.toasts[0][1], 'error');
    assert.equal(toasts.length, 0);
  });
});
