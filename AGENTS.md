## Finishing work

Every change ends as an open pull request against `main`, without waiting to be asked: once `npm run check`, `npm run lint` and the affected tests pass, commit on a feature branch, push, and open the PR with `gh pr create`. Follow-up changes to the same work go on that branch. Merge with `gh pr merge --rebase`, so each commit lands on `main` as written.

When a change alters what the README screenshots show, run `npm run screenshots` before the PR and commit the images of the views it touched (desktop, mobile). Leave the others as they are: the sample data is dated relative to today, so every run redraws their date chips too.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label triage vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
