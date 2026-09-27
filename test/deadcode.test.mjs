// CM.DeadCode — nieużywane eksporty JS/TS (faza 14): nazwy z klauzul importu na krawędziach (CM.Analysis), barrel
// `export *` z przekazaniem żądań, `export {a} from`, namespace i require = wszystko, typy z JSDoc i pliki .d.ts,
// typ w sygnaturze eksportowanej wartości (jak knip), wejście pakietu (dist → src) pominięte, napisy i regexy
// nie są eksportami, testy liczą się jako użycie; reguła Inspect `unusedexport`. Zgodność z knip: tools/corpus.mjs.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCM, host, CORE } from './harness.mjs';
import { toSarif } from '../cli/sarif.mjs';

const CM = loadCM([...CORE, 'metrics', 'rules', 'testmap', 'deadcode', 'inspect']);
const { Graph } = CM.Graph;
const F = (path, content) => ({ path, content, size: content.length, mtime: 1 });
const deps = (src, key = 'ts') => host(CM.Analysis.extractDeps(src, key)).map(({ spec, names, star, typeOnly }) => ({ spec, names, star, typeOnly }));

describe('nazwy importów w zależnościach (CM.Analysis)', () => {
  test('klauzule: default + nazwane (bez aliasu docelowego), namespace, efekt uboczny, reeksporty, import type', () => {
    const d = deps([
      "import d, { a, b as c, type T } from './x';",
      "import * as ns from './ns';",
      "import './side';",
      "export * from './star';",
      "export { e as f, default as g } from './re';",
      "export * as all from './all';",
      "import type { U } from './types';",
      "import { $dollar } from './dollar';",
    ].join('\n'));
    assert.deepEqual(d, [
      { spec: './x', names: ['default', 'a', 'b', 'T'], star: undefined, typeOnly: undefined },
      { spec: './ns', names: ['*'], star: undefined, typeOnly: undefined },
      { spec: './side', names: [], star: undefined, typeOnly: undefined },
      { spec: './star', names: undefined, star: true, typeOnly: undefined },
      { spec: './re', names: ['e', 'default'], star: undefined, typeOnly: undefined },
      { spec: './all', names: ['*'], star: undefined, typeOnly: undefined },
      { spec: './types', names: ['U'], star: undefined, typeOnly: true },
      { spec: './dollar', names: ['$dollar'], star: undefined, typeOnly: undefined },
    ]);
  });
  test('JSDoc `import(…).T` w komentarzu = zależność tylko typu z nazwą; import() w kodzie bez nazw (wszystko)', () => {
    const d = deps("/** @param {import('./t').A} a @returns {Array<import('./t').B>} */\nexport const f = (a) => import('./lazy').then((m) => m);\n", 'js');
    assert.deepEqual(d, [
      { spec: './lazy', names: undefined, star: undefined, typeOnly: undefined },
      { spec: './t', names: ['A', 'B'], star: undefined, typeOnly: true },
    ]);
  });
});

describe('eksporty pliku (exportsOf)', () => {
  test('deklaracje, listy z aliasem, default, namespace, typy; napisy i regexy to nie eksporty', () => {
    const src = [
      'export const a = 1, notSeen = 2;',
      'export async function* gen() {}',
      'export default class {}',
      'export abstract class Base {}',
      'export enum E { X }',
      'export type T = string;',
      'export interface I {}',
      'const x = 1, y = 2;',
      'export { x, y as why };',
      "export type { T as TT } from './t';",
      "export * as space from './s';",
      'const s = "export const Fake = 1";',
      'const re = /^export const Fake2 = /m;',
    ].join('\n');
    assert.deepEqual(host(CM.DeadCode.exportsOf(src)).map((e) => [e.name, e.line, e.type]), [
      ['default', 3, false], ['a', 1, false], ['gen', 2, false], ['Base', 4, false], ['E', 5, false], ['T', 6, true], ['I', 7, true],
      ['x', 9, false], ['why', 9, false], ['TT', 10, true], ['space', 11, false],
    ]);
  });
});

