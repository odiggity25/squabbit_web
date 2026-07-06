# Squabbit Web

## Deployment
- This site is hosted on **GitHub Pages** (custom domain via `CNAME` → squabbitgolf.com). **Pushing to `main` deploys it.** To ship a web change: commit and push. There is no `firebase deploy` for the web.
- **Deploys run through a GitHub Actions workflow** (`.github/workflows/deploy-pages.yml`), NOT the classic Jekyll pipeline. The workflow uploads the static files verbatim (excluding `.git`/`.github`) and deploys. Pages `build_type` is set to `workflow`. Watch a deploy: `gh run watch $(gh run list --workflow deploy-pages.yml -L1 --json databaseId --jq '.[0].databaseId') --repo odiggity25/squabbit_web`; logs are at the repo's Actions tab.
- **`.nojekyll` is committed and required** — it disables Jekyll so a stray `{{`/`{%` in any file (JS templates, blog posts) can't break the build.
- The companion backend (Cloud Functions + Firestore/Storage rules) lives in `../squabbit_cloud` and **does** deploy via `firebase deploy` (gated — requires explicit approval). Rules: `firebase deploy --only firestore:rules`. Functions: `firebase deploy --only functions:<name>` (predeploy runs `npm run lint`). Project id: `squabbit-2019`.

### Deploy gotchas (learned 2026-07-06, migrating off classic Jekyll)
- **The classic (Jekyll) Pages build was failing/hanging with a useless "Page build failed." and a badly-lagging status API.** This site uses zero Jekyll features, so the fix was `.nojekyll` + switching Pages to the Actions workflow above. Do NOT switch `build_type` back to `legacy`.
- **Pushing anything under `.github/workflows/` needs the `workflow` OAuth scope.** Default `gh` auth (`repo` scope) gets rejected with "refusing to allow an OAuth App to create or update workflow ... without `workflow` scope". Fix: user runs `gh auth refresh -h github.com -s workflow`, then push.
- **On a failed deploy, trigger a FRESH run — do not re-run only the failed job.** `gh run rerun <id> --failed` re-uploads the `github-pages` artifact and the deploy then dies with "Multiple artifacts named 'github-pages' were unexpectedly found (count 2)". Instead: `gh workflow run deploy-pages.yml --repo odiggity25/squabbit_web --ref main` (or just push again).
- **"Deployment failed, try again later." is a transient GitHub Pages backend error** — re-run fresh (see above); it is not a content problem.
- Verify a deploy actually shipped by curling the file, not just the run status: `curl -s "https://squabbitgolf.com/<file>?z=$RANDOM" | grep -c <expected-marker>`.
