import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, CORE, memStorage } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Renderowanie ChatBota (js/chatbot-render.js) na minimalnym DOM: bezpieczny markdown (escapowanie treści modelu),
// wiersze wiadomości (myśli, chipy akcji, czas generowania, kroki agenta), lista rozmów, menu „/", załączniki.
const MODS = [...CORE, 'icons', 'chatbot-strings', 'chatbot-core', 'chatbot-render'];
function load(extra = {}) {
  const doc = miniDocument(), exec = [];
  const CMApp = { appState: () => ({ mode: 'codemap', hasProject: true, availableLayouts: ['force'] }),
    exec: (a, args) => { exec.push([a, args]); if (a === 'boom') throw new Error('nie wyszło'); return 'zrobione: ' + a; }, focusNode: (id) => exec.push(['focus', id]) };
  const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };   // toasty nie trzymają procesu
  const CM = loadCM(MODS, { document: doc, CMApp, localStorage: memStorage(), confirm: () => true, setTimeout: setTimeoutUnref, ...extra });
  CM.i18n.setLang('pl');
  return { R: CM.ChatBotRender, t: CM.ChatBotStrings.t, CM, doc, exec };
}
const noop = { onEdit() {}, onThumb() {}, onRegen() {}, onChange() {} };

describe('fmt: markdown z treści modelu', () => {
  const { R } = load();
  test('niedomknięty blok kodu (strumień) renderuje się jako kod; tekst przed nim zwykły', () => {
    const h = R.fmt('Oto:\n```js\nconst a = 1;');
    assert.match(h, /^Oto:<br><div class="cb-codewrap">/);
    assert.match(h, /<pre class="cb-code hl">const a = 1;<\/pre>/);
  });
  test('etykieta języka tylko z bezpiecznych znaków — próba wstrzyknięcia atrybutu ląduje escapowana w treści kodu', () => {
    const h = R.fmt('```js" onmouseover="alert(1)\nx\n```');
    assert.doesNotMatch(h, /<[^>]*onmouseover=/);
    assert.match(h, /js&quot; onmouseover=&quot;alert\(1\)/);
    assert.doesNotMatch(h, /cb-clang/);
  });
  test('uruchamianie: język z listy albo wykryty z treści (svg, html, json, php); JSON niepoprawny → bez przycisku', () => {
    const run = (s) => (/data-runlang="([^"]+)"/.exec(R.fmt(s)) || [])[1] || null;
    assert.equal(run('```javascript\n1\n```'), 'javascript');
    assert.equal(run('```\n<svg viewBox="0 0 1 1"></svg>\n```'), 'svg');
    assert.equal(run('```\n<div>x</div>\n```'), 'html');
    assert.equal(run('```\n{"a": [1]}\n```'), 'json');
    assert.equal(run('```\n{a: 1}\n```'), null);
    assert.equal(run('```\n<?php echo 1;\n```'), 'php');
    assert.equal(run('```bash\nls\n```'), null);
  });
  test('formatowanie w linii nie działa wewnątrz escapowanego HTML; wiele akapitów', () => {
    assert.equal(R.fmt('a <b>**x**</b>'), 'a &lt;b&gt;<b>x</b>&lt;/b&gt;');
    assert.equal(R.fmt('`<i>`'), '<code class="cb-ic">&lt;i&gt;</code>');
    assert.equal(R.fmt("x\n\ny & 'z'"), 'x<br><br>y &amp; &#39;z&#39;');
  });
});

