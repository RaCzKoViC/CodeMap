/* ===================== graph.js — data model ===================== */
CM.Graph = (function(){
  const A = CM.Analysis, U = CM.util, L = CM.languages;

  class Graph {
    constructor(){ this.clear(); }
    clear(){
      this.nodes = new Map();
      this.edges = [];
      this.externals = new Map();
      this.depVersions = new Map();   // dependency name -> {version, source} from manifests
      this.langStats = new Map();
      this.meta = {name:'projekt', source:'', createdAt:Date.now()};
      this.root = {id:'__root__', type:'folder', name:'projekt', path:'', parent:null,
                   lang:'__folder__', depth:0, collapsed:false, children:[], x:0, y:0, vx:0, vy:0, r:30};
      this.nodes.set('__root__', this.root);
    }

    // ---- build from a flat file list ----
    // files: [{path, size, content|null, mtime}]
    build(files, meta){
      this.clear();
      this.meta = Object.assign({name:'projekt', source:'', createdAt:Date.now()}, meta||{});
      this.root.name = this.meta.name;
      const manifests = [];   // wpisy A.manifestEntry: aliasy tsconfig/jsconfig (z extends), pakiety workspaces

      for(const f of files){
        const path = A.normPath(f.path);
        if(!path) continue;
        const parent = this.ensureFolder(A.dirname(path));
        const info = L.lookup(A.basename(path));
        const content = (f.content != null && info.text) ? f.content : null;
        const node = {
          id: path, type:'file', name: A.basename(path), path,
          parent: parent.id, depth: parent.depth+1,
          ext: (path.split('.').pop()||'').toLowerCase(),
          lang: info.key, langInfo: info,
          size: f.size != null ? f.size : (content ? content.length : 0),
          mtime: f.mtime || null,
          content: null, preview: null, hash: '0',
          metrics: null, deps: [], importsIn: [], importsOut: [],
          x:0, y:0, vx:0, vy:0, r:6, collapsed:false,
        };
        if(content != null){
          node.metrics = A.analyzeContent(content, info.key);
          node.deps = A.extractDeps(content, info.key);
          node.symbols = A.extractSymbols(content, info.key);
          node.hash = U.hashString(content);
          // keep (almost) the whole file for the hover preview — bounded at 64 KB so even projects
          // hitting the 4000-content-files cap stay well under ~256 MB of retained text
          node.preview = content.length > 65536 ? content.slice(0,65536) : content;
          if(node.metrics) node.size = node.size || node.metrics.chars;
          this._scanManifest(node.name, content, A.dirname(path), manifests);
        } else {
          node.hash = 'bin:'+node.size;
        }
        this.nodes.set(path, node);
        this._link(parent, node);
        // language stats
        if(!this.langStats.has(info.key)) this.langStats.set(info.key, {key:info.key, info, count:0, on:true, bytes:0, lines:0});
        const st = this.langStats.get(info.key); st.count++; st.bytes += node.size||0; st.lines += node.metrics?node.metrics.lines:0;
      }

      // import / reference edges (with tsconfig/jsconfig path-alias resolution)
      const all = Array.from(this.nodes.values());
      const {edges, externals} = A.buildEdges(all, manifests);
      for(const e of edges) this.edges.push(e);
      this.externals = externals;

      // external nodes
      let extRoot = null;
      if(externals.size){
        extRoot = {id:'__ext__', type:'folder', name:CM.i18n.t('cl.extRoot','⟨ zależności zewnętrzne ⟩'), path:'__ext__',
                   parent:this.root.id, depth:1, collapsed:false, children:[], lang:'__folder__', x:0,y:0,vx:0,vy:0,r:20, external:true};
        this.nodes.set('__ext__', extRoot);
        this._link(this.root, extRoot);
        for(const [name, ex] of externals){
          const id = 'ext:'+name;
          const dv = this.depVersions.get(name) || this.depVersions.get(name.toLowerCase());
          const en = {id, type:'external', name, path:id, parent:'__ext__', depth:2, lang:'__external__',
                      count:ex.count, importers:ex.importers, version:dv?dv.version:null, depSource:dv?dv.source:null,
                      x:0,y:0,vx:0,vy:0,r:6, collapsed:false};
          this.nodes.set(id, en);
          this._link(extRoot, en);
          for(const impId of ex.importers) this.edges.push({id:'ext'+this.edges.length, source:impId, target:id, type:'import'});
        }
      }

      this._computeImportDegrees();
      this.computeAggregates();
      return this;
    }

    ensureFolder(path){
      path = A.normPath(path);
      if(path === '') return this.root;
      if(this.nodes.has(path)) return this.nodes.get(path);
      const parent = this.ensureFolder(A.dirname(path));
      const node = {id:path, type:'folder', name:A.basename(path), path, parent:parent.id,
                    depth:parent.depth+1, lang:'__folder__', children:[], collapsed:false,
                    x:0,y:0,vx:0,vy:0,r:12};
      this.nodes.set(path, node);
      this._link(parent, node);
      return node;
    }
    _link(parent, child){
      if(!parent.children) parent.children = [];
      parent.children.push(child.id);
      this.edges.push({id:'c'+this.edges.length, source:parent.id, target:child.id, type:'contains'});
    }

    // parse package/dependency manifests -> versions; wpisy do rozwiązywania importów (aliasy, pakiety) → manifests
    _scanManifest(name, content, dir, manifests){
      const n = name.toLowerCase();
      const setV = (k,v,src)=>{ if(k) this.depVersions.set(k, {version:String(v||'').replace(/^[\^~>=<\s]+/,'').trim(), source:src}); };
      const entry = A.manifestEntry(name, content, dir); if(entry) manifests.push(entry);
      try{
        if(n==='package.json'){
          const j = A.looseJSON(content);
          for(const grp of ['dependencies','devDependencies','peerDependencies','optionalDependencies']){
            const o = j[grp]; if(o&&typeof o==='object') for(const k in o) setV(k, o[k], 'npm');
          }
        } else if(n==='requirements.txt'){
          for(const line of content.split(/\r?\n/)){ const t=line.trim(); if(!t||t[0]==='#'||t.startsWith('-')) continue;
            const m=/^([A-Za-z0-9._-]+)\s*(?:[=<>!~]+\s*([0-9][\w.\-]*))?/.exec(t); if(m) setV(m[1].toLowerCase(), m[2]||'', 'pip'); }
        } else if(n==='cargo.toml'){
          let inDeps=false;
          for(const line of content.split(/\r?\n/)){ const t=line.trim();
            if(/^\[/.test(t)){ inDeps=/^\[(.*\.)?dependencies\]/.test(t); continue; }
            if(!inDeps||!t||t[0]==='#') continue;
            let m=/^([A-Za-z0-9._-]+)\s*=\s*"([^"]+)"/.exec(t); if(m){ setV(m[1], m[2], 'cargo'); continue; }
            m=/^([A-Za-z0-9._-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/.exec(t); if(m) setV(m[1], m[2], 'cargo'); }
        } else if(n==='go.mod'){
          let inReq=false;
          for(const line of content.split(/\r?\n/)){ const t=line.trim();
            if(/^require\s*\(/.test(t)){ inReq=true; continue; } if(inReq&&t===')'){ inReq=false; continue; }
            const m=/^(?:require\s+)?([\w./\-]+)\s+v([\w.\-]+)/.exec(t); if(m&&(inReq||/^require\s/.test(t))) setV(m[1], 'v'+m[2], 'go'); }
        }
      }catch(e){}
    }

    _computeImportDegrees(){
      for(const e of this.edges){
        if(e.type==='import' || e.type==='reference'){
          const s = this.nodes.get(e.source), t = this.nodes.get(e.target);
          if(s) s.importsOut.push(e.target);
          if(t && t.importsIn) t.importsIn.push(e.source);
        }
      }
    }

    // post-order aggregates for folders + radii
    computeAggregates(){
      const visit = (node) => {
        if(node.type !== 'folder'){
          node.descFiles = node.type==='file' ? 1 : 0;
          node.totalSize = node.size||0;
          node.totalLines = node.metrics ? node.metrics.lines : 0;
          node.langBreak = node.type==='file' ? new Map([[node.lang,1]]) : new Map();
          return;
        }
        let files=0, size=0, lines=0; const lb = new Map();
        for(const cid of (node.children||[])){
          const c = this.nodes.get(cid); if(!c) continue;
          visit(c);
          files += c.descFiles||0; size += c.totalSize||0; lines += c.totalLines||0;
          if(c.langBreak) for(const [k,v] of c.langBreak) lb.set(k, (lb.get(k)||0)+v);
          else if(c.type==='file') lb.set(c.lang,(lb.get(c.lang)||0)+1);
        }
        node.descFiles=files; node.totalSize=size; node.totalLines=lines; node.langBreak=lb;
        node.childCount = (node.children||[]).length;
      };
      visit(this.root);
      // radii — gentle log scaling with tight caps so dense clusters stay readable
      for(const n of this.nodes.values()){
        if(n.type==='folder') n.r = U.clamp(9 + Math.log2((n.descFiles||1)+1)*3.4, 11, 42);
        else if(n.type==='external') n.r = U.clamp(5 + Math.log2((n.count||1)+1)*1.5, 5, 13);
        // file radius reflects its weight (lines if known, else √bytes) on a wider scale so big files stand out
        else { const m = (n.metrics && n.metrics.lines) ? n.metrics.lines : Math.sqrt(n.size||1); n.r = U.clamp(3.5 + Math.log2(m+1)*1.8, 4, 24); }
      }
    }

    // ---- visibility with collapse + filters ----
    isHiddenByCollapse(n){
      let cur = n.parent != null ? this.nodes.get(n.parent) : null;
      while(cur){ if(cur.collapsed) return true; cur = cur.parent!=null ? this.nodes.get(cur.parent) : null; }
      return false;
    }
    // highest collapsed ancestor (representative when hidden)
    _rep(n, vis){
      let cur = n, top = null;
      while(cur){
        if(cur.collapsed && cur.id!==n.id) top = cur;
        cur = cur.parent!=null ? this.nodes.get(cur.parent) : null;
      }
      if(top && vis.has(top.id)) return top.id;
      return vis.has(n.id) ? n.id : null;
    }

    getVisible(F){
      const vis = new Map();
      for(const n of this.nodes.values()){
        if(n.id==='__root__') continue; // synthetic project root is never drawn
        if(n.type==='folder' && !F.folders && n.id!=='__ext__') continue;
        if(n.type==='file' && !F.files) continue;
        if((n.type==='external' || n.id==='__ext__') && !F.externals) continue;
        if(n.type==='file' && F.langsOff && F.langsOff.has(n.lang)) continue;
        if(n.type==='file' && F.minMetric>0){
          const m=F.metric||'lines';
          const v = m==='size' ? (n.size||0) : (n.metrics ? (n.metrics[m]||0) : 0);
          if(v < F.minMetric) continue;
        }
        if(this.isHiddenByCollapse(n)) continue;
        vis.set(n.id, n);
      }
      // edges aggregated to visible representatives
      const eMap = new Map();
      for(const e of this.edges){
        if(e.type==='contains' && !F.contains) continue;
        if(e.type==='import' && !F.import) continue;
        if(e.type==='reference' && !F.reference) continue;
        const sN = this.nodes.get(e.source), tN = this.nodes.get(e.target);
        if(!sN || !tN) continue;
        const s = this._rep(sN, vis), t = this._rep(tN, vis);
        if(s==null || t==null || s===t) continue;
        const key = e.type+'|'+s+'|'+t;
        if(eMap.has(key)) eMap.get(key).weight++;
        else eMap.set(key, {id:key, source:s, target:t, type:e.type, weight:1});
      }
      return {nodes:Array.from(vis.values()), edges:Array.from(eMap.values()), visSet:vis};
    }

    neighbors(id){
      const out = new Set(), inc = new Set();
      for(const e of this.edges){
        if(e.source===id) out.add(e.target);
        if(e.target===id) inc.add(e.source);
      }
      return {out, inc};
    }

    // ---- dependency impact: transitive closure of dep edges from a focus node ----
    // down = everything `id` (transitively) depends on (out edges); up = everything that depends on it (in edges).
    // Follows only code-dep edges (import/reference) by default; 'contains' (folder structure) is excluded.
    // opts.types = array of edge types to follow (default ['import','reference']).
    // Returns {focus:id, up:Set<id>, down:Set<id>} (focus excluded from both sets).
    impactSet(id, opts){
      opts = opts || {};
      const types = opts.types || ['import','reference'];
      const ok = new Set(types);
      // build forward + reverse adjacency once over dep edges (O(V+E))
      const fwd = new Map(), rev = new Map();
      for(const e of this.edges){
        if(!ok.has(e.type)) continue;
        if(!fwd.has(e.source)) fwd.set(e.source, []);
        fwd.get(e.source).push(e.target);
        if(!rev.has(e.target)) rev.set(e.target, []);
        rev.get(e.target).push(e.source);
      }
      const bfs = (adj) => {
        const seen = new Set(), q = [id];
        seen.add(id);
        while(q.length){
          const cur = q.shift();
          const nb = adj.get(cur); if(!nb) continue;
          for(const w of nb){ if(!seen.has(w)){ seen.add(w); q.push(w); } }
        }
        seen.delete(id);   // focus itself isn't part of up/down
        return seen;
      };
      return {focus:id, down:bfs(fwd), up:bfs(rev)};
    }

    // ---- import-cycle detection (Tarjan SCC over file import/reference edges) ----
    importCycles(){
      const isFile=(id)=>{ const n=this.nodes.get(id); return n && n.type==='file'; };
      const adj=new Map();
      for(const e of this.edges){
        if(e.type!=='import' && e.type!=='reference') continue;
        if(!isFile(e.source) || !isFile(e.target) || e.source===e.target) continue;
        if(!adj.has(e.source)) adj.set(e.source,[]);
        adj.get(e.source).push(e.target);
      }
      let idx=0; const index=new Map(), low=new Map(), stack=[], onStack=new Set(), sccs=[];
      // iterative Tarjan (avoids stack overflow on deep graphs)
      for(const start of adj.keys()){
        if(index.has(start)) continue;
        const work=[{v:start, i:0}];
        while(work.length){
          const frame=work[work.length-1], v=frame.v;
          if(frame.i===0){ index.set(v,idx); low.set(v,idx); idx++; stack.push(v); onStack.add(v); }
          const nbrs=adj.get(v)||[];
          if(frame.i<nbrs.length){
            const w=nbrs[frame.i++];
            if(!index.has(w)) work.push({v:w, i:0});
            else if(onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
          } else {
            if(low.get(v)===index.get(v)){
              const comp=[]; let w;
              do{ w=stack.pop(); onStack.delete(w); comp.push(w); }while(w!==v);
              if(comp.length>1) sccs.push(comp);
            }
            work.pop();
            if(work.length){ const p=work[work.length-1].v; low.set(p, Math.min(low.get(p), low.get(v))); }
          }
        }
      }
      const sccOf=new Map(); sccs.forEach((c,i)=>c.forEach(id=>sccOf.set(id,i)));
      const edges=new Set(), nodes=new Set();
      for(const e of this.edges){
        if(e.type!=='import' && e.type!=='reference') continue;
        if(sccOf.has(e.source) && sccOf.get(e.source)===sccOf.get(e.target)){
          edges.add(e.source+'|'+e.target); nodes.add(e.source); nodes.add(e.target);
        }
      }
      return {edges, nodes, components:sccs};
    }

    // ---- collapse helpers ----
    collapseAll(depth){
      for(const n of this.nodes.values()) if(n.type==='folder') n.collapsed = (n.depth>=depth && n.children && n.children.length>0);
    }
    // Choose the SHALLOWEST collapse depth whose visible-node count fits the budget.
    // A fixed collapseAll(3) does nothing for wide-flat repositories (100k files at depth 3 stay
    // visible and the whole pipeline — layout, filters, minimap, draw — pays for every one of them).
    // visible(d) ≈ all nodes at depth ≤ d (folders AT depth d render as collapsed chips).
    collapseToBudget(maxVisible){
      maxVisible = maxVisible || 3000;
      const byDepth = new Map(); let maxD = 1;
      for(const n of this.nodes.values()){
        if(n.id==='__root__' || n.id==='__ext__') continue;
        const d = n.depth||0; byDepth.set(d,(byDepth.get(d)||0)+1); if(d>maxD) maxD=d;
      }
      let cum=0, depth=1;
      for(let d=1; d<=maxD; d++){
        cum += byDepth.get(d)||0;
        if(cum > maxVisible){ depth = Math.max(1, d-1); break; }
        depth = d;
      }
      this.collapseAll(depth);
      return depth;
    }
    expandAll(){ for(const n of this.nodes.values()) if(n.type==='folder') n.collapsed=false; }

    // ---- serialization ----
    toJSON(){
      const nodes = [];
      for(const n of this.nodes.values()){
        nodes.push({
          id:n.id, type:n.type, name:n.name, path:n.path, parent:n.parent, depth:n.depth,
          ext:n.ext, lang:n.lang, size:n.size, mtime:n.mtime, hash:n.hash,
          metrics:n.metrics, count:n.count, importers:n.importers,
          collapsed:!!n.collapsed, x:Math.round(n.x*100)/100, y:Math.round(n.y*100)/100,
          preview: n.preview ? n.preview.slice(0,1500) : null,
        });
      }
      return {
        format:'codemap', version:2, meta:this.meta,
        nodes, edges:this.edges.filter(e=>e.type!=='contains').map(e=>({source:e.source,target:e.target,type:e.type})),
      };
    }

    static fromJSON(obj){
      const g = new Graph();
      g.nodes.clear(); g.edges = [];
      g.meta = obj.meta || {name:'projekt'};
      for(const nd of obj.nodes){
        const info = nd.type==='file' ? L.lookup(nd.name) : null;
        const n = Object.assign({
          children:[], importsIn:[], importsOut:[], deps:[], vx:0, vy:0,
          langInfo: info, content:null,
        }, nd);
        g.nodes.set(n.id, n);
        if(n.id==='__root__') g.root = n;
      }
      if(!g.nodes.has('__root__')){ g.nodes.set('__root__', g.root); }
      // rebuild children + contains edges from parent links
      for(const n of g.nodes.values()){
        if(n.parent!=null && g.nodes.has(n.parent)){
          const p = g.nodes.get(n.parent); if(!p.children) p.children=[]; p.children.push(n.id);
          g.edges.push({id:'c'+g.edges.length, source:n.parent, target:n.id, type:'contains'});
        }
      }
      // import/reference edges
      for(const e of (obj.edges||[])) g.edges.push({id:'e'+g.edges.length, source:e.source, target:e.target, type:e.type});
      // langStats
      for(const n of g.nodes.values()){
        if(n.type==='file'){
          if(!g.langStats.has(n.lang)) g.langStats.set(n.lang,{key:n.lang, info:n.langInfo||L.lookup(n.name), count:0, on:true, bytes:0, lines:0});
          const s=g.langStats.get(n.lang); s.count++; s.bytes+=n.size||0; s.lines+=n.metrics?n.metrics.lines:0;
        }
      }
      g._computeImportDegrees();
      g.computeAggregates();
      return g;
    }

    // ---- snapshot signature (for diffing development over time) ----
    signature(){
      const files = [];
      for(const n of this.nodes.values()){
        if(n.type==='file') files.push({path:n.path, hash:n.hash, size:n.size||0, lines:n.metrics?n.metrics.lines:0, lang:n.lang});
      }
      files.sort((a,b)=>a.path<b.path?-1:1);
      return {
        name:this.meta.name, source:this.meta.source||'',
        fileCount:files.length,
        totalSize:files.reduce((s,f)=>s+f.size,0),
        totalLines:files.reduce((s,f)=>s+f.lines,0),
        files,
      };
    }
  }

  // diff two signatures -> {added, removed, modified, unchanged, deltas}
  function diffSignatures(a, b){
    const ma = new Map(a.files.map(f=>[f.path,f]));
    const mb = new Map(b.files.map(f=>[f.path,f]));
    const added=[], removed=[], modified=[], unchanged=[];
    for(const f of b.files){
      const old = ma.get(f.path);
      if(!old) added.push(f);
      else if(old.hash !== f.hash) modified.push({...f, oldLines:old.lines, oldSize:old.size, dLines:f.lines-old.lines, dSize:f.size-old.size});
      else unchanged.push(f);
    }
    for(const f of a.files){ if(!mb.has(f.path)) removed.push(f); }
    return {
      added, removed, modified, unchanged,
      dFiles: b.fileCount - a.fileCount,
      dLines: b.totalLines - a.totalLines,
      dSize: b.totalSize - a.totalSize,
    };
  }

  return {Graph, diffSignatures};
})();