describe('nieużywane eksporty w projekcie', () => {
  const files = [
    F('package.json', '{ "name": "p", "exports": { ".": { "import": "./dist/index.js" } } }'),
    F('src/index.ts', "import { run } from './app';\nexport const api = run;\nexport const alsoPublic = 1;\n"),       // wejście (dist → src)
    F('src/app.ts', [
      "import { viaStar, type T } from './barrel';", "import * as ns from './ns';", "import def from './def';",
      "import { f } from './types';", "import { s } from './str';", "import './cjs.js';",
      "/** @param {import('./decl').Via} v */",
      'export function run(x: T) { return viaStar + ns.a + def + f(1) + s; }', 'export const unusedInApp = 1;'].join('\n')),
    F('src/barrel.ts', "export * from './b';\nexport { named } from './c';\n"),
    F('src/b.ts', 'export const viaStar = 1;\nexport const notAsked = 2;\nexport type T = number;\n'),
    F('src/c.ts', 'export const named = 1;\nexport const cOther = 2;\n'),
    F('src/ns.ts', 'export const a = 1;\nexport const b = 2;\n'),
    F('src/def.ts', 'export default 1;\nexport const extra = 2;\n'),
    F('src/types.ts', 'export type Used = { n: number };\nexport type Lonely = string;\nexport type OnlyByType = Lonely;\nexport function f(x: Used | number) { return 1; }\n'),
    F('src/decl.d.ts', 'export interface Via { a: 1 }\nexport interface NotVia { b: 2 }\n'),
    F('src/str.ts', 'export const s = "export const Fake = 1";\nconst re = /export const Fake2/;\n'),
    F('src/cjs.js', "const x = require('./req');\nmodule.exports = x;\n"),
    F('src/req.ts', 'export const r1 = 1;\nexport const r2 = 2;\n'),
    F('src/orphan.ts', 'export const nobody = 1;\n'),                                              // nikt nie importuje → reguła orphan
    F('test/c.test.ts', "import { cOther } from '../src/c';\nimport assert from 'node:assert';\nassert.ok(cOther);\n"),
  ];
  const g = new Graph().build(files.map((f) => ({ ...f })), { name: 't', source: 'test' });
  CM.TestMap.mapTests(g);
  test('nazwy na krawędziach: suma importów pary, gwiazdka barrela, require = wszystko', () => {
    const e = (s, t) => host(g.edges.find((x) => x.source === s && x.target === t && x.type === 'import'));
    assert.deepEqual(e('src/app.ts', 'src/barrel.ts').names, ['viaStar', 'T']);
    assert.equal(e('src/barrel.ts', 'src/b.ts').star, true);
    assert.deepEqual(e('src/cjs.js', 'src/req.ts').names, ['*']);
    assert.deepEqual(e('src/app.ts', 'src/decl.d.ts').names, ['Via']);   // JSDoc + rozwiązanie do .d.ts
  });
  test('wejście z exports (dist → src), wynik: tylko naprawdę nieużywane', () => {
    assert.ok(host([...CM.DeadCode.entryFiles(g)]).includes('src/index.ts'));
    const res = host(CM.DeadCode.analyze(g)).map((d) => d.path + ': ' + d.exports.map((x) => x.name).join(',')).sort();
    assert.deepEqual(res, [
      'src/app.ts: unusedInApp',
      'src/b.ts: notAsked',              // gwiazdka barrela przekazuje tylko viaStar i T
      'src/barrel.ts: named',            // reeksport, o który nikt nie pyta (c.named jest użyty przez sam reeksport)
      'src/decl.d.ts: NotVia',
      'src/def.ts: extra',
      'src/types.ts: Lonely,OnlyByType', // Used w sygnaturze eksportowanej funkcji — część API; Lonely używa tylko inny typ
    ]);
  });
  test('reguła Inspect unusedexport: pozycja na plik z liczbą i nazwami z liniami', async () => {
    const rep = await CM.Inspect.run(g), f = rep.findings.find((x) => x.rule === 'unusedexport');
    assert.ok(f && f.sev === 'low', JSON.stringify(host(rep.findings.map((x) => x.rule))));
    assert.equal(f.count, 6);
    assert.match(f.items.find((i) => i.path === 'src/types.ts').detail, /2 .*Lonely:2, OnlyByType:3/);
    assert.ok(CM.Inspect.RULES.includes('unusedexport'));
  });
  test('SARIF: linia pierwszego nieużywanego eksportu, tag dead-code', async () => {
    const rep = await CM.Inspect.run(g), run = toSarif({ CM, graph: g, rep, lang: 'en' }).runs[0];
    const r = run.results.find((x) => x.ruleId === 'unusedexport' && x.locations[0].physicalLocation.artifactLocation.uri === 'src/types.ts');
    assert.equal(r.locations[0].physicalLocation.region.startLine, 2);
    assert.ok(run.tool.driver.rules.find((x) => x.id === 'unusedexport').properties.tags.includes('dead-code'));
  });
});