describe('messageRow', () => {
  test('użytkownik: treść jako tekst markdown, załączniki jako chipy z nazwą (tekst), klik → fokus węzła; ołówek = edycja', () => {
    const { R, exec } = load();
    let edited = null;
    const m = { id: 'm1', role: 'user', content: 'Zobacz <b>to</b>', attachments: [{ id: 'src/a.js', name: '<img src=x>', type: 'file', path: 'src/a.js' }] };
    const row = R.messageRow(m, { ...noop, onEdit: (r, mm) => { edited = mm.id; } });
    assert.equal(row.getAttribute('data-mid'), 'm1');
    const b = row.querySelector('.cb-bubble-user');
    assert.equal(b.innerHTML, 'Zobacz &lt;b&gt;to&lt;/b&gt;');
    const chip = row.querySelector('.cb-att-ro');
    assert.equal(chip.querySelector('.cb-att-n').textContent, '<img src=x>');
    chip.onclick();
    assert.deepEqual(exec.at(-1), ['focus', 'src/a.js']);
    row.querySelector('.cb-mt').click();
    assert.equal(edited, 'm1');
  });
  test('asystent: myśli jako <details> (zwijane kliknięciem), bloki ```action``` wycięte, tryb szybki bez myśli', () => {
    const { R } = load();
    const m = { id: 'a1', role: 'assistant', content: '<think>plan <x></think>Gotowe.\n```action\n{"action":"fit"}\n```' };
    const html = R.messageRow(m, noop).querySelector('.cb-bubble-assistant').innerHTML;
    assert.match(html, /^<details class="cb-think" open><summary>🧠 [^<]+<\/summary><div class="cb-think-b">plan &lt;x&gt;<\/div><\/details>Gotowe\.$/);
    assert.equal(R.messageRow(m, { ...noop, quick: true }).querySelector('.cb-bubble-assistant').innerHTML, 'Gotowe.');
  });
  test('pusta odpowiedź po udanych akcjach → „wykonano"; czas generowania w PL / EN', () => {
    const { R, t, CM } = load();
    const time = (ms) => R.messageRow({ id: 'x', role: 'assistant', content: 'ok', genMs: ms }, noop).querySelector('.cb-time').textContent;
    const row = R.messageRow({ id: 'a', role: 'assistant', content: '  ', actions: [{ action: 'fit', ok: true, result: 'ok' }] }, noop);
    assert.equal(row.querySelector('.cb-bubble-assistant').innerHTML, t('didActions'));
    assert.equal(time(3400), '⏱ 3,4 s'); assert.equal(time(45000), '⏱ 45 s'); assert.equal(time(125000), '⏱ 2 min 5 s');
    CM.i18n.setLang('en');
    assert.equal(time(3400), '⏱ 3.4 s');
  });
  test('chipy akcji: wynik escapowany; narzędzie informacyjne jako /nazwa; oczekująca akcja wykonuje się po kliknięciu', () => {
    const { R, exec } = load();
    let changed = 0;
    const m = { id: 'a', role: 'assistant', content: 'x', actions: [
      { action: 'setTheme', ok: true, result: '<img src=x onerror=alert(1)>' }, { action: 'stats', ok: true, result: 'dużo' },
      { action: 'bad', ok: false, result: 'błąd' }, { action: 'fit', args: { a: 1 }, pending: true }, { action: 'boom', pending: true }] };
    const row = R.messageRow(m, { ...noop, onChange: () => changed++ });
    const chips = row.querySelectorAll('.cb-chip');
    assert.equal(chips[0].innerHTML, '⚡ &lt;img src=x onerror=alert(1)&gt;');
    assert.equal(chips[1].innerHTML, '⚡ /stats');
    assert.ok(chips[2].classList.contains('cb-chip-err'));
    chips[3].onclick();
    assert.deepEqual(exec.at(-1), ['fit', { a: 1 }]);
    assert.deepEqual([m.actions[3].ok, m.actions[3].result, 'pending' in m.actions[3]], [true, 'zrobione: fit', false]);
    chips[4].onclick();
    assert.deepEqual([m.actions[4].ok, m.actions[4].result], [false, 'nie wyszło']);
    assert.equal(changed, 2);
  });
  test('kroki agenta i oceny 👍/👎 (przełączanie klas), regeneracja', () => {
    const { R } = load();
    const calls = [];
    const m = { id: 'q', role: 'assistant', content: 'x', rating: 1, steps: [{ name: 'findText', args: { query: 'foo' }, ok: true, summary: '3 trafienia' }, { name: 'x', ok: false }] };
    const row = R.messageRow(m, { ...noop, onThumb: (mm, v) => { calls.push(v); mm.rating = v; }, onRegen: (id) => calls.push('regen:' + id) });
    assert.match(row.querySelector('.cb-steps summary').textContent, /\(2\)$/);
    assert.equal(row.querySelectorAll('.cb-step')[0].textContent, 'findText „foo” → 3 trafienia');
    assert.ok(row.querySelectorAll('.cb-step')[1].classList.contains('err'));
    const [up, dn] = row.querySelectorAll('.cb-thumb');
    assert.ok(up.classList.contains('cb-up-on'));
    dn.click();
    assert.ok(dn.classList.contains('cb-down-on') && !up.classList.contains('cb-up-on'));
    row.querySelectorAll('.cb-mt')[2].click();
    assert.deepEqual(calls, [-1, 'regen:q']);
  });
});

