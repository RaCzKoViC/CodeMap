#!/bin/sh
# Nocna kopia danych CodeMap (SQLite + bloby), rotacja 14 dni.
# Instalacja: sudo cp backup.sh /opt/codemap/backup.sh && sudo chmod +x /opt/codemap/backup.sh
# Cron (root):  15 3 * * * /opt/codemap/backup.sh
set -eu
# Kopie zawierają hashe haseł, hashe sesji i nazwy plików Sejfu — tylko root ma je czytać.
umask 077
mkdir -p /opt/codemap/backups && chmod 700 /opt/codemap/backups
d=/opt/codemap/backups/$(date +%F)
mkdir -p "$d"
sqlite3 /opt/codemap/data/codemap.sqlite "PRAGMA integrity_check;" > "$d/integrity.txt"
sqlite3 /opt/codemap/data/codemap.sqlite ".backup '$d/codemap.sqlite'"
tar czf "$d/blobs.tgz" -C /opt/codemap/data blobs
# -mindepth 1: rotacja nigdy nie usuwa samego katalogu backups (gdyby cron stanął na >14 dni)
find /opt/codemap/backups -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +
