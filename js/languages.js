/* ===================== languages.js — file type registry ===================== */
CM.languages = (function(){

  // category -> base color
  const CAT = {
    code:    '#22d3ee',
    web:     '#f59e0b',
    data:    '#a78bfa',
    config:  '#94a3b8',
    doc:     '#34d399',
    image:   '#f472b6',
    media:   '#fb7185',
    archive: '#c084fc',
    binary:  '#64748b',
    style:   '#38bdf8',
    shell:   '#84cc16',
    shader:  '#9d6cff',
    model:   '#f0883e',
    cert:    '#facc15',
    other:   '#7d8aa0',
  };

  // ext (lowercase, no dot) -> {name, color, cat, text:boolean}
  // text:true => contents are read for analysis
  const E = {};
  function def(exts, name, color, cat, text=true){
    for(const e of exts.split(' ')) E[e] = {name, color, cat, text};
  }

  // ---- programming languages ----
  def('js mjs cjs', 'JavaScript', '#f7df1e', 'code');
  def('jsx', 'React JSX', '#61dafb', 'code');
  def('ts mts cts', 'TypeScript', '#3178c6', 'code');
  def('tsx', 'React TSX', '#3178c6', 'code');
  def('py pyw pyi', 'Python', '#3776ab', 'code');
  def('rb erb rake', 'Ruby', '#cc342d', 'code');
  def('php phtml', 'PHP', '#777bb4', 'code');
  def('java', 'Java', '#f89820', 'code');
  def('kt kts', 'Kotlin', '#a97bff', 'code');
  def('scala sc', 'Scala', '#dc322f', 'code');
  def('groovy gradle', 'Groovy/Gradle', '#4298b8', 'code');
  def('go', 'Go', '#00add8', 'code');
  def('rs', 'Rust', '#dea584', 'code');
  def('c h', 'C', '#a8b9cc', 'code');
  def('cpp cc cxx hpp hh hxx ipp', 'C++', '#00599c', 'code');
  def('cs', 'C#', '#9b4f96', 'code');
  def('fs fsx fsi', 'F#', '#378bba', 'code');
  def('vb', 'Visual Basic', '#945db7', 'code');
  def('swift', 'Swift', '#f05138', 'code');
  def('m mm', 'Objective-C', '#438eff', 'code');
  def('dart', 'Dart', '#0175c2', 'code');
  def('lua', 'Lua', '#000080', 'code');
  def('pl pm', 'Perl', '#39457e', 'code');
  def('r rmd', 'R', '#276dc3', 'code');
  def('jl', 'Julia', '#9558b2', 'code');
  def('hs lhs', 'Haskell', '#5e5086', 'code');
  def('ml mli', 'OCaml', '#ec6813', 'code');
  def('ex exs', 'Elixir', '#6e4a7e', 'code');
  def('erl hrl', 'Erlang', '#a90533', 'code');
  def('clj cljs cljc edn', 'Clojure', '#5881d8', 'code');
  def('elm', 'Elm', '#60b5cc', 'code');
  def('nim', 'Nim', '#ffe953', 'code');
  def('zig', 'Zig', '#f7a41d', 'code');
  def('cr', 'Crystal', '#cccccc', 'code');
  def('v', 'V', '#5d87bd', 'code');
  def('d', 'D', '#ba595e', 'code');
  def('pas pp', 'Pascal', '#e3f171', 'code');
  def('asm s', 'Assembly', '#6e4c13', 'code');
  def('sol', 'Solidity', '#aa6746', 'code');
  def('sql', 'SQL', '#e38c00', 'data');
  def('graphql gql', 'GraphQL', '#e10098', 'code');
  def('proto', 'Protobuf', '#90a4ae', 'code');
  def('wasm wat', 'WebAssembly', '#654ff0', 'code', false);
  def('ipynb', 'Jupyter', '#f37626', 'code');
  def('vue', 'Vue', '#42b883', 'web');
  def('svelte', 'Svelte', '#ff3e00', 'web');
  def('astro', 'Astro', '#ff5d01', 'web');

  // ---- web / markup / style ----
  def('html htm xhtml', 'HTML', '#e34f26', 'web');
  def('css', 'CSS', '#1572b6', 'style');
  def('scss sass', 'Sass', '#cc6699', 'style');
  def('less', 'Less', '#1d365d', 'style');
  def('styl', 'Stylus', '#ff6347', 'style');
  def('ejs hbs handlebars mustache pug jade twig njk', 'Template', '#e8a33d', 'web');

  // ---- shell / scripts ----
  def('sh bash zsh fish', 'Shell', '#89e051', 'shell');
  def('ps1 psm1 psd1', 'PowerShell', '#012456', 'shell');
  def('bat cmd', 'Batch', '#c1f12e', 'shell');
  def('dockerfile', 'Dockerfile', '#2496ed', 'config');
  def('makefile mk', 'Makefile', '#427819', 'config');
  def('cmake', 'CMake', '#064f8c', 'config');

  // ---- data / config ----
  def('json json5 jsonc', 'JSON', '#cbcb41', 'data');
  def('yaml yml', 'YAML', '#cb171e', 'data');
  def('toml', 'TOML', '#9c4221', 'config');
  def('xml', 'XML', '#0060ac', 'data');
  def('csv tsv', 'CSV/TSV', '#36c5a8', 'data');
  def('ini cfg conf properties env', 'Config', '#6d8086', 'config');
  def('lock', 'Lockfile', '#8b949e', 'config');
  def('plist', 'Plist', '#90a4ae', 'config');
  def('parquet avro orc', 'Columnar data', '#a78bfa', 'data', false);

  // ---- docs ----
  def('md markdown mdx', 'Markdown', '#519aba', 'doc');
  def('rst', 'reStructuredText', '#519aba', 'doc');
  def('txt text log', 'Tekst', '#9aa7b3', 'doc');
  def('adoc asciidoc', 'AsciiDoc', '#519aba', 'doc');
  def('tex bib', 'LaTeX', '#3d6117', 'doc');
  def('pdf', 'PDF', '#f40f02', 'doc', false);
  def('doc docx', 'Word', '#2b579a', 'doc', false);
  def('xls xlsx', 'Excel', '#217346', 'doc', false);
  def('ppt pptx', 'PowerPoint', '#d24726', 'doc', false);
  def('rtf odt ods odp', 'Dokument', '#3d6117', 'doc', false);
  def('epub mobi', 'E-book', '#85be4b', 'doc', false);

  // ---- images ----
  def('png apng', 'PNG', '#f472b6', 'image', false);
  def('jpg jpeg jfif', 'JPEG', '#f472b6', 'image', false);
  def('gif', 'GIF', '#f472b6', 'image', false);
  def('webp avif heic heif', 'Obraz', '#f472b6', 'image', false);
  def('svg', 'SVG', '#ffb13b', 'image');
  def('bmp tiff tif ico cur', 'Bitmapa', '#ec4899', 'image', false);
  def('psd ai xcf sketch fig xd', 'Projekt graficzny', '#db4dad', 'image', false);

  // ---- media ----
  def('mp4 mkv mov avi webm flv wmv m4v mpg mpeg', 'Wideo', '#fb7185', 'media', false);
  def('mp3 wav flac aac ogg m4a wma opus mid midi', 'Audio', '#f472b6', 'media', false);
  def('ttf otf woff woff2 eot', 'Czcionka', '#8b5cf6', 'media', false);

  // ---- archives / binaries ----
  def('zip rar 7z tar gz bz2 xz zst tgz', 'Archiwum', '#c084fc', 'archive', false);
  def('exe dll so dylib bin app msi deb rpm appimage', 'Binarka', '#64748b', 'binary', false);
  def('o a lib obj class pyc pyo node', 'Skompilowane', '#64748b', 'binary', false);
  def('db sqlite sqlite3 mdb dat', 'Baza danych', '#dd6b20', 'data', false);
  def('iso img dmg', 'Obraz dysku', '#64748b', 'binary', false);

  // ============ EXTENDED: aim for "every language / every format" ============
  // ---- more programming languages ----
  def('coffee', 'CoffeeScript', '#244776', 'code');
  def('litcoffee', 'Literate CoffeeScript', '#244776', 'code');
  def('ls', 'LiveScript', '#499886', 'code');
  def('cjsx', 'CoffeeScript JSX', '#244776', 'code');
  def('gd', 'GDScript', '#478cbf', 'code');
  def('gdshader', 'Godot Shader', '#478cbf', 'shader');
  def('tscn tres', 'Godot Scene', '#478cbf', 'config', false);
  def('nut', 'Squirrel', '#800000', 'code');
  def('ahk ahkl', 'AutoHotkey', '#6594b9', 'code');
  def('au3', 'AutoIt', '#1f70c1', 'code');
  def('applescript scpt', 'AppleScript', '#101f1f', 'code');
  def('vbs vbe', 'VBScript', '#945db7', 'code');
  def('ps', 'PostScript', '#da291c', 'code', false);
  def('rkt', 'Racket', '#3c5caa', 'code');
  def('scm ss', 'Scheme', '#1e4aec', 'code');
  def('lisp lsp cl', 'Lisp', '#3fb68b', 'code');
  def('el', 'Emacs Lisp', '#7f5ab6', 'code');
  def('hx', 'Haxe', '#df7900', 'code');
  def('hxml', 'Haxe build', '#df7900', 'config');
  def('gleam', 'Gleam', '#ffaff3', 'code');
  def('roc', 'Roc', '#7c38f5', 'code');
  def('odin', 'Odin', '#3882d2', 'code');
  def('jai', 'Jai', '#a31515', 'code');
  def('mojo', 'Mojo', '#ff5f1f', 'code');
  def('move', 'Move', '#4a90d9', 'code');
  def('cairo', 'Cairo', '#f5a623', 'code');
  def('vy', 'Vyper', '#2980b9', 'code');
  def('fe', 'Fe', '#a31515', 'code');
  def('ada adb ads', 'Ada', '#02f88c', 'code');
  def('cob cbl cobol cpy', 'COBOL', '#005ca5', 'code');
  def('f f77 f90 f95 f03 f08 for fortran', 'Fortran', '#734f96', 'code');
  def('pro', 'Prolog', '#74283c', 'code');
  def('tcl tk', 'Tcl', '#e4cc98', 'code');
  def('awk', 'AWK', '#84cc16', 'shell');
  def('sed', 'sed', '#84cc16', 'shell');
  def('vala vapi', 'Vala', '#a56de2', 'code');
  def('re rei', 'Reason', '#dd4b39', 'code');
  def('res resi', 'ReScript', '#e6484f', 'code');
  def('purs', 'PureScript', '#1d222d', 'code');
  def('idr', 'Idris', '#b30000', 'code');
  def('agda', 'Agda', '#315aab', 'code');
  def('lean', 'Lean', '#572e8a', 'code');
  def('vhd vhdl', 'VHDL', '#adb2cb', 'code');
  def('sv svh vams', 'SystemVerilog', '#dae1c2', 'code');
  def('verilog vh', 'Verilog', '#b2b7f8', 'code');
  def('mat', 'MATLAB data', '#e16737', 'data', false);
  def('nb wl wls', 'Mathematica', '#dd1100', 'code');
  def('sas', 'SAS', '#1f5b9f', 'code');
  def('do ado', 'Stata', '#1a5b8a', 'code');
  def('abap', 'ABAP', '#0a6ed1', 'code');
  def('hack', 'Hack', '#878787', 'code');
  def('raku rakumod rakudoc p6 pl6 pm6', 'Raku', '#0000fb', 'code');
  def('bal', 'Ballerina', '#ff5000', 'code');
  def('pony', 'Pony', '#bb86c1', 'code');
  def('red reds', 'Red', '#f50000', 'code');
  def('factor', 'Factor', '#636746', 'code');
  def('fth 4th forth', 'Forth', '#341708', 'code');
  def('ijs', 'J', '#9eedff', 'code');
  def('apl', 'APL', '#5a8164', 'code');
  def('st', 'Smalltalk', '#596706', 'code');
  def('e', 'Eiffel', '#4d6977', 'code');
  def('mod', 'Modula', '#10253f', 'code');
  def('boo', 'Boo', '#d4bec1', 'code');
  def('n', 'Nemerle', '#3d3c6e', 'code');
  def('p prg', 'xBase', '#403a40', 'code');
  def('4gl', '4GL', '#149dcc', 'code');
  def('ring', 'Ring', '#2d54cb', 'code');
  def('wren', 'Wren', '#383838', 'code');
  def('janet', 'Janet', '#aa77cc', 'code');
  def('hy', 'Hy', '#7790b0', 'code');
  def('fnl', 'Fennel', '#fff3d7', 'code');
  def('rkt2', 'Racket', '#3c5caa', 'code');
  def('chpl', 'Chapel', '#8dc63f', 'code');
  def('x10', 'X10', '#4b6baf', 'code');
  def('pike pmod', 'Pike', '#005390', 'code');
  def('q', 'q/kdb+', '#0040cd', 'code');
  def('zs zscript', 'ZenScript', '#bf85cc', 'code');
  def('rpy', "Ren'Py", '#ff7f7f', 'code');
  def('nim nims nimble', 'Nim', '#ffe953', 'code');
  def('zig2', 'Zig', '#f7a41d', 'code');

  // ---- shaders / GPU / graphics programming ----
  def('glsl vert frag geom tesc tese comp', 'GLSL', '#5586a4', 'shader');
  def('hlsl fx fxh cginc', 'HLSL', '#5586a4', 'shader');
  def('wgsl', 'WGSL', '#5586a4', 'shader');
  def('metal', 'Metal', '#5586a4', 'shader');
  def('shader', 'Shader', '#5586a4', 'shader');
  def('cg', 'Cg', '#5586a4', 'shader');
  def('cu cuh', 'CUDA', '#3a4e3a', 'code');

  // ---- web frameworks / templates ----
  def('cshtml razor', 'Razor', '#512bd4', 'web');
  def('blade', 'Blade', '#f55247', 'web');
  def('liquid', 'Liquid', '#67b246', 'web');
  def('slim', 'Slim', '#2f2f2f', 'web');
  def('haml', 'Haml', '#ece2a9', 'web');
  def('eex leex heex', 'EEx (Elixir)', '#6e4a7e', 'web');
  def('gohtml tmpl tpl gotmpl', 'Go template', '#00add8', 'web');
  def('jinja jinja2 j2', 'Jinja', '#b41717', 'web');
  def('marko', 'Marko', '#0a7eea', 'web');
  def('mjml', 'MJML', '#ef6b4f', 'web');
  def('xaml axaml', 'XAML', '#0c54c2', 'web', true);
  def('asp aspx ascx ashx asmx', 'ASP.NET', '#512bd4', 'web');
  def('jsp jspx tagx', 'JSP', '#f89820', 'web');
  def('cfm cfc', 'ColdFusion', '#ed2e2e', 'web');
  def('qml', 'QML', '#41cd52', 'web');

  // ---- style preprocessors ----
  def('pcss postcss sss', 'PostCSS', '#dd3a0a', 'style');

  // ---- data / serialization / IaC ----
  def('thrift', 'Thrift', '#d12127', 'data');
  def('capnp', "Cap'n Proto", '#c53a32', 'data');
  def('fbs', 'FlatBuffers', '#3b8c9b', 'data');
  def('hcl tf tfvars', 'Terraform/HCL', '#7b42bc', 'config');
  def('tfstate', 'Terraform state', '#7b42bc', 'data', false);
  def('cue', 'CUE', '#ef7b4d', 'config');
  def('dhall', 'Dhall', '#dfafff', 'config');
  def('jsonnet libsonnet', 'Jsonnet', '#0064bd', 'config');
  def('ron', 'RON', '#dea584', 'data');
  def('pkl', 'Pkl', '#6b9bff', 'config');
  def('ndjson jsonl', 'JSON Lines', '#cbcb41', 'data');
  def('geojson topojson', 'GeoJSON', '#36c5a8', 'data');
  def('rss atom', 'RSS/Atom', '#ee802f', 'data');
  def('ics ical', 'iCalendar', '#36c5a8', 'data', false);
  def('vcf', 'vCard', '#36c5a8', 'data', false);
  def('npy npz', 'NumPy', '#4dabcf', 'data', false);
  def('rdata rds', 'R data', '#276dc3', 'data', false);
  def('sav', 'SPSS', '#a51e22', 'data', false);
  def('dta', 'Stata data', '#1a5b8a', 'data', false);
  def('feather arrow', 'Apache Arrow', '#a78bfa', 'data', false);
  def('h5 hdf5', 'HDF5', '#a78bfa', 'data', false);
  def('bson', 'BSON', '#a78bfa', 'data', false);

  // ---- build / project / config ----
  def('bzl bazel', 'Bazel', '#43a047', 'config');
  def('buck', 'Buck', '#43a047', 'config');
  def('ninja', 'Ninja', '#999', 'config');
  def('sbt', 'sbt', '#dc322f', 'config');
  def('nix', 'Nix', '#7e7eff', 'config');
  def('cabal', 'Cabal', '#5e5086', 'config');
  def('podspec', 'CocoaPods', '#ee3322', 'config');
  def('gradle2 kts2', 'Gradle', '#02303a', 'config');
  def('sln csproj vbproj fsproj vcxproj props targets', 'MSBuild/Project', '#9b4f96', 'config');
  def('xcodeproj pbxproj xcconfig', 'Xcode', '#1575f9', 'config');
  def('cnf', 'Config', '#6d8086', 'config');
  def('terraformrc tfrc', 'Terraform config', '#7b42bc', 'config');
  def('gitconfig gitmodules', 'Git config', '#f14e32', 'config');

  // ---- docs / markup extras ----
  def('org', 'Org mode', '#77aa99', 'doc');
  def('wiki mediawiki', 'Wiki', '#519aba', 'doc');
  def('textile', 'Textile', '#519aba', 'doc');
  def('creole', 'Creole', '#519aba', 'doc');
  def('pod', 'Perl POD', '#39457e', 'doc');
  def('man roff troff nroff me ms', 'roff/man', '#9aa7b3', 'doc');
  def('texi texinfo', 'Texinfo', '#3d6117', 'doc');
  def('nfo', 'NFO', '#9aa7b3', 'doc');
  def('srt vtt sub ass ssa', 'Napisy', '#9aa7b3', 'doc', false);

  // ---- shells / ops ----
  def('nu', 'Nushell', '#3aa675', 'shell');
  def('csh tcsh ksh', 'Shell', '#89e051', 'shell');
  def('expect', 'Expect', '#89e051', 'shell');
  def('jenkinsfile', 'Jenkinsfile', '#d24939', 'config');
  def('service socket timer mount target', 'systemd unit', '#30d475', 'config');
  def('desktop', 'Desktop entry', '#30d475', 'config');
  def('reg', 'Windows Registry', '#00a4ef', 'config', false);
  def('inf manifest', 'Manifest', '#94a3b8', 'config');

  // ---- security / keys / certs ----
  def('pem crt cer der', 'Certyfikat', '#facc15', 'cert', false);
  def('key pub ppk', 'Klucz', '#facc15', 'cert', false);
  def('gpg asc sig', 'Podpis/PGP', '#facc15', 'cert', false);
  def('p12 pfx jks keystore', 'Keystore', '#facc15', 'cert', false);
  def('htpasswd', 'htpasswd', '#facc15', 'cert', false);

  // ---- 3D / CAD / design extra ----
  def('obj3d fbx gltf glb stl ply dae blend usd usdz 3ds c4d max ma mb', 'Model 3D', '#f0883e', 'model', false);
  def('step stp iges igs dwg dxf', 'CAD', '#f0883e', 'model', false);
  def('exr hdr tga jp2 jxl pbm pgm ppm pnm xpm', 'Obraz (raster)', '#f472b6', 'image', false);
  def('cr2 nef arw dng raf orf rw2', 'RAW (foto)', '#f472b6', 'image', false);
  def('pfb pfm fon fnt', 'Czcionka', '#8b5cf6', 'media', false);

  // ---- media extra ----
  def('3gp 3g2 ogv vob ts2 mts2 m2ts', 'Wideo', '#fb7185', 'media', false);
  def('aiff aif amr ape dsf dff wv', 'Audio', '#f472b6', 'media', false);

  // ---- archives / packages extra ----
  def('lz lzma lz4 br z taz tbz tbz2 txz cpio pak arj cab', 'Archiwum', '#c084fc', 'archive', false);
  def('jar war ear', 'Archiwum Java', '#f89820', 'archive', false);
  def('apk aab ipa', 'Pakiet mobilny', '#a4c639', 'archive', false);
  def('whl gem nupkg crate xpi vsix pkg crx', 'Pakiet', '#c084fc', 'archive', false);

  // ---- binaries / db extra ----
  def('elf ko sys out com scr drv', 'Binarka', '#64748b', 'binary', false);
  def('accdb frm myd myi ibd rdb ldb realm', 'Baza danych', '#dd6b20', 'data', false);
  def('wasm2', 'WebAssembly', '#654ff0', 'code', false);

  // ---- misc / temp ----
  def('bak old orig tmp temp swp swo cache pid sock', 'Tymczasowy', '#5d6b7d', 'other', false);
  def('patch diff', 'Patch/Diff', '#22d3ee', 'code');
  def('http rest', 'HTTP request', '#22d3ee', 'data');

  // special filenames (no extension or whole-name match)
  const NAMES = {
    'dockerfile':'dockerfile','containerfile':'dockerfile','makefile':'makefile','gnumakefile':'makefile',
    'cmakelists.txt':'cmake','meson.build':'config','build':'config','workspace':'config',
    'sconstruct':'config','sconscript':'config','vagrantfile':'rb','brewfile':'rb',
    '.gitignore':'config','.gitattributes':'config','.gitmodules':'config','.editorconfig':'config',
    '.env':'config','.npmrc':'config','.yarnrc':'config','.nvmrc':'config','.babelrc':'json','.eslintrc':'json',
    '.prettierrc':'json','.stylelintrc':'json','.huskyrc':'json','.eslintignore':'config','.prettierignore':'config',
    '.tool-versions':'config','.ruby-version':'config','.python-version':'config','.node-version':'config',
    'license':'doc','licence':'doc','readme':'doc','changelog':'doc','authors':'doc','contributors':'doc',
    'notice':'doc','copying':'doc','codeowners':'config','contributing':'doc','code_of_conduct':'doc',
    'package.json':'json','package-lock.json':'json','tsconfig.json':'json','jsconfig.json':'json',
    'go.mod':'config','go.sum':'config','cargo.toml':'toml','cargo.lock':'toml','pyproject.toml':'toml',
    'pipfile':'toml','poetry.lock':'toml','requirements.txt':'config','setup.py':'py','setup.cfg':'config',
    'gemfile':'rb','gemfile.lock':'config','rakefile':'rake','procfile':'config','.dockerignore':'config',
    'jenkinsfile':'jenkinsfile','.htaccess':'cert','.htpasswd':'htpasswd','.bashrc':'sh','.zshrc':'sh',
    '.bash_profile':'sh','.profile':'sh','.vimrc':'config','.gitkeep':'other','.ds_store':'other',
    'thumbs.db':'other','webpack.config.js':'js','vite.config.js':'js','rollup.config.js':'js',
  };

  // best-effort category guess for completely unknown extensions, so "every format" still lands somewhere sensible
  const HINT = [
    [/^(t|s|x|q)?html?$|tmpl|tpl|view|page$/, 'web'],
    [/css|sass|scss|less|styl/, 'style'],
    [/json|ya?ml|toml|xml|csv|tsv|sql|db|data|dump|dat|proto|avro|parquet/, 'data'],
    [/png|jpe?g|gif|webp|svg|bmp|tiff?|ico|raw|psd|ai|heic|exr|hdr|tga/, 'image'],
    [/mp[34]|mkv|mov|avi|wav|flac|ogg|aac|midi?|webm|wmv|flv/, 'media'],
    [/zip|rar|tar|gz|7z|xz|bz2|zst|pkg|deb|rpm|whl|gem|jar|war/, 'archive'],
    [/exe|dll|so|dylib|bin|elf|obj|class|wasm|o$|a$|lib/, 'binary'],
    [/md|txt|rst|doc|pdf|rtf|tex|man|adoc|wiki|log/, 'doc'],
    [/sh$|bash|zsh|fish|bat|cmd|ps1|ksh|awk/, 'shell'],
    [/ya?ml|conf|cfg|ini|config|rc$|env|lock|properties|settings/, 'config'],
    [/pem|crt|cer|key|gpg|sig|cert|pfx|p12/, 'cert'],
    [/glsl|hlsl|wgsl|shader|frag|vert|metal/, 'shader'],
    [/c$|cc|cpp|h$|hpp|py|js|ts|rs|go|rb|php|java|kt|swift|cs|lua|pl|r$|jl|ex|clj|hs|ml|fs|vb|asm|sql|scala|dart|sol/, 'code'],
  ];
  function guessCat(ext){
    for(const [re,cat] of HINT) if(re.test(ext)) return cat;
    return 'other';
  }

  function lookup(filename){
    const lower = filename.toLowerCase();
    // whole-name match
    if(NAMES[lower]){ const k = NAMES[lower]; if(E[k]) return {key:k, ...E[k]}; }
    const base = lower.replace(/^.*\//,'');
    if(NAMES[base]){ const k = NAMES[base]; if(E[k]) return {key:k, ...E[k]}; }
    // extension match (handle .tar.gz etc -> last ext)
    const dot = base.lastIndexOf('.');
    let ext = dot > 0 ? base.slice(dot+1) : '';
    if(base.startsWith('.') && dot === 0) ext = ''; // dotfile w/o ext
    if(ext && E[ext]) return {key:ext, ...E[ext]};
    // dotfiles like .gitignore handled above; fallback
    if(!ext){
      // extensionless: treat as config-ish dotfile or generic text file
      const cat = base.startsWith('.') ? 'config' : 'other';
      return {key: base.startsWith('.') ? base : 'other', name: base.startsWith('.')?base:'Plik',
              color: CAT[cat], cat, text:true};
    }
    // unknown extension -> guess a category, deterministic color, still readable as text if likely
    const cat = guessCat(ext);
    const textual = !['image','media','archive','binary','model'].includes(cat);
    return {key:ext, name:ext.toUpperCase(), color:CM.util.colorFromString(ext), cat, text:textual};
  }

  function catColor(cat){ return CAT[cat] || CAT.other; }

  return {lookup, catColor, CAT, glyph};

  // small letter glyph for a node icon
  function glyph(info){
    const map = {image:'🖼',media:'♪',archive:'🗜',binary:'⬡',doc:'📄',data:'▤',pdf:'📕'};
    if(info.cat === 'image') return '🖼';
    if(info.cat === 'media') return '♪';
    if(info.cat === 'archive') return '🗜';
    if(info.cat === 'binary') return '⬡';
    return (info.name||'?').charAt(0).toUpperCase();
  }
})();
