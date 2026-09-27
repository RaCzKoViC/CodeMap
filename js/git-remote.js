/* ===================== git-remote.js — historia commitów z API GitHub / GitLab / Bitbucket ===================== */
// Repozytorium wczytane z adresu URL nie ma katalogu .git, więc historię bierzemy z API hostingu: lista
// commitów (100 na stronę) + szczegóły zmienionych plików per commit (1 zapytanie na commit). Limit
// zapytań bez tokenu jest mały (GitHub i Bitbucket: 60/h), dlatego szczegóły pobieramy dla NAJNOWSZYCH
// commitów w ramach budżetu, a resztę zostawiamy bez listy plików (liczą się dla autorów, nie dla plików).
// Wynik ma format git-local.js: {head, commits:[…najnowsze pierwsze], stats}.
CM.GitRemote = (function(){
  const T=(k,f)=>(CM.i18n&&CM.i18n.t)?CM.i18n.t(k,f):f;
  const ms=(d)=>{ const t=Date.parse(d); return Number.isFinite(t)?t:0; };
  function cancelled(){ const e=new Error(T('git.cancelled','Anulowano.')); e.code='cancelled'; return e; }
  function pMap(list, fn, conc){ return CM.util&&CM.util.pMap ? CM.util.pMap(list, fn, conc) : Promise.all(list.map(fn)); }

  // wspólne: fetch z anulowaniem, śledzenie limitu, czytelne błędy
  function client(headers, signal, rate){
    return async (url)=>{
      if(signal&&signal.aborted) throw cancelled();
      let r;
      try{ r=await fetch(url,{headers, signal}); }
      catch(e){ if(signal&&signal.aborted) throw cancelled(); throw new Error(T('git.net','Brak połączenia z API repozytorium.')); }
      const rem=r.headers.get('x-ratelimit-remaining')||r.headers.get('ratelimit-remaining');
      if(rem!=null && rem!=='') rate.remaining=+rem;
      if(r.status===403||r.status===429){ rate.limited=true; const e=new Error(T('git.rate','Wyczerpany limit zapytań API — dodaj token (Wczytaj → repozytorium), aby pobrać pełną historię.')); e.code='rate'; throw e; }
      if(r.status===401){ const e=new Error(T('git.auth','API odrzuciło token (401).')); e.code='auth'; throw e; }
      if(r.status===404){ const e=new Error(T('git.notFound','API: nie znaleziono repozytorium lub gałęzi (404).')); e.code='404'; throw e; }
      if(r.status===409) return [];   // puste repozytorium
      if(!r.ok){ const e=new Error('API: HTTP '+r.status); e.code='http'; throw e; }
      return r.json();
    };
  }
  // szczegóły dla najnowszych commitów w budżecie; błąd limitu kończy pobieranie, zostaje to, co już jest
  async function details(commits, budget, fetchFiles, onProgress, signal){
    const want=commits.filter(c=>!c.merge).slice(0, Math.max(0,budget));
    let done=0, stop=null;
    await pMap(want, async (c)=>{
      if(stop || (signal&&signal.aborted)) return;
      try{ c.files=await fetchFiles(c); delete c.nofiles; }
      catch(e){ if(e.code==='cancelled'||e.code==='rate'||e.code==='auth') stop=stop||e; }
      done++; if(onProgress) onProgress({phase:'details', done, total:want.length});
    }, 6);
    if(signal&&signal.aborted) throw cancelled();
    return {detailed:want.filter(c=>!c.nofiles).length, stopped:stop};
  }
  const STATUS_GH={added:'A', removed:'D', modified:'M', changed:'M', renamed:'R', copied:'A'};

  // ---------------- GitHub ----------------
  async function github(meta, o){
    const rate={remaining:null, limited:false};
    const h={'Accept':'application/vnd.github+json'}; if(o.token) h['Authorization']='Bearer '+o.token;
    const get=client(h, o.signal, rate), api='https://api.github.com/repos/'+meta.repo;
    const sub=meta.sub?'&path='+encodeURIComponent(String(meta.sub).replace(/\/$/,'')):'';
    const commits=[]; let page=1;
    while(commits.length<o.max){
      const arr=await get(api+'/commits?sha='+encodeURIComponent(meta.branch||'HEAD')+'&per_page=100&page='+page+sub);
      if(!Array.isArray(arr)||!arr.length) break;
      for(const x of arr){ const c=x.commit||{};
        commits.push({sha:x.sha, parents:(x.parents||[]).map(p=>p.sha), merge:(x.parents||[]).length>1, boundary:false,
          author:{name:(c.author&&c.author.name)||'', email:(c.author&&c.author.email)||'', login:x.author&&x.author.login||null, avatar:x.author&&x.author.avatar_url||null},
          authorTime:ms(c.author&&c.author.date), committer:{name:(c.committer&&c.committer.name)||'', email:(c.committer&&c.committer.email)||''}, time:ms(c.committer&&c.committer.date),
          message:String(c.message||'').split('\n')[0], files:[], nofiles:true}); }
      if(o.onProgress) o.onProgress({phase:'list', done:commits.length, total:o.max});
      if(arr.length<100) break; page++;
    }
    commits.splice(o.max);   // strona ma 100 commitów — nie więcej niż max
    const budget=Math.min(o.maxDetails!=null?o.maxDetails:(o.token?500:50), rate.remaining!=null?Math.max(0,rate.remaining-2):Infinity);
    const d=await details(commits, budget, async (c)=>{
      const x=await get(api+'/commits/'+c.sha);
      return (x.files||[]).map(f=>{ const s=STATUS_GH[f.status]||'M'; const r={path:f.filename, status:s, add:f.additions||0, del:f.deletions||0};
        if(s==='R'&&f.previous_filename) r.from=f.previous_filename; return r; });
    }, o.onProgress, o.signal);
    return {head:{ref:meta.branch?'refs/heads/'+meta.branch:null, sha:commits[0]&&commits[0].sha||null}, commits,
      stats:{listed:commits.length, detailed:d.detailed, truncated:commits.length>=o.max, rateLimited:rate.limited||(d.stopped&&d.stopped.code==='rate'), remaining:rate.remaining, stopped:d.stopped&&d.stopped.message}};
  }

  // ---------------- GitLab ----------------
  function diffLines(diff){ let add=0, del=0; for(const ln of String(diff||'').split('\n')){ if(ln.startsWith('+++')||ln.startsWith('---')) continue; if(ln[0]==='+') add++; else if(ln[0]==='-') del++; } return {add, del}; }
  async function gitlab(meta, o){
    const rate={remaining:null, limited:false};
    const h={}; if(o.token) h['PRIVATE-TOKEN']=o.token;
    const get=client(h, o.signal, rate), api='https://gitlab.com/api/v4/projects/'+encodeURIComponent(meta.repo)+'/repository';
    const sub=meta.sub?'&path='+encodeURIComponent(String(meta.sub).replace(/\/$/,'')):'';
    const commits=[]; let page=1;
    while(commits.length<o.max){
      const arr=await get(api+'/commits?ref_name='+encodeURIComponent(meta.branch||'')+'&per_page=100&page='+page+sub);
      if(!Array.isArray(arr)||!arr.length) break;
      for(const x of arr) commits.push({sha:x.id, parents:x.parent_ids||[], merge:(x.parent_ids||[]).length>1, boundary:false,
        author:{name:x.author_name||'', email:x.author_email||''}, authorTime:ms(x.authored_date),
        committer:{name:x.committer_name||'', email:x.committer_email||''}, time:ms(x.committed_date),
        message:String(x.title||x.message||'').split('\n')[0], files:[], nofiles:true});
      if(o.onProgress) o.onProgress({phase:'list', done:commits.length, total:o.max});
      if(arr.length<100) break; page++;
    }
    commits.splice(o.max);
    const d=await details(commits, o.maxDetails!=null?o.maxDetails:300, async (c)=>{
      const out=[];
      for(let p=1;p<=5;p++){
        const arr=await get(api+'/commits/'+c.sha+'/diff?per_page=100&page='+p);
        if(!Array.isArray(arr)) break;
        for(const f of arr){ const {add,del}=diffLines(f.diff);
          const s=f.new_file?'A':f.deleted_file?'D':f.renamed_file?'R':'M';
          const r={path:s==='D'?f.old_path:f.new_path, status:s, add, del}; if(s==='R') r.from=f.old_path; out.push(r); }
        if(arr.length<100) break;
      }
      return out;
    }, o.onProgress, o.signal);
    return {head:{ref:meta.branch?'refs/heads/'+meta.branch:null, sha:commits[0]&&commits[0].sha||null}, commits,
      stats:{listed:commits.length, detailed:d.detailed, truncated:commits.length>=o.max, rateLimited:rate.limited||(d.stopped&&d.stopped.code==='rate'), remaining:rate.remaining, stopped:d.stopped&&d.stopped.message}};
  }

  // ---------------- Bitbucket ----------------
  function parseRaw(raw){ const m=/^\s*(.*?)\s*<([^>]*)>\s*$/.exec(String(raw||'')); return m?{name:m[1], email:m[2]}:{name:String(raw||'').trim(), email:''}; }
  async function bitbucket(meta, o){
    const rate={remaining:null, limited:false};
    const h={}; if(o.token) h['Authorization']='Bearer '+o.token;
    const get=client(h, o.signal, rate), api='https://api.bitbucket.org/2.0/repositories/'+meta.repo;
    const commits=[]; let next=api+'/commits/'+encodeURIComponent(meta.branch||'')+'?pagelen=100', guard=0;
    while(next && commits.length<o.max && guard++<50){
      const j=await get(next);
      for(const x of (j.values||[])){ const a=parseRaw(x.author&&x.author.raw), u=x.author&&x.author.user;
        commits.push({sha:x.hash, parents:(x.parents||[]).map(p=>p.hash), merge:(x.parents||[]).length>1, boundary:false,
          author:{name:a.name||(u&&u.display_name)||'', email:a.email, login:u&&u.nickname||null, avatar:u&&u.links&&u.links.avatar&&u.links.avatar.href||null},
          authorTime:ms(x.date), committer:{name:a.name, email:a.email}, time:ms(x.date),
          message:String(x.message||'').split('\n')[0], files:[], nofiles:true}); }
      if(o.onProgress) o.onProgress({phase:'list', done:commits.length, total:o.max});
      next=j.next||null;
    }
    commits.splice(o.max);
    const d=await details(commits, o.maxDetails!=null?o.maxDetails:(o.token?300:40), async (c)=>{
      const out=[]; let u=api+'/diffstat/'+c.sha+'?pagelen=100', g=0;
      while(u && g++<5){ const j=await get(u);
        for(const f of (j.values||[])){ const s={added:'A', removed:'D', modified:'M', renamed:'R'}[f.status]||'M';
          const r={path:(s==='D'?(f.old&&f.old.path):(f.new&&f.new.path))||'', status:s, add:f.lines_added||0, del:f.lines_removed||0};
          if(s==='R'&&f.old) r.from=f.old.path; if(r.path) out.push(r); }
        u=j.next||null; }
      return out;
    }, o.onProgress, o.signal);
    // Bitbucket nie filtruje po ścieżce po stronie serwera — podkatalog odcina git-core.rebase()
    return {head:{ref:meta.branch?'refs/heads/'+meta.branch:null, sha:commits[0]&&commits[0].sha||null}, commits,
      stats:{listed:commits.length, detailed:d.detailed, truncated:commits.length>=o.max, rateLimited:rate.limited||(d.stopped&&d.stopped.code==='rate'), remaining:rate.remaining, stopped:d.stopped&&d.stopped.message}};
  }

  // ---------------- pull / merge requesty (faza 5: mapa wpływu PR) ----------------
  // → {pr:{number, title, state, draft, url, author:{login, name, avatar}, base, head}, files:[{path, status, add, del, from?}], truncated}
  async function fetchPR(meta, number, opts){
    opts=opts||{}; const n=Math.floor(+number); if(!supported(meta)||!(n>0)) throw new Error(T('git.prBad','Podaj numer PR w repozytorium z GitHub / GitLab / Bitbucket.'));
    const rate={remaining:null, limited:false}, sig=opts.signal;
    // łatki (unified diff) do asystenta przeglądu i widoku przed/po — z limitem: 12 KB na plik, 200 KB na PR
    let ptot=0; const cap=(d)=>{ if(!d || ptot>=200000) return undefined; const x=String(d).slice(0,12000); ptot+=x.length; return x; };
    if(meta.host==='gitlab'){
      const h={}; if(opts.token) h['PRIVATE-TOKEN']=opts.token;
      const get=client(h, sig, rate), api='https://gitlab.com/api/v4/projects/'+encodeURIComponent(meta.repo)+'/merge_requests/'+n;
      const m=await get(api); const files=[];
      let list=null; try{ const ch=await get(api+'/changes'); list=ch&&ch.changes; }catch(e){ if(e.code==='cancelled') throw e; }
      if(!list){ list=[]; for(let p=1;p<=30;p++){ const arr=await get(api+'/diffs?per_page=100&page='+p); if(!Array.isArray(arr)||!arr.length) break; list.push(...arr); if(arr.length<100) break; } }
      for(const f of list){ const {add,del}=diffLines(f.diff); const s=f.new_file?'A':f.deleted_file?'D':f.renamed_file?'R':'M';
        const r={path:s==='D'?f.old_path:f.new_path, status:s, add, del}; if(s==='R') r.from=f.old_path; const pt=cap(f.diff); if(pt) r.patch=pt; files.push(r); }
      return {pr:{number:m.iid||n, title:m.title||'', state:m.state||'', draft:!!(m.draft||m.work_in_progress), url:m.web_url||'',
        author:{login:m.author&&m.author.username||null, name:m.author&&m.author.name||'', avatar:m.author&&m.author.avatar_url||null},
        base:m.target_branch||'', head:m.source_branch||''}, files, truncated:false};
    }
    if(meta.host==='bitbucket'){
      const h={}; if(opts.token) h['Authorization']='Bearer '+opts.token;
      const get=client(h, sig, rate), api='https://api.bitbucket.org/2.0/repositories/'+meta.repo+'/pullrequests/'+n;
      const m=await get(api); const files=[]; let u=api+'/diffstat?pagelen=100', g=0;
      while(u && g++<30){ const j=await get(u);
        for(const f of (j.values||[])){ const s={added:'A', removed:'D', modified:'M', renamed:'R'}[f.status]||'M';
          const r={path:(s==='D'?(f.old&&f.old.path):(f.new&&f.new.path))||'', status:s, add:f.lines_added||0, del:f.lines_removed||0};
          if(s==='R'&&f.old) r.from=f.old.path; if(r.path) files.push(r); }
        u=j.next||null; }
      const a=m.author||{};
      return {pr:{number:m.id||n, title:m.title||'', state:m.state||'', draft:false, url:(m.links&&m.links.html&&m.links.html.href)||'',
        author:{login:a.nickname||null, name:a.display_name||'', avatar:(a.links&&a.links.avatar&&a.links.avatar.href)||null},
        base:(m.destination&&m.destination.branch&&m.destination.branch.name)||'', head:(m.source&&m.source.branch&&m.source.branch.name)||''}, files, truncated:!!u};
    }
    const h={'Accept':'application/vnd.github+json'}; if(opts.token) h['Authorization']='Bearer '+opts.token;
    const get=client(h, sig, rate), api='https://api.github.com/repos/'+meta.repo+'/pulls/'+n;
    const m=await get(api); const files=[]; let page=1, last=0;
    for(; page<=30; page++){ const arr=await get(api+'/files?per_page=100&page='+page); last=Array.isArray(arr)?arr.length:0;
      for(const f of (arr||[])){ const s=STATUS_GH[f.status]||'M'; const r={path:f.filename, status:s, add:f.additions||0, del:f.deletions||0};
        if(s==='R'&&f.previous_filename) r.from=f.previous_filename; const pt=cap(f.patch); if(pt) r.patch=pt; files.push(r); }
      if(last<100) break; }
    const u=m.user||{};
    return {pr:{number:m.number||n, title:m.title||'', state:m.merged_at?'merged':(m.state||''), draft:!!m.draft, url:m.html_url||'',
      author:{login:u.login||null, name:'', avatar:u.avatar_url||null}, base:(m.base&&m.base.ref)||'', head:(m.head&&m.head.ref)||''},
      files, truncated:page>30&&last===100, remaining:rate.remaining};
  }

  // otwarte PR / MR (jedno zapytanie, najświeższe pierwsze) → [{number, title, author, draft, updated, url}]
  async function listPRs(meta, opts){
    opts=opts||{}; if(!supported(meta)) return [];
    const rate={remaining:null, limited:false}, sig=opts.signal, max=Math.min(50, opts.max||30);
    if(meta.host==='gitlab'){
      const h={}; if(opts.token) h['PRIVATE-TOKEN']=opts.token;
      const arr=await client(h, sig, rate)('https://gitlab.com/api/v4/projects/'+encodeURIComponent(meta.repo)+'/merge_requests?state=opened&order_by=updated_at&sort=desc&per_page='+max);
      return (Array.isArray(arr)?arr:[]).map(m=>({number:m.iid, title:m.title||'', author:(m.author&&m.author.username)||'', draft:!!(m.draft||m.work_in_progress), updated:ms(m.updated_at), url:m.web_url||''}));
    }
    if(meta.host==='bitbucket'){
      const h={}; if(opts.token) h['Authorization']='Bearer '+opts.token;
      const j=await client(h, sig, rate)('https://api.bitbucket.org/2.0/repositories/'+meta.repo+'/pullrequests?state=OPEN&sort=-updated_on&pagelen='+max);
      return ((j&&j.values)||[]).map(m=>({number:m.id, title:m.title||'', author:(m.author&&(m.author.nickname||m.author.display_name))||'', draft:false, updated:ms(m.updated_on), url:(m.links&&m.links.html&&m.links.html.href)||''}));
    }
    const h={'Accept':'application/vnd.github+json'}; if(opts.token) h['Authorization']='Bearer '+opts.token;
    const arr=await client(h, sig, rate)('https://api.github.com/repos/'+meta.repo+'/pulls?state=open&sort=updated&direction=desc&per_page='+max);
    return (Array.isArray(arr)?arr:[]).map(m=>({number:m.number, title:m.title||'', author:(m.user&&m.user.login)||'', draft:!!m.draft, updated:ms(m.updated_at), url:m.html_url||''}));
  }

  // meta = graph.meta z loadera (host, repo, branch, sub); opts = {token, max=1000, maxDetails, onProgress, signal}
  function supported(meta){ return !!(meta && meta.repo && /^(github|gitlab|bitbucket)$/.test(meta.host||'')); }
  async function fetchHistory(meta, opts){
    const o=Object.assign({max:1000}, opts||{});
    if(!supported(meta)) throw new Error(T('git.noRemote','To nie jest repozytorium GitHub/GitLab/Bitbucket.'));
    if(meta.host==='gitlab') return gitlab(meta, o);
    if(meta.host==='bitbucket') return bitbucket(meta, o);
    return github(meta, o);
  }
  return {fetchHistory, fetchPR, listPRs, supported, _diffLines:diffLines, _parseRaw:parseRaw};
})();
