/* ===================== symbols-core.js — graf symboli z drzew tree-sittera (CM.SymbolsCore) =====================
   Czyste funkcje wspólne dla workera (js/symbols-worker.js), fallbacku na głównym wątku (js/symbols.js)
   i testów w Node: wybór gramatyki po języku pliku, przejście drzewa składni kursorem (definicje:
   funkcje, metody, klasy, struktury, interfejsy, enumy, traity/impl; wywołania w ich ciałach),
   analiza partii plików i rozwiązywanie wywołań na krawędzie symbol → symbol.
   Silnik: web-tree-sitter 0.22.6 + gramatyki z tree-sitter-wasms 0.1.12 (ABI 13/14) — ta para została
   sprawdzona na próbkach wszystkich 12 języków (tools/symbols-probe.mjs, test/symbols.test.mjs).
   Plik jest klasycznym skryptem: w stronie i w workerze dopisuje się do self.CM. */
(function(root){
  const CM = root.CM = root.CM || {};

  // klucz języka z CM.languages (węzeł.lang) → nazwa gramatyki w tree-sitter-wasms (out/tree-sitter-<nazwa>.wasm)
  const GRAMMAR_OF = {
    js:'javascript', mjs:'javascript', cjs:'javascript', jsx:'javascript',
    ts:'typescript', mts:'typescript', cts:'typescript', tsx:'tsx',
    py:'python', pyi:'python', pyw:'python',
    go:'go', java:'java', rs:'rust',
    c:'c', h:'cpp', cpp:'cpp', cc:'cpp', cxx:'cpp', hpp:'cpp', hh:'cpp', hxx:'cpp', ipp:'cpp',   // .h → C++ (nadzbiór C)
    cs:'c_sharp', php:'php', phtml:'php', rb:'ruby', rake:'ruby',
  };
  const GRAMMARS = Array.from(new Set(Object.values(GRAMMAR_OF)));
  function grammarFor(langKey, path){
    if(langKey && GRAMMAR_OF[langKey]) return GRAMMAR_OF[langKey];
    const ext = String(path||'').split('/').pop().split('.').pop().toLowerCase();
    return GRAMMAR_OF[ext] || null;
  }

  // ---- definicje: typ węzła → rodzaj symbolu ----
  const DEF = {
    function_declaration:'function', generator_function_declaration:'function', function_definition:'function',
    function_item:'function', function_signature_item:'function',
    method_definition:'method', method_declaration:'method', method:'method', singleton_method:'method',
    constructor_declaration:'constructor',
    class_declaration:'class', abstract_class_declaration:'class', class_definition:'class', class_specifier:'class',
    class:'class', record_declaration:'class',
    interface_declaration:'interface', trait_item:'trait', trait_declaration:'trait',
    struct_item:'struct', struct_specifier:'struct', struct_declaration:'struct',
    enum_declaration:'enum', enum_item:'enum', enum_specifier:'enum',
    type_alias_declaration:'type', type_spec:'type', impl_item:'impl', module:'module',
  };
  // JS/TS: `const f = () => …`, pola klas z funkcją (`handle = (e) => …`)
  const BOUND_FN = new Set(['variable_declarator', 'field_definition', 'public_field_definition']);
  const FUNC_VALUE = new Set(['arrow_function', 'function_expression', 'function', 'generator_function']);
  // C/C++: specyfikator bez ciała to użycie typu, nie definicja (`struct P p;`)
  const NEEDS_BODY = new Set(['struct_specifier', 'class_specifier', 'enum_specifier']);
  // funkcja zdefiniowana w takim kontenerze jest metodą (Python def w class, Rust fn w impl, C++ w class)
  const CONTAINER = new Set(['class', 'struct', 'impl', 'trait', 'interface', 'module']);

  // ---- wywołania: typ węzła → gdzie jest callee ----
  const CALL = new Set(['call_expression', 'call', 'new_expression', 'method_invocation', 'object_creation_expression',
    'invocation_expression', 'function_call_expression', 'member_call_expression', 'scoped_call_expression',
    'nullsafe_member_call_expression']);
  const ID_T = new Set(['identifier', 'property_identifier', 'private_property_identifier', 'field_identifier', 'type_identifier', 'name', 'constant',
    'shorthand_property_identifier', 'simple_identifier', 'namespace_identifier']);
  const SKIP = new Set(['this', 'super', 'self', 'Self', 'parent', 'static']);
  const KIND_CODE = { function:'FN', method:'MTH', constructor:'NEW', class:'CLS', interface:'IF', struct:'ST', enum:'EN',
    trait:'TR', impl:'IMP', type:'TY', module:'MOD' };

  const lastSeg = (s)=>{ s = String(s||'').replace(/<[\s\S]*$/, '').trim(); const p = s.split(/::|\.|->|\\/); return (p[p.length-1]||'').trim(); };

  // C/C++: nazwa funkcji siedzi na dnie łańcucha deklaratorów (pointer/reference/function/qualified)
  function declName(d){
    for(let i=0; i<10 && d; i++){
      const t = d.type;
      if(t==='identifier' || t==='field_identifier' || t==='type_identifier' || t==='destructor_name' || t==='operator_name') return d.text;
      if(t==='qualified_identifier' || t==='template_function'){ const nm = d.childForFieldName('name'); if(nm){ d = nm; continue; } return lastSeg(d.text); }
      d = d.childForFieldName('declarator') || d.firstNamedChild;
    }
    return '';
  }
  function nameOf(n){
    const t = n.type;
    if(t==='function_definition' && !n.childForFieldName('name')) return declName(n.childForFieldName('declarator'));   // C/C++
    if(t==='impl_item') return lastSeg(n.childForFieldName('type') ? n.childForFieldName('type').text : '');
    const nm = n.childForFieldName('name');
    return nm ? lastSeg(nm.text) : '';
  }
  function defOf(n, parentKind){
    const t = n.type;
    if(BOUND_FN.has(t)){
      const v = n.childForFieldName('value'); if(!v || !FUNC_VALUE.has(v.type)) return null;
      const nm = n.childForFieldName('name') || n.childForFieldName('property'); if(!nm) return null;
      return { name:lastSeg(nm.text), kind: t==='variable_declarator' ? (parentKind && CONTAINER.has(parentKind) ? 'method' : 'function') : 'method' };
    }
    let kind = DEF[t]; if(!kind) return null;
    if(NEEDS_BODY.has(t) && !n.childForFieldName('body')) return null;
    if(t==='type_spec'){ const ty = n.childForFieldName('type'); kind = ty && ty.type==='struct_type' ? 'struct' : (ty && ty.type==='interface_type' ? 'interface' : 'type'); }
    if(kind==='function' && parentKind && CONTAINER.has(parentKind)) kind = 'method';
    const name = nameOf(n);
    return name ? { name, kind } : null;
  }
  function calleeNode(n){
    switch(n.type){
      case 'call_expression': case 'invocation_expression': case 'function_call_expression': return n.childForFieldName('function');
      case 'call': return n.childForFieldName('method') || n.childForFieldName('function');   // Ruby | Python
      case 'new_expression': return n.childForFieldName('constructor');
      case 'method_invocation': case 'member_call_expression': case 'scoped_call_expression': case 'nullsafe_member_call_expression':
        return n.childForFieldName('name');
      case 'object_creation_expression': return n.childForFieldName('type') || n.firstNamedChild;
    }
    return null;
  }
  // `a.b.c()` → c, `new X()` → X, `std::max()` → max, `obj->run()` → run
  function calleeName(n, depth){
    depth = depth || 0;
    if(!n || depth > 6) return '';
    if(ID_T.has(n.type)) return n.text;
    const f = n.childForFieldName('property') || n.childForFieldName('field') || n.childForFieldName('attribute') || n.childForFieldName('name');
    if(f && f !== n) return calleeName(f, depth+1);
    const c = n.lastNamedChild; if(c && c !== n) return calleeName(c, depth+1);
    return '';
  }

  // Przejście drzewa kursorem (bez tworzenia obiektów dla każdego węzła) — węzeł materializujemy tylko,
  // gdy jego typ to definicja albo wywołanie. Wywołanie przypisujemy do najbliższej obejmującej definicji.
  const MAX_SYMS = 400, MAX_CALLS = 150;
  // wywołanie przez kropkę / ścieżkę (`obj.m()`, `Vec::new()`) — resolveCalls traktuje je inaczej niż gołą nazwę
  const MEMBER_T = new Set(['member_expression', 'attribute', 'field_expression', 'selector_expression', 'scoped_identifier',
    'qualified_identifier', 'member_access_expression', 'scoped_call_expression', 'member_call_expression', 'nullsafe_member_call_expression']);
  const isMemberCall = (n, callee)=> !!callee && (MEMBER_T.has(callee.type) || MEMBER_T.has(n.type) ||
    (n.type === 'method_invocation' && !!n.childForFieldName('object')) || (n.type === 'call' && !!n.childForFieldName('receiver')));
  // `this.m()` / `self.m()` — metoda tej klasy albo klasy bazowej (nie Map.get z biblioteki)
  const isSelfCall = (callee)=>{ const o = callee && callee.childForFieldName('object'); return !!o && (o.type === 'this' || (o.type === 'identifier' && o.text === 'self')); };
  function extract(tree){
    const syms = [], sets = [], bare = [], self = [];
    const cur = tree.walk();
    const visit = (owner)=>{
      const t = cur.nodeType;
      if(DEF[t] || BOUND_FN.has(t)){
        const node = cur.currentNode;
        const d = defOf(node, owner >= 0 ? syms[owner].kind : null);
        if(d && syms.length < MAX_SYMS){
          syms.push({ name:d.name, kind:d.kind, line:node.startPosition.row+1, endLine:node.endPosition.row+1, calls:[] });
          sets.push(new Set()); bare.push(new Set()); self.push(new Set());
          return syms.length - 1;
        }
      } else if(owner >= 0 && CALL.has(t)){
        const node = cur.currentNode, callee = calleeNode(node), nm = calleeName(callee);
        const s = syms[owner], seen = sets[owner];
        if(nm && nm.length <= 80 && !SKIP.has(nm)){
          if(!seen.has(nm) && s.calls.length < MAX_CALLS){ seen.add(nm); s.calls.push(nm); }
          if(seen.has(nm) && !isMemberCall(node, callee)) bare[owner].add(nm);
          else if(seen.has(nm) && isSelfCall(callee)) self[owner].add(nm);
        }
      }
      return owner;
    };
    const ownerAt = [visit(-1)];
    let depth = 0;
    outer: for(;;){
      if(cur.gotoFirstChild()){ depth++; ownerAt[depth] = visit(ownerAt[depth-1]); continue; }
      while(!cur.gotoNextSibling()){
        if(!cur.gotoParent()) break outer;
        depth--;
        if(depth < 0) break outer;
      }
      ownerAt[depth] = visit(depth > 0 ? ownerAt[depth-1] : -1);
    }
    cur.delete();
    // member = nazwy wołane wyłącznie przez kropkę (bez gołego wywołania), self = z nich przez this./self. — tylko gdy są
    syms.forEach((s, i)=>{
      const m = s.calls.filter((nm)=>!bare[i].has(nm)); if(m.length) s.member = m;
      const me = m.filter((nm)=>self[i].has(nm)); if(me.length) s.self = me;
    });
    return syms;
  }

  // Analiza partii plików: files = [{path, lang, content}], loadLanguage(grammar) → Promise<Language>.
  // hooks: {cancelled(): bool, onProgress(done,total): Promise|void}. Wynik: [{path, symbols}] (+ {path, error}).
  const MAX_CHARS = 300000;
  async function analyzeBatch(TS, files, loadLanguage, hooks){
    hooks = hooks || {};
    const parser = new TS(); const out = []; let lastLang = null;
    try{
      for(let i=0; i<files.length; i++){
        if(hooks.cancelled && hooks.cancelled()) break;
        const f = files[i]; const g = grammarFor(f.lang, f.path);
        if(g && f.content != null){
          try{
            const L = await loadLanguage(g);
            if(L){
              if(L !== lastLang){ parser.setLanguage(L); lastLang = L; }
              const src = f.content.length > MAX_CHARS ? f.content.slice(0, MAX_CHARS) : f.content;
              const tree = parser.parse(src);
              const symbols = extract(tree); tree.delete();
              if(symbols.length) out.push({ path:f.path, symbols });
            }
          }catch(e){ out.push({ path:f.path, error:String((e && e.message) || e) }); }
        }
        if(hooks.onProgress && (i % 20 === 19 || i === files.length-1)) await hooks.onProgress(i+1, files.length);
      }
    } finally { try{ parser.delete(); }catch(e){ /* parser już zwolniony */ } }
    return out;
  }

  // metody wbudowane (Map, Array, Promise, DOM, console…): `x.get()` przez import nie wskazuje naszej definicji `get`
  const BUILTIN_METHODS = new Set(('get set has delete add clear push pop shift unshift splice slice concat map filter forEach reduce ' +
    'find findIndex some every includes indexOf join split replace trim then catch finally call apply bind toString valueOf keys ' +
    'values entries assign freeze from of warn log error info debug postMessage addEventListener removeEventListener ' +
    'dispatchEvent querySelector querySelectorAll appendChild removeChild setAttribute getAttribute setProperty emit on off once ' +
    'next return throw resolve reject test exec match write read close open send sort reverse fill flat flatMap').split(' '));

  // Rozwiązywanie wywołań: nazwa → definicja w tym samym pliku (inna niż wołający; rekurencja nie daje krawędzi),
  // inaczej w plikach importowanych przez ten plik (kolejność importów), inaczej pomijana. importsOf(path) → [path…]
  // albo [{path, names}] (names z klauzul importu, CM.Analysis): gołe wywołanie `f()` idzie przez import tylko, gdy f
  // jest importowane z tego pliku (albo '*' / 'default' / brak wiedzy); wywołanie przez kropkę (`x.m()`, s.member) —
  // przez każdy import, ale bez nazw metod wbudowanych. perFile = [{path, symbols:[{id, name, calls, member?}]}].
  // Wynik: [{source, target}].
  function resolveCalls(perFile, importsOf){
    const byFile = new Map();
    for(const f of perFile){
      const m = new Map();
      for(const s of f.symbols){ if(!m.has(s.name)) m.set(s.name, []); m.get(s.name).push(s.id); }
      byFile.set(f.path, m);
    }
    const edges = [], seen = new Set();
    for(const f of perFile){
      const local = byFile.get(f.path); const imps = (importsOf ? importsOf(f.path) : null) || [];
      for(const s of f.symbols){
        const member = new Set(s.member || []), self = new Set(s.self || []);
        for(const name of (s.calls || [])){
          // `map.get()`, `arr.push()` — metoda wbudowana, nie nasza definicja (także w tym samym pliku); `this.get()` — tak
          if(member.has(name) && !self.has(name) && BUILTIN_METHODS.has(name)) continue;
          const l = local.get(name); let tgt = null;
          if(l) tgt = l.find((id)=>id !== s.id) || null;
          // lokalnie tylko sam wołający (rekurencja albo metoda-owijka `m(){ m(x) }`): import tylko jawnie z tą nazwą
          const selfOnly = !!l && !tgt;
          if(!tgt) for(const imp of imps){
            const p = typeof imp === 'string' ? imp : imp.path, names = typeof imp === 'string' ? null : imp.names;
            const c = byFile.get(p) && byFile.get(p).get(name); if(!c || !c.length) continue;
            if(selfOnly && !(names && names.includes(name))) continue;
            if(member.has(name)){ /* przez kropkę: każdy import (wbudowane odfiltrowane wyżej) */ }
            else if(names && !names.includes(name) && !names.includes('*') && !names.includes('default')) continue;
            tgt = c[0]; break;
          }
          if(!tgt) continue;
          const k = s.id + '|' + tgt; if(seen.has(k)) continue; seen.add(k);
          edges.push({ source:s.id, target:tgt });
        }
      }
    }
    return edges;
  }

  CM.SymbolsCore = { GRAMMAR_OF, GRAMMARS, KIND_CODE, grammarFor, extract, analyzeBatch, resolveCalls,
    symbolId: (path, s)=>path + '#' + s.name + '@' + s.line };
})(typeof self !== 'undefined' ? self : this);
