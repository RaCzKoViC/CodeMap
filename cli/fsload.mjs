// Wczytanie projektu z dysku z tymi samymi regułami co przeglądarka (js/loaders.js → fromFileList):
// katalogi z CM.Loaders.shouldSkip (node_modules, dist, build, coverage, .git…) pomijane, treść tylko dla
// plików tekstowych wg CM.languages do TEXT_SIZE_LIMIT, najwyżej MAX_CONTENT_FILES plików z treścią;
// raporty pokrycia (RE_COVERAGE, do 5 segmentów ścieżki, poza node_modules/.git) zbierane także z katalogów
// pomijanych — jak pliki „boczne" w przeglądarce. Różnice (celowe): kolejność deterministyczna (alfabetyczna),
// dowiązania symboliczne pomijane (brak pętli), archiwa i PDF-y nie są rozpakowywane (zwykłe pliki binarne).
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const NEVER = /^(\.git|node_modules)$/i;   // tu nawet raportów pokrycia nie szukamy
const COV_MAX_SEGS = 5;

/**
 * @param {string} root  katalog projektu (absolutny)
 * @param {object} CM    moduły z cli/runtime.mjs (Loaders, Rules)
 * @param {{maxContent?:number, exclude?:string[]}} opts
 * @returns {{files:{path,size,content,mtime}[], coverage:string[], stats:{files,content,capped,symlinks,excluded,maxContent}}}
 */
export function loadProjectFiles(root, CM, opts = {}) {
  const L = CM.Loaders;
  const maxContent = opts.maxContent != null ? opts.maxContent : L.MAX_CONTENT_FILES;
  const exclude = (opts.exclude || []).filter(Boolean);
  const isExcluded = (rel) => exclude.length > 0 && CM.Rules.matchGlob(exclude, rel);
  const dec = new TextDecoder('utf-8');   // jak FileReader.readAsText: UTF-8, BOM zdjęty, złe bajty → U+FFFD
  const files = [], coverage = [];
  const stats = { files: 0, content: 0, capped: 0, symlinks: 0, excluded: 0, maxContent };
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

  // tylko raporty pokrycia w katalogu pomijanym (coverage/, build/, target/…)
  const walkSide = (abs, rel) => {
    let ents; try { ents = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort(byName)) {
      const r = rel + '/' + e.name, segs = r.split('/').length;
      if (e.isDirectory()) { if (!NEVER.test(e.name) && segs < COV_MAX_SEGS) walkSide(join(abs, e.name), r); }
      else if (e.isFile() && segs <= COV_MAX_SEGS && L.RE_COVERAGE.test(r)) coverage.push(r);
    }
  };
  const walk = (abs, rel) => {
    let ents; try { ents = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents.sort(byName)) {
      const r = rel ? rel + '/' + e.name : e.name, p = join(abs, e.name);
      if (e.isSymbolicLink()) { stats.symlinks++; continue; }
      if (e.isDirectory()) {
        if (L.shouldSkip(r)) { if (!NEVER.test(e.name) && r.split('/').length < COV_MAX_SEGS) walkSide(p, r); continue; }
        if (isExcluded(r)) { stats.excluded++; continue; }
        walk(p, r);
        continue;
      }
      if (!e.isFile()) continue;
      if (r.split('/').length <= COV_MAX_SEGS && L.RE_COVERAGE.test(r)) coverage.push(r);
      if (L.shouldSkip(r)) continue;                     // .DS_Store, Thumbs.db
      if (isExcluded(r)) { stats.excluded++; continue; }
      let st; try { st = statSync(p); } catch { continue; }
      let content = null;
      if (L.isTextFile(e.name, st.size)) {
        if (stats.content < maxContent) {
          try { content = dec.decode(readFileSync(p)); stats.content++; } catch { content = null; }
        } else stats.capped++;
      }
      files.push({ path: r, size: st.size, content, mtime: Math.round(st.mtimeMs) || null });
    }
  };
  walk(root, '');
  stats.files = files.length;
  return { files, coverage, stats };
}
