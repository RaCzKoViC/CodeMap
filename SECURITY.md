# Polityka bezpieczeństwa

## Zgłaszanie podatności

Nie otwieraj publicznego issue dla problemów bezpieczeństwa. Użyj prywatnego zgłoszenia na GitHubie:
**Security → Report a vulnerability** w repozytorium https://github.com/RaCzKoViC/CodeMap.
Odpowiedź w ciągu 7 dni; poprawki wychodzą jako nowe wydanie z wpisem w [CHANGELOG.md](CHANGELOG.md).

Wspierana jest najnowsza wersja z gałęzi `main` / ostatniego wydania.

## Model zagrożeń w skrócie

**Frontend (aplikacja w przeglądarce)** działa w całości lokalnie. Sieć jest używana tylko na żądanie
użytkownika (tabela w [README → Prywatność](README.md#-prywatność--co-opuszcza-twoje-urządzenie)).

- Tokeny GitHub/GitLab/Bitbucket żyją wyłącznie w pamięci karty; adresy API są zaszyte na stałe,
  więc obcy URL repozytorium nie może przekierować tokenu.
- Klucze Mistral są w `localStorage` (jawnie) — każdy XSS w aplikacji oznaczałby ich kradzież, dlatego
  całe renderowanie treści z repozytorium i odpowiedzi modeli przechodzi przez escapowanie.
- ChatBot wykonuje automatycznie tylko akcje z allowlisty „zmiany widoku"; nazwy plików z repozytorium
  trafiają do promptu, więc traktujemy je jako dane niezaufane (prompt injection).
- Runner uruchamia kod w `iframe sandbox="allow-scripts allow-modals"` bez `allow-same-origin`
  (opaque origin, brak dostępu do strony, `localStorage` ani plików).
- Sejf: AES-GCM-256, klucz z PBKDF2-SHA256 (600 000 iteracji dla nowych haseł; albumy sprzed
  wersji 1.1 odszyfrowują się z 210 000 i przechodzą na nową wartość przy zmianie hasła — pole
  `kdf` w metadanych albumu), losowe IV, weryfikator przez AEAD, minimum 8 znaków hasła.
  Hasło albumu nigdy nie opuszcza urządzenia. Uwaga: album synchronizowany z chmurą leży na serwerze
  jako szyfrogram, więc siła hasła decyduje o odporności na atak offline — używaj długich haseł.

**Backend (`server/`, opcjonalny)**

- Hasła: argon2id; sesje: losowy token w ciasteczku `HttpOnly`/`Secure`/`SameSite=Lax`, w bazie tylko
  SHA-256; tokeny e-mail jednorazowe, hashowane, z TTL; reset hasła unieważnia wszystkie sesje.
- CSRF: kontrola nagłówka `Origin` dla żądań zmieniających stan; rate limit globalny i per endpoint,
  a do tego per KONTO: po 5 nieudanych logowaniach blokada rosnąca od 30 s do 15 min (także dla
  nieistniejących adresów), maile ograniczone do 3/h na adres, wysyłka poza ścieżką odpowiedzi
  (czas odpowiedzi nie zdradza istnienia konta), argon2 z limitem współbieżności.
- Wygasłe sesje, tokeny e-mail, blokady i dziennik maili są sprzątane co godzinę.
- Wszystkie zapytania SQL parametryzowane; każdy zasób ograniczony do `user_id` sesji.
- Uploady strumieniowe z twardym limitem rozmiaru i atomową rezerwacją quoty.
- Serwer dev nasłuchuje na `127.0.0.1` i serwuje tylko pliki frontendu z allowlisty.
- Produkcja: Caddy z HSTS i nagłówkami bezpieczeństwa, unit systemd z hardeningiem
  (`deploy/`). CSP jest w trybie report-only — przełączenie na tryb wymuszający wymaga
  dostosowania Runnera (nonce/hash), patrz komentarz w `deploy/Caddyfile`.

**Poza zakresem:** złośliwe rozszerzenia przeglądarki, przejęty komputer użytkownika, modele AI
zwracające błędne analizy (nie są wykonywane bez potwierdzenia poza akcjami widokowymi).

## Znane ograniczenia

- Serwer widzi nazwy, rozmiary i daty plików Sejfu (nie treść). Szyfrowanie nazw jest w planie.
- CSP działa w trybie report-only do czasu dostosowania Runnera.
