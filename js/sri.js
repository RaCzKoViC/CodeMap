/* ===================== sri.js — przypięte skróty plików z CDN (GENEROWANE: node tools/sri.mjs) =====================
   Statyczne pliki npm z jsDelivr używane przez graf symboli (web-tree-sitter + gramatyki WASM). Kod i WASM są
   pobierane jako bajty, sprawdzane SHA-384 i dopiero wtedy wykonywane — podmieniony plik na CDN nie zostanie użyty.
   Działa w oknie i w workerze (self). CI: node tools/sri.mjs --check. */
(function(g){
  g.CM = g.CM || {};
  const HASHES = {
    "https://cdn.jsdelivr.net/npm/web-tree-sitter@0.22.6/tree-sitter.js":"sha384-cf1lJSFeRUD65oHpVMmUhyxnG8YEWXcN/0MeawE0ZsF5/91mvHFgjnSzOFYmqCXg",
    "https://cdn.jsdelivr.net/npm/web-tree-sitter@0.22.6/tree-sitter.wasm":"sha384-htQG5dc1bUNslacRivub4ILTQ0UrBtzFNssvzv+1xTNHf7a6TGQfHiQhZp7yZ+be",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-c.wasm":"sha384-956Al1A2aAMoRDeqvX0SNMyUY8IEgyQ3fsOpi/yHwRReTgRPgomXQNZ4WO1NQDXe",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-c_sharp.wasm":"sha384-Zu0PKAXSrvBd4nClc7FTqf8t09W7uRAWc2YmBIAR034z+1OvlXKfuy2rtJYRK1O7",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-cpp.wasm":"sha384-6jtxCqxvzrj0W6KdLsTkJgGEJ7xUu0FdOze/i65sExP677JorhwNO5M7BNN9wGKy",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-go.wasm":"sha384-nvmRtjoht+Wm50p8e4n+8CUZA5t0cqjbeS0goJk7miyxTvuKrKRRYnNEholPtJYu",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-java.wasm":"sha384-kEKCInE6rzvbBQTko4+4dtUNuC1J7IEGFugae33uvieVO08L4v6stIZwqekNEPZO",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-javascript.wasm":"sha384-0fu+05Ub/oCu75mgVR72amMy7ZfllKAhuVGvksmcW56Fu+jp3nwFyOSkwwuMx39S",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-php.wasm":"sha384-8Gr+sv8d06O+tS3ILN1BZfW3C+IW0yQ0FqnzLOX2QQ+X6KkN3UALWzh2c2d+Hxdd",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-python.wasm":"sha384-PjjIhAnAhBCggI7gTI2cvRWbgtKQC6J45/ZgYK3ba+4KR9VrM8/YaxIBcbeTzs1L",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-ruby.wasm":"sha384-IMXuZ4SylAZ04Ek9ejanZLq1g1njfmf3AbfAYHz0PlZPyMvNP+mrvrUpogdNSfDC",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-rust.wasm":"sha384-bBHsoSAu8Dc0Hhpm05fKErZ4p3usg+ekqgxa/xSL9c7HYyCKt1ujMN97XkL3diQE",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-tsx.wasm":"sha384-IOFFnA9OmCShfR8n2yycpGAPr1stXe240yaRrcsSoc+VtLi2uzW4WX2U/Apu9UMV",
    "https://cdn.jsdelivr.net/npm/tree-sitter-wasms@0.1.12/out/tree-sitter-typescript.wasm":"sha384-SM3CrnleafwPrVEDa2Tkp7xQfGKxWwhnqo309O+xLno6gdXx++YdcqggokbHJ38l"
  };
  const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  // bajty pliku zgodne z przypiętym skrótem albo wyjątek (plik spoza listy też jest odrzucany)
  async function fetchVerified(url){
    const want = HASHES[url]; if (!want) throw new Error('SRI: brak przypiętego skrótu dla ' + url);
    const r = await fetch(url, {credentials:'omit'}); if (!r.ok) throw new Error('CDN ' + r.status + ': ' + url);
    const buf = await r.arrayBuffer();
    const got = 'sha384-' + b64(await crypto.subtle.digest('SHA-384', buf));
    if (got !== want) throw new Error('SRI: plik z CDN nie zgadza się z przypiętym skrótem — ' + url.split('/').slice(-2).join('/'));
    return buf;
  }
  g.CM.SRI = { HASHES, integrity:(url)=>HASHES[url]||'', fetchVerified };
})(typeof self !== 'undefined' ? self : window);
