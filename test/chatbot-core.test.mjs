import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';

// Czysta logika ChatBota (chatbot-core.js) bez DOM i bez modelu: parsowanie odpowiedzi, walidacja akcji,
// rozpoznawanie poleceń i próśb o pomoc, komendy „/", szybkie polecenia i tok rozumowania <think>.
// Stan aplikacji (dostępne układy) podaje zaślepka CMApp.appState — jak window.CMApp w przeglądarce.
const LAYOUTS = ['force', 'tree', 'radial', 'treemap', 'pack'];
const appStub = () => ({ CMApp: { appState: () => ({ mode: 'codemap', hasProject: true, project: 'demo', layout: 'force', availableLayouts: LAYOUTS, theme: 'dark', lang: 'pl' }) } });
const CM = loadCM([...CORE, 'chatbot-strings', 'chatbot-core'], appStub());
CM.i18n.setLang('pl');
const C = CM.ChatBotCore;
const S = CM.ChatBotStrings;

describe('parseStructured: odpowiedź modelu {actions, reply}', () => {
  test('poprawny JSON → reply przycięte, akcje znormalizowane', () => {
    const o = host(C.parseStructured('{"actions":[{"action":"setTheme","args":{"theme":"light"}}],"reply":"  Gotowe!  "}'));
    assert.deepEqual(o, { reply: 'Gotowe!', actions: [{ action: 'setTheme', args: { theme: 'light' } }] });
  });
  test('JSON w bloku ```json``` i po <think> → wyłuskany z tekstu', () => {
    assert.deepEqual(host(C.parseStructured('```json\n{"actions":[],"reply":"Cześć"}\n```')), { reply: 'Cześć', actions: [] });
    assert.deepEqual(host(C.parseStructured('<think>użytkownik się wita</think>\n{"actions":[],"reply":"ok"}')), { reply: 'ok', actions: [] });
  });
  test('ucięty JSON (limit tokenów) → domknięte akcje + początek reply, partial', () => {
    const o = host(C.parseStructured('{"actions":[{"action":"setLayout","args":{"layout":"treemap"}},{"action":"fit","args":{}}],"reply":"Ustawiam układ treem'));
    assert.equal(o.partial, true);
    assert.equal(o.reply, 'Ustawiam układ treem');
    assert.deepEqual(o.actions, [{ action: 'setLayout', args: { layout: 'treemap' } }, { action: 'fit', args: {} }]);
  });
  test('ucięty JSON z pętlą powtórzeń w reply → powtórki wycięte', () => {
    const o = host(C.parseStructured('{"actions":[],"reply":"Ustawiam układ force. Ustawiam układ force. Ustawiam układ force. Usta'));
    assert.equal(o.reply, 'Ustawiam układ force. Usta');
  });
  test('nazwa układu / motywu jako nazwa akcji → setLayout / setTheme; brakujący klucz argumentu → klucz główny', () => {
    const o = host(C.parseStructured('{"actions":[{"action":"treemap","args":{}},{"action":"Dark","args":{}},{"action":"setLayout","args":{"name":"pack"}}],"reply":"ok"}'));
    assert.deepEqual(o.actions, [
      { action: 'setLayout', args: { layout: 'treemap' } },
      { action: 'setTheme', args: { theme: 'dark' } },
      { action: 'setLayout', args: { name: 'pack', layout: 'pack' } },
    ]);
  });
  test('tekst bez JSON-a → null', () => {
    assert.equal(C.parseStructured('Po prostu tekst, bez żadnych akcji.'), null);
  });
});