describe('panel: rozmowy, menu „/", załączniki, pozycja', () => {
  test('sidebar: pusta lista, aktywna rozmowa, tytuł jako tekst, usuwanie po potwierdzeniu', () => {
    const { R, doc, t } = load();
    const sb = doc.createElement('div'), h = { calls: [], onNew() { this.calls.push('new'); }, onSwitch(id) { this.calls.push('sw:' + id); }, onDelete(id) { this.calls.push('del:' + id); } };
    R.sidebar(sb, [], null, h);
    assert.equal(sb.querySelector('.cb-sb-empty').textContent, t('empty'));
    const convs = [{ id: 'c1', title: '<b>T</b>', messages: [{ role: 'user' }, { role: 'assistant' }, { role: 'user' }], createdAt: Date.now() }, { id: 'c2', messages: [] }];
    R.sidebar(sb, convs, 'c2', h);
    const items = sb.querySelectorAll('.cb-conv');
    assert.equal(items.length, 2); assert.ok(items[1].classList.contains('active'));
    assert.equal(items[0].querySelector('.cb-conv-t').textContent, '<b>T</b>');
    assert.match(items[0].querySelector('.cb-conv-m').textContent, /^2 · /);
    assert.equal(items[1].querySelector('.cb-conv-t').textContent, t('untitled'));
    items[0].click();
    items[0].querySelector('.cb-conv-del').dispatchEvent({ type: 'click', stopPropagation() {} });
    sb.querySelector('.cb-newbtn').click();
    assert.deepEqual(h.calls, ['sw:c1', 'del:c1', 'new']);
  });
  test('toolsMenu: filtr po nazwie/opisie, pierwszy zaznaczony, ▶ dla akcji zmieniających stan, brak trafień', () => {
    const { R, doc, t } = load();
    const box = doc.createElement('div'); let picked = null;
    R.toolsMenu(box, 'stats', (n) => { picked = n; });
    const rows = box.querySelectorAll('.cb-tool');
    assert.ok(rows.length >= 1); assert.ok(rows[0].classList.contains('sel'));
    assert.equal(rows[0].querySelector('.cb-tool-n').textContent, '/stats');
    rows[0].onmousedown({ preventDefault() {} });
    assert.equal(picked, 'stats');
    assert.equal(rows[0].querySelector('.cb-tool-w'), null, 'narzędzie informacyjne działa od razu');
    R.toolsMenu(box, 'clearProject', () => {});
    assert.ok(box.querySelector('.cb-tool-w'), 'czyszczenie projektu wymaga potwierdzenia');
    R.toolsMenu(box, 'zzzz-nie-ma', () => {});
    assert.equal(box.querySelector('.cb-tools-empty').textContent, t('toolNoMatch'));
  });
  test('attachChips: ukryte bez załączników, licznik n / max, × usuwa', () => {
    const { R, doc } = load();
    const box = doc.createElement('div'); const removed = [];
    R.attachChips(box, [], 5, () => {});
    assert.ok(box.classList.contains('hidden'));
    const list = [{ name: 'a.js', type: 'file' }, { name: 'src', type: 'folder' }];
    R.attachChips(box, list, 5, (a) => removed.push(a.name));
    assert.ok(!box.classList.contains('hidden'));
    assert.equal(box.querySelector('.cb-att-cnt').textContent, '2 / 5');
    box.querySelectorAll('.cb-att-x')[1].click();
    assert.deepEqual(removed, ['src']);
  });
  test('applySavedPos: zapamiętana pozycja przycięta do okna; brak / śmieci → bez zmian', () => {
    const ls = memStorage();
    const { R } = load({ localStorage: ls, innerWidth: 1000, innerHeight: 700 });
    const p = { style: {} };
    R.applySavedPos(p); assert.deepEqual(p.style, {});
    ls.setItem('codemap_chatbot_pos', '{zle');
    R.applySavedPos(p); assert.deepEqual(p.style, {});
    ls.setItem('codemap_chatbot_pos', JSON.stringify({ l: 5000, t: -50 }));
    R.applySavedPos(p);
    assert.deepEqual(p.style, { left: '680px', top: '4px', right: 'auto', bottom: 'auto' });
  });
  test('openSource: plik znaleziony po id albo ścieżce → fokus i otwarcie; brak → komunikat', () => {
    const { R, CM, exec } = load();
    const opened = [];
    CM.App = { graph: { nodes: new Map([['src/a.js', { id: 'src/a.js', type: 'file', path: 'src/a.js' }]]) }, handlers: { openFile: (n) => opened.push(n.id) } };
    R.openSource({ id: 'zmieniony-id', path: 'src/a.js', start: 1, end: 3 });
    assert.deepEqual(opened, ['src/a.js']);
    assert.deepEqual(exec.at(-1), ['focus', 'src/a.js']);
    R.openSource({ id: 'x', path: 'nie/ma.js' });
    assert.equal(opened.length, 1);
  });
});
