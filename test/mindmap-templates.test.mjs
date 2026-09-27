import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host } from './harness.mjs';
import { miniDocument } from './minidom.mjs';

// Szablony MindMap (js/mindmap-templates.js): builder węzłów, palety, miniatury, wykrywanie języka i karta „kod".
const MODS = ['util', 'icons', 'i18n', 'mindmap-strings', 'mindmap-templates'];
const T = loadCM(MODS).MindMapTemplates;

describe('builder i diagramy', () => {
  test('mk: domyślne pola karty i id z licznika; lk ignoruje brakujące końce', () => {
    const ctx = { nodes: [], edges: [], seq: 7 };
    const { mk, lk, nodes } = T.builder(ctx);
    const a = mk(1, 2), b = mk(3, 4, { text: 'B', w: 50, color: '#fff' });
    assert.deepEqual(host(a), { id: 'n7', x: 1, y: 2, w: 160, text: '', template: 'card', color: '#22d3ee', font: 14 });
    assert.equal(b.w, 50); assert.equal(ctx.seq, 9); assert.equal(nodes, ctx.nodes);
    lk(a, b); lk(a, null); lk(undefined, b);
    assert.deepEqual(host(ctx.edges), [{ from: 'n7', to: 'n8' }]);
  });
  test('build zwraca definicję (z nazwą w bieżącym języku); find dla nieznanego → null', () => {
    const ctx = { nodes: [], edges: [], seq: 1 };
    const d = T.build('swot', ctx);
    assert.equal(d.k, 'swot');
    assert.ok(ctx.nodes.some((n) => n.text === 'SWOT'));
    assert.ok(ctx.nodes.filter((n) => n.parent).every((n) => ctx.nodes.some((p) => p.id === n.parent)));
    assert.equal(T.find('nie-ma'), null);
  });
  test('palety schematu: ≥ 6 kolorów #hex każda; COLORS bez powtórzeń', () => {
    for (const [k, pal] of Object.entries(T.SCHEMA_PALETTES)) {
      assert.ok(pal.length >= 6, k);
      for (const c of pal) assert.match(c, /^#[0-9a-f]{6}$/i, k);
    }
    assert.equal(new Set(T.COLORS).size, T.COLORS.length);
  });
  test('thumb: nieznany typ dostaje domyślną miniaturę gwiazdy (5 gałęzi)', () => {
    const svg = T.thumb({ k: 'cos-nowego' });
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    assert.equal((svg.match(/<circle /g) || []).length, 6);
  });
});

describe('detectCodeLang', () => {
  test('heurystyki strukturalne dla każdego obsługiwanego języka', () => {
    const cases = [
      ['<?php echo 1;', 'php'], ['<div class="a">x</div>', 'html'], ['#include <stdio.h>\nint main(){}', 'cpp'],
      ['public class A { }', 'java'], ['package main\nfunc main() {}', 'go'], ['fn main() { let mut x = 1; }', 'rust'],
      ['from os import path', 'py'], ['puts "hi"', 'rb'], ['UPDATE users SET a = 1', 'sql'], ['{"k": [1, 2]}', 'json'],
      ['.btn { color: red; }', 'css'], ['export default x', 'js'], ['#!/bin/bash\necho hi', 'sh'], ['zwykły tekst notatki', 'text'],
      ['   \n\t', ''], [null, ''],
    ];
    for (const [code, lang] of cases) assert.equal(T.detectCodeLang(code), lang, String(code));
  });
});

describe('karta „kod" (codeView)', () => {
  const setTimeoutUnref = (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; };   // toast i znacznik „skopiowano"
  function view(text, extra = {}) {
    const doc = miniDocument();
    const C = loadCM(MODS, { document: doc, setTimeout: setTimeoutUnref, ...extra });
    const card = doc.createElement('div');
    C.MindMapTemplates.codeView(card, { text });
    return { card, C };
  }
  test('bez podświetlacza treść jest escapowana; numeracja linii; etykieta języka i przycisk kopiowania', () => {
    const { card } = view('<script>alert(1)</script>\nconst a = 1;');
    const pre = card.querySelector('.mm-code-pre');
    assert.equal(pre.innerHTML, '&lt;script&gt;alert(1)&lt;/script&gt;\nconst a = 1;');
    assert.equal(card.querySelector('.mm-code-gut').textContent, '1\n2');
    assert.equal(card.querySelector('.mm-code-lang').textContent, 'html');
    assert.ok(card.querySelector('.mm-code-copy'));
  });
  test('pusta karta: podpowiedź zamiast kodu, bez etykiety i bez kopiowania', () => {
    const { card } = view('  ');
    assert.match(card.querySelector('.mm-code-ph').textContent, /^\/\/ dwuklik/);   // element z tekstem, nie HTML z napisu
    assert.equal(card.querySelector('.mm-code-gut').textContent, '1');
    assert.equal(card.querySelector('.mm-code-lang').textContent, '');
    assert.equal(card.querySelector('.mm-code-copy'), null);
  });
  test('podświetlacz CM.UI.highlight dostaje kod i wykryty język; jego wyjątek → czysty tekst', () => {
    const seen = [];
    const doc = miniDocument();
    const C = loadCM(MODS, { document: doc });
    C.UI = { highlight: (code, lang) => { seen.push(lang); return '<i>hl</i>'; } };
    const card = doc.createElement('div');
    C.MindMapTemplates.codeView(card, { text: 'def f():\n  pass' });
    assert.equal(card.querySelector('.mm-code-pre').innerHTML, '<i>hl</i>');
    assert.deepEqual(seen, ['py']);
    C.UI.highlight = () => { throw new Error('x'); };
    const card2 = doc.createElement('div');
    C.MindMapTemplates.codeView(card2, { text: 'a<b' });
    assert.equal(card2.querySelector('.mm-code-pre').textContent, 'a<b');
  });
  test('kopiowanie: schowek dostaje surowy kod, kliknięcie nie przechodzi do karty', async () => {
    let copied = null;
    const { card } = view('SELECT 1 FROM t', { navigator: { clipboard: { writeText: async (s) => { copied = s; } } } });
    let stopped = false;
    card.querySelector('.mm-code-copy').onclick({ stopPropagation: () => { stopped = true; } });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(copied, 'SELECT 1 FROM t'); assert.equal(stopped, true);
    assert.ok(card.querySelector('.mm-code-copy').classList.contains('done'));
  });
});
