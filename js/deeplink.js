/* ===================== deeplink.js — deep-linki (#repo= / #gist= / #share=) i mapy z linków ===================== */
// Czyste funkcje bez DOM (testowane w harnessie, test/deeplink.test.mjs):
//  • parseHash / parseRepoSpec — źródło repozytorium WYŁĄCZNIE z github.com / gitlab.com / bitbucket.org albo skrót
//    owner/nazwa[@gałąź[/podkatalog]] (GitHub). Dowolne hosty, schematy inne niż https, dane logowania i port w URL,
//    segmenty „.” / „..”, znaki sterujące i „%” są odrzucane — aplikacja nie jest proxy do pobierania czegokolwiek,
//    a gałąź/podkatalog trafiają potem do adresów API (raw.githubusercontent.com składa je bez kodowania).
//  • fetchGistMap / fetchShareMap — pobranie mapy z Gista (api.github.com; przy truncated tylko raw_url z
//    gist.githubusercontent.com) i z publicznego linku (/api/share/<id>, ten sam origin); fetch wstrzykiwany.
//  • validateMap / sanitizeMap / prepareShare — mapa z linku jest niezaufana: struktura, rozmiar, adresy repo
//    i awatarów tylko https ze znanych hostów (href/window.open z „javascript:" i śledzące obrazki odpadają).
CM.DeepLink = (function(){
  const MAX_MAP_BYTES = 25*1024*1024;   // mapa z Gista / publicznego linku
  const MAX_NODES = 500000;
  const MAX_HASH = 2048;
  const GIST_API = 'https://api.github.com/gists/';
  const GIST_RAW_HOST = 'gist.githubusercontent.com';
  const HOSTS = {'github.com':'github','www.github.com':'github','gitlab.com':'gitlab','www.gitlab.com':'gitlab',
    'bitbucket.org':'bitbucket','www.bitbucket.org':'bitbucket'};
  const WEB = {github:'https://github.com', gitlab:'https://gitlab.com', bitbucket:'https://bitbucket.org'};
  const AVATAR_HOST = /^(avatars\.githubusercontent\.com|github\.com|gitlab\.com|secure\.gravatar\.com|www\.gravatar\.com|bitbucket\.org|bytebucket\.org|[a-z0-9-]+\.atl-paas\.net)$/;

  const CTRL = /[\u0000-\u001f\u007f]/;
  const RE_GIST = /^[0-9a-f]{20,40}$/;
  const RE_SHARE = /^[A-Za-z0-9_-]{22,64}$/;
  const RE_GH_OWNER = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
  const RE_NAME = /^[A-Za-z0-9_.][A-Za-z0-9._-]{0,99}$/;
  const RE_LAYOUT = /^[a-z][a-z0-9_-]{0,31}$/;

  function fail(code, extra){ const e=new Error(code); e.code=code; if(extra) Object.assign(e, extra); return e; }

  const isGistId=(s)=>typeof s==='string' && RE_GIST.test(s);
  const isShareId=(s)=>typeof s==='string' && RE_SHARE.test(s);
  const isDeepLink=(h)=>/^#(repo|gist|share)=/.test(String(h||''));

  // nazwa gałęzi/tagu wg reguł git-check-ref-format + bez znaków, które zmieniają znaczenie adresu (% ? # itd.)
  function validRef(r){
    if(typeof r!=='string' || !r || r.length>200 || r==='@') return false;
    if(CTRL.test(r) || /[\s~^:?*[\\%#<>"'`|{}]/.test(r)) return false;
    return !/^[-/.]|[/.]$|\.lock$|\.\.|\/\/|@\{|\/\./.test(r);
  }
  const normSub=(s)=>s==null ? '' : String(s).replace(/^\/+|\/+$/g,'');
  function validSub(s){
    if(typeof s!=='string') return false;
    if(s==='') return true;
    if(s.length>300 || CTRL.test(s) || /[\\%?#<>"'`|]/.test(s)) return false;
    return s.split('/').every(seg=>seg!=='' && seg!=='.' && seg!=='..' && seg.trim()===seg);
  }
  const validName=(x)=>typeof x==='string' && RE_NAME.test(x) && !/^\.+$/.test(x);

  function build(host, names, branch, sub){
    if(!names.length || !names.every(validName)) return null;
    if(host==='github' && !RE_GH_OWNER.test(names[0])) return null;
    branch=branch||''; sub=normSub(sub);
    if(branch && !validRef(branch)) return null;
    if(!validSub(sub)) return null;
    const repo=names.join('/');
    return {host, repo, owner:names[0], name:names[names.length-1], branch, sub, url:WEB[host]+'/'+repo};
  }
  const stripGit=(s)=>String(s).replace(/\.git$/i,'');

  // segmenty ścieżki pełnego adresu: github owner/repo[/tree/gałąź[/podkatalog]],
  // gitlab grupa/…/projekt[/-/tree/gałąź[/podkatalog]], bitbucket ws/repo[/src/gałąź[/podkatalog]]
  function fromSegs(host, segs){
    if(host==='gitlab'){
      const i=segs.indexOf('-'), proj=(i<0?segs:segs.slice(0,i)).slice(), rest=i<0?[]:segs.slice(i+1);
      if(proj.length<2 || proj.length>20) return null;
      proj[proj.length-1]=stripGit(proj[proj.length-1]);
      if(!rest.length) return build(host, proj, '', '');
      if(rest[0]!=='tree' || !rest[1]) return null;
      return build(host, proj, rest[1], rest.slice(2).join('/'));
    }
    if(segs.length<2) return null;
    const names=[segs[0], stripGit(segs[1])], rest=segs.slice(2);
    if(!rest.length) return build(host, names, '', '');
    if(rest[0]!==(host==='bitbucket'?'src':'tree') || !rest[1]) return null;
    return build(host, names, rest[1], rest.slice(2).join('/'));
  }

  // źródło repozytorium z linku → {host, repo, owner, name, branch, sub, url} albo null
  function parseRepoSpec(input){
    if(typeof input!=='string') return null;
    const s=input.trim();
    if(!s || s.length>512 || CTRL.test(s) || s.includes('\\')) return null;
    if(/(^|\/)\.\.?(\/|$)/.test(s)) return null;                         // ścieżki z „.” / „..”
    let m=/^(?:https:\/\/)?((?:www\.)?(?:github\.com|gitlab\.com|bitbucket\.org))(\/[^?#]*)?(?:[?#].*)?$/i.exec(s);
    if(m) return fromSegs(HOSTS[m[1].toLowerCase()], (m[2]||'').split('/').filter(Boolean));
    if(/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;                      // inny schemat / host z portem
    m=/^([^/@]+)\/([^/@]+?)(?:@(.+))?$/.exec(s);                          // owner/nazwa[@gałąź[/podkatalog]]
    if(!m) return null;
    let branch='', sub='';
    if(m[3]!=null){ const i=m[3].indexOf('/'); branch=i<0?m[3]:m[3].slice(0,i); sub=i<0?'':m[3].slice(i+1); if(!branch) return null; }
    return build('github', [m[1], stripGit(m[2])], branch, sub);
  }
  const HOST_LABEL={github:'github.com', gitlab:'gitlab.com', bitbucket:'bitbucket.org'};
  function label(spec){ return spec ? HOST_LABEL[spec.host]+'/'+spec.repo+(spec.branch?'@'+spec.branch:'')+(spec.sub?' / '+spec.sub:'') : ''; }

  // "#k=v&k2=v2" → Map (pierwsze wystąpienie wygrywa); null, gdy kodowanie % jest uszkodzone
  function parseParams(body){
    const out=new Map();
    for(const part of body.split('&')){
      if(!part) continue;
      const i=part.indexOf('='), k=i<0?part:part.slice(0,i), raw=i<0?'':part.slice(i+1);
      let v; try{ v=decodeURIComponent(raw); }catch(e){ return null; }
      if(!out.has(k)) out.set(k, v);
    }
    return out;
  }

  // location.hash → {kind:'demo'|'view'} | {kind:'repo', spec, layout} | {kind:'gist'|'share', id}
  //               | {kind:'error', type, reason} | null (nie nasz hash)
  function parseHash(hash){
    let h=String(hash==null?'':hash); if(h[0]==='#') h=h.slice(1);
    if(!h) return null;
    if(h==='demo') return {kind:'demo'};
    if(h.startsWith('v=')) return {kind:'view'};
    const k0=/^(repo|gist|share)=/.exec(h); if(!k0) return null;
    const type=k0[1], bad=(reason)=>({kind:'error', type, reason});
    if(h.length>MAX_HASH) return bad('toolong');
    const p=parseParams(h); if(!p) return bad('encoding');
    const v=(p.get(type)||'').trim();
    if(type==='gist'){ const id=v.toLowerCase(); return isGistId(id) ? {kind:'gist', id} : bad('id'); }
    if(type==='share') return isShareId(v) ? {kind:'share', id:v} : bad('id');
    let spec=parseRepoSpec(v); if(!spec) return bad('source');
    if(p.has('branch')){ const b=p.get('branch').trim(); if(b){ if(!validRef(b)) return bad('branch'); spec=Object.assign({}, spec, {branch:b}); } }
    if(p.has('path')){ const s=normSub(p.get('path').trim()); if(!validSub(s)) return bad('path'); spec=Object.assign({}, spec, {sub:s}); }
    const ly=(p.get('layout')||'').trim();
    return {kind:'repo', spec, layout:RE_LAYOUT.test(ly)?ly:''};   // nieznany układ = zignorowany (sprawdzany też z listą układów)
  }

  // ---------------- mapa z niezaufanego źródła ----------------
  function validateMap(obj){
    if(!obj || typeof obj!=='object' || Array.isArray(obj) || obj.format!=='codemap') return 'notmap';
    if(!Array.isArray(obj.nodes) || !obj.nodes.length || obj.nodes.length>MAX_NODES) return 'badmap';
    if(obj.edges!=null && !Array.isArray(obj.edges)) return 'badmap';
    if(obj.meta!=null && (typeof obj.meta!=='object' || Array.isArray(obj.meta))) return 'badmap';
    for(const n of obj.nodes) if(!n || typeof n!=='object' || typeof n.id!=='string') return 'badmap';
    return '';
  }
  function httpsUrl(u){
    if(typeof u!=='string' || u.length>2048) return null;
    try{ const x=new URL(u); if(x.protocol!=='https:' || x.username || x.password || x.port) return null; return x; }catch(e){ return null; }
  }
  function repoWebUrl(u){ const x=httpsUrl(u); return x && HOSTS[x.hostname.toLowerCase()] ? x.href.replace(/\/$/,'') : null; }
  function avatarUrl(u){ const x=httpsUrl(u); return x && AVATAR_HOST.test(x.hostname.toLowerCase()) ? x.href : null; }
  // adresy trafiające do href / window.open / <img src> — tylko https ze znanych hostów; zwraca liczbę usuniętych pól
  function sanitizeMap(obj){
    let dropped=0;
    const keep=(o,k,fn)=>{ if(!o || typeof o!=='object' || o[k]==null) return; const v=fn(o[k]); if(v==null){ delete o[k]; dropped++; } else o[k]=v; };
    const m=obj && obj.meta;
    if(m && typeof m==='object'){
      keep(m,'html',repoWebUrl);
      if(m.repoInfo && typeof m.repoInfo==='object') keep(m.repoInfo,'url',repoWebUrl);
      if(m.owner && typeof m.owner==='object'){ keep(m.owner,'url',repoWebUrl); keep(m.owner,'avatar',avatarUrl); }
    }
    const gi=obj && obj.gitInfo;
    if(gi && Array.isArray(gi.authors)) for(const a of gi.authors) keep(a,'avatar',avatarUrl);
    return dropped;
  }
  // przed publicznym udostępnieniem: bez podglądu treści plików i bez e-maili autorów (domyślnie oba włączone).
  // obj = świeży wynik graph.toJSON() — węzły są nowymi obiektami, gitInfo podmieniamy na kopię (nie ruszamy grafu).
  function prepareShare(obj, opt){
    opt=opt||{};
    if(opt.noPreview!==false) for(const n of (obj.nodes||[])) if(n && n.preview!=null) n.preview=null;
    if(opt.noEmails!==false && obj.gitInfo) obj.gitInfo=JSON.parse(JSON.stringify(obj.gitInfo, (k,v)=>k==='email'?undefined:v));
    return obj;
  }

  // ---------------- pobieranie ----------------
  // tekst odpowiedzi z twardym limitem (Content-Length i liczenie bajtów strumienia — gzip nie oszuka limitu)
  async function readCapped(res, max){
    const cl=Number(res.headers && res.headers.get && res.headers.get('content-length'));
    if(cl && cl>max) throw fail('too-big');
    if(res.body && typeof res.body.getReader==='function'){
      const r=res.body.getReader(), dec=new TextDecoder(); let n=0, out='';
      for(;;){
        const {done, value}=await r.read(); if(done) break;
        n+=value.length; if(n>max){ try{ r.cancel(); }catch(e){} throw fail('too-big'); }
        out+=dec.decode(value, {stream:true});
      }
      return out+dec.decode();
    }
    const t=await res.text(); if(t.length>max) throw fail('too-big'); return t;
  }
  const finalHostOk=(res, host)=>{ const u=res && res.url; if(!u) return true; const x=httpsUrl(u); return !!x && x.hostname===host; };
  async function get(f, url, init){ try{ return await f(url, init); }catch(e){ throw fail('net'); } }
  const parseJSON=(t)=>{ try{ return JSON.parse(t); }catch(e){ return undefined; } };

  // Gist → {map, file, owner, description, htmlUrl}. Bez tokenu (link nigdy nie używa tokenu użytkownika).
  async function fetchGistMap(id, opts){
    opts=opts||{};
    const f=opts.fetch || ((u,o)=>fetch(u,o)), max=opts.maxBytes||MAX_MAP_BYTES;
    if(!isGistId(id)) throw fail('gist-id');
    const res=await get(f, GIST_API+id, {headers:{Accept:'application/vnd.github+json'}, credentials:'omit'});
    if(res.status===404) throw fail('gist-notfound');
    if(res.status===429 || (res.status===403 && res.headers && res.headers.get('x-ratelimit-remaining')==='0')) throw fail('gist-rate');
    if(res.status===403) throw fail('gist-forbidden');
    if(!res.ok) throw fail('gist-http', {status:res.status});
    if(!finalHostOk(res, 'api.github.com')) throw fail('raw-host');
    const j=parseJSON(await readCapped(res, max));
    const files=j && j.files;
    if(!files || typeof files!=='object') throw fail('gist-notmap');
    const names=Object.keys(files).filter(n=>/\.json$/i.test(n))
      .sort((a,b)=>(b==='codemap.json')-(a==='codemap.json') || (a<b?-1:a>b?1:0)).slice(0,20);
    let tooBig=false;
    for(const name of names){
      const fl=files[name]; if(!fl || typeof fl!=='object') continue;
      if(Number(fl.size)>max){ tooBig=true; continue; }
      let text=typeof fl.content==='string' && !fl.truncated ? fl.content : null;
      if(text==null){
        const x=httpsUrl(fl.raw_url);
        if(!x || x.hostname!==GIST_RAW_HOST) throw fail('raw-host');
        const r=await get(f, x.href, {credentials:'omit'});
        if(!r.ok) throw fail('gist-http', {status:r.status});
        if(!finalHostOk(r, GIST_RAW_HOST)) throw fail('raw-host');
        try{ text=await readCapped(r, max); }catch(e){ if(e.code==='too-big'){ tooBig=true; continue; } throw e; }
      }
      const obj=parseJSON(text);
      if(obj && obj.format==='codemap'){
        const bad=validateMap(obj); if(bad) throw fail(bad);
        return {map:obj, file:name, owner:(j.owner && typeof j.owner.login==='string') ? j.owner.login : '',
          description:typeof j.description==='string' ? j.description : '', htmlUrl:repoWebUrl(j.html_url)||('https://gist.github.com/'+id)};
      }
    }
    throw fail(tooBig ? 'too-big' : 'gist-notmap');
  }

  // publiczny link → mapa. Ten sam origin, bez ciasteczek (credentials:'omit' — endpoint jest publiczny).
  async function fetchShareMap(id, opts){
    opts=opts||{};
    const f=opts.fetch || ((u,o)=>fetch(u,o)), max=opts.maxBytes||MAX_MAP_BYTES;
    if(!isShareId(id)) throw fail('share-id');
    const res=await get(f, (opts.base||'')+'/api/share/'+id, {credentials:'omit', cache:'no-store', headers:{Accept:'application/json'}});
    if(res.status===404) throw fail('share-notfound');
    if(res.status===429) throw fail('share-rate');
    if(!res.ok) throw fail('share-http', {status:res.status});
    const ct=(res.headers && res.headers.get && res.headers.get('content-type'))||'';
    if(!/application\/json/i.test(ct)) throw fail('share-notfound');   // np. SPA-fallback serwera statycznego bez backendu
    const obj=parseJSON(await readCapped(res, max));
    const bad=validateMap(obj); if(bad) throw fail(bad);
    return {map:obj};
  }

  return {parseHash, parseRepoSpec, parseParams, validRef, validSub, normSub, isGistId, isShareId, isDeepLink, label,
    validateMap, sanitizeMap, prepareShare, readCapped, fetchGistMap, fetchShareMap, MAX_MAP_BYTES};
})();
