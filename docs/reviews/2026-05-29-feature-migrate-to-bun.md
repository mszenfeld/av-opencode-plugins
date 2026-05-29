# Code Review — `feature/migrate-to-bun` vs `master`

_Data: 2026-05-29 · Metoda: security-auditor + code-quality-auditor + documentation-auditor, weryfikacja Cross-Verifier + Challenger._

## Podsumowanie

Migracja npm → bun w monorepo wtyczek OpenCode (TypeScript). 22 pliki, +3026/−4024. **To zmiana wyłącznie w toolingu buildowym** — brak kodu runtime aplikacji w diffie.

**Werdykt: Migracja jest czysta i dobrze wykonana. Bezpieczna do mergu.** 0 podatności bezpieczeństwa, 0 findingów CRITICAL/HIGH. ESLint + `tsc --noEmit` przechodzą, testy (`root-plugin` 9, `qa-preflight` 23) przechodzą, `bun pm pack` produkuje poprawny tarball, migracja jest spójna (zero pozostałości npm w toolingu, brak pliku CI do rozjazdu).

| Severity | Liczba |
|----------|--------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 2 (tematy złożone) |
| LOW | 7 |

**Mocne strony:** `verify-dist-sync.mjs` utwardzony (`execFileSync` dla `git status`); guard preinstall uczciwie opisany w komentarzu jako kontrola UX, nie bezpieczeństwa; dbałość o cross-platform w teście (`path.posix`, normalizacja `path.sep`); `.gitattributes` pinuje `bun.lock` do LF; `bunfig.toml` z empirycznym uzasadnieniem pinu linkera; bun domyślnie blokuje niezaufane postinstall (utwardzenie supply-chain względem npm).

---

## Bezpieczeństwo

**0 podatności.** trufflehog (0 sekretów), semgrep (command-injection + security-audit, 0 trafień), `bun audit` + `npm audit` cross-check (0/0). `bun.lock`: SRI sha512 na wszystkich zależnościach third-party, brak nowych pakietów względem starego `package-lock.json`, brak źródeł `git+`/`http://`/`.tgz`. Override `uuid>=14.0.0` rozwiązuje się czysto do 14.0.0 (bez CVE). Jedyny lifecycle script to root `preinstall` (przeanalizowany — bez wektora injection, czyta tylko env do porównania stringów).

_Opcjonalne utwardzenie (nie blokujące):_ dodać `bun install --frozen-lockfile` + `bun audit` do CI — w drzewie jest prerelease `effect@4.0.0-beta.66` wart monitorowania.

## Wydajność

**N/A** — diff to konfiguracja i skrypty buildowe. Brak zapytań DB, pętli, kolekcji. Test pakowania robi realny `bun pm pack` + `tar` (I/O na uruchomienie), co jest akceptowalne.

---

## Findingi MEDIUM (tematy priorytetowe — do rozważenia przed mergem)

### [MEDIUM] MAINT-001: Wymóg wersji `>=1.3.13` ogłaszany w 3 miejscach, nieegzekwowany nigdzie — a guard nie uruchomi się bez Node

**Status:** ✅ Fixed (2026-05-29)

**ID:** MAINT-001
**Location:** `scripts/check-package-manager.mjs:8-13`, `package.json:29`
**Category:** Maintainability
**Effort:** easy

**Problem:**
Łączy dwa skorelowane findingi (Q1 + Q2 + DOC-002):
- Guard sprawdza wyłącznie prefiks `ua.startsWith("bun/")`, ale komunikat błędu obiecuje `>= 1.3.13`. Stary `bun/1.0.0` przechodzi z exit 0, po czym trafia na błąd buildu, który `bunfig.toml` (pin linkera) miał właśnie ominąć. Ten sam pin wersji widnieje w README i AGENTS — żaden kod go nie waliduje (bun, w przeciwieństwie do corepack, nie egzekwuje pola `packageManager` przy instalacji).
- `preinstall` wywołuje `node scripts/...`, podczas gdy dokumentacja deklaruje wymóg *tylko* bun. W środowisku bun-only bez Node `bun install` pada z nieczytelnym ENOENT, zanim guard wyświetli swój pomocny komunikat — czyli zawodzi dokładnie tego developera, któremu miał pomóc.

