// Paczka npm z CLI (`codemap analyze …` przez npx) — przygotowanie i sprawdzenie, BEZ publikacji.
// Nazwa „codemap" jest w npm zajęta, więc publikuje się pod własnym zakresem (np. @login/codemap): narzędzie buduje
// katalog paczki (cli/ + tylko moduły js/ używane przez CLI + LICENSE + README), pakuje ją `npm pack`, instaluje
// tarball w katalogu tymczasowym i uruchamia zainstalowane `codemap analyze` na przykładowym projekcie.
//   node tools/npm-pack.mjs --name @login/codemap        → dist/npm/<nazwa>-<wersja>.tgz + test instalacji
//   potem (konto właściciela):  npm publish dist/npm/<plik>.tgz --access public
import { mkdtemp, mkdir, cp, writeFile, readFile, rm } from 'node:fs/promises';
import { execSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(import.meta.url), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const NAME = arg('name', '@raczkovic/codemap');
if (!/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(NAME)) { console.error('✖ nieprawidłowa nazwa paczki: ' + NAME); process.exit(2); }
const root = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const { CLI_MODULES, MCP_MODULES } = await import('file:///' + join(ROOT, 'cli/runtime.mjs').replace(/\\/g, '/'));
// npm przez powłokę (npm.cmd na Windows) z cytowanymi ścieżkami; zainstalowane CLI — bezpośrednio przez node
const q = (s) => '"' + String(s).replace(/"/g, '\\"') + '"';
const npm = (args, cwd) => execSync('npm ' + args.map((a) => (/^[\w@./:=-]+$/.test(a) ? a : q(a))).join(' '), { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// 1) katalog paczki
const pkgDir = await mkdtemp(join(tmpdir(), 'codemap-npm-'));
await cp(join(ROOT, 'cli'), join(pkgDir, 'cli'), { recursive: true });
await mkdir(join(pkgDir, 'js'));
for (const m of CLI_MODULES.concat(MCP_MODULES)) await cp(join(ROOT, 'js', m + '.js'), join(pkgDir, 'js', m + '.js'));
await cp(join(ROOT, 'LICENSE'), join(pkgDir, 'LICENSE'));
await cp(join(ROOT, 'README.md'), join(pkgDir, 'README.md'));
await writeFile(join(pkgDir, 'package.json'), JSON.stringify({
  name: NAME, version: root.version,
  description: 'CodeMap CLI — code map analysis in CI: health score, dependency cycles, architecture rules, git hotspots, SARIF and Markdown reports. No build step, no network.',
  license: root.license, homepage: root.homepage, repository: root.repository, bugs: { url: 'https://github.com/RaCzKoViC/CodeMap/issues' },
  bin: { codemap: 'cli/codemap.mjs' }, engines: root.engines, files: ['cli/', 'js/', 'LICENSE', 'README.md'],
  keywords: ['code-map', 'dependency-graph', 'static-analysis', 'code-health', 'sarif', 'git-hotspots', 'architecture', 'cli'],
}, null, 2) + '\n');

// 2) npm pack → dist/npm/
const out = join(ROOT, 'dist', 'npm'); await mkdir(out, { recursive: true });
const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', out], pkgDir))[0];
const tgz = join(out, packed.filename);
console.log(`✔ ${packed.name}@${packed.version}: ${packed.entryCount} plików, ${(packed.size / 1024).toFixed(0)} KB (rozpakowane ${(packed.unpackedSize / 1024).toFixed(0)} KB)`);

// 3) instalacja tarballa w pustym projekcie i uruchomienie zainstalowanego CLI na małym projekcie
const app = await mkdtemp(join(tmpdir(), 'codemap-npm-try-'));
await writeFile(join(app, 'package.json'), '{"name":"try","version":"1.0.0","private":true}\n');
npm(['install', '--no-audit', '--no-fund', '--silent', tgz], app);
const proj = join(app, 'proj'); await mkdir(join(proj, 'src', 'lib'), { recursive: true });
await writeFile(join(proj, 'src', 'app.js'), "import { u } from './lib/util.js';\nexport const run = () => u();\n");
await writeFile(join(proj, 'src', 'lib', 'util.js'), "import { run } from '../app.js';\nexport function u(){ if (Math.random() > 2) return run(); return 1; }\n");
const bin = join(app, 'node_modules', ...NAME.split('/'), 'cli', 'codemap.mjs');
const report = join(app, 'report.json');
execFileSync(process.execPath, [bin, 'analyze', proj, '--quiet', '--no-git', '--json', report], { cwd: app, stdio: ['ignore', 'pipe', 'pipe'] });
const rep = JSON.parse(await readFile(report, 'utf8'));
const cycles = (rep.findings || []).find((f) => f.rule === 'cycles');
if (!(rep.score >= 0 && cycles && cycles.count >= 1)) { console.error('✖ zainstalowane CLI dało nieoczekiwany raport: ' + JSON.stringify(rep).slice(0, 300)); process.exit(1); }
console.log(`✔ po instalacji: codemap analyze działa (wynik ${rep.score}/100, cykl zależności wykryty)`);
// serwer MCP z zainstalowanej paczki: initialize + jedno narzędzie (moduły MCP_MODULES muszą być w paczce)
const mcpIn = [{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
  { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'cycles', arguments: {} } }].map((m) => JSON.stringify(m)).join('\n') + '\n';
const mcpOut = execFileSync(process.execPath, [bin, 'mcp', proj, '--no-git'], { cwd: app, input: mcpIn, stdio: ['pipe', 'pipe', 'pipe'] }).toString();
const mcpMsgs = mcpOut.trim().split('\n').map((l) => JSON.parse(l)), cyc = mcpMsgs.find((m) => m.id === 2);
if (!cyc || cyc.result.isError || !/import cycle/.test(cyc.result.content[0].text)) throw new Error('codemap mcp po instalacji nie działa: ' + mcpOut.slice(0, 300));
console.log('✔ po instalacji: codemap mcp odpowiada (initialize, narzędzie cycles)');
await rm(pkgDir, { recursive: true, force: true }); await rm(app, { recursive: true, force: true });
console.log(`\nPublikacja (konto npm właściciela zakresu ${NAME.startsWith('@') ? NAME.split('/')[0] : '—'}):\n  npm publish ${tgz} --access public\nPotem: npx ${NAME} analyze .`);
