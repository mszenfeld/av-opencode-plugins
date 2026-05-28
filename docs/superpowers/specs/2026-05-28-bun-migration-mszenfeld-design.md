# Migracja monorepo z npm na bun (mszenfeld @ 0.3.0) — design spec

**Data:** 2026-05-28
**Status:** Approved (pending user review of written spec)
**Branch:** `feature/migrate-to-bun`
**Wersja:** `0.3.0` → `0.4.0`

> **Kontekst historyczny:** to druga iteracja tej migracji. Pierwsza została wykonana na branchu opartym o `upstream/master` (AppVerk) i przeniesiona do tag'u `backup/master-before-mszenfeld-rebase` (`6aae51b`) bez merge'a do mszenfeld. Mszenfeld rozjechał się z AppVerk znacznie (refactor src→TS-only z tsup `bundle:false`, absorbcja `commit`/`qa` jako `src/modules/`, nowy harness Pantheon z `coordinator`/`agent-registry`/`pantheon-config`/`explore`, hook `session-notification`). Spec adresuje rzeczywisty mszenfeld layout, z lekcjami z pierwszej iteracji (m.in. 9 ulepszeń `/fix-all` wpisanych bezpośrednio do zakresu).

## Motywacja

Cztery cele migracji (kolejność wg priorytetu):

1. **Szybsze instalacje** — `bun install` typowo 5-25× szybszy od `npm install`. Empirycznie z poprzedniej iteracji: `bun install --frozen-lockfile` ~757ms.
2. **Szybsze skrypty** — łańcuchy `npm run --workspace X` (×6 paczek na mszenfeld) w root scripts. Bun `--filter` redukuje to.
3. **Mniej narzędzi w stacku** — eliminacja npm jako PM dependency w toolchainie.
4. **Zrównanie dev/prod runtime** — OpenCode w produkcji uruchamia pluginy w bun runtime. Lokalny bun zrównuje warunki, pozwala (opcjonalnie, sekcja "Bun runtime API audit") eksplorować `Bun.spawn` w wybranych miejscach kodu runtime.

Vitest, tsup, eslint, prettier, typescript — wszystkie zostają bez zmian. Migracja dotyczy wyłącznie **package managera, runnera skryptów i powiązanych narzędzi developerskich**, nie test runnera, nie bundlera, nie kompilatora.

## Ulepszenia 1-9 — origin (forward-applied z poprzedniej iteracji)

Wszystkie 9 ulepszeń wynika z `/fix-all` w poprzedniej iteracji migracji (AppVerk-bazowanej) i jest wbudowane w niniejszy spec — eliminuje to potrzebę osobnego review/fix cycle post-merge.

| # | Ulepszenie | Lokalizacja w specu |
|---|------------|---------------------|
| 1 | **Preinstall guard jako osobny `scripts/check-package-manager.mjs`** z header comment "UX hint, NOT a security control" + threat model. Mszenfeld pre-migration nie miał inline guard — to ADD, nie REFACTOR. | D3, Mapa zmian, Krok 3a |
| 2 | **`try/finally + rmSync(tmpDir)` w teście tarballa** — cleanup gwarantowany przy każdym wyjściu z try. | D9, Krok 4 |
| 3 | **`execFileSync` argv-form zamiast `execSync` shell-concat** w `scripts/verify-dist-sync.mjs` — eliminuje CWE-78 latent risk. | D10, Krok 4 |
| 4 | **`catch (err)` z error message zamiast `catch {}`** w `verify-dist-sync.mjs` — błędy nie są ciche. | D10, Krok 4 |
| 5 | **`build:skill-utils` jako nazwany skrypt** w root `package.json` — czyni ukrytą zależność widoczną i reużywalną. | D11, Krok 3a, AGENTS.md update |
| 6 | **Generalizacja exception listy** dla intentional `npm`/`npx` content downstream — wildcard zamiast hand-list. | D15, Krok 5 |
| 7 | **AGENTS.md filter syntax note z motywującym błędem** "No packages matched the filter" — przyszły maintainer zobaczy konkretny komunikat zamiast abstrakcyjnej reguły. | D4, Krok 5 |
| 8 | **Spec/plan past-tense voice + addendum visibility** — lekcja META z poprzedniej iteracji: pisać spec od razu w finalnej formie; resolved decyzje w past tense; addendum item-by-item zsynchronizowany ze specem. Ten spec jest pisany zgodnie z tą lekcją (nie ma "Niepewności do walidacji" oddzielonych od resolved decyzji w sposób mylący). | Cały spec |
| 9 | **`expect.arrayContaining(...)` derived z `package.json:files`** w teście tarballa — eliminuje klasę regresji "zapomniałem dodać nowy `dist/` path". | D8, Krok 4 |

## Verified non-issues

Lista założeń sprawdzonych podczas review, które NIE wymagają działania w tej migracji:

- **`.npmrc` registry auth** — bun reads `.npmrc` od wersji 1.0 (np. `_authToken` dla private registries). Migracja nie wymaga zmian.
- **Workspace dep `"@appverk/opencode-skill-utils": "*"`** — bun wspiera tę składnię od >2 lat (zweryfikowane w Sanity 2 Kroku 2).
- **`process.cwd()` pod `bun run`** — identyczne semantyki jak `npm run` dla root scripts (cwd = directory containing the package.json with the invoked script).
- **Source maps** — `tsup.root.config.ts` ma `sourcemap: false`, więc kwestia nie dotyczy mszenfeld.
- **`bun.lock` text format readability** — udokumentowane przez Bun team jako poprawa code review experience vs binary `bun.lockb`.
- **Bun 1.3.2+ default `isolated` linker** — dotyczy TYLKO nowych workspace projects z `configVersion=1` w `bun.lock`. Existing repos z `configVersion=0` zostają na `hoisted`. **Empiryczne pytanie do Kroku 1:** czy pierwszy `bun install` na mszenfeld zapisuje `configVersion=0` czy `=1`. (Wynik determinuje czy `bunfig.toml` pin jest potrzebny — patrz D6/R11.)

## Zakres

### W zakresie (zmienia się)

