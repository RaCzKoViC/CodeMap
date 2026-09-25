# Wgrywa CodeMap na serwer (frontend + backend) i restartuje API.
# Użycie:  .\tools\deploy.ps1 -Server deploy@codemap.twojadomena.pl
param(
    [Parameter(Mandatory = $true)]
    [string]$Server,
    [string]$Domain = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot   # katalog projektu (D:\Projekty\CodeMap)

Write-Host "== CodeMap deploy -> $Server ==" -ForegroundColor Cyan

# 1. Frontend -> /opt/codemap/app/
Write-Host "[1/4] Frontend (index.html, sw.js, manifest, ikony, css/, js/)..."
$front = @("index.html", "sw.js", "manifest.webmanifest",
           "icon-192.png", "icon-512.png", "icon-maskable-512.png")
foreach ($f in $front) { scp -q (Join-Path $root $f) "${Server}:/opt/codemap/app/" }
scp -q -r (Join-Path $root "css") (Join-Path $root "js") "${Server}:/opt/codemap/app/"

# 2. Backend -> /opt/codemap/server/  (bez node_modules, data i .env)
Write-Host "[2/4] Backend (server/*.js, schema.sql, package*.json)..."
Get-ChildItem (Join-Path $root "server") -File |
    Where-Object { $_.Name -match '\.(js|sql|json)$' -and $_.Name -ne '.env' } |
    ForEach-Object { scp -q $_.FullName "${Server}:/opt/codemap/server/" }
scp -q (Join-Path $root "deploy\backup.sh") "${Server}:~/backup.sh"

# 3. Zależności + restart usługi
Write-Host "[3/4] npm ci + restart codemap-api..."
ssh $Server "cd /opt/codemap/server && npm ci --omit=dev --silent && sudo systemctl restart codemap-api"

# 4. Test zdrowia
Write-Host "[4/4] Test /api/health..."
if ($Domain -eq "") { $Domain = ($Server -split "@")[-1] }
$health = ssh $Server "curl -s -m 5 http://127.0.0.1:8787/api/health"
if ($health -match '"ok"\s*:\s*true') {
    Write-Host "OK: API dziala ($health). Sprawdz jeszcze https://$Domain" -ForegroundColor Green
} else {
    Write-Host "UWAGA: API nie odpowiada poprawnie: $health" -ForegroundColor Red
    Write-Host "Diagnoza: ssh $Server 'sudo journalctl -u codemap-api -n 50'"
    exit 1
}
