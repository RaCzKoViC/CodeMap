# Polityka bezpieczeństwa

## Zgłaszanie podatności

Nie otwieraj publicznego issue dla problemów bezpieczeństwa. Użyj prywatnego zgłoszenia na GitHubie:
**Security → Report a vulnerability** w repozytorium https://github.com/RaCzKoViC/CodeMap.
Odpowiedź w ciągu 7 dni; poprawki wychodzą jako nowe wydanie z wpisem w [CHANGELOG.md](CHANGELOG.md).

Wspierana jest najnowsza wersja z gałęzi `main` / ostatniego wydania.

## Model zagrożeń w skrócie

**Frontend (aplikacja w przeglądarce)** działa w całości lokalnie. Sieć jest używana tylko na żądanie
użytkownika (tabela w [README → Prywatność](README.pl.md#-prywatność--co-opuszcza-twoje-urządzenie)).

- Tokeny GitHub/GitLab/Bitbucket żyją wyłącznie w pamięci karty; adresy API są zaszyte na stałe,
  więc obcy URL repozytorium nie może przekierować tokenu.
- Klucze Mistral są w `localStorage` (jawnie) — każdy XSS w aplikacji oznaczałby ich kradzież, dlatego
  całe renderowanie treści z repozytorium i odpowiedzi modeli przechodzi przez escapowanie.
- ChatBot wykonuje automatycznie tylko akcje z allowlisty „zmiany widoku"; nazwy plików z repozytorium
  trafiają do promptu, więc traktujemy je jako dane niezaufane (prompt injection).
- **CSP egzekwowane** (`<meta>` w `index.html`, bo GitHub Pages nie ustawia nagłówków): skrypty tylko z własnego
  pochodzenia i z dwóch CDN (`esm.run`, `cdn.jsdelivr.net` — WebLLM, rough.js, tree-sitter), bez skryptów inline,
  atrybutów `on…=` i `eval` (WASM przez `wasm-unsafe-eval`), `object-src 'none'`, `base-uri 'self'`, ramki tylko własne.
  `connect-src` jest celowo szeroki (dowolni dostawcy AI z kluczem użytkownika, własna Ollama także w sieci lokalnej,
  API repozytoriów, wagi modeli) — polityka chroni przed wykonaniem wstrzykniętego kodu, nie przed zapytaniami.
  Test smoke sprawdza, że wstrzyknięty skrypt inline i atrybut `onerror` są blokowane.
- Runner uruchamia kod z ChatBota w `runner.html` (własna, luźna polityka — kod modelu potrzebuje skryptów inline
  i `eval`), a sam kod siedzi w jego zagnieżdżonym `iframe sandbox="allow-scripts allow-modals" srcdoc` bez
  `allow-same-origin` (nieprzezroczyste pochodzenie: brak dostępu do strony, `localStorage`, OPFS ani kluczy).
  Kod przychodzi przez `postMessage` tylko od aplikacji; „otwórz w nowej karcie" używa tej samej strony.
- **SRI dla CDN:** web-tree-sitter (`tree-sitter.js`, `tree-sitter.wasm`) i gramatyki WASM mają przypięte SHA-384
  (`js/sri.js`, generowany przez `node tools/sri.mjs`, CI: `--check`) — bajty są sprawdzane PRZED wykonaniem
  (w workerze skrypt uruchamiany z `blob:` po weryfikacji, WASM z bajtów; bez workera natywny `integrity`), a plik
  niezgodny albo spoza listy jest odrzucany. Pakiety `+esm` z esm.run (WebLLM, rough.js, php-wasm) są przypięte
  dokładną wersją, ale bez skrótu: jsDelivr generuje je po swojej stronie i może przebudować, więc skrót wyłączyłby
  te funkcje bez żadnej zmiany w kodzie.
- Deep-linki (`#repo=`, `#gist=`, `#share=`, a także źródło w `#v=`) to dane z zewnątrz: źródło repozytorium
  tylko z github.com / gitlab.com / bitbucket.org (albo skrót `owner/nazwa`), bez `..`, `%`, znaków sterujących,
  danych logowania i portu w adresie; id gista `[0-9a-f]{20,40}`, plik gista tylko z `gist.githubusercontent.com`,
  limit 25 MB. Link nigdy nie używa tokenu z okna „Wczytaj…". Mapa z pliku lub linku jest niezaufana:
  adresy repozytorium, profilu i awatarów trafiają do `href` / `window.open` / `<img>` tylko jako `https`
  ze znanych hostów.
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
- Publiczne linki do map (`/api/share/<id>`): **każdy, kto ma link, widzi kopię mapy bez logowania** —
  nazwy i ścieżki plików, metryki, zależności, a jeśli właściciel ich nie wyłączy — podgląd treści plików
  i dane historii git (domyślnie wysyłane bez podglądu treści i bez e-maili autorów). Id to 144 losowe bity;
  404 jest identyczne dla linku nieistniejącego, wygasłego i unieważnionego; odpowiedź `application/json` +
  `nosniff`, `Cross-Origin-Resource-Policy: same-origin`, bez CORS, bez ciasteczek, `no-store` (unieważnienie
  działa natychmiast), `noindex`; rate limit per IP. Tworzenie tylko po zalogowaniu (sesja sprawdzana przed
  odczytem ciała), limit 25 MB, walidacja formatu, quota i limit aktywnych linków; usuwa tylko właściciel.
  Id linku nie trafia do logów (maskowane w ścieżce).
- Serwer dev nasłuchuje na `127.0.0.1` i serwuje tylko pliki frontendu z allowlisty.
- Produkcja: Caddy z HSTS i nagłówkami bezpieczeństwa, unit systemd z hardeningiem (`deploy/`). CSP w nagłówku
  egzekwowane (ta sama polityka co meta + `frame-ancestors 'self'`, `X-Frame-Options: SAMEORIGIN`), poza
  `runner.html`; osobno report-only z wąską listą hostów `connect-src` do obserwacji.

**Poza zakresem:** złośliwe rozszerzenia przeglądarki, przejęty komputer użytkownika, modele AI
zwracające błędne analizy (nie są wykonywane bez potwierdzenia poza akcjami widokowymi).

## Znane ograniczenia

- Serwer widzi nazwy, rozmiary i daty plików Sejfu (nie treść). Szyfrowanie nazw jest w planie.
- `connect-src` nie ogranicza hostów (dostawcy AI i Ollama konfigurowani przez użytkownika); WebLLM, rough.js
  i php-wasm ładowane z esm.run bez skrótu SRI (przypięta wersja).
- Publiczny link jest kluczem na okaziciela: kto go ma (także z historii przeglądarki, czatu, logów proxy
  po stronie odbiorcy), ten widzi mapę do czasu wygaśnięcia lub unieważnienia. Mapy udostępnionej przez Gist
  (tajny gist) nie da się unieważnić z CodeMap — usuń gist na GitHubie.
