# AGENTS

## Safe working scope and authorization
- Codex may analyze, modify, and test local project files only within the scope explicitly requested by the user. Do not make unrelated changes.
- Work in small, closable, and verifiable stages. Avoid unnecessary application-wide reconstruction, and leave the application functional at the end of every stage.
- Codex may prepare changes and create local commits only when they are part of the authorized stage. Never run `git push` without the user's explicit authorization.
- Never deploy, publish, or send changes to production without the user's explicit authorization. This includes GitHub, Firebase, Vercel, Hosting, Functions, Firestore rules/indexes, and any other remote or production environment.
- Do not add new dependencies without the user's explicit authorization.

## Mandatory analysis and agreement protocol
- When the user proposes an improvement, correction, problem, or new feature, do not modify files immediately. First discuss the desired outcome with the user.
- During analysis, Codex may read, search, and inspect the project to understand current behavior, but must not modify files.
- Identify impacts, dependencies, risks, and historical-compatibility concerns before proposing implementation.
- When multiple reasonable solutions exist, explain the alternatives before selecting one with the user.
- Reach clear functional agreements with the user, then present a summary of every agreement before planning implementation.
- Always state how many stages are recommended for safe delivery and, after agreement with the user, how many stages will actually be used.
- Prefer small, safe, closable, and verifiable stages. Each stage must have one clearly delimited primary objective.
- Do not begin implementation until the user gives explicit authorization.

## What constitutes execution authorization
- Modify files or execute a stage only after an explicit and unambiguous instruction such as “procede”, “hazlo”, “aplícalo”, “corrígelo”, “procede con la Etapa X”, “ejecuta la Etapa X”, or a clearly equivalent instruction.
- Conceptual agreement or analysis language such as “me gusta”, “de acuerdo”, “correcto”, “esa opción”, “podemos hacerlo”, or “me parece bien” does not authorize implementation. Questions about how a proposal would work also do not authorize implementation.
- Such expressions may close functional agreements, but implementation still requires separate explicit authorization.

## Authorized stage execution
- Execute only the stage the user expressly authorizes, and never advance automatically to the next stage.
- Completing a stage, even with all tests passing, does not authorize the next stage.
- Do not expand a stage's scope or use it for unagreed refactoring, cleanup, or additional improvements.
- If an unforeseen problem, dependency, or risk requires broader scope, stop and explain it to the user before continuing.
- Maintain compatibility with existing data and historical behavior when applicable, and follow the data-safety rules below throughout execution.

## Data, history, and compatibility safety
- Do not delete `localStorage`, IndexedDB, persistent data, local databases, or existing information unless the user expressly instructs it.
- Do not delete or overwrite historical files, backups, or compatibility data unless the user expressly instructs it.
- Preserve historical compatibility with existing data, structures, and formats.
- If an action may be destructive, irreversible, or affect data, stop and request authorization before executing it.
- Authorization for a destructive or delicate action is always specific to that individual action. Never treat “Allow once” or any previous authorization as permanent permission for future actions.
- Never request, assume, or retain permanent authorization for destructive operations.
- If there is doubt between a safe action and one that may affect data, Git history, production, or infrastructure, stop and consult the user.
- Treat deletion of files, destructive resets, significant structural changes, Firebase alterations, and operations that are difficult to reverse as delicate actions requiring explicit authorization.
- When an authorization system offers a choice for a delicate action, prefer one-time authorization over permanent authorization.

## Stage completion and sensitive components
- Before closing a stage, run the reasonably available tests, review the changes made, and report the results. Clearly state when a check could not run because tools or automated tests are unavailable.
- At the end of each stage, stop implementation; run tests corresponding to the change and reasonable smoke tests for the affected behavior; check for evident related errors; and review the stage diff.
- Confirm that no files or areas outside the agreed scope changed.
- Report the completed stage, its objective, changes made, modified files, tests run, test results, smoke-test result, risks or observations, and any pending work.
- After reporting, stop and wait for the user's review and approval. Do not start the next stage or treat successful tests as permission to continue.
- Do not commit automatically at the end of implementation. Give the user time to test and review the application manually before requesting commit authorization.
- Firebase, PWA, Service Workers, caches, versions, and other sensitive components may be modified only when they are genuinely part of the stage objective.
- Do not use a routine version or cache update as justification to modify sensitive components outside the requested scope.

