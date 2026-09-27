// Sonda grafu symboli na PRAWDZIWYM tree-sitterze (web-tree-sitter + gramatyki z tree-sitter-wasms z
// devDependencies): parsuje próbki 12 języków przez js/symbols-core.js i sprawdza, że definicje
// i wywołania zostały znalezione. Bez zainstalowanych pakietów kończy się komunikatem „pominięto".
//   node tools/symbols-probe.mjs            (—verbose: wypisz symbole)
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const NM = join(ROOT, 'node_modules');
const require = createRequire(import.meta.url);
const verbose = process.argv.includes('--verbose');

export const SAMPLES = {
  js: { src: "class A { m(a){ return this.b(a) + helper(a); } b(x){ return x; } }\nfunction helper(q){ return new Foo(q).run(); }\nconst arrow = (z) => helper(z);\n",
    defs: ['A:class', 'm:method', 'b:method', 'helper:function', 'arrow:function'], calls: { m: ['b', 'helper'], helper: ['Foo', 'run'], arrow: ['helper'] } },
  ts: { src: "interface I { a(): void }\nenum E { A }\ntype T = string;\nexport class K implements I { a(){ go(); } }\nexport function go(): number { return util.x(1); }\n",
    defs: ['I:interface', 'E:enum', 'T:type', 'K:class', 'a:method', 'go:function'], calls: { a: ['go'], go: ['x'] } },
  tsx: { src: "export function App(){ const [s] = useState(0); return <div onClick={() => handle(s)} />; }\nfunction handle(v){ log(v); }\n",
    defs: ['App:function', 'handle:function'], calls: { App: ['useState', 'handle'], handle: ['log'] } },
  py: { src: "class C:\n    def m(self):\n        return helper(self.x) + os.path.join('a')\n\ndef helper(v):\n    return C().m()\n",
    defs: ['C:class', 'm:method', 'helper:function'], calls: { m: ['helper', 'join'], helper: ['C', 'm'] } },
  go: { src: "package main\ntype S struct{ a int }\ntype I interface{ M() }\nfunc (s S) M() { helper(s.a); fmt.Println(1) }\nfunc helper(x int) int { return x }\n",
    defs: ['S:struct', 'I:interface', 'M:method', 'helper:function'], calls: { M: ['helper', 'Println'] } },
  java: { src: "public class A { public A(){ init(); } void init(){ Helper.run(new B()); } }\ninterface X { void y(); }\nenum E { A }\n",
    defs: ['A:class', 'A:constructor', 'init:method', 'X:interface', 'E:enum'], calls: { init: ['run', 'B'] } },
  rs: { src: "struct S { a: i32 }\nenum E { A }\ntrait T { fn t(&self); }\nimpl T for S { fn t(&self) { helper(self.a); Vec::new(); self.go(); } }\nfn helper(x: i32) -> i32 { x }\n",
    defs: ['S:struct', 'E:enum', 'T:trait', 'S:impl', 't:method', 'helper:function'], calls: { t: ['helper', 'new', 'go'] } },
  c: { src: "struct P { int x; };\nenum K { A };\nstatic int helper(int a){ return a; }\nint main(void){ helper(1); printf(\"x\"); return 0; }\n",
    defs: ['P:struct', 'K:enum', 'helper:function', 'main:function'], calls: { main: ['helper', 'printf'] } },
  cpp: { src: "namespace n { class A { public: void m(); }; }\nvoid n::A::m(){ helper(); obj.run(); }\nstruct S { int x; };\nint helper(){ return std::max(1,2); }\n",
    defs: ['A:class', 'm:function', 'S:struct', 'helper:function'], calls: { m: ['helper', 'run'], helper: ['max'] } },
  cs: { src: "namespace N { public class A { public A(){ Init(); } void Init(){ Helper.Run(new B()); } } interface I { void Y(); } struct S {} enum E { A } }\n",
    defs: ['A:class', 'A:constructor', 'Init:method', 'I:interface', 'S:struct', 'E:enum'], calls: { A: ['Init'], Init: ['Run', 'B'] } },
  php: { src: "<?php\nfunction helper($a){ return strlen($a); }\nclass A { public function m(){ $this->go(); helper(1); B::s(); new C(); } }\ninterface I {}\ntrait T {}\n",
    defs: ['helper:function', 'A:class', 'm:method', 'I:interface', 'T:trait'], calls: { helper: ['strlen'], m: ['go', 'helper', 's', 'C'] } },
  rb: { src: "module M\n  class A\n    def m\n      helper(1)\n      obj.run\n    end\n    def self.s; end\n  end\nend\ndef helper(x) = x\n",
    defs: ['M:module', 'A:class', 'm:method', 's:method', 'helper:method'], calls: { m: ['helper', 'run'] } },
};