describe('validAction / knownAction', () => {
  test('znane nazwy: katalog + aliasy spoza menu; nieznane i puste odrzucone', () => {
    assert.equal(C.knownAction('setLayout'), true);
    assert.equal(C.knownAction('setNodeScale'), true);
    assert.equal(C.knownAction('nope'), false);
    assert.equal(C.validAction({ action: '', args: {} }), false);
    assert.equal(C.validAction({ action: 'nope', args: {} }), false);
    assert.equal(C.validAction(null), false);
  });
  test('brak wymaganego argumentu → akcja odrzucona; poprawne argumenty → przyjęta', () => {
    assert.equal(C.validAction({ action: 'setMode', args: {} }), false);
    assert.equal(C.validAction({ action: 'setMode', args: { mode: 'mindmap' } }), true);
    assert.equal(C.validAction({ action: 'setLayout', args: {} }), false);
    assert.equal(C.validAction({ action: 'setLayout', args: { layout: 'treemap' } }), true);
    assert.equal(C.validAction({ action: 'setLayout', args: { layout: 'spiral' } }), false, 'układ spoza availableLayouts');
    assert.equal(C.validAction({ action: 'setAccent', args: { color: '#ff8800' } }), true);
    assert.equal(C.validAction({ action: 'setAccent', args: { color: 'red' } }), false);
    assert.equal(C.validAction({ action: 'search', args: { query: '   ' } }), false);
    assert.equal(C.validAction({ action: 'fit' }), true, 'akcja bez argumentów');
  });
});

describe('polecenie czy pytanie, prośba o pomoc', () => {
  test('looksLikeCommand: czasowniki PL/EN (także odmienione) vs zwykłe pytanie', () => {
    assert.equal(C.looksLikeCommand('ustaw układ treemap'), true);
    assert.equal(C.looksLikeCommand('czy możesz ustawić układ treemap?'), true);
    assert.equal(C.looksLikeCommand('switch to the light theme'), true);
    assert.equal(C.looksLikeCommand('wymień wszystkie dostępne komendy'), false);
    assert.equal(C.looksLikeCommand('jak działa ten projekt'), false);
  });
  test('isHelpRequest: PL i EN, ale nie zwykłe polecenie', () => {
    for (const q of ['jakie masz komendy?', 'co potrafisz', 'wymień wszystkie dostępne komędy', 'pomoc', '/help', 'what can you do?', 'show all commands'])
      assert.equal(C.isHelpRequest(q), true, q);
    for (const q of ['pokaż hotspoty', 'włącz jasny motyw', 'switch layout to force'])
      assert.equal(C.isHelpRequest(q), false, q);
  });
  test('helpText: nagłówek + jedna linia „- `/nazwa`” na narzędzie, opisy po polsku', () => {
    const lines = C.helpText().split('\n').filter((l) => l.startsWith('- `/'));
    assert.equal(lines.length, C.TOOLS.length);
    assert.ok(lines.includes('- `/setLayout {layout}` — zmień układ mapy CodeMap'));
  });
});

describe('parseSlash: komendy „/” wpisane przez użytkownika', () => {
  test('argument trafia pod klucz główny akcji (albo query); liczby i JSON', () => {
    assert.deepEqual(host(C.parseSlash('/setLayout treemap')), { action: 'setLayout', args: { layout: 'treemap' } });
    assert.deepEqual(host(C.parseSlash('/codeSearch format date')), { action: 'codeSearch', args: { query: 'format date' } });
    assert.deepEqual(host(C.parseSlash('/setSpacing 120')), { action: 'setSpacing', args: { percent: 120 } });
    assert.deepEqual(host(C.parseSlash('/setFilter {"files":false}')), { action: 'setFilter', args: { files: false } });
    assert.deepEqual(host(C.parseSlash('  /fit  ')), { action: 'fit', args: {} });
  });
  test('nazwa bez względu na wielkość liter; nieznane narzędzie albo brak „/” → null', () => {
    assert.deepEqual(host(C.parseSlash('/SETLAYOUT force')), { action: 'setLayout', args: { layout: 'force' } });
    assert.equal(C.parseSlash('/nieznane coś'), null);
    assert.equal(C.parseSlash('setLayout treemap'), null);
  });
});

