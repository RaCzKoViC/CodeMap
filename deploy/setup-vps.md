# CodeMap — instrukcja wdrożenia na Hetzner Cloud (krok po kroku)

Koszt całości: **~5–6 €/mies. (~25 zł)**. Czas: ~1–2 h przy pierwszym podejściu.

## 1. Jaki serwer kupić

| Parametr | Wybór |
|---|---|
| Typ | **Hetzner Cloud CX22** (2 vCPU x86, 4 GB RAM, 40 GB NVMe, 20 TB transferu, ~4–5 €/mies.) |
| Lokalizacja | **Falkenstein (fsn1)** — Niemcy, ~25–35 ms z Polski |
| System | **Ubuntu 24.04 LTS** |
| Sieć | **Public IPv4** (+~0,60 €) + IPv6 |
| Backups | **Włącz** (+20% ceny, ~0,80 €) — 7 automatycznych obrazów serwera |

Gdy zabraknie dysku: dokup Volume (0,044 €/GB/mies.) — bez reinstalacji.

## 2. Zanim kupisz — klucz SSH (na Windowsie, PowerShell)

```powershell
ssh-keygen -t ed25519 -C "codemap-hetzner"          # Enter na wszystkie pytania
Get-Content ~\.ssh\id_ed25519.pub | Set-Clipboard    # klucz publiczny → schowek
```

## 3. Utworzenie serwera

1. Konto na https://console.hetzner.cloud (karta/PayPal; nowe konta przechodzą krótką weryfikację).
2. **New project** → `codemap` → **Add Server**:
   - Location: **Falkenstein** • Image: **Ubuntu 24.04** • Type: Shared vCPU x86 → **CX22**
   - Networking: zaznacz **Public IPv4** i IPv6
   - SSH keys: **Add SSH key** → wklej klucz ze schowka
   - Firewalls: **Create Firewall** → reguły inbound: **TCP 22, TCP 80, TCP 443** (nic więcej)
   - Backups: **włącz** • Name: `codemap-1`
3. **Create & Buy Now** → po ~30 s zanotuj **publiczny adres IPv4**.

## 4. DNS (u rejestratora Twojej domeny)

| Typ | Nazwa | Wartość |
|---|---|---|
| A | `codemap` (subdomena) | IPv4 serwera |
| AAAA | `codemap` | IPv6 serwera (opcjonalnie) |

Sprawdzenie (do 1 h): `nslookup codemap.twojadomena.pl`

## 5. Pierwsze logowanie i utwardzenie (jako root)

```bash
ssh root@ADRES_IP

apt update && apt upgrade -y
adduser deploy && usermod -aG sudo deploy                      # administrator (SSH)
adduser --system --group --home /opt/codemap codemap           # użytkownik usługi (bez logowania)
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/; s/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl restart ssh
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
apt install -y unattended-upgrades sqlite3 && dpkg-reconfigure -plow unattended-upgrades
```

Od teraz logujesz się: `ssh deploy@ADRES_IP`.

## 6. Node.js 22 + Caddy

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

## 7. Katalogi i konfiguracja

```bash
sudo mkdir -p /opt/codemap/{app,server,data/blobs,backups}
sudo chown -R codemap:codemap /opt/codemap/data && sudo chmod 700 /opt/codemap/data
sudo chown -R deploy:deploy /opt/codemap/app /opt/codemap/server
```

- Caddy: skopiuj `deploy/Caddyfile` do `/etc/caddy/Caddyfile`, **podmień domenę**, `sudo systemctl reload caddy`.
  Certyfikat Let's Encrypt pobierze się sam (DNS z kroku 4 musi już wskazywać serwer).
- systemd: skopiuj `deploy/codemap-api.service` do `/etc/systemd/system/`.
- `.env` produkcyjny — utwórz `/opt/codemap/server/.env` (NIE kopiuj dev-owego!):

```
PORT=8787
APP_ORIGIN=https://codemap.twojadomena.pl
DATA_DIR=/opt/codemap/data
EMAIL_MODE=resend
RESEND_API_KEY=re_xxxxxxxxx
EMAIL_FROM=CodeMap <no-reply@twojadomena.pl>
NODE_ENV=production
```

## 8. E-maile (WAŻNE: Hetzner blokuje porty SMTP 25/465)

Wysyłka idzie przez HTTPS API — załóż darmowe konto **Resend** (resend.com, 3000 maili/mies.)
lub **Brevo** (brevo.com, 300/dzień, firma z UE):

1. W panelu serwisu dodaj swoją domenę.
2. Wpisz podane rekordy **DKIM (TXT)** i **SPF** (+ opcjonalnie DMARC `p=none`) w DNS domeny.
3. Po weryfikacji wygeneruj klucz API → wpisz do `.env` powyżej.

Bez DKIM/SPF maile weryfikacyjne będą lądować w spamie.

## 9. Pierwszy deploy (z Windowsa)

```powershell
cd D:\codemap
.\tools\deploy.ps1 -Server deploy@codemap.twojadomena.pl
```

Następnie na serwerze:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now codemap-api
sudo systemctl status codemap-api          # ma być "active (running)"
curl -s https://codemap.twojadomena.pl/api/health   # → {"ok":true}
```

Aby deploy.ps1 mógł restartować usługę bez pytania o hasło, dodaj regułę sudoers:

```bash
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart codemap-api' | sudo tee /etc/sudoers.d/codemap
```

## 10. Backupy danych

```bash
sudo cp /opt/codemap/server/../deploy/backup.sh /opt/codemap/backup.sh 2>/dev/null || sudo cp ~/backup.sh /opt/codemap/backup.sh
sudo chmod +x /opt/codemap/backup.sh
sudo crontab -e     # dopisz: 15 3 * * * /opt/codemap/backup.sh
```

(deploy.ps1 wgrywa backup.sh do katalogu domowego; obrazy całego serwera robi Hetzner z kroku 3.)

## 11. Test końcowy

1. `https://codemap.twojadomena.pl` — zielona kłódka, aplikacja działa.
2. Rejestracja na prawdziwą skrzynkę → mail przychodzi (sprawdź, że NIE w spamie) → link weryfikuje.
3. Logowanie → zapis migawki → widoczna na drugim urządzeniu po zalogowaniu.
4. `sudo reboot` → po minucie wszystko wstaje samo (Caddy + codemap-api).