## Local commits and recovery points
- Local commits are safe recovery points between stages. When a stage is to be closed with a local commit, use a descriptive message related to that stage.
- Do not automatically run `git push` after a commit. A local commit does not authorize the next stage; after committing, stop and wait for instructions.
- Before including changes in a commit, warn the user if pending changes exist that do not belong to the current stage.
- Positive feedback such as “quedó bien”, “funciona”, “perfecto”, “excelente”, or “listo” may indicate satisfaction but does not authorize a commit.
- When the user confirms that the stage is correct, ask exactly: **“Etapa aprobada. ¿Procedo al commit local?”** Then wait for explicit authorization before creating the commit.
- The user may authorize the commit with a message, ask Codex to propose a descriptive message, or request additional changes before committing.
- Before an authorized commit, verify that the included changes belong only to the approved stage, no modified files fall outside scope, no accidental changes are included, and the Git working tree is in the expected state.
- After the commit, report its short hash, the message used, and the working-tree state; then stop. The commit does not authorize the next stage or a `git push`.
- The next stage requires separate explicit authorization. Publication to GitHub occurs only with the user's explicit authorization and through the project's agreed publication flow.

## GitHub and production workflow
- The normal publication flow for this project is performed from Terminal when the user decides.
- Codex should focus on analysis, local modifications, tests, review, and authorized local commits.
- Authorization to modify files is not authorization to push. Authorization to commit is not authorization to push. Authorization to advance a stage is not authorization to publish.

## Required workflow
- The mandatory sequence is: **IDEA → CODE ANALYSIS → CONVERSATION → AGREEMENTS → SUMMARY → STAGE DEFINITION → AUTHORIZATION → EXECUTION OF ONE STAGE → TESTS → SMOKE TEST → DIFF REVIEW → CHANGE SUMMARY → USER APPROVAL → LOCAL COMMIT WHEN APPLICABLE → STOP.**
- Wait for independent authorization before the next stage. Never jump directly from an idea or conversation into implementation of multiple stages.

## Repo shape (no build system)
- This is a static multi-module web app: root `index.html` links to module folders (`pos/`, `inventario/`, `lotes/`, `pedidos/`, `agenda/`, `finanzas/`, `catalogos/`, `analitica/`, `configuracion/`, `centro-mando/`, etc.).
- Shared runtime utilities live in `assets/js/` (notably `a33-storage.js`, `a33-theme.js`, `a33-release.js`). Most modules are plain HTML/CSS/JS, no bundler.
- `functions/` is a separate Firebase Functions project (Node 20, entrypoint `functions/src/index.js`).

## Canonical paths and legacy trap
- Use `centro-mando/` as canonical. `centro_mando/index.html` is a legacy redirect/cleanup page; do not implement new features there.

## Firebase deploy reality
- Source of truth is `firebase.json`.
- Hosting deploy target is `hosting.public = "pruebas"` (not repo root).
- Firestore config is root-level `firestore.rules` + `firestore.indexes.json`.
- Functions source is `functions/` with runtime `nodejs20`.

## Commands you can actually run
- The commands in this section are technical references only. Their presence does not authorize deployment or remote connections. Any Firebase or production operation must be required by the current stage objective; deployment or publication always requires the user's explicit authorization.
- From repo root, deploy pieces with Firebase CLI: `firebase deploy --only hosting`, `firebase deploy --only functions`, `firebase deploy --only firestore:rules,firestore:indexes`.
- In `functions/`: `npm run serve` (functions emulator), `npm run deploy`, `npm run logs`.
- `functions/npm run lint` is a placeholder (`echo "Sin lint configurado"`); do not assume lint/test/typecheck automation exists.

## Versioning + cache coherence (easy to break)
- Cache/version values are hardcoded and duplicated across module HTML and service workers via `?v=...&r=...` query params.
- `assets/js/a33-release.js` is the SW/UI release source (`suiteVersion`, `rev`). If you change asset versions or SW precache lists, update related `?v/&r` references and module `sw.js` precache entries together.
- Service workers are module-scoped (`pos/sw.js`, `inventario/sw.js`, `lotes/sw.js`, `pedidos/sw.js`, `catalogos/sw.js`, `centro_mando/sw.js`) and intentionally avoid cross-module cache deletion.

## Storage conventions that affect cross-module behavior
- Shared storage prefixes are `arcano33_`, `a33_`, `suite_a33_` (see `assets/js/a33-storage.js`). New persisted keys should follow these prefixes to remain compatible with backup/cleanup tooling.
