/* ===================== doctor-ui.js — wejścia do „Doktora hotspotów" (doctor.js + ChatBot) ===================== */
// Sekcja w panelu szczegółów pliku z kodem: miejsce w rankingu ryzyka i przycisk „🩺 Plan refaktoryzacji", który otwiera
// ChatBota z nową rozmową (CM.ChatBot.diagnose). Akcja ChatBota `hotspotDoctor {query?}` — bez argumentu bierze
// plik z czoła rankingu hotspotów. Sama kartoteka i prompt: doctor.js (czyste, testowane w Node).
// „🧪 Szkielet testów” (faza 11): plik testów wg konwencji projektu z CM.TestGen — okno z kodem, kopiowaniem
// i pobraniem; akcja `testSkeleton {query?}` (bez argumentu: najwyższy w rankingu plik bez testów).
(function(){
  const A=CM.App, U=CM.util, el=U.el, I=CM.i18n, D=CM.Doctor;
  const STR={
    pl:{'doc.title':'Doktor hotspotów','doc.btn':'🩺 Plan refaktoryzacji','doc.hint':'Diagnoza, plan małych kroków z cytatami kodu, testy przed zmianą i ryzyko — liczone modelem lokalnym (kod nie wychodzi z komputera).',
      'doc.rank':'Ryzyko: #{r} z {n} plików','doc.run':'Doktor bada: ','doc.none':'Nie znalazłem pliku z treścią do zbadania.',
      'doc.tg':'🧪 Szkielet testów','doc.tgHint':'Plik testów wg konwencji projektu: framework, położenie, import, przypadki od najbardziej złożonych funkcji — bez modelu.',
      'doc.tgTitle':'Szkielet testów','doc.tgPath':'Proponowany plik','doc.tgFw':'framework','doc.tgConv':'konwencja z projektu','doc.tgDef':'konwencja domyślna dla języka',
      'doc.tgCopy':'Kopiuj','doc.tgCopied':'Skopiowano','doc.tgSave':'Pobierz plik','doc.tgInline':'Wklej na koniec pliku źródłowego (moduł testów w tym samym pliku).','doc.tgRun':'Szkielet testów: '},
    en:{'doc.title':'Hotspot doctor','doc.btn':'🩺 Refactoring plan','doc.hint':'Diagnosis, a plan of small steps with code citations, tests before the change and the risk — computed by a local model (the code never leaves your computer).',
      'doc.rank':'Risk: #{r} of {n} files','doc.run':'Doctor examines: ','doc.none':'No file with content to examine.',
      'doc.tg':'🧪 Test skeleton','doc.tgHint':'A test file following the project conventions: framework, location, import, cases from the most complex functions — no model.',
      'doc.tgTitle':'Test skeleton','doc.tgPath':'Proposed file','doc.tgFw':'framework','doc.tgConv':'convention from the project','doc.tgDef':'default convention for the language',
      'doc.tgCopy':'Copy','doc.tgCopied':'Copied','doc.tgSave':'Download file','doc.tgInline':'Append to the end of the source file (a test module in the same file).','doc.tgRun':'Test skeleton: '}};
  I.extend('pl', STR.pl); I.extend('en', STR.en);
  const t=(k)=>I.t(k, STR.pl[k]);
  const isCode=(n)=>n && n.type==='file' && n.preview!=null && !n.isTest && (n.metrics&&n.metrics.complexity>0 || (CM.TestMap&&CM.TestMap.isCodeFile(n.path||n.id)));

  if(CM.UI && CM.UI.addDetailSection) CM.UI.addDetailSection((node, g)=>{
    if(!node || !g || !D || !isCode(node) || (node.gid && node.gid!=='base')) return null;
    const sec=el('div',{class:'det-section det-doctor'});
    sec.appendChild(el('h5',{}, t('doc.title')));
    const rank=D.ranking(g, CM.GitCore), pos=rank.indexOf(node);
    if(pos>=0) sec.appendChild(el('span',{class:'tag'+(pos<5?' doc-hot':''), text:t('doc.rank').replace('{r}', pos+1).replace('{n}', rank.length)}));
    sec.appendChild(el('button',{class:'tb-btn primary doc-btn', type:'button', text:t('doc.btn'), title:t('doc.hint'), onclick:()=>{ if(CM.ChatBot) CM.ChatBot.diagnose(node.path); }}));
    sec.appendChild(el('div',{class:'muted small', text:t('doc.hint')}));
    if(CM.TestGen && !(node.testedBy && node.testedBy.length)) sec.appendChild(el('button',{class:'tb-btn doc-btn doc-tg', type:'button', text:t('doc.tg'), title:t('doc.tgHint'), onclick:()=>skeleton(node)}));
    return sec;
  });

  function skeleton(node){
    const r=CM.TestGen.generate(A.graph, node, {lang:I.getLang&&I.getLang()==='en'?'en':'pl'});
    const dlg=CM.UIKit.modal('modal-testgen','share-modal tg-modal','tg').title(t('doc.tgTitle')+' — '+node.name); dlg.clear();
    const inline=r.path===node.path;
    dlg.body.appendChild(el('div',{class:'tg-meta'}, el('span',{class:'muted small',text:t('doc.tgPath')+': '}), el('code',{text:r.path}),
      r.framework?el('span',{class:'tag',text:t('doc.tgFw')+': '+r.framework}):null, el('span',{class:'muted small',text:' · '+(r.convention&&r.convention.fromProject?t('doc.tgConv'):t('doc.tgDef'))})));
    if(inline) dlg.body.appendChild(el('div',{class:'muted small',text:t('doc.tgInline')}));
    const pre=el('pre',{class:'tg-code hl'});
    try{ U.setHTML(pre, (CM.UI&&CM.UI.highlight)?CM.UI.highlight(r.code, node.lang||node.ext):U.escapeHtml(r.code)); }catch(e){ pre.textContent=r.code; }   // kolorowanie escapuje treść
    dlg.body.appendChild(pre);
    const copy=el('button',{class:'tb-btn',type:'button',text:t('doc.tgCopy'),onclick:async()=>{ try{ await navigator.clipboard.writeText(r.code); copy.textContent=t('doc.tgCopied'); }catch(e){ if(U.toast) U.toast(e.message,'error'); } }});
    const save=el('button',{class:'tb-btn primary',type:'button',text:t('doc.tgSave'),onclick:()=>{
      const url=URL.createObjectURL(new Blob([r.code],{type:'text/plain'})), a=el('a',{href:url, download:r.path.slice(r.path.lastIndexOf('/')+1)});
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 1000); }});
    dlg.foot.appendChild(copy); dlg.foot.appendChild(save);
    dlg.open();
    return r;
  }

  if(A.registerAction) A.registerAction({name:'hotspotDoctor', sig:'{query?}',
    desc:'refactoring plan for a file (default: the top hotspot) — diagnosis, small steps citing the code, tests to add first, risk; local models only',
    descPl:'Doktor hotspotów — plan refaktoryzacji pliku (domyślnie z czoła hotspotów)', auto:false,
    run:(a)=>{ if(!A.graph) throw new Error(I.t('cb.noProject','Najpierw wczytaj projekt (CodeMap).'));
      const q=a&&(a.query||a.path||a.file), n=q?D.find(A.graph, q):D.top(A.graph, CM.GitCore);
      if(!n || n.preview==null) throw new Error(t('doc.none'));
      setTimeout(()=>{ if(CM.ChatBot) CM.ChatBot.diagnose(n.path); }, 0);
      return t('doc.run')+n.path; }});
  if(A.registerAction) A.registerAction({name:'testSkeleton', sig:'{query?}',
    desc:'generate a test file skeleton for a code file following the project conventions (framework, location, imports, cases ordered by complexity) — no model; default: the highest-risk file without tests',
    descPl:'Szkielet testów dla pliku (konwencje projektu, bez modelu); domyślnie najbardziej ryzykowny plik bez testów', auto:true,
    run:(a)=>{ if(!A.graph) throw new Error(I.t('cb.noProject','Najpierw wczytaj projekt (CodeMap).'));
      const q=a&&(a.query||a.path||a.file);
      const n=q?D.find(A.graph, q):D.ranking(A.graph, CM.GitCore).find(x=>isCode(x) && !(x.testedBy&&x.testedBy.length));
      if(!n || !isCode(n)) throw new Error(t('doc.none'));
      if(A.focusNode) A.focusNode(n.id);
      const r=skeleton(n);
      return t('doc.tgRun')+r.path+(r.framework?' ('+r.framework+')':'')+' — '+r.symbols.join(', '); }});
})();
