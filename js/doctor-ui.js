/* ===================== doctor-ui.js — wejścia do „Doktora hotspotów" (doctor.js + ChatBot) ===================== */
// Sekcja w panelu szczegółów pliku z kodem: miejsce w rankingu ryzyka i przycisk „🩺 Plan refaktoryzacji", który otwiera
// ChatBota z nową rozmową (CM.ChatBot.diagnose). Akcja ChatBota `hotspotDoctor {query?}` — bez argumentu bierze
// plik z czoła rankingu hotspotów. Sama kartoteka i prompt: doctor.js (czyste, testowane w Node).
(function(){
  const A=CM.App, U=CM.util, el=U.el, I=CM.i18n, D=CM.Doctor;
  const STR={
    pl:{'doc.title':'Doktor hotspotów','doc.btn':'🩺 Plan refaktoryzacji','doc.hint':'Diagnoza, plan małych kroków z cytatami kodu, testy przed zmianą i ryzyko — liczone modelem lokalnym (kod nie wychodzi z komputera).',
      'doc.rank':'Ryzyko: #{r} z {n} plików','doc.run':'Doktor bada: ','doc.none':'Nie znalazłem pliku z treścią do zbadania.'},
    en:{'doc.title':'Hotspot doctor','doc.btn':'🩺 Refactoring plan','doc.hint':'Diagnosis, a plan of small steps with code citations, tests before the change and the risk — computed by a local model (the code never leaves your computer).',
      'doc.rank':'Risk: #{r} of {n} files','doc.run':'Doctor examines: ','doc.none':'No file with content to examine.'}};
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
    return sec;
  });

  if(A.registerAction) A.registerAction({name:'hotspotDoctor', sig:'{query?}',
    desc:'refactoring plan for a file (default: the top hotspot) — diagnosis, small steps citing the code, tests to add first, risk; local models only',
    descPl:'Doktor hotspotów — plan refaktoryzacji pliku (domyślnie z czoła hotspotów)', auto:false,
    run:(a)=>{ if(!A.graph) throw new Error(I.t('cb.noProject','Najpierw wczytaj projekt (CodeMap).'));
      const q=a&&(a.query||a.path||a.file), n=q?D.find(A.graph, q):D.top(A.graph, CM.GitCore);
      if(!n || n.preview==null) throw new Error(t('doc.none'));
      setTimeout(()=>{ if(CM.ChatBot) CM.ChatBot.diagnose(n.path); }, 0);
      return t('doc.run')+n.path; }});
})();
