/* ===================== testgen.js — szkielety testów (Doktor hotspotów, faza 11), bez DOM i bez modelu ===================== */
// Dla pliku z kodem: framework z projektu (package.json: vitest / jest / mocha, `node --test`, importy istniejących
// testów; pytest / unittest; Go testing; Rust #[cfg(test)]; JUnit 5), położenie i nazwa pliku testów wg konwencji, którą
// projekt już stosuje (pary test ↔ kod z CM.TestMap: obok pliku, __tests__/, płaski test/, lustrzane drzewo), inaczej
// domyślna dla języka; import wyeksportowanych funkcji i klas; przypadki od najbardziej złożonych funkcji (złożoność
// cyklomatyczna = minimalna liczba przypadków do pokrycia gałęzi). generate(graph, node, {lang}) → {path, code, framework, symbols, note}.
CM.TestGen = (function(){
  const ext = (p) => { const b = p.slice(p.lastIndexOf('/') + 1), i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
  const dirOf = (p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
  const baseNoExt = (p) => { const b = p.slice(p.lastIndexOf('/') + 1); const i = b.indexOf('.'); return i > 0 ? b.slice(0, i) : b; };
  const FAM = {js:'js', mjs:'js', cjs:'js', jsx:'js', ts:'ts', tsx:'ts', mts:'ts', cts:'ts', py:'py', go:'go', rs:'rs', java:'java', kt:'kt'};

  function relPath(fromDir, to){
    const a = fromDir ? fromDir.split('/') : [], b = to.split('/');
    let i = 0; while(i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    const up = a.length - i, rest = b.slice(i).join('/');
    return (up ? '../'.repeat(up) : './') + rest;
  }

  // framework JS/TS: package.json najbliższy plikowi, potem importy istniejących testów
  function jsFramework(graph, node){
    let dir = dirOf(node.path);
    for(;;){
      const pj = graph.nodes.get(dir ? dir + '/package.json' : 'package.json');
      if(pj && typeof pj.preview === 'string'){
        try{
          const j = JSON.parse(pj.preview), deps = Object.assign({}, j.dependencies, j.devDependencies), test = String((j.scripts || {}).test || '');
          if(deps.vitest || /\bvitest\b/.test(test)) return 'vitest';
          if(deps.jest || deps['ts-jest'] || /\bjest\b/.test(test)) return 'jest';
          if(deps.mocha || /\bmocha\b/.test(test)) return 'mocha';
          if(/node\s+--test/.test(test)) return 'node';
        }catch(e){ /* package.json obcięty w podglądzie albo niepoprawny — szukamy dalej */ }
      }
      if(!dir) break; dir = dirOf(dir);
    }
    for(const n of graph.nodes.values()) if(n.isTest && typeof n.preview === 'string'){
      if(/from ['"]vitest['"]/.test(n.preview)) return 'vitest';
      if(/from ['"]node:test['"]/.test(n.preview)) return 'node';
      if(/@jest\/globals|jest\.fn\(/.test(n.preview)) return 'jest';
    }
    return FAM[ext(node.path)] === 'ts' ? 'vitest' : 'node';
  }

  // konwencja położenia: z par test → kod w grafie (krawędzie 'test'), najczęstszy wzorzec; → {kind, root?, suffix}
  function convention(graph, node){
    const fam = FAM[ext(node.path)];
    const votes = new Map();
    for(const e of graph.edges){
      if(e.type !== 'test') continue;
      const t = graph.nodes.get(e.source), s = graph.nodes.get(e.target);
      if(!t || !s || !t.path || !s.path || FAM[ext(s.path)] !== fam) continue;
      const tb = t.path.slice(t.path.lastIndexOf('/') + 1), sBase = baseNoExt(s.path);
      const suffix = tb.startsWith('test_') ? 'test_' : tb.slice(baseNoExt(t.path).length);   // „.test.mjs", „_test.go", „.spec.ts"
      let kind;
      if(dirOf(t.path) === dirOf(s.path)) kind = 'sibling';
      else if(dirOf(t.path) === (dirOf(s.path) ? dirOf(s.path) + '/' : '') + '__tests__') kind = '__tests__';
      else {
        const troot = t.path.split('/')[0];
        const rest = dirOf(s.path).split('/').slice(1).join('/');
        kind = (dirOf(t.path) === troot + (rest ? '/' + rest : '') && s.path.split('/').length > 1) ? 'mirror:' + troot : 'flat:' + dirOf(t.path);
      }
      if(!tb.includes(sBase)) continue;
      let v = votes.get(kind); if(!v){ v = {n: 0, suffixes: []}; votes.set(kind, v); } v.n++; v.suffixes.push({suffix, sext: ext(s.path)});
    }
    // głos na rodzaj konwencji (przyrostki .test.js / .test.jsx się nie rozbijają); przyrostek dopasowany do rozszerzenia pliku
    let best = null; for(const [k, v] of votes) if(!best || v.n > best[1].n) best = [k, v];
    if(best){
      // przyrostek pary z tym samym rozszerzeniem pliku; inaczej: gdy w projekcie przyrostek powtarza rozszerzenie pliku
      // (.test.jsx dla .jsx) — podmiana na nasze, gdy jest stały (.test.mjs dla .js, jak w CodeMap) — bez zmian
      const e = ext(node.path), sfx = best[1].suffixes, same = sfx.find(x => x.sext === e), first = sfx[0];
      const suffix = same ? same.suffix : first.suffix === 'test_' ? 'test_' : first.suffix.endsWith('.' + first.sext) ? first.suffix.replace(/\.[^.]+$/, '.' + e) : first.suffix;
      return {kind: best[0], suffix, fromProject: true};
    }
    const def = {js:['flat:test', '.test.' + ext(node.path)], ts:['sibling', '.test.' + ext(node.path)], py:['flat:tests', 'test_'], go:['sibling', '_test.go'],
      rs:['inline', ''], java:['java', 'Test.java'], kt:['java', 'Test.kt']}[fam] || ['sibling', '.test.' + ext(node.path)];
    return {kind: def[0], suffix: def[1], fromProject: false};
  }

  function testPath(node, conv){
    const dir = dirOf(node.path), base = baseNoExt(node.path), name = conv.suffix === 'test_' ? 'test_' + base + '.py' : base + conv.suffix;
    if(conv.kind === 'inline') return node.path;
    if(conv.kind === 'java'){ const p = node.path.replace(/(^|\/)src\/main\//, '$1src/test/'); return dirOf(p) + '/' + base + conv.suffix; }
    if(conv.kind === 'sibling') return (dir ? dir + '/' : '') + name;
    if(conv.kind === '__tests__') return (dir ? dir + '/' : '') + '__tests__/' + name;
    if(conv.kind.startsWith('mirror:')){ const root = conv.kind.slice(7), rest = dir.split('/').slice(1).join('/'); return root + '/' + (rest ? rest + '/' : '') + name; }
    if(conv.kind.startsWith('flat:')) return conv.kind.slice(5) + '/' + name;
    return (dir ? dir + '/' : '') + name;
  }

  // symbole do testów: najwyżej 12, od najbardziej złożonych; eksportowane (JS/TS: export / module.exports; Python: publiczne
  // na poziomie modułu; Go: w tym samym pakiecie wszystkie, eksportowane pierwsze; Rust: pub; Java: publiczne)
  function pickSymbols(node){
    const fam = FAM[ext(node.path)], src = typeof node.preview === 'string' ? node.preview.split('\n') : [];
    const syms = (node.symbols || []).filter(s => s.kind === 'function' || s.kind === 'class' || s.kind === 'method');
    const line = (s) => src[s.line - 1] || '';
    const cjs = /module\.exports\s*=\s*\{([^}]*)\}/.exec(node.preview || '');
    const cjsNames = cjs ? new Set(cjs[1].split(',').map(x => x.split(':')[0].trim()).filter(Boolean)) : null;
    let exported, hint = null;
    if(fam === 'js' || fam === 'ts'){
      exported = syms.filter(s => /^\s*export\b/.test(line(s)) || (cjsNames && cjsNames.has(s.name)) || new RegExp('^\\s*exports\\.' + s.name + '\\s*=').test((node.preview || '').split('\n').find(l => l.includes('exports.' + s.name)) || ''));
      if(!exported.length && syms.length) hint = 'noexports';
    } else if(fam === 'py') exported = syms.filter(s => !s.name.startsWith('_') && /^(def|async def|class)\b/.test(line(s)));
    else if(fam === 'go') exported = syms.slice().sort((a, b) => (/^[A-Z]/.test(b.name) - /^[A-Z]/.test(a.name)));
    else if(fam === 'rs') exported = syms.filter(s => /\bpub\b/.test(line(s)) || s.kind === 'function');
    else exported = syms;
    const list = (exported.length ? exported : syms).filter(s => s.kind !== 'method' || fam === 'java');
    return {list: list.slice().sort((a, b) => (b.complexity || 1) - (a.complexity || 1) || a.line - b.line).slice(0, 12), hint};
  }

  const T = {
    pl:{head:'Szkielet testów dla {p} — wygenerowany przez CodeMap. Uzupełnij TODO.', order:'Kolejność: od najbardziej złożonych funkcji (złożoność = minimalna liczba przypadków do pokrycia gałęzi).',
      cx:'złożoność {c} — co najmniej {c} przypadków; linia {l}', typical:'typowe wejście', edge:'przypadki brzegowe (puste, null, granice)', err:'niepoprawne wejście',
      inst:'tworzy instancję', noexp:'Moduł niczego nie eksportuje — wyeksportuj testowane funkcje albo testuj przez publiczne API.', none:'Brak funkcji do przetestowania w tym pliku.'},
    en:{head:'Test skeleton for {p} — generated by CodeMap. Fill in the TODOs.', order:'Order: most complex functions first (complexity = minimum number of cases to cover the branches).',
      cx:'complexity {c} — at least {c} cases; line {l}', typical:'typical input', edge:'edge cases (empty, null, boundaries)', err:'invalid input',
      inst:'creates an instance', noexp:'The module exports nothing — export the functions under test or test through the public API.', none:'No functions to test in this file.'},
  };
  const fill = (s, o) => s.replace(/\{(\w+)\}/g, (m, k) => (o[k] != null ? o[k] : m));
  const ident = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').toLowerCase();
  const throws = (node) => /\bthrow\b|\braise\b|\bpanic!?\(|errors\.New|return\s+.*\berr\b/.test(node.preview || '');

  function generate(graph, node, opts){
    opts = opts || {};
    const L = T[opts.lang === 'en' ? 'en' : 'pl'], fam = FAM[ext(node.path)];
    const {list, hint} = pickSymbols(node);
    const conv = convention(graph, node), path = testPath(node, conv);
    const cmt = fam === 'py' ? '#' : '//';
    const head = [cmt + ' ' + fill(L.head, {p: node.path}), cmt + ' ' + L.order];
    if(hint === 'noexports') head.push(cmt + ' ' + L.noexp);
    const cx = (s) => fill(L.cx, {c: s.complexity || 1, l: s.line});
    const err = throws(node);
    let framework, code;
    if(fam === 'js' || fam === 'ts'){
      framework = jsFramework(graph, node);
      const imp = relPath(dirOf(path), fam === 'ts' ? node.path.replace(/\.(tsx?|mts|cts)$/, '') : node.path);
      const names = list.map(s => s.name);
      const lines = head.slice();
      if(framework === 'vitest') lines.push("import { describe, it, expect } from 'vitest';");
      if(framework === 'node') lines.push("import { describe, it } from 'node:test';", "import assert from 'node:assert/strict';");
      if(framework === 'mocha') lines.push("import assert from 'node:assert/strict';");
      if(names.length && hint !== 'noexports') lines.push(`import { ${names.join(', ')} } from '${imp}';`);
      const eq = (v) => framework === 'vitest' || framework === 'jest' ? `expect(${v}).toEqual(/* TODO */);` : `assert.deepEqual(${v}, /* TODO */);`;
      const thr = (f) => framework === 'vitest' || framework === 'jest' ? `expect(() => ${f}(/* TODO */)).toThrow();` : `assert.throws(() => ${f}(/* TODO */));`;
      for(const s of list){
        lines.push('', `describe('${s.name}', () => {`, `  // ${cx(s)}`);
        if(s.kind === 'class') lines.push(`  it('${L.inst}', () => {`, `    const obj = new ${s.name}(/* TODO */);`, `    ${eq('obj')}`, '  });');
        else {
          lines.push(`  it('${L.typical}', () => {`, `    const result = ${s.name}(/* TODO */);`, `    ${eq('result')}`, '  });');
          lines.push(`  it('${L.edge}', () => {`, '    // TODO', '  });');
          if(err) lines.push(`  it('${L.err}', () => {`, `    ${thr(s.name)}`, '  });');
        }
        lines.push('});');
      }
      code = lines.join('\n') + '\n';
    } else if(fam === 'py'){
      const pytest = pyFramework(graph) === 'pytest'; framework = pytest ? 'pytest' : 'unittest';
      const mod = node.path.replace(/\.py$/, '').replace(/^(src|lib)\//, '').replace(/\/__init__$/, '').split('/').join('.');
      const lines = head.slice(); const names = list.map(s => s.name);
      if(pytest) lines.push('import pytest', ''); else lines.push('import unittest', '');
      if(names.length) lines.push(`from ${mod} import ${names.join(', ')}`);
      if(pytest){
        for(const s of list){ const b = ident(s.name);
          lines.push('', '', `def test_${b}_${ident(L.typical)}():`, `    # ${cx(s)}`, s.kind === 'class' ? `    obj = ${s.name}()  # TODO` : `    result = ${s.name}()  # TODO`, '    assert ' + (s.kind === 'class' ? 'obj' : 'result') + ' == ...  # TODO');
          if(s.kind !== 'class'){ lines.push('', '', `def test_${b}_${ident(L.edge)}():`, '    ...  # TODO');
            if(err) lines.push('', '', `def test_${b}_${ident(L.err)}():`, '    with pytest.raises(Exception):  # TODO: konkretny wyjątek', `        ${s.name}()  # TODO`); } }
      } else {
        lines.push('', '', `class Test${baseNoExt(node.path).replace(/(^|_)(\w)/g, (m, a, c) => c.toUpperCase())}(unittest.TestCase):`);
        for(const s of list){ const b = ident(s.name); lines.push(`    def test_${b}_${ident(L.typical)}(self):`, `        # ${cx(s)}`, '        self.assertEqual(..., ...)  # TODO', ''); }
        lines.push('', "if __name__ == '__main__':", '    unittest.main()');
      }
      code = lines.join('\n') + '\n';
    } else if(fam === 'go'){
      framework = 'testing';
      const pkg = (/^\s*package\s+(\w+)/m.exec(node.preview || '') || [0, 'main'])[1];
      const lines = head.slice(); lines.push(`package ${pkg}`, '', 'import "testing"');
      for(const s of list){ const nm = s.name.charAt(0).toUpperCase() + s.name.slice(1);
        lines.push('', `func Test${nm}(t *testing.T) {`, `\t// ${cx(s)}`, '\ttests := []struct {', '\t\tname string', '\t}{', `\t\t{"${L.typical}"},`, `\t\t{"${L.edge}"},`, '\t}',
          '\tfor _, tt := range tests {', '\t\tt.Run(tt.name, func(t *testing.T) {', '\t\t\t// TODO', '\t\t})', '\t}', '}'); }
      code = lines.join('\n') + '\n';
    } else if(fam === 'rs'){
      framework = 'cargo test';
      const lines = head.slice(); lines.push('#[cfg(test)]', 'mod tests {', '    use super::*;');
      for(const s of list) lines.push('', '    #[test]', `    fn ${ident(s.name)}_${ident(L.typical)}() {`, `        // ${cx(s)}`, '        // TODO', '    }');
      lines.push('}');
      code = lines.join('\n') + '\n';
    } else if(fam === 'java' || fam === 'kt'){
      framework = 'JUnit 5';
      const pkg = (/^\s*package\s+([\w.]+)/m.exec(node.preview || '') || [])[1], cls = baseNoExt(node.path);
      const lines = head.slice(); if(pkg) lines.push(`package ${pkg};`, '');
      lines.push('import org.junit.jupiter.api.Test;', 'import static org.junit.jupiter.api.Assertions.*;', '', `class ${cls}Test {`);
      for(const s of list) lines.push('', '    @Test', `    void ${s.name}_${ident(L.typical).replace(/_(\w)/g, (m, c) => c.toUpperCase())}() {`, `        // ${cx(s)}`, '        // TODO', '    }');
      lines.push('}');
      code = lines.join('\n') + '\n';
    } else {
      framework = null;
      code = head.concat(list.map(s => cmt + ' - ' + s.name + ': ' + cx(s))).join('\n') + '\n';
    }
    if(!list.length) code = head.concat([cmt + ' ' + L.none]).join('\n') + '\n';
    return {path, code, framework, symbols: list.map(s => s.name), convention: conv, note: hint};
  }

  function pyFramework(graph){
    for(const n of graph.nodes.values()){
      if(n.type !== 'file') continue;
      if(/(^|\/)conftest\.py$/.test(n.path) || /(^|\/)pytest\.ini$/.test(n.path)) return 'pytest';
      if(/(^|\/)(requirements[\w-]*\.txt|pyproject\.toml|setup\.cfg|tox\.ini)$/.test(n.path) && /\bpytest\b/.test(n.preview || '')) return 'pytest';
      if(n.isTest && /^\s*import pytest|^\s*from pytest\b/m.test(n.preview || '')) return 'pytest';
    }
    for(const n of graph.nodes.values()) if(n.isTest && /\bunittest\b/.test(n.preview || '')) return 'unittest';
    return 'pytest';
  }

  return {generate, convention, testPath, pickSymbols, jsFramework, pyFramework, relPath};
})();
