// Benchmark renderera i wczytywania na syntetycznym projekcie (headless Chrome przez CDP, bez zależności).
// Projekt: N plików JS w 40 pakietach × 400 modułach, po 2 importy (70 % w obrębie tego samego pakietu),
// wszystko rozwinięte, krawędzie struktury i importów włączone — najgorszy przypadek dla rysowania.
// Mierzy: wczytanie + analiza + układ, mediana klatki (z wymuszoną rasteryzacją: getImageData / gl.finish)
// przy dopasowaniu całej mapy, po przybliżeniu ×8 i podczas przesuwania — dla każdego dostępnego backendu.
//   node tools/bench.mjs                 (domyślnie N = 5000,20000)
//   node tools/bench.mjs --n 50000 --json bench.json --max-frame 50
//   --summary: tabela Markdown do $GITHUB_STEP_SUMMARY (CI) albo na stdout
// --max-frame: kod wyjścia 1, gdy mediana klatki przy dopasowaniu przekroczy próg (ms) — do CI.
import { writeFile, appendFile } from 'node:fs/promises';
import { startBrowser, sleep } from './cdp.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const SIZES = String(arg('n', '5000,20000')).split(',').map((x) => parseInt(x, 10)).filter((x) => x > 0);
const OUT = arg('json', null), MAX_FRAME = parseFloat(arg('max-frame', '0')) || 0;

let B;
try { B = await startBrowser({ prefix: 'codemap-bench-', width: 1400, height: 900 }); }
catch (e) { console.error('✖ ' + e.message); process.exit(2); }
const { port, send, js } = B;

const results = [];
try {
  for (const N of SIZES) {
    await send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html?bench=${N}` });
    for (let i = 0; i < 80; i++) { if (await B.evalJs('!!(window.CMApp && CM.App && CM.App.renderer)')) break; await sleep(250); }
    await sleep(500);
    const r = await js(`(async()=>{
      const sleep=(ms)=>new Promise(r=>setTimeout(r,ms)); const N=${N};
      const files=[]; let seed=7; const rnd=()=>{ seed=(seed*16807)%2147483647; return seed/2147483647; };
      const P=(j)=>'pkg'+(j%40)+'/mod'+(j%400)+'/f'+j+'.js';
      for(let i=0;i<N;i++){ const imps=[];
        for(let k=0;k<2;k++){ const j=rnd()<0.7 ? (Math.floor(i/400)*400+Math.floor(rnd()*400))%N : Math.floor(rnd()*N); imps.push("import x"+k+" from '../../"+P(j)+"';"); }
        const c=imps.join('\\n')+'\\nexport default function f'+i+'(a){ if(a) return 1; return 2; }\\n'; files.push({path:P(i), size:c.length, content:c, mtime:1}); }
      const t0=performance.now(); await CMApp.loadFiles(files, {name:'bench', source:'bench', kind:'local'});
      for(let i=0;i<600 && CMApp.graph.nodes.size<N;i++) await sleep(50);
      const load=performance.now()-t0;
      const g=CMApp.graph, R=CM.App.renderer;
      const t1=performance.now(); g.expandAll();
      for(const id of ['edge-contains','edge-import']){ const e=document.getElementById(id); if(e && !e.checked) e.click(); }
      CM.App.apply({}); const expand=performance.now()-t1; await sleep(300);
      if(R.sim) R.sim.running=false;
      const backends=(R.backends?R.backends():['canvas']);
      const out={N, nodes:R.nodes.length, edges:R.edges.length, load:Math.round(load), expand:Math.round(expand), gl:!!(R.backends&&R.backends().includes('webgl')), frames:{}};
      const sync=()=>{ if(R._glLayer && R._glLayer.active) R._glLayer.gl.finish(); R.ctx.getImageData(0,0,1,1); };
      const med=(f,k=7)=>{ const a=[]; for(let i=0;i<k;i++){ const t=performance.now(); f(); sync(); a.push(performance.now()-t); } a.sort((x,y)=>x-y); return Math.round(a[k>>1]*10)/10; };
      for(const b of backends){
        if(R.setBackend) R.setBackend(b); R.fit(70,false); await sleep(100); R._draw(); sync();
        const f={};
        f.fit=med(()=>R._draw());
        R.cam.zoom*=8; R.cam._k=''; f.zoom8=med(()=>R._draw()); R.cam.zoom/=8; R.cam._k='';
        let dx=0; f.pan=med(()=>{ dx+=37/R.cam.zoom; R.cam.x+=37/R.cam.zoom; R._draw(); }); R.cam.x-=dx;
        out.frames[b]=f;
      }
      if(R.setBackend) R.setBackend('auto');
      return out; })()`);
    results.push(r);
    const fr = Object.entries(r.frames).map(([b, f]) => `${b}: dopasowanie ${f.fit} ms · ×8 ${f.zoom8} ms · przesuwanie ${f.pan} ms`).join(' | ');
    console.log(`N=${r.N}: ${r.nodes} węzłów, ${r.edges} krawędzi · wczytanie ${r.load} ms · rozwinięcie ${r.expand} ms · ${fr}`);
  }
} catch (e) { console.error('✖ ' + (e && e.message || e)); B.close(); process.exit(2); }
B.close();
if (OUT) await writeFile(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
if (process.argv.includes('--summary')) {
  const rows = ['### Benchmark renderera', '', '| pliki | węzły | krawędzie | wczytanie | backend | klatka: dopasowanie | ×8 | przesuwanie |', '|---:|---:|---:|---:|---|---:|---:|---:|'];
  for (const r of results) for (const [b, f] of Object.entries(r.frames)) rows.push(`| ${r.N} | ${r.nodes} | ${r.edges} | ${r.load} ms | ${b} | ${f.fit} ms | ${f.zoom8} ms | ${f.pan} ms |`);
  const md = rows.join('\n') + '\n\nKlatka z wymuszoną rasteryzacją (getImageData / gl.finish), mediana z 7; runner bez GPU = WebGL programowy.\n';
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md); else console.log('\n' + md);
}
if (MAX_FRAME) {
  const worst = Math.max(...results.map((r) => Math.min(...Object.values(r.frames).map((f) => f.fit))));
  if (worst > MAX_FRAME) { console.error(`✖ klatka ${worst} ms > próg ${MAX_FRAME} ms`); process.exit(1); }
  console.log(`✔ najwolniejsza klatka (najlepszy backend) ${worst} ms ≤ ${MAX_FRAME} ms`);
}
