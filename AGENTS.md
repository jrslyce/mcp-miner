# Repository Guidelines

## Canonical Checkout
Use `/Users/jared/Code/mcp-miner` as the only normal checkout for this repository. Work on `main` unless the user explicitly asks for a short-lived branch. Do not recreate sibling worktrees such as `mcp-miner-subscriptions`; if a worktree is truly needed, remove it after merge and return all work to `main`.

## Project Structure & Module Organization
The repo contains the whole product, not separate repos. Firebase backend code lives in `firebase/functions/src`, the hosted portal lives in `firebase/hosting`, Firebase config and security rules live in `firebase.json`, `.firebaserc`, `firestore.rules`, and `firestore.indexes.json`, and the Codex plugin lives under `plugins/mcp-miner`. Product/game data is in `data`, design and launch docs are in `docs`, and validation/smoke scripts are in `scripts`.

## Build, Test, and Development Commands
Run `npm run check` for the full validation suite. Use focused scripts while iterating: `npm run test:dashboard`, `npm run test:firebase-js`, `npm run test:billing`, `npm run test:cloud-sync-api`, `npm run test:mcp`, or a single Ruby test such as `ruby scripts/test_dashboard_static.rb`. Firebase emulator checks use `npm run firebase:emulators:smoke`, `npm run firebase:rules:smoke`, and related scripts; these require Java for Firestore.

## Coding Style & Naming Conventions
The codebase is plain Ruby and Node.js. JavaScript is validated with `node --check` and the Functions lint script in `firebase/functions/package.json`; Ruby tests are direct script assertions. Keep generated or bulk output out of source unless it belongs under existing data, docs, or Firebase hosting assets.

## Testing Guidelines
Before merging, prefer `npm run check`. For Firebase or portal-only changes, at minimum run the affected focused tests plus `npm run test:firebase-js` and `git diff --check`. For live deployment work, record the exact deploy and live smoke evidence in the PR or Linear ticket.

## Commit & PR Guidelines
Commit history uses short imperative messages, often prefixed with Linear IDs such as `MUX-221 support auth-keyed live QA repeats`. Keep each ticket or fix in its own commit when practical. After a PR is merged, delete merged local and remote branches so `main` remains the single source of truth.
