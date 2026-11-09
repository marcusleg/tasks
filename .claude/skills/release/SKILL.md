---
name: release
description: Cut a release of Tasks: pick the semantic version from what changed since the last tag, bump it through a PR, tag main, publish the image and the GitHub Release. Use when the user asks to release, cut or ship a version, or bump the version.
---

A release is a `vX.Y.Z` tag on main. The tag push runs `Build and push image` (`.github/workflows/image.yml`), which refuses a tag that doesn't match `package.json`'s `version` or isn't on main, then publishes `ghcr.io/marcusleg/tasks:X.Y.Z` and `:latest`. The GitHub Release carries the notes.

## Versioning

The **contract** is what a self-hoster or a User relies on across upgrades: the environment variables, the image's port, volume and `DATABASE_PATH`, the data in the database, Calendar Link URLs that external calendars subscribe to, and the features themselves. The JSON endpoints under `/api` serve the app's own pages and are not part of it.

- **Major**: upgrading needs action from the self-hoster or breaks something they rely on: an environment variable renamed, removed or newly required; a changed port or volume; a migration that drops data or needs a manual step; Calendar Link URLs that stop working; a feature removed.
- **Minor**: new features, a new Language, a new optional environment variable, and **any new migration** in `drizzle/`. Rolling back an image across a patch is then always safe; across a minor it may not be.
- **Patch**: everything else that reaches the image: fixes, dependency updates, performance, wording.

While the version is `0.x`, a major change bumps the minor (`0.4.2` → `0.5.0`) and gets upgrade notes; minor and patch apply as above. Moving to `1.0.0` is the user's call; propose it, never pick it.

A release with no change that reaches the image (only docs, tests, CI, agent skills) has nothing to ship: tell the user and stop.

## 1. Collect the changes

```sh
git fetch origin --tags
last=$(git describe --tags --abbrev=0 --match 'v*' origin/main)   # fails: first release, use the whole history
git log --first-parent --format='%h %s' "$last"..origin/main
git diff --stat "$last"..origin/main -- drizzle/ .env.example Dockerfile
```

Classify every commit as _major_, _minor_, _patch_ or _not shipped_ against **Versioning**. A subject is a hint, not proof: read the diff (`git show <sha>`) wherever it could hide a contract change, which means any commit touching `drizzle/`, `.env.example`, `Dockerfile`, `src/lib/server/**/config.ts`, `src/hooks.server.ts` or `src/routes/cal/`.

Done when every commit in the range carries a class.

## 2. Pick the version and write the notes

The version is the current one (`package.json`) bumped by the highest class in the range; the first release is `0.1.0`.

Write the release notes for self-hosters and Users, in their words, not the commit's. One line per change, PR number at the end (`(#86)`); fold all dependency updates into one line. Sections, empty ones left out:

```markdown
## Upgrade notes
What a self-hoster must do before or after pulling this version, step by step.

## Features
## Fixes
## Other changes

Image: `ghcr.io/marcusleg/tasks:X.Y.Z`
```

Every major-class change needs an entry under _Upgrade notes_. Save the notes to the scratchpad.

Show the user the version, the reason for it (the change that set the class) and the notes. Go on only with their go-ahead; they may change the version or the notes.

## 3. Bump the version through a PR

```sh
git switch -c release-X.Y.Z origin/main
npm version X.Y.Z --no-git-tag-version   # package.json and package-lock.json
git commit -am "Release X.Y.Z"
git push -u origin release-X.Y.Z
gh pr create --title "Release X.Y.Z" --body-file <notes>
gh pr checks --watch
gh pr merge --squash --delete-branch
```

Done when the PR is merged. Its merge commit is the release commit: `gh pr view --json mergeCommit --jq .mergeCommit.oid`.

If commits landed on main between step 1 and the merge, they are in the release: classify them, and if they raise the class, bump again in a new PR; otherwise add them to the notes.

## 4. Tag and publish

```sh
git fetch origin
git tag -a vX.Y.Z <release commit> -m "Release X.Y.Z"
git push origin vX.Y.Z
gh run list --workflow image.yml --branch vX.Y.Z   # then: gh run watch <id> --exit-status
```

Done when the run is green. Then publish the notes:

```sh
gh release create vX.Y.Z --verify-tag --title "X.Y.Z" --notes-file <notes>
```

Report the release URL to the user.

A failed `Check release tag` means the tag is wrong and no image was published: delete it (`git push origin :refs/tags/vX.Y.Z`, `git tag -d vX.Y.Z`), fix the cause and tag again. A tag whose image was published is permanent: fix forward with a patch release.
