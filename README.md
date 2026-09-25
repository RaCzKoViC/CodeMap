# CodeMap — Kartografia Kodu 🗺️

Potężne, w pełni lokalne narzędzie do wizualizacji struktury kodu w stylu map i siatek **Maltego**.
Wczytujesz pliki, foldery albo repozytorium GitHub, a CodeMap buduje interaktywną, profesjonalnie
połączoną mapę plików i ich zależności — po której możesz się swobodnie poruszać, obracać ją
i analizować zaawansowane parametry każdego elementu.

---

## 🚀 Uruchomienie

**Najprościej:** otwórz `index.html` w przeglądarce (Chrome / Edge / Firefox) — dwuklik wystarczy.

**Zalecane (pełna obsługa migawek przez IndexedDB, brak ograniczeń `file://`):**
uruchom mały serwer lokalny w katalogu projektu i wejdź na `http://localhost:8777`:

```powershell
python -m http.server 8777 --directory D:\Projekty\CodeMap
```

> Chcesz od razu zobaczyć działanie? Otwórz `index.html#demo` lub kliknij **„✨ Zobacz demo"**.

---

## ✨ Możliwości

### Wczytywanie (obsługa ponad 150 formatów)
- **📁 Folder** — wybór całego katalogu z urządzenia (z pełną strukturą).
- **📄 Pliki** — pojedyncze pliki.
- **🌐 Źródło** — repozytorium **GitHub** po adresie URL (publiczne lub prywatne z tokenem),
  można też wskazać konkretny podkatalog (`.../tree/main/src`).
- **Przeciągnij i upuść** folder lub pliki bezpośrednio na mapę.
- Rozpoznawane: kod (JS/TS, Python, C/C++, C#, Go, Rust, Java, Kotlin, PHP, Ruby, Swift, …),
  web (HTML/CSS/SCSS/Vue/Svelte), dane (JSON/YAML/XML/CSV/SQL), dokumenty, obrazy, media,
  archiwa, binaria i wiele innych.

### Mapa i nawigacja
- **Swobodne przemieszczanie** (przeciąganie tła) i **płynny zoom** (kółko myszy, do kursora).
- **Dowolny obrót mapy** — `Shift`+przeciąganie, prawy przycisk, pokrętło w rogu, przyciski lub `Q`/`E`.
- **Pseudo-3D / perspektywa** (`T` lub przycisk ◳).
- **Minimapa** z prostokątem widoku (klik = przeskok).
- Profesjonalne, czytelne połączenia: **struktura** (zawieranie), **importy/zależności**
  (z grotami kierunku) oraz **referencje** do zasobów.

### Inteligentna analiza
- Automatyczne **parsowanie importów** i budowa grafu zależności między plikami
  (rozpoznaje `import`/`require`/`#include`/`use`/`@import`/`<script src>` itd.).
- **Zależności zewnętrzne** (pakiety npm/pip/…) jako osobne węzły.
- Zaawansowane metryki: linie, linie kodu, komentarze %, złożoność, liczba definicji,
  TODO/FIXME, rozmiar, data modyfikacji, skład folderu wg typu, najwięksi „mieszkańcy" itd.

### Widok i ustawienia
- 5 układów: **drzewo**, **radialny**, **siła** (graf zależności), **siatka**, **klastry wg typu**.
- Filtry: foldery / pliki / zależności zewnętrzne, typy połączeń, włączanie/wyłączanie typów plików.
- Zwijanie i rozwijanie folderów (dwuklik na folderze) z agregacją połączeń.
- Wyszukiwarka plików/ścieżek (klawisz `/`), podświetlanie sąsiadów, menu kontekstowe (PPM).

### Zapis i śledzenie rozwoju
- **💾 Zapisz / 📂 Otwórz** — eksport i import całej mapy do pliku `.codemap.json` (z pozycjami).
- **📌 Migawka** — zapis stanu projektu (lokalnie, w przeglądarce).
- **🕓 Historia** — porównywanie dwóch migawek lub migawki ze stanem bieżącym:
  raport **dodane / zmienione / usunięte** pliki, Δ linii i Δ rozmiaru, oraz
  naniesienie różnic bezpośrednio na mapę (zielony = nowy, żółty = zmiana, czerwony = usunięty).
- Eksport/import całej historii migawek do pliku.

---

## ⌨️ Skróty klawiszowe

| Klawisz | Działanie | | Klawisz | Działanie |
|---|---|---|---|---|
| `F` | dopasuj widok | | `Q` / `E` | obróć w lewo / prawo |
| `+` / `-` | przybliż / oddal | | `R` | wyzeruj obrót |
| `/` | wyszukiwanie | | `T` | perspektywa (pseudo-3D) |
| `Esc` | odznacz / zamknij menu | | strzałki | przesuń widok |

Mysz: przeciąganie tła = przesuwanie • kółko = zoom • przeciąganie węzła = przesuń element •
dwuklik na folderze = zwiń/rozwiń • PPM = menu kontekstowe.

---

## 🧱 Architektura (czysty JavaScript, bez zależności i bez kroku budowania)

```
index.html              # struktura UI
css/styles.css          # motyw (ciemny, „cyber-cartography")
js/util.js              # narzędzia: kamera (pan/zoom/obrót/tilt), hash, formatowanie
js/languages.js         # rejestr 150+ formatów plików (kolory, kategorie)
js/analysis.js          # metryki kodu + parsowanie i rozwiązywanie zależności
js/graph.js             # model danych: hierarchia, agregaty, zwijanie, (de)serializacja, diff
js/layouts.js           # algorytmy układu: force, tree, radial, grid, cluster
js/renderer.js          # render na <canvas> + interakcje (pan/zoom/obrót/wybór/hover)
js/loaders.js           # wczytywanie: pliki / foldery / drag-drop / GitHub API
js/storage.js           # migawki (IndexedDB), zapis/odczyt mapy, nanoszenie różnic
js/ui.js                # panele: szczegóły, filtry, historia, diff, podpowiedzi, menu
js/app.js               # spięcie całości + tryb demo
```

Wszystko działa po stronie klienta — **żadne dane nie opuszczają Twojego urządzenia**
(jedyne połączenie sieciowe to opcjonalne pobieranie repozytorium z GitHub na Twoje żądanie).

---

## ☁️ Konto i synchronizacja (opcjonalny backend)

CodeMap ma opcjonalny serwer (katalog `server/` — Node.js + Fastify + SQLite), który dodaje
**rejestrację z weryfikacją e-mail** i **synchronizację między urządzeniami**: mapy, migawki
(z pełną treścią), ustawienia oraz Sejf/Ulubione — te ostatnie **wyłącznie jako szyfrogram**
(AES-GCM po stronie klienta; serwer nigdy nie widzi haseł ani treści plików). Klucze API
(np. Mistral) nigdy nie są wysyłane na serwer. Bez logowania aplikacja działa w 100% lokalnie,
dokładnie jak dotychczas.

**Dev (Windows):**
```powershell
cd server; copy .env.example .env; npm install; npm start   # → http://localhost:8787
```
Maile weryfikacyjne w trybie dev drukują się w konsoli serwera (`EMAIL_MODE=console`).

**Produkcja (Hetzner VPS):** pełna instrukcja krok po kroku w [`deploy/setup-vps.md`](deploy/setup-vps.md);
wgrywanie: `.\tools\deploy.ps1 -Server deploy@twoja-domena`.
