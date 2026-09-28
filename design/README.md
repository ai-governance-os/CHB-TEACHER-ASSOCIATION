# 中华账簿 · 视觉与加载优化

The interface uses midnight navy, cobalt, cyan, violet and icy silver. The user rejected the prior brown/gold direction, large white surfaces and promotional copy. Sign-in uses a compact school masthead and a single form card. Mobile has no marketing header, tagline or decorative video. The official crest remains in the masthead and reports.

## Night interface, September 29

The active screen theme now uses the darker `src/night.css`: a navy canvas, layered translucent blue cards, thin cyan and violet edge lights, and bright values with restrained secondary text. It addresses the user's feedback that the previous page was too white and lacked impact. Login uses a dark blue form while mobile keeps all fields in one card. Ledger tabs, filters, totals, tables, reports and record forms share the theme; PDF and print keep their white document surface. The existing ImageGen blue book and optional HyperFrames loop remain the only decorative media, so the new effect adds no network wait on mobile. Color changes never change financial values or Google Sheets data.

Annual and half-year reports use `src/report-print.css` for dense A4 printing. Every active transaction, category totals, the balance equation and signature lines remain; lengthy source-review notes are shortened to a marked count on paper and stay complete in the app. PDF checks against live ledger content: Teachers 2024 (60 entries, 2 pages), Teachers 2025 (58, 2), PTA 2024 (37, 2), Store 2025 (30, 1), Teachers 2024 H1 (23, 1). Extracted PDF date counts matched every source entry.

## ImageGen assets

Created using the built-in ImageGen tool. Original outputs are kept here; web icon derivatives are in `public/icons`.

- Active: `app-icon-blue-original.png`. Final built-in ImageGen prompt: "Use case: logo-brand. Create one final square app icon image for a modern Chinese school finance app called 中华账簿 (NO text in the image). A bold, highly legible white and icy silver folded open-book symbol, three abstract clean page folds subtly representing three ledgers, centered and occupying 62% of the canvas. Precise geometric silhouette with a restrained luminous cyan edge and very shallow sculptural depth. Background full-bleed deep midnight navy #071630, subtle cobalt-blue light concentrated behind the symbol. Premium futuristic fintech app identity, confident and cool, extremely clean at 32px. Frontal view, symmetric composition, smooth satin material, polished edges. No gold, brown, cream, bronze, red, letters, numbers, school crest, border, frame, rounded-square outer mask, mockup, extra objects or watermark. The background must reach all four square image edges; the phone applies its own icon mask."
- Web derivatives: `public/icons/icon-blue-{32,180,192,512}.png`; named URLs let browsers discover the refreshed favicon and home-screen identity. Browser/OS home-screen icon refresh remains platform controlled.
- Archived design explorations: `app-icon-original.png` and `dashboard-concept.png` document the superseded warm design. They are not used by the app. All concept amounts are fictional; authenticated pages always use real ledger data.

## HyperFrames

`brand-motion` contains the editable single-scene composition, its brief, and the installed `drift-hold` primitive used for motion timing. Active export: `public/brand-motion-blue.mp4`, 6 seconds, 480 × 480, H.264, 24 fps, silent, approximately 511 KB. The updated silver book floats within thin cyan orbital lines. HyperFrames 0.8.82 check passes with zero lint/runtime/layout/motion findings. Frame snapshots were visually inspected. Re-render with the pinned project script, with FFmpeg and FFprobe on PATH. The poster is exported from the actual composition.

The login form renders independently of the decoration. Video is requested after 1.4 seconds only on desktop when reduced motion and data saver are off. Users can pause it. Mobile uses no video; a static poster is available for other no-motion cases.

## Loading changes

- Removed a blocking Google Fonts stylesheet and large split Chinese body-font downloads. Chinese interface text uses native sans-serif fonts; Latin numbers use one local 25 KB Manrope font. The previous editorial serif subset is no longer loaded.
- Login can return its first ledger snapshot with the same authenticated, globally rate-limited Google request. Password and rate limit must both pass before any cookie or financial data is returned.
- Correct sign-ins do not consume failed-password attempts. The server signs its own password-verification result; a client-supplied result is ignored. Twelve consecutive failures still block even a correct password until the lock expires. Failure counters use a separate namespace from legacy all-attempt counters because their meanings differ.
- Redirect response bodies are released explicitly. Result-download timeouts retry sooner; signed Google execution keeps its existing timeout budget.
- If a read or server-verified successful login has not completed after four seconds, a single backup request can supply the result. The losing connection is aborted. Financial writes and incorrect passwords never use speculative requests; a correct password still cannot bypass the shared lockout counter.
- Previously opened ledgers remain in session memory. Switching displays the snapshot immediately; snapshots older than 15 seconds refresh. Manual refresh always reads the source. Writes replace their book's cached snapshot; logout clears every entry. No financial data is saved to localStorage.
- Vercel function region is Singapore (`sin1`). Google Sheets remains the durable source, so network delays can still vary.

Validation includes authenticated login, rate-limit and wrong-password rejection, cache isolation/expiry/clearing, conflict/void behavior, all three ledger calculations, and local/production browser checks.
