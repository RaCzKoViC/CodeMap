import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { loadCodeMap } from '../cli/runtime.mjs';
import { toSarif, importLine, SARIF_SCHEMA, INFO_URI } from '../cli/sarif.mjs';

// SARIF 2.1.0 (cli/sarif.mjs) z syntetycznego wyniku Inspect na prawdziwym grafie: reguły tylko z wynikami w plikach,
// poziomy wg ważności pozycji, URI względne z prefiksem podkatalogu, linia importu w cyklu, odciski niezależne od liczb.
const CM = loadCodeMap({ lang: 'pl' });
const FILES = [
  { path: 'src/a.js', size: 40, content: "// moduł a\nimport { b } from './b.js';\nexport const a = () => b();\n" },
  { path: 'src/b.js', size: 30, content: "import { a } from './a.js';\nexport const b = () => a;\n" },
  { path: 'src/my file.js', size: 10, content: 'export const x = 1;\n' },
  { path: 'src/util/index.js', size: 10, content: 'export default 1;\n' },
  { path: 'src/c.js', size: 30, content: "const q = 1;\nimport u from './util';\n" },
  { path: 'app.py', size: 20, content: 'import os\nfrom .helpers import run\n' },
  { path: 'helpers.py', size: 5, content: 'def run(): pass\n' },
];
const graph = new CM.Graph.Graph(); graph.build(FILES, { name: 'demo' });
const N = (id) => graph.nodes.get(id);
const rep = (archDetail = 'warstwa 3 → 1') => ({ score: 71, files: 7, findings: [
  { rule: 'cycles', sev: 'high', count: 2, items: [{ id: 'src/a.js', path: 'src/a.js', related: ['src/b.js'], detail: '2 pliki' }, { id: 'src/b.js', path: 'src/b.js', related: ['src/a.js'] }] },
  { rule: 'deep', sev: 'low', count: 1, items: [{ id: 'src/util', path: 'src/util' }] },
  { rule: 'archviolation', sev: 'med', count: 5, items: [{ id: 'src/a.js', path: 'src/a.js', related: ['src/b.js'], detail: archDetail, sev: 'high' }] },
  { rule: 'risky', sev: 'high', count: 1, items: [{ id: 'src/my file.js', path: 'src/my file.js', sev: 'low' }] },
] });

describe('importLine: linia importu pliku docelowego (heurystyka na podglądzie)', () => {
  test('import w cudzysłowie, index.js po nazwie folderu, from-import Pythona; brak → null', () => {
    assert.equal(importLine(graph, N('src/a.js'), N('src/b.js')), 2);
    assert.equal(importLine(graph, N('src/b.js'), N('src/a.js')), 1);
    assert.equal(importLine(graph, N('src/c.js'), N('src/util/index.js')), 2);
    assert.equal(importLine(graph, N('app.py'), N('helpers.py')), 2);
    assert.equal(importLine(graph, N('src/a.js'), N('src/c.js')), null);
    assert.equal(importLine(graph, { preview: null }, N('src/a.js')), null);
    assert.equal(importLine(graph, N('src/a.js'), N('src')), null, 'cel nie jest plikiem');
  });
});

describe('toSarif', () => {
  const doc = toSarif({ CM, graph, rep: rep(), lang: 'pl', uriPrefix: 'sub/dir/' });
  const run = doc.runs[0];
  test('dokument: schemat, wersja, narzędzie z wersją CodeMap i językiem, właściwości przebiegu', () => {
    assert.equal(doc.$schema, SARIF_SCHEMA); assert.equal(doc.version, '2.1.0');
    assert.equal(run.tool.driver.name, 'CodeMap'); assert.equal(run.tool.driver.version, CM.VERSION);
    assert.equal(run.tool.driver.informationUri, INFO_URI); assert.equal(run.tool.driver.language, 'pl-PL');
    assert.deepEqual(run.properties, { healthScore: 71, files: 7, findings: 9, folderFindings: 1, truncated: { archviolation: 4 } });
    assert.equal(toSarif({ CM, graph, rep: rep(), lang: 'en' }).runs[0].tool.driver.language, 'en-US');
  });
  test('reguły tylko z wynikami w plikach (folder „deep" pominięty), tagi, security-severity dla risky', () => {
    assert.deepEqual(run.tool.driver.rules.map((r) => r.id), ['cycles', 'archviolation', 'risky']);
    const byId = Object.fromEntries(run.tool.driver.rules.map((r) => [r.id, r]));
    assert.equal(byId.cycles.shortDescription.text, CM.Inspect.text('r.cycles'));
    assert.equal(byId.cycles.defaultConfiguration.level, 'error');
    assert.deepEqual(byId.archviolation.properties.tags, ['codemap', 'architecture']);
    assert.equal(byId.risky.properties['security-severity'], '5.0');
    assert.equal(byId.cycles.properties['security-severity'], undefined);
  });
  test('wyniki: poziom wg ważności pozycji, URI względne kodowane z prefiksem, linia importu w cyklu, powiązane lokalizacje', () => {
    assert.equal(run.results.length, 4);
    const [c1, c2, arch, risky] = run.results;
    assert.deepEqual([c1.level, arch.level, risky.level], ['error', 'error', 'note']);
    assert.equal(c1.ruleIndex, 0); assert.equal(arch.ruleIndex, 1); assert.equal(risky.ruleIndex, 2);
    const loc = (r) => r.locations[0].physicalLocation;
    assert.deepEqual(loc(c1).artifactLocation, { uri: 'sub/dir/src/a.js', uriBaseId: '%SRCROOT%' });
    assert.equal(loc(c1).region.startLine, 2); assert.equal(loc(c2).region.startLine, 1);
    assert.equal(loc(arch).region.startLine, 2, 'naruszenie: linia importu celu');
    assert.equal(loc(risky).artifactLocation.uri, 'sub/dir/src/my%20file.js'); assert.equal(loc(risky).region.startLine, 1);
    assert.equal(c1.message.text, CM.Inspect.text('r.cycles') + ': 2 pliki');
    assert.deepEqual(c1.relatedLocations.map((l) => [l.id, l.message.text, l.physicalLocation.artifactLocation.uri]), [[1, 'b.js', 'sub/dir/src/b.js']]);
    assert.equal(risky.relatedLocations, undefined);
    assert.deepEqual(risky.properties, { severity: 'low' });
  });
  test('odciski: niezależne od liczb w szczegółach naruszeń, języka i prefiksu; różne dla różnych plików', () => {
    const fp = (d) => d.runs[0].results.map((r) => r.partialFingerprints['codemap/v1']);
    const base = fp(doc), other = fp(toSarif({ CM, graph, rep: rep('warstwa 7 → 2'), lang: 'en' }));
    assert.deepEqual(other, base);
    assert.equal(new Set(base).size, 4);
    assert.ok(base.every((f) => /^[0-9a-f]{32}$/.test(f)));
    const changed = fp(toSarif({ CM, graph, rep: rep('warstwa usługi → domena') }));
    assert.notEqual(changed[2], base[2], 'inny tekst naruszenia = inny odcisk');
  });
  test('bez prefiksu: URI od korzenia analizy; pusty raport → pusty przebieg', () => {
    const d = toSarif({ CM, graph, rep: rep() });
    assert.equal(d.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri, 'src/a.js');
    const e = toSarif({ CM, graph, rep: { score: 100, files: 0, findings: [] } });
    assert.deepEqual([e.runs[0].results, e.runs[0].tool.driver.rules, e.runs[0].properties.findings], [[], [], 0]);
  });
});