**Impact:** Kontrakt wersji minimalnej jest fikcją; developer ufający dokumentacji zakłada egzekwowanie, którego nie ma. Praktyczny wpływ niski (`.bun-version` pinuje wersję dla użytkowników menedżerów wersji), stąd nie HIGH.

**Remediation:**
```js
// check-package-manager.mjs — uruchamiany przez bun, z realnym porównaniem wersji
const ua = process.env.npm_config_user_agent ?? ""
const m = ua.match(/^bun\/(\d+)\.(\d+)\.(\d+)/)
if (!m) { /* obecny komunikat + exit 1 */ }
const [maj, min, pat] = m.slice(1).map(Number)
const ok = maj > 1 || (maj === 1 && (min > 3 || (min === 3 && pat >= 13)))
if (!ok) { console.error(`Requires bun >= 1.3.13. Detected: ${ua}`); process.exit(1) }
```
```json
"preinstall": "bun scripts/check-package-manager.mjs",
```
Alternatywa minimalna: usunąć `(>= 1.3.13)` z komunikatu, by przestał obiecywać niesprawdzaną wersję. Ujednolicić glif `>=`/`≥` w guardzie, README i AGENTS (DOC-002).

> ⚠️ Zweryfikuj na swojej wersji bun, że `bun <plik>` rozwiązuje się w fazie `preinstall` (runnerem jest sam bun, więc powinno) — przed zmianą uruchom lokalnie `bun install`.

### [MEDIUM] MAINT-002: Test pakowania nie wykrywa nad-inkluzji ani wypadnięcia ścieżki z `files[]`

**Status:** ✅ Fixed (2026-05-29)

**ID:** MAINT-002
**Location:** `tests/root-plugin.test.ts:144-185` (asercja 180-181), discovery `165-168`
**Category:** Maintainability
**Effort:** easy

**Problem:**
`deriveExpectedFilesFromPackageJson` wyprowadza oczekiwane pliki z `package.json` `files[]`, a asercja używa `expect.arrayContaining(...)` (podzbiór). Stąd dwie luki: (1) **nad-inkluzja** — dodatkowy plik w tarballu (np. przypadkowy `.map`, źródło, sekret) przechodzi cicho; (2) **częściowa cykliczność** — usunięcie ścieżki z `files[]` kurczy *jednocześnie* zbiór oczekiwany i spakowany, więc test dalej przechodzi. Audyt bezpieczeństwa potwierdził, że *obecny* tarball jest czysty — to zabezpieczenie na przyszłość (egress supply-chain), nie aktualna dziura. Dodanie `scripts/` do `files[]` (commit `b4581e4`) to dokładnie typ zmiany, której ten test nie prześwietla.

> Uczciwie: Challenger słusznie zauważył, że stara lista hardkodowana miała *tę samą* ślepotę na nad-inkluzję, a nowy kod jest *lepszy* w kierunku „zadeklarowane-ale-niespakowane". To więc wzmocnienie istniejącego guardrailu, nie regresja.

**Remediation:** Dodać asercję kontraktu na poziomie top-level + deterministyczne pobranie nazwy tarballa:
```ts
const tarballName = execFileSync("bun", ["pm","pack","--quiet","--destination",tmpDir],
  { cwd: rootDirectory, encoding: "utf8" }).trim()
// ...
const topLevel = new Set(packedFiles.map((f) => f.split("/")[0]))
expect(topLevel).toEqual(new Set(["package.json","README.md","dist","scripts","packages"]))
```
Opcjonalnie denylist (`!/\.(env|ts)$/`). To zamyka też lukę dla `bun pm pack --quiet` (Q4).

---

## Findingi LOW

### [LOW] MAINT-003: `verify-dist-sync.mjs` utwardzony tylko połowicznie
**Status:** ✅ Fixed (2026-05-29)
**Location:** `scripts/verify-dist-sync.mjs:27` vs `36-40` — wywołanie buildu nadal `execSync("bun run build")`, podczas gdy `git status` przeszło na `execFileSync`. Brak realnego ryzyka (string statyczny), ale niespójność zaprasza przyszłą regresję. Fix: `execFileSync("bun", ["run","build"], { stdio: "inherit" })`.