describe('intentFallback: krótkie jednoznaczne polecenie → akcja bez modelu', () => {
  test('polecenia PL/EN', () => {
    assert.deepEqual(host(C.intentFallback('włącz jasny motyw')), { action: 'setTheme', args: { theme: 'light' } });
    assert.deepEqual(host(C.intentFallback('switch to the dark theme')), { action: 'setTheme', args: { theme: 'dark' } });
    assert.deepEqual(host(C.intentFallback('wczytaj demo')), { action: 'loadDemo', args: {} });
    assert.deepEqual(host(C.intentFallback('show hotspots')), { action: 'hotspots', args: {} });
    assert.deepEqual(host(C.intentFallback('otwórz ustawienia')), { action: 'openSettings', args: {} });
  });
  test('pytanie, przeczenie, brak czasownika albo długa prośba → null (decyduje model)', () => {
    assert.equal(C.intentFallback('czy możesz włączyć jasny motyw?'), null);
    assert.equal(C.intentFallback('nie włączaj jasnego motywu'), null);
    assert.equal(C.intentFallback('jasny motyw'), null);
    assert.equal(C.intentFallback('włącz jasny motyw i potem opisz mi dokładnie, które pliki mają najwięcej zależności w tym projekcie'), null);
  });
});

describe('tok rozumowania <think> i bloki ```action```', () => {
  test('stripThink / splitThink: domknięte i niedomknięte (strumień) bloki', () => {
    assert.equal(C.stripThink('<think>rozważam</think>Odpowiedź'), 'Odpowiedź');
    assert.deepEqual(host(C.splitThink('<think>a</think>X<think>b')), { think: 'a\nb', rest: 'X', open: true });
    assert.deepEqual(host(C.splitThink('bez myśli')), { think: '', rest: 'bez myśli', open: false });
  });
  test('extractActions / stripActions', () => {
    const txt = 'Już się robi.\n```action\n{"action":"fit","args":{}}\n```\n\n\n```action\n{zepsuty\n```';
    assert.deepEqual(host(C.extractActions(txt)), [{ action: 'fit', args: {} }]);
    assert.equal(C.stripActions(txt), 'Już się robi.');
  });
});

describe('friendlyError i teksty', () => {
  test('sieć / klucz / nieznany błąd; szczegóły przycięte', () => {
    assert.ok(C.friendlyError({ code: 'net', message: 'Failed to fetch' }).startsWith('⚠ ' + S.t('errNetwork')));
    const auth = C.friendlyError({ status: 401, message: '401 Unauthorized' });
    assert.ok(auth.includes(S.t('errAuth')) && auth.includes('szczegóły: 401 Unauthorized'), auth);
    assert.equal(C.friendlyError(new Error('coś dziwnego')), '⚠ coś dziwnego');
  });
  test('t(): język z CM.i18n, nieznany klucz → sam klucz', () => {
    assert.equal(S.t('send'), 'Wyślij');
    CM.i18n.setLang('en');
    try {
      assert.equal(S.t('send'), 'Send');
      assert.ok(C.friendlyError({ status: 429 }).includes('rate limit'));
    } finally { CM.i18n.setLang('pl'); }
    assert.equal(S.t('brak.takiego.klucza'), 'brak.takiego.klucza');
  });
});

describe('prompty i historia dla modelu', () => {
  const hist = [{ role: 'user', content: 'cześć' }, { role: 'assistant', content: '<think>x</think>Hej!\n```action\n{"action":"fit","args":{}}\n```' }, { role: 'user', content: 'ustaw układ pack' }];
  test('chatMessages: mały model lokalny → system + few-shot (4) + historia bez <think> i bloków akcji', () => {
    const m = host(C.chatMessages(hist, { local: true, think: false, structured: true, localProv: true }));
    assert.equal(m[0].role, 'system');
    assert.match(m[0].content, /Answer ONLY with one JSON object/);
    assert.equal(m.length, 1 + 4 + hist.length);
    assert.deepEqual(m.slice(-2), [{ role: 'assistant', content: 'Hej!' }, { role: 'user', content: 'ustaw układ pack' }]);
  });
  test('chatMessages: model rozumujący → bez roli system i bez few-shot, prompt doklejony do pierwszej wiadomości użytkownika', () => {
    const m = host(C.chatMessages(hist, { local: true, think: true, structured: false, localProv: true }));
    assert.equal(m.length, hist.length);
    assert.ok(m.every((x) => x.role !== 'system'));
    assert.match(m[0].content, /^You are ChatBot inside CodeMap[\s\S]*\n\ncześć$/);
  });
  test('ragHistory: bez bieżącego pytania, komunikatów „brak klucza” i komend „/”, najwyżej 4', () => {
    const last = { role: 'user', content: 'jak działa rag?' };
    const msgs = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b', noKey: true }, { role: 'user', content: '/fit', slash: true },
      { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }, { role: 'assistant', content: 'e' }, { role: 'system', content: 's' }, last];
    assert.deepEqual(host(C.ragHistory(msgs, last)).map((m) => m.content), ['a', 'c', 'd', 'e']);
  });
  test('cleanTitle: pierwsza linia bez cudzysłowów i końcowej kropki, najwyżej 48 znaków', () => {
    assert.equal(C.cleanTitle('"Mapa kodu projektu."\ncoś jeszcze'), 'Mapa kodu projektu');
    assert.equal(C.cleanTitle(null), '');
  });
});

