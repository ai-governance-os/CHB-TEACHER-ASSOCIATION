# 中华账簿 · 视觉与加载优化

The interface uses warm ivory, oxblood ink and champagne gold. The school's official crest is retained in the login masthead and financial reports. The new app mark is a separate gold open book inspired by the crest and the three ledgers.

## ImageGen assets

Created using the built-in ImageGen tool. Original outputs are kept here; web icon derivatives are in `public/icons`.

- `app-icon-original.png`: single premium square icon, edge-to-edge oxblood lacquer, centered champagne gold sculpted open book, three visible folded leaves suggesting three ledgers, subtle vermilion in the creases, bold small-size silhouette, no words or numbers. School crest supplied as conceptual reference; not a replacement official emblem.
- `dashboard-concept.png`: desktop school finance dashboard for 文林望中华学校 / 中华账簿; warm ivory canvas, charcoal oxblood sidebar, champagne rules, vermilion active accent, Chinese Song-style headings and readable sans body, three ledger tabs, wide balance panel, income/expense cards, charts and transaction table. All concept amounts are fictional. The implemented app always uses its authenticated data.

## HyperFrames

`brand-motion` contains the editable single-scene composition, its brief, and the installed `drift-hold` primitive used for motion timing. Export: `public/brand-motion.mp4`, 6 seconds, 480 × 480, H.264, 24 fps, silent. HyperFrames 0.8.82 check passes with zero lint/runtime/layout/motion findings. Frame snapshots were visually inspected. Re-render with the pinned project script, with FFmpeg and FFprobe on PATH.

The login form renders independently of the decoration. Video is requested after 1.4 seconds only on desktop when reduced motion and data saver are off. Users can pause it. Mobile uses no video; a static poster is available for other no-motion cases.

## Loading changes

- Removed a blocking Google Fonts stylesheet and large split Chinese body-font downloads. Body text uses native CJK fonts; Latin numbers and a 25 KB editorial Chinese title subset are hosted with the app.
- Login can return its first ledger snapshot with the same authenticated, globally rate-limited Google request. Password and rate limit must both pass before any cookie or financial data is returned.
- Correct sign-ins do not consume failed-password attempts. The server signs its own password-verification result; a client-supplied result is ignored. Twelve consecutive failures still block even a correct password until the lock expires. Failure counters use a separate namespace from legacy all-attempt counters because their meanings differ.
- Redirect response bodies are released explicitly. Result-download timeouts retry sooner; signed Google execution keeps its existing timeout budget.
- Previously opened ledgers remain in session memory. Switching displays the snapshot immediately; snapshots older than 15 seconds refresh. Manual refresh always reads the source. Writes replace their book's cached snapshot; logout clears every entry. No financial data is saved to localStorage.
- Vercel function region is Singapore (`sin1`). Google Sheets remains the durable source, so network delays can still vary.

Validation includes authenticated login, rate-limit and wrong-password rejection, cache isolation/expiry/clearing, conflict/void behavior, all three ledger calculations, and local/production browser checks.
