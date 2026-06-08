# Squabbit Web

## Deployment
- This site is hosted on **GitHub Pages** (custom domain via `CNAME` → squabbitgolf.com). **Pushing to `main` deploys it** — there is no build/deploy step or `firebase deploy` for the web. To ship a web change: commit and push.
- The companion backend (Cloud Functions + Firestore/Storage rules) lives in `../squabbit_cloud` and **does** deploy via `firebase deploy` (gated — requires explicit approval). Rules: `firebase deploy --only firestore:rules`. Functions: `firebase deploy --only functions:<name>` (predeploy runs `npm run lint`). Project id: `squabbit-2019`.