describe('addTool: narzędzia modułów ładowanych później', () => {
  test('wpis w katalogu, menu i pomocy, allowlistach i walidacji; duplikat ignorowany', () => {
    const X = loadCM([...CORE, 'chatbot-strings', 'chatbot-core'], appStub()).ChatBotCore;
    const n = X.TOOLS.length;
    X.addTool({ name: 'owners', sig: '{query?}', desc: 'list code owners', descPl: 'właściciele kodu', auto: true, info: true, required: (a) => a.n == null || a.n > 0 });
    X.addTool({ name: 'owners', desc: 'duplikat' });
    assert.equal(X.TOOLS.length, n + 1);
    assert.ok(X.ACTION_CATALOG.includes('owners {query?} — list code owners'));
    assert.ok(X.AUTO_OK.has('owners') && X.INFO_TOOLS.has('owners'));
    assert.equal(X.validAction({ action: 'owners', args: {} }), true);
    assert.equal(X.validAction({ action: 'owners', args: { n: 0 } }), false);
    assert.ok(X.helpText().includes('- `/owners {query?}` — właściciele kodu'));
    assert.deepEqual(host(X.parseSlash('/owners src/app')), { action: 'owners', args: { query: 'src/app' } });
  });
});

describe('chatbot-render.js: bezpieczny markdown (bez DOM)', () => {
  const R = loadCM([...CORE, 'icons', 'chatbot-strings', 'chatbot-core', 'chatbot-render'], appStub()).ChatBotRender;
  test('fmt: pogrubienie, kursywa, kod w linii, nowe linie; HTML z treści zawsze escapowany', () => {
    assert.equal(R.fmt('**b** *i* `c`\nx'), '<b>b</b> <i>i</i> <code class="cb-ic">c</code><br>x');
    assert.equal(R.fmt('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  });
  test('fmt: blok kodu z językiem → etykieta, przycisk kopiowania i (dla języków podglądu) uruchamiania', () => {
    const html = R.fmt('```html\n<b>hi</b>\n```');
    assert.match(html, /<span class="cb-clang">html<\/span>/);
    assert.match(html, /data-runlang="html"/);
    assert.match(html, /<pre class="cb-code hl">&lt;b&gt;hi&lt;\/b&gt;\n<\/pre>/);
    assert.doesNotMatch(R.fmt('```python\nprint(1)\n```'), /cb-run/);
  });
  test('thinkHTML: na żywo otwarty z kropką, po zakończeniu zwijany; bez myśli → pusto', () => {
    assert.equal(R.thinkHTML({ think: '' }, false), '');
    assert.match(R.thinkHTML({ think: 'a<b', open: true }, true), /^<details class="cb-think cb-think-live" open><summary><span class="cb-think-dot"><\/span>Myślę…<\/summary><div class="cb-think-b">a&lt;b<\/div><\/details>$/);
    assert.doesNotMatch(R.thinkHTML({ think: 'x', open: false }, true), / open>/);
  });
});