### [LOW] MAINT-004: `err.message` może być `undefined`
**Status:** ✅ Fixed (2026-05-29)
**Location:** `scripts/verify-dist-sync.mjs:43` — dla nie-Error throw wypisze `undefined`. Sąsiedni catch (l. 28) już jest defensywny. Fix: `String(err?.message ?? err)`.

### [LOW] MAINT-005: Test twardo zależy od systemowego `tar`
**Status:** ✅ Fixed (2026-05-29)
**Location:** `tests/root-plugin.test.ts:170` — `execFileSync("tar", ...)`. macOS/Linux CI ma `tar`; minimalne kontenery/Windows mogą nie mieć. Udokumentować założenie lub parsować tarball w procesie.

### [LOW] MAINT-006: Pozostawiony polski znacznik w kodzie
**Status:** ✅ Fixed (2026-05-29)
**Location:** `tests/root-plugin.test.ts:178` — `// ... (ulepszenie #9):`. AGENTS.md (Code Review Artefacts) zakazuje zostawiania ID zadań w źródle. Usunąć `(ulepszenie #9)`, zostawić uzasadnienie techniczne.

### [LOW] DOC-001: Rozjazd spec/plan vs implementacja
**Status:** ✅ Fixed (2026-05-29)
**Location:** `docs/superpowers/plans/2026-05-28-...-plan.md:34`, `docs/superpowers/specs/2026-05-28-...-design.md:118` — spec deklaruje „files[] BEZ ZMIAN" i „Total: 5 commits", a `files[]` zyskało `"scripts"` (commit `b4581e4`) i branch ma więcej commitów. Najlżejszy fix: oznaczyć dokumenty `[ARCHIVED]` po mergu (zgodnie z Post-Merge Follow-ups) albo dopisać addendum o `scripts/`.

### [LOW] DOC-002: Niespójność glifu `>=` vs `≥`
**Status:** ✅ Fixed (2026-05-29)
**Location:** `scripts/check-package-manager.mjs:10` (ASCII) vs `README.md:71`, `AGENTS.md:30` (Unicode). Kosmetyka; rozwiąże się przy MAINT-001.

### [LOW] MAINT-007 (pre-existing): AGENTS.md odnosi się do nieistniejącego `.opencode/`
**Status:** ✅ Fixed (2026-05-29)
**Location:** `AGENTS.md:24` — wzmianka o `.opencode/` z „separate package.json", którego nie ma w repo. Nie wprowadzone na tym branchu; do sprzątnięcia.

---

## Verification Summary

**Metoda:** Korelacja cross-domenowa (Cross-Verifier) + przegląd adwersarialny (Challenger).

| Metryka | Liczba |
|---------|--------|
| Findingi zweryfikowane | 9 |
| False positives usunięte | 0 |
| Korekty severity | 4 (MEDIUM→LOW indywidualnie, re-eskalacja 2 klastrów→MEDIUM) |
| Findingi z cross-analizy | 2 composite MEDIUM + 1 composite LOW |

**Cross-Analysis (Security ↔ Quality ↔ Docs):** Findingi grupują się wokół punktów wejścia supply-chain. Kluczowy wniosek: audyt bezpieczeństwa pokrył *ingress* zależności (SRI, brak nowych pakietów), ale nie *egress* publikowanego tarballa — co łączy się z luką testu (MAINT-002). Drugi klaster: pin wersji bun ogłaszany w guardzie/README/AGENTS, lecz nieegzekwowany (MAINT-001). To uzasadnia priorytet MEDIUM dla tych dwóch tematów mimo trywialności pojedynczych elementów.

**Challenged Findings:** Challenger ocenił wszystkie 4 pierwotne MEDIUM (Q1–Q4) jako technicznie poprawne, lecz przeszacowane → LOW indywidualnie (guard jawnie nie-bezpieczeństwa; `node` powszechnie obecny; test nie gorszy od starej listy; temp dir izolowany). **Zero false positives** — każdy finding odzwierciedla realny stan kodu. Rozstrzygnięcie: severity pojedynczych = LOW; dwa tematy złożone = MEDIUM (priorytet naprawy).

**GAP do rozważenia:** żaden audytor nie potwierdził, czy `packageManager: bun@1.3.13` jest faktycznie odczytywane przez jakikolwiek tooling przy instalacji (w świecie bun brak odpowiednika corepack) — założenie „real enforcement via packageManager" z komentarza guarda pozostaje niezweryfikowane.