export async function loadTreeSitter() {
  if (!existsSync(join(NM, 'web-tree-sitter')) || !existsSync(join(NM, 'tree-sitter-wasms', 'out'))) return null;
  const Parser = require(join(NM, 'web-tree-sitter'));
  await Parser.init();
  const cache = new Map();
  const load = (g) => { if (!cache.has(g)) cache.set(g, Parser.Language.load(join(NM, 'tree-sitter-wasms', 'out', 'tree-sitter-' + g + '.wasm'))); return cache.get(g); };
  return { Parser, load };
}

export function loadCore() {
  const g = {}; g.self = g; g.window = g;
  const ctx = vm.createContext(g);
  vm.runInContext(readFileSync(join(ROOT, 'js', 'symbols-core.js'), 'utf8'), ctx, { filename: 'js/symbols-core.js' });
  return ctx.CM.SymbolsCore;
}

/** Sprawdza jedną próbkę: brakujące definicje i brakujące wywołania (lista komunikatów). */
export function checkSample(key, sample, symbols) {
  const problems = [];
  const have = new Set(symbols.map((s) => s.name + ':' + s.kind));
  for (const d of sample.defs) if (!have.has(d)) problems.push(`brak definicji ${d}`);
  for (const [fn, calls] of Object.entries(sample.calls)) {
    // ta sama nazwa może wystąpić kilka razy (Rust: sygnatura w traicie + implementacja w impl) — wystarczy jeden kandydat
    const cands = symbols.filter((x) => x.name === fn);
    if (!cands.length) { problems.push(`brak symbolu ${fn} dla wywołań`); continue; }
    const best = cands.reduce((a, b) => (b.calls.length > a.calls.length ? b : a));
    for (const c of calls) if (!best.calls.includes(c)) problems.push(`${fn} nie woła ${c} (ma: ${best.calls.join(', ')})`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ts = await loadTreeSitter();
  if (!ts) { console.log('– symbols-probe: pominięto (brak web-tree-sitter / tree-sitter-wasms w node_modules)'); } else {
  const Core = loadCore();
  let failed = 0;
  for (const [key, sample] of Object.entries(SAMPLES)) {
    const res = await Core.analyzeBatch(ts.Parser, [{ path: 'x.' + key, lang: key, content: sample.src }], ts.load, {});
    const r = res[0] || { symbols: [] };
    if (r.error) { console.log(`✖ ${key}: ${r.error}`); failed++; continue; }
    const problems = checkSample(key, sample, r.symbols);
    console.log(`${problems.length ? '✖' : '✔'} ${key.padEnd(4)} ${Core.grammarFor(key).padEnd(10)} ${r.symbols.length} symboli, ${r.symbols.reduce((a, s) => a + s.calls.length, 0)} wywołań${problems.length ? '\n   ' + problems.join('\n   ') : ''}`);
    if (verbose) for (const s of r.symbols) console.log(`     ${s.kind.padEnd(11)} ${s.name}  L${s.line}-${s.endLine}  → ${s.calls.join(', ')}`);
    if (problems.length) failed++;
  }
  // exitCode zamiast process.exit(): Node 26 na Windows z modułem WASM (emscripten) potrafi zakończyć
  // twarde exit() asercją libuv (UV_HANDLE_CLOSING) — naturalne wyjście z pętli zdarzeń jest czyste.
  process.exitCode = failed ? 1 : 0;
  }
}