- Lockfile: `package-lock.json` → `bun.lock` (text format, default od Bun 1.2)
- Lokalna instalacja: `npm install` → `bun install`
- Root scripts: `npm run --workspace @appverk/X` → `bun --filter @appverk/X` (×6 paczek)
- Per-package test scripts: 4 paczki z `npm run build && vitest` → `bun run build && vitest` (`code-review`, `frontend-developer`, `python-developer`, `swift-developer`). Paczki `skill-utils` i `skill-registry` mają tylko `vitest run` — bez zmian.
- `scripts/verify-dist-sync.mjs`: `npm run build` → `bun run build` plus ulepszenia: `execFileSync` argv-form zamiast shell-concat (ulepszenie #3), `catch (err)` z exit code zamiast `catch {}` (ulepszenie #4)
- `tests/root-plugin.test.ts`: `npm pack --dry-run --json` → `bun pm pack --destination + tar -tzf` z `try/finally + rmSync` cleanup (ulepszenie #2) i `expect.arrayContaining(...)` derived z `package.json:files` (ulepszenie #9)
- Root `package.json`: `packageManager: "bun@1.3.13"`, `preinstall` → wskazuje na `scripts/check-package-manager.mjs` (ulepszenie #1), nowy nazwany skrypt `build:skill-utils` (ulepszenie #5), version `0.3.0` → `0.4.0`. `main`/`types`/`files`/`dependencies`/`devDependencies`/`overrides` — bez zmian.
- Nowy `scripts/check-package-manager.mjs` (standalone preinstall guard z header comment "UX hint, NOT a security control" + threat model — ulepszenie #1)
- Nowy `bunfig.toml`: `[install] linker = "hoisted"` z inline komentarzem rationale (Bun 1.3.2+ default change)
- Nowy `.gitattributes`: `bun.lock text eol=lf`
- Nowy `.bun-version`: `1.3.13`
- `.prettierignore`: `package-lock.json` → `bun.lock`
- `AGENTS.md`: sekcje Commands + Per-package; **dodanie sekcji Prerequisites** PRZED "Pantheon harness configuration"; **dodanie sekcji "skill-utils build dependency"** (ulepszenie #5); **filter syntax note z motywującym błędem** "No packages matched the filter" (ulepszenie #7). Sekcja "Pantheon harness configuration" i pozostałe — bez zmian.
- `README.md`: Quickstart install + Local Development commands; **nowa sekcja Prerequisites**. Installation downstream tag bump `#v0.3.0` → `#v0.4.0` (po wygenerowaniu tag'u release).
- **Sekcja "Bun runtime API audit" w specu** — analiza miejsc kandydatów na `Bun.*` API z per-place rekomendacją; **nic nie zmieniamy w runtime kodzie w tej migracji**.

### Poza zakresem (zostaje bez zmian)

- `vitest`, `tsup`, `eslint`, `prettier`, `typescript` — runner testów, bundler, lintery, kompilator wołane przez `bun run`
- Komitowane root `dist/` i `packages/*/dist/` — model publikacji bez zmian
- `tsup.root.config.ts` z `bundle: false` — bez zmian
- ESM/NodeNext/TS config — bez zmian
- `overrides: { uuid: ">=14.0.0" }` — bun honoruje top-level overrides (zweryfikowane w poprzedniej iteracji)
- `jsonc-parser` dependency — bun resolve'uje normalnie
- Workspace dep `"@appverk/opencode-skill-utils": "*"` — bun wspiera tę składnię
- Runtime kod: `src/modules/qa/run-bash.ts`, `src/modules/coordinator/dispatch.ts` (background tasks), `src/hooks/session-notification/`, `src/modules/qa/child-env.ts`, `src/modules/_shared/load-asset.ts`, `src/modules/qa/index.ts` (BindingsStore TTL sweep) — bez zmian w core migracji. Audit Bun.* API produkuje listę follow-up'ów.
- `scripts/qa-preflight.sh` — bash, PM-agnostic
- `scripts/copy-root-assets.mjs`, `scripts/copy-assets.mjs` — Node CLI, działają pod bun bez zmian
- `pantheon.json` — user-global config, runtime read, nie tknięty
- Skill content downstream: `packages/*/src/{skills,agents,commands}/**`, `src/modules/*/src/**`, `src/{skills,commands,agents,hooks}/**`, `dist/**` — intentional `npm`/`npx` references jako product content dla downstream consumerów (generalizowana exception lista — ulepszenie #6)
- Brak CI — nic do dorzucenia w tej migracji
- Brak `.opencode/` w repo — nic do migrowania
- Runtime publikowanego pluginu — dalej `@opencode-ai/plugin@^1.14.19`, OpenCode bun-side, migracja PM nie zmienia

## Decyzje techniczne

| # | Decyzja | Wybór | Uzasadnienie |
|---|---------|-------|--------------|
| D1 | Format lockfile | `bun.lock` (text) | Default od Bun 1.2; lepszy do code review niż binarny |
| D2 | Wersja bun w `packageManager` | `bun@1.3.13` — exact pin (NIE floor) | Sprawdzona empirycznie w poprzedniej iteracji (~757ms install, 37s `check`). **Pin exact** w `packageManager`, `.bun-version`, README/AGENTS Prerequisites, DoD. Krok 1 pre-flight: jeśli maszyna ma starszą wersję → `bun upgrade` do 1.3.13. Jeśli nowsza → spec NIE bumpuje automatycznie; floor update wymaga osobnej decyzji (consistency between `.bun-version` + version managers > floating to newest) |
| D3 | Enforcement | `packageManager` field + nowy `preinstall` guard (`scripts/check-package-manager.mjs`) + README/AGENTS docs | `packageManager` nie egzekwowany przez bun ani corepack; guard sprawdza `npm_config_user_agent.startsWith('bun/')`. **Mszenfeld pre-migration nie ma inline guard** — to nowy plik, nie refactor. Header comment "UX hint, NOT a security control" (ulepszenie #1) |
| D4 | Workspace filter syntax | `bun --filter <name> <script>` (BEZ `run` w środku) — canonical form | **3 formy do rozróżnienia:** (1) `bun --filter X SCRIPT` — działa (canonical, używamy w spec); (2) `bun run --filter X SCRIPT` — też documented-valid (równoważne); (3) `bun --filter X run SCRIPT` — **broken**, zwraca "No packages matched the filter" bo bun parsuje `run` jako script target (issue #18241). Wybieramy formę 1 jako spójną i krótszą |
| D5 | Sequencing skryptów root | Sekwencyjnie przez `&&` (NIE `--concurrency=1` flag) | Każde `bun --filter <name>` matchuje 1 paczkę, sequencing pochodzi z `&&`. R4 mitigation = `&&` chain. (Lekcja z poprzedniej iteracji: `--concurrency=1` było zbędne) |
| D6 | Linker | `bunfig.toml` z `[install] linker = "hoisted"` + inline komentarz rationale (warunkowo) | Bun 1.3.2+ zmienił default linker na `isolated` (pnpm-style symlinki) **wyłącznie dla nowych workspace projects z `configVersion=1` w `bun.lock`**. Existing repos z `configVersion=0` zostają na `hoisted` jako default. **Empiryczne pytanie do Kroku 1:** co bun zapisuje przy pierwszym `bun install` na mszenfeld? Jeśli `configVersion=0` → pin niepotrzebny, `bunfig.toml` można pominąć. Jeśli `configVersion=1` → pin uzasadniony jako konserwatywna ochrona przed symlinks-based resolution issues w tsup `bundle:false` outputs. Pass criterion w Kroku 1: empirycznie zweryfikować obie wersje (z bunfig pin + bez) — `bun run build` produkuje identyczny `dist/` (`diff -r dist/ dist-baseline/` pusty). |
| D7 | Publishing weryfikacja | `bun pm pack --destination <tmp>` + `tar -tzf` (NIE `bun pm pack --json`) | `bun pm pack` nie ma flagi `--json` w bun 1.3.13. `tar -tzf` daje deterministyczną listę plików niezależną od bun CLI output format |
| D8 | Tarball test assertions | Derive expected list from `package.json:files` (NIE hand-coded) | Ulepszenie #9 — eliminuje klasę regresji "zapomniałem dorzucić nowy dist do testu" |
| D9 | Tarball test cleanup | `try { … } finally { rmSync(tmpDir, { recursive, force }) }` | Ulepszenie #2 |
| D10 | `verify-dist-sync.mjs` ergonomy | `execFileSync` argv-form + `catch (err)` z msg+exit code | Ulepszenia #3 + #4 |
| D11 | Hidden build dependency | Wydzielony `build:skill-utils` jako nazwany skrypt; reused w `build`/`test`/`typecheck`; udokumentowany w AGENTS.md | Ulepszenie #5. Zachowuje istniejący side-effect (skill-utils dist musi być najpierw), czyni go widocznym |
| D12 | Strategia migracji | Big-bang, jeden PR, branch `feature/migrate-to-bun` | Zatwierdzone |
| D13 | Wersja pakietu | `0.3.0` → `0.4.0` (minor) | Zatwierdzone. Sygnalizuje downstream "build pipeline changed" (mimo że published artifact się nie zmienia) |
| D14 | Pin `engines.bun` lub `engines.node` | NIE dodajemy ani jednego | mszenfeld dziś nie ma `engines`. Nie wprowadzamy nowej formy kontraktu. Wymóg bun dokumentujemy w README/AGENTS Prerequisites + przez preinstall guard |
| D15 | Generalizacja exception listy | Wildcard `packages/*/src/{skills,agents,commands}/**` + `src/modules/**/*.{md,ts}` (NIE nested `src/`) + `src/{skills,commands,agents,hooks}/**` + `dist/**` jako intentional product content | Ulepszenie #6 zaadaptowane do mszenfeld layout. **Sprostowanie:** poprzednia wersja speca miała błędną ścieżkę `src/modules/*/src/` — mszenfeld nie ma nested `src/` pod modułami, asset pliki (`.md`) i kod (`.ts`) leżą bezpośrednio w `src/modules/<name>/`. Aktualne miejsca z npm/npx: `src/modules/qa/prompt-sections/overlay-fe.md` (`npx playwright install`), `packages/code-review/src/agents/*.md`, `packages/frontend-developer/src/skills/*.md` |
| D16 | Bun runtime API audit | Skrócona sekcja w specu z 3 actionable miejscami (A1, A4, A5); **nic nie zmieniamy w runtime kodzie w tej migracji**; audit produkuje follow-up listę | Skip-entries (A2/A3/A6/A7/A8/A10) usunięte — sygnalizowały "thoroughness" bez wartości |

### Niepewności do walidacji w Kroku 1 (nie blokujące dla speca)

- **Co bun zapisuje w `bun.lock` jako `configVersion` przy pierwszym `bun install` na istniejącym (uprzednio npm-installed) projekcie?** Wpływa na D6 — jeśli `configVersion=0` → `bunfig.toml` może być pominięty.
- **Czy tsup `bundle:false` produkuje identyczny `dist/` pod bun (z hoisted i isolated linker)?** Pass criterion: `diff -r dist/ dist-baseline/` pusty.
- **Czy vitest 3.1.2 z bun działa stabilnie?** Empiryczny smoke test `bun --filter @appverk/opencode-code-review test` (najbardziej złożone mocki vitest w mszenfeld).
- **Czy `bun --filter '@appverk/*' <script>` (workspace glob) respektuje topological order (skill-utils first)?** **Niska szansa** — `bun --filter` parallelizm i ordering nie są stabilnie udokumentowane. Jeśli tak → możliwe uproszczenie `build:skill-utils` pattern. Default plan zakłada explicit chain.

## Mapa zmian per plik

| Plik | Akcja | Szczegóły |
|------|-------|-----------|
| `package.json` (root) | **edycja** | • + `"packageManager": "bun@1.3.13"`<br>• + `"preinstall": "node scripts/check-package-manager.mjs"`<br>• version `0.3.0` → `0.4.0`<br>• 4 skrypty (`build`, `test`, `typecheck`, `check`) przepisane na `bun --filter` + `bun run build:root` zamiast `npm run build:root`<br>• + nowy `"build:skill-utils": "bun --filter @appverk/opencode-skill-utils build"` (ulepszenie #5)<br>• `lint`, `format`, `format:check`, `verify-dist` — bez zmian (lokalne tooling: eslint/prettier/node)<br>• `main`, `types`, `files`, `dependencies`, `devDependencies`, `overrides` — BEZ ZMIAN |
| `package-lock.json` | **usunięcie** | ~130 KB |
| `bun.lock` | **dodanie** | Wygenerowany przez `bun install` w Kroku 2 |
| `bunfig.toml` | **dodanie warunkowe** | `[install] linker = "hoisted"` + inline komentarz rationale. **WARUNKOWE:** plik powstaje tylko jeśli Krok 1 wykaże że default `isolated` łamie tsup buildy LUB jeśli `configVersion=1` w wygenerowanym `bun.lock`. Jeśli `configVersion=0` i isolated nie łamie → plik pomijamy, bun default robi swoje |
| `.bun-version` | **dodanie** | `1.3.13` |
| `.gitattributes` | **dodanie** | `bun.lock text eol=lf` |
| `.prettierignore` | **edycja** | Usunąć `package-lock.json`, dodać `bun.lock` |
| `scripts/check-package-manager.mjs` (nowy) | **dodanie** | Standalone preinstall guard z header comment "UX hint, NOT a security control" + threat model. Logika: `process.env.npm_config_user_agent?.startsWith('bun/')` → exit 0; else exit 1 z helpful error |
| `scripts/verify-dist-sync.mjs` | **edycja** | • `execSync("npm run build")` → `execSync("bun run build")` + bound `catch (err)` z exit code (ulepszenie #4)<br>• `execSync("git status --short -- " + paths.join(" "))` → `execFileSync("git", ["status","--short","--",...paths])` + bound catch (ulepszenia #3 + #4)<br>• Komentarz na górze: `npm run build` → `bun run build`<br>• Error message w success/failure: `npm run build` → `bun run build` |
| `tests/root-plugin.test.ts` | **edycja w jednym testcase** | • Usunąć `execFileSync("npm", ["pack", "--dry-run", "--json"])` + parsing `packResult[0]?.files.map(f => f.path)`<br>• Zastąpić: `mkdtempSync(path.join(tmpdir(), "bun-pack-"))` → `execFileSync("bun", ["pm", "pack", "--destination", tmpDir])` → `tar -tzf <tarball>` → normalize `package/` prefix<br>• Owinąć w `try { … } finally { rmSync(tmpDir, { recursive, force }) }` (ulepszenie #2)<br>• `expect.arrayContaining(...)` — wartości **derive z runtime'owego odczytu `package.json:files`** (rozwinąć każdy `dist/...` na pliki przez `fs.readdirSync({recursive: true})`). Eliminuje hand-coded listę. (Ulepszenie #9)<br>• Pozostałe testy w pliku (Perun, swift, frontend, skill activation, commit bash protection, hook composition, session-notification event) — bez zmian |
| `packages/code-review/package.json` | **edycja** | • `"test": "npm run build && vitest run …"` → `"test": "bun run build && vitest run …"`<br>• version `0.3.0` → `0.4.0` (D13 atomic bump) |
| `packages/frontend-developer/package.json` | **edycja** | jw. (test script + version 0.4.0) |
| `packages/python-developer/package.json` | **edycja** | jw. (test script + version 0.4.0) |
| `packages/swift-developer/package.json` | **edycja** | jw. (test script + version 0.4.0) |
| `packages/skill-utils/package.json` | **edycja (tylko version)** | test = `vitest run --config vitest.config.ts` (brak prefiksu build, nie wymaga zmian w skrypcie); version `0.3.0` → `0.4.0` (D13 atomic bump) |
| `packages/skill-registry/package.json` | **edycja (tylko version)** | jw. (tylko version bump 0.4.0) |
| `AGENTS.md` | **edycja** | • Sekcje "Commands" i "Per-package commands": `npm run X` → `bun run X`; `npm run X --workspace @appverk/...` → `bun --filter @appverk/... X`<br>• **Nowa sekcja "Prerequisites"** PRZED sekcją "Pantheon harness configuration": wymóg bun ≥ 1.3.13 + `curl -fsSL https://bun.sh/install \| bash` + uzasadnienie preinstall guard<br>• **Nowa sekcja "skill-utils build dependency"** w obszarze per-package commands: dokumentacja `build:skill-utils` jako shared script (ulepszenie #5)<br>• **Filter syntax note z motywującym błędem** "bun's `--filter` takes the script name directly; `bun --filter X run BUILD` returns `No packages matched the filter`" (ulepszenie #7)<br>• Wszystkie pozostałe sekcje (Monorepo Layout, Build & Packaging Details, Pantheon harness, Testing Conventions, etc.) — bez zmian |
| `README.md` | **edycja** | • Quickstart install: `npm install` → `bun install`; commands: `npm run X` → `bun run X`<br>• **Nowa sekcja "Prerequisites"** w "Local Development": wymóg bun ≥ 1.3.13 + install link + preinstall guard rationale<br>• Installation downstream `git+https://...#v0.3.0` → `git+https://...#v0.4.0` (po release tag bump — krok osobny, post-merge) |
| `docs/superpowers/specs/2026-05-28-bun-migration-mszenfeld-design.md` | **dodanie** | Ten spec |
| `docs/superpowers/plans/2026-05-28-bun-migration-mszenfeld-plan.md` | **dodanie** | Plan implementacji (krok następny, po pisaniu speca — przez writing-plans skill) |
| `.gitignore` | **bez zmian** | `node_modules/` ignorowane, root `dist/` + `packages/*/dist/` z carve-out — pasuje do bun |
| `node_modules/` | **reinstalacja** | `rm -rf node_modules`, `bun install` |
| `dist/` (root) | **bez zmian na poziomie kodu** | tsup ESM bundling pod bun działa identycznie; możliwy re-build w Kroku 6 (final smoke) generujący identyczny output |

**Sumarycznie**: 4-5 nowych plików (`bun.lock`, `.bun-version`, `.gitattributes`, `scripts/check-package-manager.mjs` + warunkowo `bunfig.toml`), 1 usunięty (`package-lock.json`), 11 edytowanych (z czego 6 packages/*/package.json — wszystkie z version bump 0.4.0, 4 z dodatkową zmianą test script). Plus spec + plan w `docs/superpowers/`.

## Bun runtime API audit

**Cel sekcji:** zinwentaryzować miejsca w runtime kodzie mszenfeld, gdzie `Bun.*` API mogłoby zastąpić Node API z mierzalnym zyskiem. **Niczego nie zmieniamy w tej migracji.** Audit produkuje uporządkowaną listę follow-up'ów z rekomendacją per miejsce.

**Założenie kontekstowe:** OpenCode w produkcji uruchamia pluginy w bun runtime. Migracja PM zrównuje dev/test runtime. To otwiera drzwi do `Bun.*` API w plugin code bez utraty kompatybilności prod, ale **nadal koszt = utrata przenośności pod node-side vitest** (chyba że `bun run test`, co i tak będzie naszą konwencją po migracji).

Po review tabela ograniczona do 3 actionable miejsc (A1, A4, A5). Skip-entries (A2/A3/A6/A7/A8/A9/A10) usunięte — sygnalizowały thoroughness bez wartości; ich uzasadnienie ("standard JS API, działa identycznie") można rekonstruować na żądanie.

| ID | Miejsce | Obecne API | Kandydat (Bun) | Potencjalny zysk | Koszt/Ryzyko | Rekomendacja |
|----|---------|-----------|----------------|------------------|--------------|--------------|
| **A1** | `src/modules/qa/run-bash.ts:96` | `child_process.spawn("bash", ["-c", cmd], { detached: true, signal })` + custom timer-based timeout + group kill | `Bun.spawn(["bash", "-c", cmd], { timeout, signal, killSignal })` + `proc.exited` Promise (timeout option potwierdzony na bun 1.3.13) | **Średni-wysoki**: wbudowany `timeout` eliminuje ~30 LOC custom timer logic, idiomatyczne `await proc.exited`. **Uwaga:** spawn overhead nie jest zwykle dominującym kosztem QA recipe (wall time spawned-command dominuje), więc zysk wydajnościowy zależny od scenariusza. | (a) Test coverage gęsty (`tests/modules/qa/run-bash.test.ts`) — refactor wymaga reaplikacji edge cases (signal/abort timing, ENOENT, group kill — **semantyki signal/detached różnią się od Node, audit musi enumerować**); (b) bun runtime lock-in dla tego modułu (test pod node = `Bun.spawn` undefined) | **Low-priority PoC** — przed otwarciem PR wymagamy benchmark spec: harness z definicją (n samples, warm-up, statystyka), próg adopcji ≥ 1.5× speedup na zdefiniowanym scenariuszu, dokumentacja diff w signal/group-kill semantyce |
| **A4** | `src/modules/_shared/load-asset.ts` (loadModuleAsset, line 31, `readFileSync` line 40) | `fs.readFileSync(path, "utf8")` synchronicznie do ładowania `.md` (sibling-asset pattern z tsup `bundle:false`) | `Bun.file(path).text()` (async, faster I/O) | **Niski**: szybsze ładowanie ~30 asset plików (KB-skale, sumarycznie ms), ale `readFileSync` jest tu intencjonalnie sync (plugin factory init w OpenCode jest synchronous) | Sync → async refactor każdego call site'u (każdy plugin factory `await loadModuleAsset(...)`) | **Skip.** Sync I/O assetów prosty i czytelny; zysk niewspółmierny do kosztu. |
| **A5** *(zaktualizowane)* | `src/hooks/session-notification/notification-sender.ts` | **NIE używa `child_process.spawn`** (false premise w poprzedniej wersji audytu) — używa `ShellTag` abstraction (caller injects shell, np. OpenCode `ctx.$` lub test mock) | n/a — abstraction jest runtime-agnostic; Bun.spawn nie ma zastosowania w tym warstwie | brak | brak | **Skip.** Inicjalna rekomendacja audytu była oparta na błędnym założeniu (sprostowane podczas review). |

**Summary tabeli:**

- **1 actionable**: A1 (`run-bash.ts` → `Bun.spawn`) — low-priority PoC z wymaganym benchmark spec.
- **2 ostatecznie skip**: A4 (intentional sync, niska wartość), A5 (false premise — nie ma `spawn` do migracji).

**Follow-up output:** spec rekomenduje rozważyć PoC PR po merge'u tej migracji dla A1 — **NIE jako "wysoki priorytet"** (downgrade z poprzedniej wersji audytu — challenger flagged unjustified priority). Benchmark spec wymagane przed PR: harness, sample count, statystyka, threshold. Bez benchmark spec → nie otwieramy PoC.

**Audit NIE obejmuje:**

- Bun-native test runner (`bun test`) — zatrzymujemy się przy vitest
- Bun bundler (zamiast tsup) — zatrzymujemy się przy tsup
- `Bun.serve`, `Bun.fetch` — nie używamy HTTP server-side w pluginach

## Kolejność wykonania (kroki)

Każdy krok zostawia repo w stanie spójnym (możliwy stop+rollback bez utraty pracy). Walidacja **po każdym kroku**, nie na końcu.

### Krok 1 — Pre-flight (bez commitu)

- **Sprawdzić wersję bun:** `bun --version`. Jeśli < 1.3.13 → `bun upgrade` do 1.3.13. Jeśli ≥ 1.3.13 → użyj tego (NIE bumpuj automatycznie do nowszej — D2 pin exact, floor update wymaga osobnej decyzji).
- **Walidacja D6 (linker default determination — KRYTYCZNE):** zapisać baseline `dist/` z npm: `cp -r dist/ /tmp/dist-baseline/` przed migracją. Następnie utworzyć ad-hoc `bunfig.toml` z `[install] linker = "isolated"`, `rm -rf node_modules package-lock.json`, `bun install`, `bun run build:root` + per-package builds. **Pass criterion:** `diff -r dist/ /tmp/dist-baseline/` zwraca pusty output (zero differences). **Failure criterion:** jakiekolwiek diff w `dist/` plikach (poza znanym wpływem clean=true). Notuj też `configVersion` w wygenerowanym `bun.lock` (`grep configVersion bun.lock` lub head -5). Wynik determinuje:
  - `configVersion=0` (legacy) → bun default już to `hoisted` → `bunfig.toml` pin może być pominięty
  - `configVersion=1` (new workspace) → bun default to `isolated` → `bunfig.toml` `linker = "hoisted"` jako precaution
  - dist diff pod isolated → pin obowiązkowy niezależnie od configVersion
  - **Po teście:** ad-hoc `bunfig.toml` i `bun.lock` odrzucić, przywrócić `package-lock.json` (z `git checkout package-lock.json`)
- **Empirical vitest+bun smoke (R15):** ad-hoc `bun install` + `bun --filter @appverk/opencode-code-review test` (najgęstsze mocki vitest w mszenfeld). Jeśli zielone → potwierdzenie R15. Jeśli failuje → priorytet ponad pin decyzję, zatrzymać migrację, raportować upstream.
- **Empiryczna weryfikacja `bun pm pack --destination`:** tymczasowy `mkdir /tmp/bun-pack-test && bun pm pack --destination /tmp/bun-pack-test && tar -tzf /tmp/bun-pack-test/*.tgz | head -20` — potwierdzić: (a) ścieżki mają prefix `package/`, (b) wszystkie `dist/modules/*` są obecne, (c) sortowanie deterministyczne.
- **Empiryczna weryfikacja `bun pm untrusted`** na obecnej `node_modules` (jeszcze npm-installed) — czy pokażą się jakieś blocked lifecycle scripts po przejściu na bun. Notuj wynik dla decyzji o `trustedDependencies` w bunfig.
- **Cleanup:** wszystkie ad-hoc artefakty (`bunfig.toml`, `bun.lock`, `/tmp/bun-pack-test/`, `/tmp/dist-baseline/`) odrzucić przed Krokiem 2 — repo musi wrócić do czystego npm baseline.

### Krok 2 — Lockfile swap + bunfig + safety files

- `rm -rf node_modules package-lock.json`
- Utworzyć `bunfig.toml`:

  ```toml
  # Pin: Bun 1.3.2+ changed default linker to "isolated" (pnpm-style symlinks
  # via node_modules/.bun/). We pin "hoisted" because tsup bundle:false in
  # tsup.root.config.ts emits per-file outputs that some workspaces may
  # resolve against a flat node_modules tree (verified in step 1 pre-flight).
  # Remove this pin only after empirical re-validation across all workspaces.
  [install]
  linker = "hoisted"
  ```

  (Jeśli Krok 1 zweryfikował że `isolated` działa, ten plik może w ogóle nie powstać — wtedy odpowiednia adnotacja w spec addendum.)
- Utworzyć `.gitattributes`: `bun.lock text eol=lf`
- Utworzyć `.bun-version`: `1.3.13`
- `bun install` (generuje `bun.lock`)
- **Sanity 1:** `git diff package.json` — `bun install` nie reorderował kluczy
- **Sanity 2:** `ls -la node_modules/@appverk/` — workspace dep `skill-utils` to symlink na `packages/skill-utils`
- **Sanity 3:** `bun pm untrusted` — pusty lub udokumentowane
- **Sanity 4:** `bun pm ls uuid` — wersja ≥ 14 (overrides honored)
- **Sanity 5 (rollback baseline):** zapisać `npm ls --all > /tmp/npm-ls-mszenfeld-before-bun.txt` PRZED `bun install`, na wypadek pełnego rollbacku
- **Walidacja:** `npm run check` (uwaga: skrypty wciąż na `npm run --workspace`, więc to wymaga że npm jest dostępne lokalnie. Akceptowalne na tym etapie. Jeśli npm niedostępne → przejść od razu do Kroku 3.)
- **Commit:** `bun.lock` + `bunfig.toml` (jeśli powstał) + `.bun-version` + `.gitattributes`; `package-lock.json` jako removed

### Krok 3a — Nowy scripts/check-package-manager.mjs + root scripts

- Utworzyć `scripts/check-package-manager.mjs`:

  ```javascript
  // Preinstall guard for av-opencode-plugins.
  //
  // This is NOT a security control — npm_config_user_agent is trivially
  // spoofable (e.g., npm_config_user_agent='bun/x' npm install bypasses it).
  // Its purpose is to catch accidental `npm install` / `yarn install`
  // invocations from developers unfamiliar with the bun-only convention.
  // Real enforcement is via `packageManager` + README/AGENTS Prerequisites docs.
  const ua = process.env.npm_config_user_agent ?? ""
  if (!ua.startsWith("bun/")) {
    console.error("This project requires bun (≥ 1.3.13). Detected:", ua || "<unset>")
    console.error("Install: https://bun.sh")
    console.error("See README.md Prerequisites for details.")
    process.exit(1)
  }
  ```

- `package.json` root:
  - `"packageManager": "bun@1.3.13"`
  - `"preinstall": "node scripts/check-package-manager.mjs"`
  - version `0.3.0` → `0.4.0`
- **Atomic version bump** (część tego samego commita): wszystkie 6 `packages/*/package.json` version `0.3.0` → `0.4.0` (skill-utils, skill-registry, code-review, frontend-developer, python-developer, swift-developer). Bump musi być atomic z root żeby `bun pm ls` nie pokazał version mismatchu między root a workspaces.
- `package.json` root scripts:
    - `"build:root"` BEZ ZMIAN (`tsup --config tsup.root.config.ts && node scripts/copy-root-assets.mjs`)
    - `"build:skill-utils": "bun --filter @appverk/opencode-skill-utils build"` (nowy, ulepszenie #5)
    - `"build": "bun run build:root && bun run build:skill-utils && bun --filter @appverk/opencode-python-developer build && bun --filter @appverk/opencode-code-review build && bun --filter @appverk/opencode-frontend-developer build && bun --filter @appverk/opencode-skill-registry build && bun --filter @appverk/opencode-swift-developer build"`
    - `"test": "bun run build:root && bun run build:skill-utils && vitest run --config vitest.config.ts && bun --filter @appverk/opencode-python-developer test && bun --filter @appverk/opencode-code-review test && bun --filter @appverk/opencode-frontend-developer test && bun --filter @appverk/opencode-skill-registry test && bun --filter @appverk/opencode-swift-developer test"`
    - `"typecheck": "tsc -p tsconfig.json --noEmit && bun run build:skill-utils && bun --filter @appverk/opencode-skill-utils typecheck && bun --filter @appverk/opencode-python-developer typecheck && bun --filter @appverk/opencode-code-review typecheck && bun --filter @appverk/opencode-frontend-developer typecheck && bun --filter @appverk/opencode-skill-registry typecheck && bun --filter @appverk/opencode-swift-developer typecheck"`
    - `"check": "bun run typecheck && bun run test && bun run build"` (bez zmian semantyki, tylko npm → bun)
- **Walidacja:** `bun run typecheck` — zielone

### Krok 3b — Per-package scripts (4 paczki)

- `packages/code-review/package.json`: `"test": "npm run build && vitest…"` → `"test": "bun run build && vitest…"`
- `packages/frontend-developer/package.json`: jw.
- `packages/python-developer/package.json`: jw.
- `packages/swift-developer/package.json`: jw.
- (`packages/skill-utils` i `packages/skill-registry` — bez zmian, brak prefiksu build)
- **Walidacja:**
  - `bun run typecheck` — zielone
  - `bun run test` — zielone (testy importują z `dist/`, sekwencja `bun run build:root && bun run build:skill-utils && vitest && bun --filter ... test` wymusza poprawny order)
  - `bun run build` — zielone
- **Walidacja shell-semantics:** `bun run` używa własnego shella (nie /bin/sh). Specjalnie sprawdzić: `bun run build:root` (zawiera `&&`), per-package buildy z `&& node scripts/copy-assets.mjs`. Każdy chained script musi działać.

### Krok 4 — Test roota + verify-dist-sync

- `scripts/verify-dist-sync.mjs`:
  - Import dodać `execFileSync`
  - `execSync("npm run build")` → `execSync("bun run build")` z bound `catch (err)` + exit code (ulepszenie #4)
  - `execSync("git status --short -- " + trackedDistPaths.join(" "))` → `execFileSync("git", ["status", "--short", "--", ...trackedDistPaths], { encoding: "utf8" })` z bound catch (ulepszenia #3 + #4)
  - Komentarz top + sukces/failure messages: `npm` → `bun`
- `tests/root-plugin.test.ts` (jeden testcase "packages a self-contained git-install surface"):
  - Imports: `import { mkdtempSync, readdirSync, rmSync, readFileSync, existsSync, statSync } from "node:fs"`, `import { tmpdir } from "node:os"`
  - Zastąpić:

    ```typescript
    const packResult = JSON.parse(
      execFileSync("npm", ["pack", "--dry-run", "--json"], { cwd: rootDirectory, encoding: "utf8" }),
    ) as Array<{ files: Array<{ path: string }> }>
    const packedFiles = packResult[0]?.files.map((file) => file.path) ?? []
    ```

  - Nowy fragment:

    ```typescript
    const tmpDir = mkdtempSync(path.join(tmpdir(), "bun-pack-"))
    try {
      execFileSync("bun", ["pm", "pack", "--destination", tmpDir], { cwd: rootDirectory })
      const tarball = readdirSync(tmpDir).find((entry) => entry.endsWith(".tgz"))
      if (!tarball) throw new Error(`No .tgz file found in ${tmpDir}`)
      const packedFiles = execFileSync("tar", ["-tzf", path.join(tmpDir, tarball)], { encoding: "utf8" })
        .trim()
        .split("\n")
        .map((entry) => entry.replace(/^package\//, ""))
        .filter((entry) => entry.length > 0)

      // ulepszenie #9: derive expected files list from package.json files field
      const expectedFiles = deriveExpectedFilesFromPackageJson(packageJson, rootDirectory)
      expect(packedFiles).toEqual(expect.arrayContaining(expectedFiles))
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
    ```

  - Pomocnik `deriveExpectedFilesFromPackageJson(packageJson, rootDirectory)`:
    - **Wejście:** parsed package.json + abs path root
    - **Iteruje** po `packageJson.files`. Bieżący mszenfeld files = 7 literal dirs (`"dist"` + 6× `"packages/X/dist"`); **brak globów** — assumption documented + verifiable in spec test (assertion: każdy entry NIE zawiera `*`)
    - Dla każdej ścieżki: `statSync(path.join(rootDirectory, entry))`
      - Plik (rzadkie, dziś nie używamy) → push entry wprost
      - Dir → `readdirSync(absPath, {recursive: true, withFileTypes: true})`, dla każdego DirentEntry:
        - **Skip jeśli isDirectory()** — listujemy tylko pliki
        - **Skip-list (hardcoded):** `.DS_Store`, `Thumbs.db`, dotfiles (`.startsWith('.')`), `.tsbuildinfo`
        - **Symlinki:** follow (statSync) i traktuj jak target type. Mszenfeld nie ma intentional symlinks w `dist/`, ale skip-by-default jeśli nie file po follow.
        - Pozostałe pliki → push relative path `entry + "/" + relativePathInDir`
    - **Zwraca:** listę plików (nieuporządkowaną — test używa `arrayContaining`, sort nie potrzebny). Brak dedup wymagany (nie ma duplikacji w literal-dir input).
    - **Edge case:** pusty katalog `dist/` (np. pre-build) → zwraca tylko `package.json` z `package/`-prefix; test wtedy failuje (`packedFiles` nie zawiera oczekiwanych dist entries), co jest pożądane.
  - Pozostałe testy w pliku — **bez zmian** (loadRootModule, Perun, swift, frontend, skill activation, hook composition, commit bash protection, session-notification event)
- **Walidacja:** `bun run check && bun run verify-dist`

### Krok 5 — Dokumentacja

- `AGENTS.md`:
  - Sekcja "Commands": `npm run X` → `bun run X` (3 linijki)
  - Sekcja "Per-package commands": `npm run build --workspace @appverk/X` → `bun --filter @appverk/X build`; note z ulepszenia #7 (filter syntax + error message)
  - **Nowa sekcja "Prerequisites"** wstawiona PRZED "Pantheon harness configuration": wymóg bun ≥ 1.3.13 + install command + preinstall guard rationale
  - **Nowa sekcja "skill-utils build dependency"** w obszarze per-package commands: dokumentacja `build:skill-utils` shared script (ulepszenie #5)
- `README.md`:
  - Local Development section: `npm install` → `bun install`, `npm run X` → `bun run X`
  - **Nowa sekcja "Prerequisites"** w Local Development: wymóg bun + install link
  - Installation downstream section: `git+https://...#v0.3.0` → `git+https://...#v0.4.0` (po release tag, post-merge)
- `.prettierignore`: `package-lock.json` → `bun.lock`
- **Grep sanity** (UWAGA: BSD grep na macOS nie wspiera globów w `--exclude-dir`; używamy `ripgrep` (`rg`) który wspiera glob i jest zainstalowany w tym projekcie):

  ```bash
  rg -nE '\b(npm|npx)\b' \
    --type-add 'cfg:*.{json,mjs,cjs,ts,js,md,yml,yaml,sh}' \
    --type cfg \
    --glob '!node_modules' \
    --glob '!.git' \
    --glob '!**/dist/**' \
    .
  ```

  Alternatywa z GNU grep (`brew install grep` → `ggrep`), jeśli ripgrep niedostępny:

  ```bash
  ggrep -rEn '\b(npm|npx)\b' \
    --include='*.json' --include='*.mjs' --include='*.cjs' --include='*.ts' \
    --include='*.js' --include='*.md' --include='*.yml' --include='*.yaml' \
    --include='*.sh' \
    --exclude-dir=node_modules --exclude-dir=.git \
    --exclude-dir=dist --exclude-dir=packages \
    .
  ```

  (BSD grep workaround: explicit `--exclude-dir=dist` i osobno listować każdy `packages/X/dist` jeśli grep nie wspiera glob — albo prościej, użyć ripgrep.)

  Dozwolone wyjątki (ulepszenie #6, intentional product content downstream):
  - `packages/*/src/{skills,agents,commands}/**` — frontend-developer pnpm-package-manager skill, code-review agents/commands (`npm test`, `npm audit`, `npm install -g eslint` w skill content)
  - `src/modules/**/*.{md,ts}` — assets ładowane runtime przez `loadModuleAsset` (np. `src/modules/qa/prompt-sections/overlay-fe.md` zawiera `npx playwright install`). **Uwaga:** mszenfeld NIE ma nested `src/` pod modułami; pliki leżą bezpośrednio w `src/modules/<name>/`
  - `src/{skills,commands,agents,hooks}/**` — top-level asset markdowny ładowane runtime
  - `dist/**` — zbudowane artefakty kopiujące powyższe (excluded by glob)

### Krok 6 — Final smoke

- `rm -rf node_modules && bun install --frozen-lockfile` (deterministyczność)
- `bun run check && bun run verify-dist`
- **Tarball smoke test:**

  ```bash
  TMP=$(mktemp -d)
  bun pm pack --destination "$TMP"
  cd "$TMP" && tar -xzf *.tgz && cd package
  bun install  # OpenCode i tak to robi po instalacji pluginu
  node -e "import('./dist/index.js').then(m => console.log('OK:', Object.keys(m)))"
  ```

  Musi wypisać `OK: [AppVerkPlugins, createAppVerkPlugins, default]` (lub similar).

### Opcjonalnie — Benchmark before/after

Zarejestrować (motywacja #1, #2):

```bash
# BEFORE — na backup tag'u
git checkout backup/master-before-mszenfeld-rebase
time npm ci 2>&1 | tail -3
time npm run check 2>&1 | tail -3

# AFTER — na feature branch
git checkout feature/migrate-to-bun
time bun install --frozen-lockfile 2>&1 | tail -3
time bun run check 2>&1 | tail -3
```

Wpisać do PR description jako dowód spełnienia motywacji. Notuj cold-cache vs warm-cache.

## Definicja ukończenia (DoD)

Checklist do zaznaczenia przed merge'em PR:

**Build/test pipeline:**

- [ ] `bun run typecheck` — zielone (root + 6 paczek)
- [ ] `bun run test` — wszystkie testy zielone (root `tests/` + `tests/modules/{commit,qa,coordinator,explore,agent-registry,pantheon-config}` + per-package tests)
- [ ] `bun run build` — zielone, `dist/` + `packages/*/dist/` zgodne z committed
- [ ] `bun run verify-dist` — zielone, brak driftu w żadnym z 7 tracked paths

**Reproducibility:**

- [ ] `bun install --frozen-lockfile` od zera (rm -rf node_modules) — działa, deterministyczne wynikiem
- [ ] `bun.lock` w repo, `package-lock.json` usunięty
- [ ] `git diff package.json` po `bun install` — pusty (bun nie reorderował kluczy)

**Packaging:**

- [ ] **Tarball smoke test (Krok 6):** `bun pm pack` → `tar -xzf` → `cd package && bun install && node -e "import('./dist/index.js')..."` — wypisuje `OK: [keys]` bez błędu
- [ ] Test `tests/root-plugin.test.ts` "packages a self-contained git-install surface" przechodzi z derived expected files list (ulepszenie #9)

**Toolchain enforcement:**

- [ ] `packageManager: "bun@1.3.13"` w root `package.json`
- [ ] `.bun-version` = `1.3.13` (zsynchronizowane z `packageManager`)
- [ ] `bunfig.toml` obecny z `linker = "hoisted"` + inline komentarz uzasadnienia (lub nieobecny jeśli Krok 1 zweryfikował że `isolated` działa — wtedy adnotacja w spec addendum)
- [ ] `.gitattributes` z `bun.lock text eol=lf`
- [ ] `scripts/check-package-manager.mjs` obecny z header comment "UX hint, NOT a security control"
- [ ] **Preinstall guard działa:** uruchomienie `npm install` w katalogu kończy się exit 1 z błędem "This project requires bun..."
- [ ] **Preinstall guard nie blokuje legitnego użycia:** `bun install` przechodzi czysto

**Wersjonowanie:**

- [ ] Root `package.json` version `0.4.0`
- [ ] Wszystkie `packages/*/package.json` version `0.4.0` (spójność z root)
- [ ] Brak luźnych referencji `0.3.0` w docs/installation examples (README "Installation" wskazuje `#v0.4.0` po wygenerowaniu tag'u)

**Lifecycle safety:**

- [ ] `bun pm untrusted` po `bun install` — pusty wynik (lub udokumentowane wyjątki w bunfig.toml)
- [ ] `bun pm ls uuid` — wersja ≥ 14.0.0 (overrides honored)

**Dokumentacja:**

- [ ] `AGENTS.md` zaktualizowane: Prerequisites + Commands + Per-package commands + skill-utils build dependency + filter syntax note z error message
- [ ] `README.md` zaktualizowane: Prerequisites + Local Development + Installation downstream tag bump (faza post-merge)
- [ ] `.prettierignore` zaktualizowane (`bun.lock` zamiast `package-lock.json`)
- [ ] **Broader grep clean:** `grep -rEn '\b(npm|npx)\b' --include='*.json' …` zwraca tylko allowed exceptions z ulepszenia #6
- [ ] Spec (`docs/superpowers/specs/2026-05-28-bun-migration-mszenfeld-design.md`) i plan (`docs/superpowers/plans/2026-05-28-bun-migration-mszenfeld-plan.md`) w repo
- [ ] **Bun API audit section w specu** kompletny — z follow-up listą A1 jako wysoki priorytet

**Optional (recommendation, not gate):**

- [ ] Benchmark before/after w PR description (motywacje #1, #2): `time bun install --frozen-lockfile`, `time bun run check` — zarówno cold cache jak i warm cache

**Commit hygiene:**

- [ ] Wszystkie commity zgodne z Conventional Commits (lekcje z poprzedniej iteracji: subject ≤ 72 chars, lowercase scopes)
- [ ] Branch `feature/migrate-to-bun` push'owany do `origin` (mszenfeld), NIE do `upstream` (AppVerk)
- [ ] PR utworzony jako merge → `mszenfeld/master`

## Ryzyko i mitigacje

| # | Ryzyko | Prawd. | Wpływ | Mitigacja |
|---|--------|--------|-------|-----------|
| R1 | `bun pm pack` produkuje tarball o innej strukturze ścieżek niż npm | Niska (zweryfikowane w poprzedniej iteracji) | Średni | Krok 1 weryfikuje empirycznie; test używa `arrayContaining` (order-agnostic) z `package/` prefix normalize |
| R2 | `overrides: { uuid: ">=14.0.0" }` zachowuje się inaczej w bun | Bardzo niska (zweryfikowane: bun honors **top-level** overrides; **nested overrides są NIE wspierane** — nie ma to znaczenia bo używamy tylko top-level) | Niski | Sanity 4 w Kroku 2: `bun pm ls uuid` ≥ 14 |
| R3 | Workspace symlink dla `@appverk/opencode-skill-utils` nie powstaje | Bardzo niska | Wysoki | Sanity 2 w Kroku 2; bun wspiera workspaces >2 lat |
| R4 | `bun --filter` parallelizm łamie kolejność build/test (testy importują z dist/) | Niska (mitigowane przez `&&` chain w D5) | Wysoki | Sekwencja w skryptach roota: każde `bun --filter <single-name> <script>` matchuje 1 paczkę → concurrency=1 z definicji; `&&` gwarantuje sequencing między nimi. Walidacja Kroku 3b wyłapie regresję |
| R5 | Lifecycle scripts blocked by default w bun (postinstall, install) | Niska | Niski | Sanity 3 w Kroku 2: `bun pm untrusted` musi być pusty (lub udokumentowane w bunfig `trustedDependencies` array). **Zauważyć:** to security improvement vs npm, nie regresja — bun blokuje by default, npm wykonuje by default |
| R6 | `bun run` używa własnego shella (nie /bin/sh) — chained scripts z `cp`/`rm`/glob mogą się różnić | Średnia | Średni | Walidacja shell-semantics w Kroku 3b: explicit smoke test każdego `&&`-chained scriptu (w mszenfeld: `build:root` z `tsup && node scripts/copy-root-assets.mjs`, per-package buildy z `tsup … && node scripts/copy-assets.mjs`) |
| R7 | Członek zespołu nie ma bun zainstalowanego / odpala `npm install` | Pewne | Średni | `preinstall` guard wykrywa wrong PM; README/AGENTS Prerequisites; `.bun-version` dla version managerów (mise/asdf/proto); `packageManager` jako wskazówka |
| R8 | Maszyna publikująca (ręczny publish/release tag bump) wymaga bun | Pewne | Średni | README install command na samej górze, w sekcji Prerequisites |
| R9 | `bun install` reorderuje klucze w `package.json` | Niska | Niski | Sanity 1 w Kroku 2: `git diff package.json` musi być pusty |
| R10 | `bun run` auto-installs missing deps (może maskować broken lockfile) | Niska | Średni | DoD wymaga `bun install --frozen-lockfile` od zera |
| R11 | Bun 1.3.2+ default linker `isolated` aktywuje się na mszenfeld i łamie tsup `bundle:false` resolution | **Default zmieniony: pewne. Aktywacja na mszenfeld: nieznana do Kroku 1** (zależy od `configVersion` w nowym `bun.lock` — 0=hoisted, 1=isolated) | Wysoki (jeśli zmaterializowane I niewykryte) | **Aktywne tylko jeśli** Krok 1 wykaże `configVersion=1`. Wtedy `bunfig.toml` `linker = "hoisted"` jako precaution. Jeśli `configVersion=0` — pin niepotrzebny (default już hoisted). Pass criterion: `bun run build` produkuje `dist/` identyczny z npm baseline (`diff -r dist/ dist-baseline/` pusty) |
| R12 | `packageManager` field nie egzekwowany przez bun ani corepack | Pewne | Niski | `preinstall` guard jako mitigacja; oczekiwana ograniczona skuteczność |
| R13 | `files` array w root `package.json` brakuje jakiegoś `dist/` path (np. nowy `dist/modules/foo/`) | Niska | Wysoki (silently broken plugin install) | **Ulepszenie #9** — test `tests/root-plugin.test.ts` derive'uje expected files z `package.json:files`, więc auto-coverage przyszłych ścieżek (jeśli `files` jest pełen) |
| ~~R14~~ | **Skonsolidowane z R11** — duplikat tematu | — | — | — |
| R15 | Test `tests/modules/qa/run-bash.test.ts` używa internal Node mocking patterns vitest, mogą nie działać identycznie pod bun runtime | Niska | Średni | Vitest pod bun jest stabilny od 2024-Q1 (vitest 1.x+ działa z bun). **Empiryczna walidacja:** Krok 1 pre-flight smoke test `bun --filter @appverk/opencode-code-review test` (najbardziej złożona paczka pod względem mocków vitest). Walidacja w Kroku 3b dla pełnego test suite. W razie problemu — vitest 3.1.2 pinnięty, raportować upstream |
| R16 *(nowe)* | **`session.promptAsync` + `BackgroundTaskStore` (coordinator dispatch) zachowują się inaczej pod bun runtime** | Bardzo niska | Wysoki | To OpenCode plugin API, nie Node child_process — runtime-agnostic. OpenCode w produkcji używa bun już teraz; jeśli plugin code działa w prod, działa też pod naszym dev `bun run test` |
| R17 *(nowe)* | **Asset loading pattern (`loadModuleAsset` reading `.md` sibling files z `dist/modules/*/`) ma inne sync semantics pod bun** | Bardzo niska | Średni | `fs.readFileSync` jest standard Node API, identyczne pod bun. Test coverage w `tests/modules/{commit,qa,coordinator}/*` wyłapie regresję |
| R18 | Push do `origin` (mszenfeld) idzie do złego remote'u i ląduje na upstream (AppVerk) | Niska (mitigacja w miejscu) | Niski (sanity wciąż przeprowadzamy) | **Już mitigowane:** tracking ustawiony `master` → `origin/master` (mszenfeld) w poprzednim turnie. Sanity-check przed `git push`: `git remote -v` + `git config branch.feature/migrate-to-bun.remote`. PR utworzymy explicit z `gh pr create -R mszenfeld/av-opencode-plugins`. Backup tag `backup/master-before-mszenfeld-rebase` istnieje. **Lekcja zachowana** mimo downgrade severity |

### Sygnały do natychmiastowego rollbacku po merge

- Test `tests/root-plugin.test.ts` przechodzi lokalnie, ale `verify-dist` pokazuje dryf w `dist/` (znak że `bun --filter` nie wymusza orderingu mimo `&&` — np. shell unification issue)
- Konsument (OpenCode podczas instalacji pluginu) zgłasza brakujące pliki w paczce (R13 — choć ulepszenie #9 powinno zapobiec)
- Tests `tests/modules/qa/run-bash.test.ts` lub `tests/modules/coordinator/*` failują tylko pod bun (R15)
- `bun pm untrusted` nagle zwraca paczki (R5)
- Pojawia się error 1.3.2-style linker conflict w runtime resolution (R11)

### Sygnały do natychmiastowego rollbacku PRZED merge (in-PR)

- Krok 1 pre-flight zwraca > 1 nieoczekiwany finding (np. tsup pod isolated łamie się + bun pm pack tarball ma inne ścieżki niż w poprzedniej iteracji)
- Krok 3b walidacja shell-semantics nie przechodzi (R6 — bun shell unification)

## Rollback

**Pełny revert:** Wymaga **trzech kroków** (rewert nie wystarcza sam — lekcja z poprzedniej iteracji):

```bash
# 1. Revert merge commit (lub series of squashed commits jeśli zostały zsquashowane)
git revert <merge-commit>            # tworzy revert commit
# LUB jeśli żałujemy całkiem
git reset --hard <pre-merge-sha>     # destructive — tylko jeśli nikt nie pulnął

# 2. Wyczyścić bun-side artifacts
rm -rf node_modules bun.lock         # git revert nie usuwa node_modules ani lock-file aktywnego
# (bunfig.toml, .bun-version, .gitattributes — usunięte przez revert; OK)

# 3. Odtworzyć stary stan npm
npm install                          # generuje świeży package-lock.json
                                     # z deps deklarowanych w przywróconym package.json
npm run check                        # walidacja że stan działa
```

**Czas:** < 5 minut na maszynie deweloperskiej.

### Backup ścieżka

Tag `backup/master-before-mszenfeld-rebase` z poprzedniego turnu (`6aae51b`) NIE jest backupem tej migracji — to backup poprzedniej (AppVerk-bazowanej). Dla TEJ migracji backup będzie naturalnie: punkt sprzed merge'a PR `feature/migrate-to-bun`.

Po merge'u **utworzyć dodatkowy tag** dla łatwej referencji:

```bash
git tag backup/mszenfeld-master-before-bun-migration <pre-merge-sha>
git push origin backup/mszenfeld-master-before-bun-migration
```

(To jedyne miejsce gdzie pushujemy tag — robocze tagi backupowe nie powinny być pushowane, ale ten konkretny ma wartość archival.)

### Punkty bez powrotu

- **`bun.lock` resolves wersje inaczej niż `package-lock.json`:** możliwe przy `overrides` lub `"*"` w workspace deps. **Mitigacja:** w Kroku 2 sanity 5, zapisać `npm ls --all > /tmp/npm-ls-mszenfeld-before-bun.txt`. Jeśli po rollbacku `npm ls --all` daje inny output → zdiff'ować i rozważyć ręczny pin wersji.
- **Członek zespołu pobrał branch i odpalił `bun install` lokalnie:** ma w `node_modules/` bun-symlinks (lub isolated `.bun/` jeśli ktoś dropnął bunfig). Rewert tego nie czyści. Wymaga ręcznego `rm -rf node_modules` na każdej maszynie deweloperskiej.
- **PR z migracji wprowadził współzależności kodu (mało prawdopodobne ale możliwe):** jeśli ktoś, robiąc fix-all-style cleanup, dotknie `src/modules/qa/run-bash.ts` lub innych runtime plików (mimo że audit Bun.* API był "nic nie zmieniamy w tej migracji"), tego nie unrollbackujesz przez `git revert` samego PR — trzeba wziąć osobny review na każdą taką zmianę.

### Sygnały kontroli — walidacja po rollbacku

- `git status` — clean
- `node_modules/` brak (lub zawiera npm-style flat layout po `npm install`)
- `bun.lock`, `bunfig.toml`, `.bun-version`, `.gitattributes`, `scripts/check-package-manager.mjs` — wszystkie nieobecne
- `package-lock.json` — istnieje, prawidłowy (`npm install` zregenerował)
- `npm run check` — zielone

### Partial rollback (cofamy tylko fragmenty)

Możliwy ale niewskazany. Jeśli np. preinstall guard sprawia problem ale reszta migracji jest OK:

- Edytuj `package.json`, usuń `"preinstall": "..."`, zostaw resztę
- Albo zmień script na `node -e "process.exit(0)"` jako no-op
- Commit + push

Vs. pełny rollback — partial wymaga ręcznej intervencji na każdej zewnętrznej maszynie (consumerzy nadal mają `packageManager: "bun@1.3.13"` i `.bun-version`, więc będą próbowali bun).
