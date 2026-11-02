---
name: dependabot-major-updates
description: Land a Dependabot PR that auto-merge left open (a major update, or the 0.x drizzle group): read every breaking change, adapt the code, verify, push to the PR. Use when the user asks to handle Dependabot PRs, major updates, or a dependency upgrade.
---

Minor and patch updates merge themselves (`.github/workflows/dependabot-auto-merge.yml`). What stays open needs code changes or a decision: semver-major updates of npm packages, GitHub Actions and the Docker base image, plus the `drizzle` group, whose 0.x minors break like majors.

## 1. Pick the PRs

If the user named a PR, take it. Otherwise list the open Dependabot PRs without auto-merge:

```sh
gh pr list --author app/dependabot --json number,title,autoMergeRequest \
  --jq '.[] | select(.autoMergeRequest == null) | "\(.number) \(.title)"'
```

Handle one PR at a time, steps 2–5 each. A PR that moves a package covered by a **coupling** below takes its siblings along in the same PR; close Dependabot's separate PRs for those siblings once yours lands.

## 2. Collect the breaking changes

`gh pr view <n>` carries release notes and links. Read the changelog, release notes and migration guide for **every** major between the old and the new version, not just the last one. Write down the breaking-changes list: one line per change.

Done when every major in the range has been read and its breaking changes are on the list.

## 3. Adapt the code

`gh pr checkout <n>`, then `npm ci`. Walk the breaking-changes list; for each entry search the code (`src/`, `e2e/`, config files, `.github/workflows/`, `Dockerfile`) and either fix the usage or note why it doesn't apply.

Done when every entry on the list is marked _fixed_ or _not applicable: reason_.

### Couplings

Packages that only move together in this repo:

- **Node runtime**: `FROM node:<major>-slim` (every stage in `Dockerfile`), `node-version` in `.github/workflows/ci.yml`, `engines.node` in `package.json`, the `@types/node` major and "Requires Node <major>" in `README.md`. Take only even (LTS) Node majors; close a PR proposing an odd one with a comment saying so. A lone `@types/node` major is the same upgrade: do the whole runtime or close it.
- **Drizzle**: `drizzle-orm` and `drizzle-kit` (Dependabot groups them). After the upgrade run `npm run db:generate`: it must produce no new migration. A new migration or a rewritten `drizzle/meta` snapshot means the generator changed; commit only what the upgrade guide calls for and explain it in the PR.
- **Svelte toolchain**: `svelte`, `@sveltejs/kit`, `@sveltejs/vite-plugin-svelte`, `@sveltejs/adapter-node`, `vite`, `vitest`, `svelte-check`, `eslint-plugin-svelte`, `prettier-plugin-svelte`. Their peer ranges pin each other; `npm ls` must report no invalid peers.
- **Lint toolchain**: `eslint`, `@eslint/js`, `typescript-eslint`, `eslint-config-prettier`, `typescript`.
- **better-sqlite3** is native: the `Build and push image` check proves it still compiles in the Docker image.

## 4. Verify

```sh
npm run lint && npm run check && npm test && npm run test:e2e
```

Done when all four pass. A failure is a missed breaking change: back to step 3.

## 5. Push and hand over

Commit to the PR branch with a message naming the upgrade, push, and comment on the PR with the breaking-changes list and how each entry was resolved. Once you have pushed, Dependabot stops rebasing the branch; resolve conflicts yourself, since `@dependabot recreate` would discard your commits.

Report to the user and merge with `gh pr merge <n> --auto --squash` only on their go-ahead.

If the upgrade can't land now (a peer hasn't released support yet, the migration is a project of its own), comment the blocker on the PR and ask the user whether to leave it open or tell Dependabot `@dependabot ignore this major version`.
