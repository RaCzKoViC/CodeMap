import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';

// Nakładki kolorowania węzłów (js/overlays.js): rampy kolorów, rejestr, przełączanie, wbudowane nakładki.
// CM.App to zaślepka z rendererem (colorFn, kick) i grafem — jak kontekst aplikacji.
function load() {
  const renderer = { colorFn: null, kicks: 0, kick() { this.kicks++; } };
  const CM = loadCM(['util', 'i18n', 'overlays'], { CM: { App: { renderer, graph: null } } });
  return { O: CM.Overlays, A: CM.App, renderer };
}
const file = (id, o = {}) => ({ id, type: 'file', ...o });
const graphOf = (...nodes) => ({ nodes: new Map(nodes.map((n) => [n.id, n])) });

describe('kolory: mixHex i ramp', () => {
  const { O } = load();
  test('mixHex: końce, środek, skrót #abc', () => {
    assert.equal(O.mixHex('#000000', '#ffffff', 0), '#000000');
    assert.equal(O.mixHex('#000000', '#ffffff', 1), '#ffffff');
    assert.equal(O.mixHex('#000', '#fff', 0.5), '#808080');
  });
  test('ramp: t przycięte do [0,1], NaN → pierwszy kolor, jeden kolor → zawsze on', () => {
    const r = O.ramp(['#000000', '#ff0000', '#ffffff']);
    assert.equal(r(0), '#000000'); assert.equal(r(0.5), '#ff0000'); assert.equal(r(1), '#ffffff');
    assert.equal(r(-3), '#000000'); assert.equal(r(9), '#ffffff'); assert.equal(r(NaN), '#000000');
    assert.equal(r(0.25), '#800000');
    assert.equal(O.ramp(['#123456'])(0.7), '#123456');
  });
});

describe('rejestr i przełączanie', () => {
  test('list: tylko dostępne, wg order; wyjątek w available() = niedostępna; etykieta z funkcji albo id', () => {
    const { O, A } = load();
    A.graph = graphOf(file('a.js', { metrics: { complexity: 0 } }));
    O.register({ id: 'zz', order: 5, label: () => 'Zet', compute: () => null });
    O.register({ id: 'boom', available: () => { throw new Error('x'); }, compute: () => null });
    O.register({ id: 'plain', order: 60, compute: () => null });
    O.register(null); O.register({ label: 'bez id' });
    assert.deepEqual(host(O.list().map((o) => o.id)), ['lang', 'zz', 'plain']);
    assert.equal(O.label(O.list()[1]), 'Zet');
    assert.equal(O.label({ id: 'plain' }), 'plain');
    assert.equal(O.label({ id: 'err', label: () => { throw new Error('x'); } }), 'err');
  });
  test('set: nieznana → błąd z listą; niedostępna → komunikat nakładki; poprawna → colorFn w rendererze', () => {
    const { O, A, renderer } = load();
    A.graph = graphOf(file('a.js', { metrics: { complexity: 0 } }));
    assert.throws(() => O.set('nie-ma'), /nie-ma \(lang, complexity, mtime\)/);
    O.register({ id: 'git', available: () => false, unavailable: () => 'Najpierw historia git', compute: () => null });
    assert.throws(() => O.set('git'), /Najpierw historia git/);
    O.register({ id: 'red', label: () => 'Czerwone', compute: () => ({ colorOf: () => '#ff0000', legend: { items: [] } }) });
    assert.equal(O.set('red'), 'Czerwone');
    assert.equal(O.current(), 'red');
    assert.equal(renderer.colorFn(file('x')), '#ff0000');
    assert.ok(renderer.kicks > 0);
    O.reset();
    assert.equal(O.current(), 'lang'); assert.equal(renderer.colorFn, null);
  });
  test('refresh: błąd compute → brak kolorowania (bez wyjątku); utrata danych → powrót do „lang"', () => {
    const { O, A, renderer } = load();
    A.graph = graphOf(file('a.js'));
    let avail = true;
    O.register({ id: 'flaky', available: () => avail, compute: () => { throw new Error('boom'); } });
    const warn = console.warn; console.warn = () => {};
    try { O.set('flaky'); } finally { console.warn = warn; }
    assert.equal(renderer.colorFn, null);
    assert.equal(O.current(), 'flaky');
    avail = false; O.refresh();
    assert.equal(O.current(), 'lang');
  });
});

describe('wbudowane nakładki', () => {
  test('complexity: dostępna, gdy jakiś plik ma CC > 0; skala logarytmiczna, foldery i inne typy osobno', () => {
    const { O, A, renderer } = load();
    A.graph = graphOf(file('a.js', { metrics: { complexity: 0 } }));
    assert.ok(!O.list().some((o) => o.id === 'complexity'));
    const lo = file('lo.js', { metrics: { complexity: 1 } }), hi = file('hi.js', { metrics: { complexity: 100 } }), zero = file('z.js', { metrics: { complexity: 0 } });
    A.graph = graphOf(lo, hi, zero, { id: 'src', type: 'folder' }, { id: 'ext:react', type: 'external' });
    O.set('complexity');
    const c = renderer.colorFn;
    assert.equal(c(hi), O.HEAT[O.HEAT.length - 1], 'maksimum = najgorętszy kolor');
    assert.equal(c(zero), O.HEAT[0]);
    assert.notEqual(c(lo), c(zero));
    assert.equal(c({ id: 'src', type: 'folder' }), O.FOLDER);
    assert.equal(c({ id: 'ext:react', type: 'external' }), O.NONE);
    assert.equal(c(file('spoza-grafu.js')), O.NONE);
  });
  test('mtime: wymaga dat dla co najmniej połowy plików; najstarszy = pierwszy kolor rampy', () => {
    const { O, A, renderer } = load();
    A.graph = graphOf(file('a', { mtime: 1000 }), file('b'), file('c'));
    assert.throws(() => O.set('mtime'));
    const old = file('old', { mtime: 1000 }), neu = file('new', { mtime: 5000 });
    A.graph = graphOf(old, neu, file('nodate'));
    O.set('mtime');
    assert.equal(renderer.colorFn(old), '#1e293b');
    assert.equal(renderer.colorFn(neu), '#facc15');
    assert.equal(renderer.colorFn(file('nodate')), O.NONE);
  });
  test('palety: HEAT i PALETTE to poprawne kolory #hex, PALETTE bez powtórzeń', () => {
    const { O } = load();
    for (const c of [...O.HEAT, ...O.PALETTE, O.NONE, O.FOLDER]) assert.match(c, /^#[0-9a-f]{6}$/);
    assert.equal(new Set(O.PALETTE).size, O.PALETTE.length);
  });
});
