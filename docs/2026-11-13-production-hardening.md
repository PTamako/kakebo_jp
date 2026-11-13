# 2026-11-13 production ledger hardening

## Private document-assistant receiver
- Private Worker name: `kakeibo-homeflow-bridge`; no workers.dev, routes or Preview URLs.
- Same existing production D1 and `JPDA_BRIDGE_SECRET` binding are required. Never paste the secret into Git.
- `.github/workflows/deploy-private-bridge.yml` builds, runs all release tests, and deploys on relevant source changes to `main`; also supports manual dispatch.
- GitHub Actions must be configured with `CLOUDFLARE_API_TOKEN` (scoped for this Worker deployment), `CLOUDFLARE_ACCOUNT_ID`, and required `production` environment approvals if desired. Without them the workflow **fails visibly**, not silently. Do not create any new Preview resources.
- For incompatible sender/receiver changes: deploy receiver first; then release the document-assistant sender. Verify current Worker version annotations and D1/secret bindings.
- Verify a valid signed `operation:options` can return the fixed SBI transfer category, then test exactly-once receipt of an explicitly authorized sample. Do not automatically write real financial entries as a health check.

## Historical SBI records
- On 2026-11-13, D1 Time Travel bookmark was obtained before changes; six original SBI transfers were verified by effective date and identifiable purpose.
- Six **additive** `sbi_transfer_links` associations were saved: five `monthly`, one points `purchase`. No original entry dates, amounts, or payment sources changed.
- Future manual or imported transfers should always store purpose explicitly. No automatic bulk reclassification of unknown data.

## Backup privacy
- Account/transaction JSON and full receipt ZIP can optionally be encrypted in the browser with AES-256-GCM, random salt/IV, and PBKDF2-SHA256. The resulting `.kbe` file has authenticated ciphertext.
- Decryption happens locally before regular integrity and structural validation. Legacy plain JSON and ZIP imports stay supported.
- Passwords are never sent to Cloudflare or persisted in browser storage. Forgotten password means the encrypted backup cannot be recovered; retain a secure copy.
- The mobile file picker accepts `.json`, `.zip`, `.kbe`. Large encrypted ZIPs need adequate free memory in Safari.

## Remaining release-policy control
- GitHub Issue #268 tracks administrative branch/ruleset enforcement. Repo-level branch protection **cannot** be applied from the GitHub integration used here.
- Require pull requests, `Validate / validate`, `Mobile WebKit Smoke / mobile-webkit`, and block force/direct pushes through GitHub repository Settings. Do not make private financial repository content public just to bypass a plan limitation.
- Public Git history containing prior screenshot-derived fixture values must be examined separately; ordinary commits cannot purge historical blobs. Do not rewrite repository history without coordinated review and backup.
