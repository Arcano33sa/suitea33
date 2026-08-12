# AGENTS

## Safe working scope and authorization
- Codex may analyze, modify, and test local project files only within the scope explicitly requested by the user. Do not make unrelated changes.
- Work in small, closable, and verifiable stages. Avoid unnecessary application-wide reconstruction, and leave the application functional at the end of every stage.
- Codex may prepare changes and create local commits only when they are part of the authorized stage. Never run `git push` without the user's explicit authorization.
- Never deploy, publish, or send changes to production without the user's explicit authorization. This includes GitHub, Firebase, Vercel, Hosting, Functions, Firestore rules/indexes, and any other remote or production environment.
- Do not add new dependencies without the user's explicit authorization.

## Data, history, and compatibility safety
- Do not delete `localStorage`, IndexedDB, persistent data, local databases, or existing information unless the user expressly instructs it.
- Do not delete or overwrite historical files, backups, or compatibility data unless the user expressly instructs it.
- Preserve historical compatibility with existing data, structures, and formats.
- If an action may be destructive, irreversible, or affect data, stop and request authorization before executing it.
- Authorization for a destructive or delicate action is always specific to that individual action. Never treat “Allow once” or any previous authorization as permanent permission for future actions.
- Never request, assume, or retain permanent authorization for destructive operations.
- If there is doubt between a safe action and one that may affect data, Git history, production, or infrastructure, stop and consult the user.

## Stage completion and sensitive components
- Before closing a stage, run the reasonably available tests, review the changes made, and report the results. Clearly state when a check could not run because tools or automated tests are unavailable.
- Firebase, PWA, Service Workers, caches, versions, and other sensitive components may be modified only when they are genuinely part of the stage objective.
- Do not use a routine version or cache update as justification to modify sensitive components outside the requested scope.

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
