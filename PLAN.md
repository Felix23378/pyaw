# Pyaw — Myanmar Voice Transcriber PWA

**Plan v1 · Nov 2026**

Pyaw (ပြော) means “speak.” Tap the mic, speak Myanmar, get clean Burmese text.

| Decision | Choice |
| --- | --- |
| Stack | React 19 + Vite + TypeScript + Tailwind CSS v4 |
| API keys | User-pasted in Settings, stored locally (BYO key) |
| Offline | Queue recordings in IndexedDB, auto-transcribe on reconnect |
| Visual direction | Warm paper + ink + marigold, light & dark |
| AI | `gemini-3.1-flash-lite` primary, configurable fallback models |
| Backend | None for v1 (static PWA) |

---

## 1. Product

### Core flow

1. Tap the record button → mic permission (first run) → record with live waveform + timer.
2. Stop → audio is sent to Gemini → transcript streams into the result card.
3. Result card: copy, edit, share, re-transcribe, delete.
4. Every successful transcript is saved locally and appears under **Recents** (search, copy, delete).
5. If offline (or all retries fail), the recording is saved to a **Pending** queue and retried automatically.

### Scope for v1

- Direct in-browser recording (no file upload in v1, but the recorder module accepts blobs so upload is trivial later).
- Burmese speech → Burmese script, with English code-switching preserved.
- Multi-key + multi-model retry engine.
- Copy button with feedback.
- Recents in localStorage (text only; audio blobs in IndexedDB, off by default).
- Installable PWA + offline app shell + offline recording queue.
- Responsive 320px → 4K, light/dark, reduced motion, keyboard accessible.

### Non-goals for v1

- Accounts, cloud sync, team sharing.
- Speaker diarization, word timestamps, translation to English (can be follow-ups).
- Backend proxy (the key-exposure trade-off is documented in §9).
- Live streaming transcription while recording (Gemini Live API) — future.

---

## 2. UX / Screens

### Layout

```
Desktop ≥1024px                          Mobile <1024px
┌──────────────────────────────────┐    ┌──────────────────┐
│ Header: Pyaw · theme · settings  │    │ Header           │
├───────────────────────┬──────────┤    ├──────────────────┤
│ Recorder card         │ Recents  │    │ Recorder card    │
│ waveform · timer      │ search   │    │ waveform · timer │
│ big record button     │ list     │    ├──────────────────┤
├───────────────────────┤          │    │ Result (streams) │
│ Result card           │          │    ├──────────────────┤
│ transcript · actions  │          │    │ Recents          │
└───────────────────────┴──────────┘    └──────────────────┘
                                         sticky record dock
```

- Single column max-width `720px`; two columns at `lg` with a `360–400px` recents rail.
- Mobile: recorder is always reachable; a compact sticky dock mirrors the record button while scrolling.
- Safe-area insets (`env(safe-area-inset-bottom)`), 44px+ touch targets, no input zoom (16px min font).

### Recorder card

| State | UI |
| --- | --- |
| Idle | Large marigold circular mic button, “Tap to record” |
| Permission | Explainer + “Allow microphone”; denied state with browser-specific help |
| Recording | Pulsing ring driven by live audio level, `00:12` timer, animated bar waveform, Stop / Cancel |
| Processing | Button becomes spinner/cancel; status line shows retry activity (e.g. “Model busy — trying gemini-3.5-flash-lite · key 2/3”) |
| Success | Ring settles, transcript card animates in, auto-scroll into view on mobile |
| Error | Friendlier message + Retry; technical details collapsed |

Extras: max duration (10 min default), pause/resume, playback preview, “Re-record,” size warning near the 20MB inline limit, haptic tick on start/stop where supported.

### Result card

- Burmese transcript at comfortable reading size and line-height (stacked glyphs need room).
- Top-right **Copy** button: icon → check + “Copied” for 1.8s; `aria-live="polite"` announcement.
- Actions: Copy · Share (if `navigator.share`) · Edit · Re-transcribe · Delete.
- Meta chips: duration, model actually used, relative time, language.
- Streaming text with a subtle caret; retries reset the visible buffer (no duplicated text).
- Empty/no-speech and safety-blocked states get distinct, calm copy.

### Recents

- Saved the moment transcription succeeds; newest first.
- Search (Burmese + Latin), grouped by **Today / Yesterday / Earlier**, relative timestamps via `Intl.RelativeTimeFormat`.
- Row: 2-line snippet, duration + time, copy icon (always visible on mobile).
- Click opens detail: full text, copy, share, edit, delete, “Copy model used.”
- Cap ~100 entries; empty state illustration; Clear all with confirm.
- Text only in localStorage. Optional “Keep audio” toggle stores the blob in IndexedDB for 7 days.

### Settings (sheet on desktop, full-screen on mobile)

1. **API keys** — add (label + key), test, reorder, delete, masked reveal; status dot: healthy / cooling down / exhausted / invalid; last used.
2. **Models** — ordered fallback list, enable/disable, drag to reorder; primary fixed to `gemini-3.1-flash-lite` by default; validate model IDs against the user’s key.
3. **Transcription** — language mode (Myanmar / Auto-detect), punctuation on/off, auto-copy on/off.
4. **Audio** — max duration, keep audio toggle, input device picker (if labels exposed).
5. **Storage** — usage estimate, clear recents, clear queue, wipe everything.
6. **About** — privacy note, model/key caveats, version, install help.

### First run

Three-step welcome sheet: **Add a Gemini key** (deep link to AI Studio) → **Allow mic** → **Record**. Includes a plain-language privacy note: audio goes only to Google’s Gemini API; keys and transcripts stay on this device. Skippable, with a persistent “Add key” callout until configured.

### PWA

- Custom install prompt after the second visit (beforeinstallprompt); iOS “Add to Home Screen” instructions.
- Offline banner; pending queue count; auto-retry on `online`.
- Update toast: “New version available — Refresh” (skipWaiting only on user action).
- Deep-link shortcut: **New recording**.

---

## 3. Gemini integration

### Endpoint

```
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse
Header: x-goog-api-key: <key>
```

- Use `streamGenerateContent` for perceived speed; parse SSE `data:` frames and append `candidates[0].content.parts[].text`.
- If streaming fails in a browser, fall back to `:generateContent` (non-streaming) for that attempt.
- Send the key as a header, not a query param, so it never lands in error URLs/logs.
- `thinkingConfig: { thinkingBudget: 0 }` for Flash-Lite latency; if a model rejects it, strip and retry once.

### Request body

```jsonc
{
  "systemInstruction": { "parts": [{ "text": "<transcription policy>" }] },
  "contents": [{
    "role": "user",
    "parts": [
      { "text": "Transcribe this recording." },
      { "inlineData": { "mimeType": "audio/webm", "data": "<base64>" } }
    ]
  }],
  "generationConfig": {
    "temperature": 0,
    "maxOutputTokens": 8192,
    "responseMimeType": "text/plain"
  }
}
```

### Prompt (Burmese transcription policy)

```
You are a precise Myanmar (Burmese) speech transcription engine.

Transcribe the attached audio verbatim in Burmese script.
Rules:
- Output ONLY the transcript. No preamble, notes, translation, or timestamps.
- Preserve the speaker's words, including English/code-switched terms in Latin script.
- Use natural Burmese punctuation: ။ at sentence ends, ၊ for short clause breaks,
  and paragraph breaks for long pauses.
- Write numbers, dates, and times as spoken; keep units as spoken.
- Do not summarize, correct grammar, or omit filler words.
- If there is no intelligible speech, output exactly: [no speech]
```

Auto-detect mode adds: “Detect the spoken language. Transcribe in the original language; Burmese must be written in Burmese script.”

### Audio pipeline

```
getUserMedia → MediaRecorder (opus preferred)
   Chrome/Android: audio/webm;codecs=opus
   Safari:         audio/mp4  → send as audio/m4a
   Firefox:        audio/ogg;codecs=opus
→ Blob + duration + waveform peaks
→ size check
   ≤ 12MB  → base64 inline (base64 expands ~33%, stays under the 20MB request cap)
   > 12MB  → Files API upload, then file_data reference
   > 10 min → blocked by client cap (configurable)
```

- Gemini accepts WAV/MP3/AIFF/AAC/OGG/FLAC/M4A/WebM/Opus, so native recordings usually need no transcode.
- Fallback if a browser emits an unsupported container: decode with `AudioContext` and encode 16kHz mono WAV (small pure-TS encoder) before upload.
- Files API: multipart upload (`/upload/v1beta/files`), poll until `state: ACTIVE`, then reference `fileUri` + `mimeType`. Files expire in 48h. Cache the uploaded file per `keyId` for the session because projects/keys differ.
- Note: Gemini bills audio at ~32 tokens/second; show duration, not a fake cost estimate.

### Model fallback list (editable)

1. `gemini-3.1-flash-lite` — primary, cheapest/fastest
2. `gemini-3.5-flash-lite` — same tier, newer
3. `gemini-3.5-flash` — stronger, still fast
4. `gemini-3.8-flash` — last resort, most capable

Users can add/remove/reorder. Invalid IDs are marked “unavailable for this key” after a 404 and skipped (session-only until re-tested).

---

## 4. Retry & key-rotation engine (the core)

### Goals

- **Busy/overloaded** → try another **model** with the same key.
- **Out of quota** → try another **key** with the same model.
- Never hammer a dead key or a missing model.
- Always finish within a deadline, or fail with a useful explanation.
- Keep partial results and UI state clean across retries.

### Error taxonomy

| HTTP / status | Class | Action |
| --- | --- | --- |
| 429 + `QuotaFailure.quotaId` contains `PerDay` / `Daily` | `daily_quota` | Mark key exhausted (cooldown until next reset), **next key**, same model |
| 429 + `PerDay` on every key | `all_exhausted` | Stop; show “All keys are out of quota,” reset ETA |
| 429 + `RetryInfo.retryDelay` (short) | `rate_limit` | Wait `retryDelay` (≤ 10s) once on same pair; if repeated, cool key and **next key** |
| 429 with **no** details (capacity 429) | `busy` | **Next model**, same key; exponential backoff afterwards |
| 503 / 500 / 502 / 504 | `busy` | **Next model**, same key |
| 403 `PERMISSION_DENIED`, `API_KEY_INVALID`, leaked/blocked | `invalid_key` | Mark key invalid, **next key** |
| 404 `NOT_FOUND` (model gone) | `model_gone` | Disable model this session, **next model** |
| 400 `INVALID_ARGUMENT` | `bad_request` | Inspect; if audio too large → Files API once; else fatal |
| 413 payload too large | `too_large` | Files API once, then fatal |
| 408 / network / abort-by-timeout | `network` | Retry same pair once, then **next model** |
| 400 safety / `promptFeedback.blockReason` | `blocked` | Fatal with “couldn’t transcribe this clip” + retry option |
| 402 prepay depleted | `billing` | Fatal, link to billing |

Key details from real Gemini responses:

- Quota ID is the reliable signal. `PerMinute` = transient; `PerDay` = terminal for that key.
- `RetryInfo.retryDelay` can be misleading on daily quotas — check the quota ID first.
- 429s with **no** `QuotaFailure`/`RetryInfo` are capacity-related; rotating keys won’t help, switching models will.

### Orchestrator algorithm

```
transcribe(audio):
  deadline = now + 150s
  round = 0; attempts = 0
  lastError = null

  while now < deadline and round < 4:
    quotaHit = false; busyHit = false; progressed = false

    for model in enabledModels():                 # priority order
      for key in keyPool.healthyOrCoolingLast():  # skip cooling keys
        if attempts++ >= 12 or now >= deadline: break
        try:
          return await callGemini(stream=true, model, key, audio, signal)
        catch e:
          kind = classify(e)
          lastError = e
          progressed = true

          switch kind:
            invalid_key: key.markInvalid(); continue        # next key
            daily_quota: key.markExhausted(); quotaHit=true; continue
            rate_limit:
              if e.retryAfter <= 10s and now+e.retryAfter < deadline:
                 await sleep(e.retryAfter)
                 retry same pair once
              else { key.cooldown(e.retryAfter); quotaHit=true; continue }
            busy/network: busyHit=true; break                # next model, same key
            model_gone: model.disable(); break               # next model
            too_large: audio = await filesApi.upload(); retry same pair once
            blocked/fatal/billing: throw e
      # end keys
    # end models

    if not progressed: break
    round++
    await sleep(jitteredBackoff(round))   # 1s, 2s, 4s, 8s, cap 20s, ±30%

  throw TranscriptionError(lastError, attemptedModels, attemptedKeys)
```

Additional rules:

- **Single-flight:** one transcription at a time; a new recording aborts the previous request. Never fire parallel requests (wastes quota).
- **Per-attempt timeout:** 60s; stream idle timeout 20s; overall deadline 150s. `AbortController` cancels the request and any pending backoff.
- **Circuit breaker:** in-memory + localStorage map `{keyId}:{modelId} → {cooldownUntil, reason}`. Skip cooling entries; if everything is cooling, wait for the nearest cooldown (capped 30s) or fail with a reset ETA.
- **Daily quota reset:** show “Resets at midnight PT” and avoid retrying that key until the computed time. Don’t guess if the API provides no reset info — cool for 1 hour and retry.
- **Retry safety:** the audio bytes are immutable across attempts. Rebuild the request each attempt. Discard partial streamed text per attempt.
- **Key rotation order:** round-robin/least-recently-used across healthy keys, so one key isn’t always burned first. Each key remembers its last successful model.
- **No duplicate saves:** the transcript is saved once, on the winning attempt, with an idempotency guard.
- **Observable:** every attempt is appended to an in-memory log (model, key label, error class, wait) shown in a collapsible “Attempt details” and in the error state.

### Key pool UX

- Add multiple keys with labels (e.g. “Personal,” “Work”).
- Status dots: green healthy, amber cooling with countdown, red exhausted, gray invalid.
- “Test all keys” runs a tiny `generateContent` (or `models.list`) and updates status.
- Keys are masked (`AIza…9f2`) and never included in exported logs or error messages.

### Backoff

- Honor `RetryInfo.retryDelay` when present.
- Otherwise `min(20s, 1s × 2^(round−1))` with ±30% jitter.
- Never sleep past the overall deadline; skip attempts that cannot fit.
- Mobile: catch `online` → wake the pending queue immediately.

---

## 5. Data model & storage

### localStorage (small, versioned)

```ts
type KeyStatus = 'unknown' | 'ok' | 'cooling' | 'exhausted' | 'invalid';

interface ApiKey {
  id: string;                 // uuid
  label: string;              // "Personal"
  value: string;              // AIza...
  status: KeyStatus;
  cooldownUntil?: number;     // epoch ms
  lastUsedAt?: number;
  addedAt: number;
}

interface ModelConfig {
  id: string;                 // "gemini-3.1-flash-lite"
  label: string;
  enabled: boolean;
  order: number;
  unavailableUntil?: number;  // session-ish, set on 404
}

interface TranscriptEntry {
  id: string;                 // uuid (also used by detail route/state)
  text: string;
  createdAt: number;
  updatedAt?: number;
  durationMs: number;
  model: string;              // model that actually succeeded
  language: 'my' | 'auto';
  source: 'live' | 'queue';
  audioId?: string;           // IndexedDB key if "keep audio" was on
  charCount: number;
}

interface Settings {
  theme: 'system' | 'light' | 'dark';
  keys: ApiKey[];
  models: ModelConfig[];
  languageMode: 'my' | 'auto';
  autoCopy: boolean;
  keepAudio: boolean;
  maxDurationSec: number;
  haptics: boolean;
  retry: { maxRounds: number; maxAttempts: number; totalTimeoutMs: number };
}
```

Storage keys: `pyaw.settings.v1`, `pyaw.recents.v1`, `pyaw.circuit.v1`, `pyaw.onboarded.v1`.

- Recents cap 100; prune oldest on write; guard with `navigator.storage.estimate()` and a byte-size check.
- Cross-tab sync via the `storage` event (re-read before writing).
- Migration functions keyed by `v1 → v2`, never destructive without a backup.

### IndexedDB

- `audio` store: kept recordings (optional, TTL 7 days).
- `pending` store: `{ id, blob, mime, durationMs, createdAt, attempts, lastError }` for offline/failed jobs.
- `waveforms` store (optional): downsampled peaks for recents playback.

### Pending queue behavior

- Enqueue on: offline, total retry failure, tab close mid-request (audio already persisted).
- Process serially on `online`, app start, and every 5 minutes while foregrounded.
- Max 5 jobs / 50MB; oldest warns before pruning.
- Each job shows status in Recents: queued, transcribing, needs key, failed (with Retry/Delete).

---

## 6. Architecture

```
pyaw/
├─ public/
│  ├─ icons/ (192, 512, maskable, apple-touch)
│  ├─ screenshots/ (install UI)
│  └─ favicon.svg
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ styles/tokens.css, globals.css
│  ├─ audio/
│  │  ├─ recorder.ts        # MediaRecorder wrapper, pause/resume, mime negotiation
│  │  ├─ waveform.ts        # AnalyserNode → peaks
│  │  ├─ encode.ts          # WAV fallback encoder
│  │  └─ mime.ts
│  ├─ gemini/
│  │  ├─ client.ts          # streamGenerateContent, SSE parser
│  │  ├─ prompt.ts
│  │  ├─ files.ts           # Files API upload + polling
│  │  └─ types.ts
│  ├─ retry/
│  │  ├─ classifier.ts      # HTTP/body → error class (pure, fully tested)
│  │  ├─ orchestrator.ts    # the loop above
│  │  ├─ pools.ts           # key/model health, LRU rotation
│  │  └─ backoff.ts
│  ├─ storage/
│  │  ├─ local.ts, idb.ts, recents.ts, migrations.ts, circuit.ts
│  ├─ store/                # Zustand
│  │  ├─ settings.ts, session.ts, recents.ts, queue.ts
│  ├─ hooks/
│  │  ├─ useRecorder.ts, useTranscription.ts, useOnline.ts, useCopy.ts,
│  │  └─ useMediaQuery.ts, useInstallPrompt.ts
│  ├─ components/
│  │  ├─ layout/Header, Shell, MobileDock
│  │  ├─ recorder/RecorderCard, RecordButton, Waveform, Timer
│  │  ├─ result/TranscriptCard, AttemptLog, CopyButton, ActionBar
│  │  ├─ recents/RecentsPanel, RecentRow, RecentDetail, SearchField
│  │  ├─ settings/SettingsSheet, KeyManager, ModelList, StoragePanel
│  │  ├─ onboarding/WelcomeSheet
│  │  └─ ui/Button, Sheet, Dialog, Toast, Badge, EmptyState, Skeleton
│  ├─ lib/ (cn, format, clipboard, share, uuid, time)
│  └─ pwa/register.ts, update.ts
├─ tests/ (unit, integration, e2e)
├─ vite.config.ts
├─ tsconfig.json
├─ package.json
└─ PLAN.md
```

**Libraries:** Zustand (state), Tailwind v4 (tokens via `@theme`), `vite-plugin-pwa` (Workbox), `idb-keyval` (storage), `lucide-react` (icons), `motion` (micro-animations, respects reduced motion), `@fontsource` Noto Sans Myanmar + a Latin family. No component library — the design is custom.

**Optional:** `react-router` only if detail views need URLs; otherwise local UI state is enough for a single-screen app.

---

## 7. Design system

### Palette (light)

| Token | Value | Use |
| --- | --- | --- |
| `--paper` | `#F6F1E7` | App background |
| `--surface` | `#FFFCF5` | Cards |
| `--ink` | `#181512` | Primary text |
| `--muted` | `#6B6358` | Secondary text |
| `--line` | `#E4DACB` | Borders |
| `--marigold` | `#E09A2B` | Primary action |
| `--marigold-deep` | `#B45309` | Hover/pressed, accent text |
| `--jade` | `#2F7A5B` | Success |
| `--rust` | `#C2410C` | Error/record stop |

**Dark:** `#12100E` paper, `#1C1916` surface, `#F4EDE1` ink, `#F0B45A` marigold, `#26211C` lines. Both themes pass WCAG AA for body text; marigold is used for large elements/icons, with deep marigold for small text on paper.

### Typography

- Burmese: **Noto Sans Myanmar** 400/500/600, fallback `Padauk, "Myanmar Text", "Pyidaungsu", sans-serif`. Line-height **1.85–2.0**, letter-spacing 0, generous padding; never truncate mid-stack — clamp with fade instead.
- Latin: **Instrument Sans** (or Inter) for UI; tabular numerals for the timer.
- Scale: 12 / 14 / 16 / 18 / 22 / 28 / 36; transcript 18–20px mobile, 20–22px desktop.
- Bundle a Myanmar subset via `unicode-range` to keep the font payload reasonable; system fallback is fine on Android.

### Surfaces & motion

- 24px card radius, 16px controls, 1px `--line` borders, layered soft shadows (`0 1px 2px rgba(24,21,18,.04), 0 12px 32px rgba(24,21,18,.06)`).
- Subtle paper-grain SVG overlay at 4% opacity (CSS `background-image`, no image request).
- Motion 150–250ms, spring-ish easing; recorder pulse driven by RMS level; transcript fade/slide 12px.
- `prefers-reduced-motion`: static level bar, no pulse, instant transitions.

### Responsive rules

- 320: single column, 16px gutters, recorder 84px, no horizontal scroll.
- 480: larger type, actions wrap to two rows.
- 768: two-column recents preview below the fold; result card full width.
- 1024: side rail (380px), sticky recorder card; result and recents side by side.
- 1440+: max-width 1120px, centered, whitespace grows not text width.
- 4K: same max-width; never stretch the transcript line beyond ~72 characters.

### Copy/microcopy tone

Warm, short, human: “Tap to record,” “Listening…,” “Writing it down…,” “Copied,” “Saved to Recents,” “All keys are taking a break — resets at 12:00 AM PT.” Avoid “Error 429.”

---

## 8. PWA, offline & performance

- `manifest.webmanifest`: name Pyaw, short_name Pyaw, `display: standalone`, theme/background colors, maskable 512 icon, screenshots, `shortcuts: [{name:"New recording", url:"/?record=1"}]`.
- Service worker: precache app shell; `NetworkOnly` for `generativelanguage.googleapis.com`; stale-while-revalidate for fonts; navigation fallback to `/index.html`; cleanup old caches on activate.
- Offline: app shell loads, recording works, job goes to the pending queue; UI clearly says “Saved — will transcribe when online.”
- Install: custom prompt + iOS instructions; request `navigator.storage.persist()` after the first successful recording.
- Update: detect `waiting` worker, show toast, activate on click, then reload.
- Perf budgets: initial JS ≤ 200KB gzip (excluding fonts), LCP < 2.5s on mid-range Android, no layout shift from the waveform (fixed height), lazy-load settings sheet and recents detail.
- Fonts: `font-display: swap`, preload only the Burmese 400/600 subsets.

---

## 9. Privacy & security

- Keys live in `localStorage` (with an optional “session only” toggle using `sessionStorage`). This is BYO-key and documented: anyone with access to the browser profile can read them. No keys are sent anywhere except Google.
- Keys are sent via `x-goog-api-key` header, masked in UI, and redacted from errors/logs (`AIza…`).
- Strict CSP: `default-src 'self'; connect-src 'self' https://generativelanguage.googleapis.com; media-src blob:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
- No third-party analytics, no remote logging. Transcripts stay on-device.
- React escapes all transcript text; no `dangerouslySetInnerHTML`.
- Warn that free-tier Gemini may use data to improve products; paid tier differs. Link to Google’s terms; do not overpromise.
- Provide “Wipe all data” (keys, recents, queue, caches, IndexedDB).

---

## 10. Testing & QA

### Unit (Vitest)

- `classifier`: daily vs per-minute quota, 429 without details, 503, 403, 404, 413, 400, network, abort.
- `orchestrator`: scripted fake fetch sequences verifying exact model/key order, cooldowns, deadline, max attempts, partial-stream reset.
- `backoff`: caps, jitter bounds, Retry-After parsing (`34s`, `34.4s`, ms).
- Storage: cap/prune, migrations, cross-tab re-read, quota-exceeded fallback.
- WAV encoder + MIME negotiation.

### Integration (MSW + RTL)

- 429 daily on key 1 → uses key 2, same model.
- 503 on model 1 → uses model 2, same key.
- Mixed: 503 model 1, daily quota key 1, success on model 2/key 2.
- All keys exhausted → clear message + settings CTA.
- Invalid key skipped permanently.
- Abort/cancel during backoff resolves cleanly.
- Recents persist, copy works, edit updates `updatedAt`.

### E2E (Playwright)

- Fake mic: `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream --use-file-for-fake-audio-capture=fixtures/mm.wav`.
- First-run onboarding → add key (mocked) → record → stop → transcript → copy → recents.
- Offline → record → queue → go online → auto-transcribes.
- Installability + manifest + service worker offline shell.
- Responsive snapshots at 320, 390, 768, 1024, 1440; light/dark; reduced motion.

### Manual matrix

iOS Safari 17+ (PWA + mic quirks), Android Chrome, desktop Chrome/Safari/Firefox. Verify Burmese rendering with Padauk fallback and 200% zoom.

### Targets

Lighthouse ≥ 95 Performance/Best Practices, 100 Accessibility, PWA installable; axe clean; no console errors; transcript copy verified with real Burmese text.

---

## 11. Milestones

| Phase | Deliverable | Est. |
| --- | --- | --- |
| 0. Scaffold | Vite/React/TS/Tailwind, tokens, shell, manifest, CI | 0.5d |
| 1. Recorder | Mic permissions, MediaRecorder, waveform, timer, playback, cancel | 1.5d |
| 2. Gemini + retry | Client, SSE streaming, classifier, orchestrator, key/model pools, unit tests | 2.5d |
| 3. Result + recents | Transcript card, copy/share/edit, localStorage recents, search, detail | 1.5d |
| 4. Settings | Key manager, model list, test keys, storage panel, onboarding | 1.5d |
| 5. PWA + offline | Service worker, install, update toast, IndexedDB queue, auto-retry | 1.5d |
| 6. Polish + QA | Responsive/a11y pass, dark mode, E2E, device testing, deploy | 2d |

**Roughly 11 working days.** Phase 2 is the risk center; build it pure and test it before wiring the UI.

### Acceptance criteria

- [ ] Installable PWA; app shell loads offline.
- [ ] Records via mic on iOS Safari, Android Chrome, desktop browsers.
- [ ] Burmese audio → Burmese script via `gemini-3.1-flash-lite`.
- [ ] 503/busy → next model automatically; daily quota → next key automatically; both visible in attempt status.
- [ ] Retries respect `Retry-After`, use jittered backoff, never exceed the deadline, and never duplicate requests in parallel.
- [ ] Copy button works with feedback in secure and insecure contexts.
- [ ] Recents persist across reloads, are searchable, capped, and deletable.
- [ ] Works from 320px to 4K, light/dark, keyboard-only, reduced motion.
- [ ] Offline recording queued and transcribed on reconnect.
- [ ] No key appears in URLs, logs, error text, or exports.

---

## 12. Risks & open questions

| Risk | Mitigation |
| --- | --- |
| API keys exposed in a static client | BYO-key with clear warning; optional session-only mode; future Cloudflare Worker proxy if this becomes a product |
| Model names/availability change | Editable model list, 404 auto-disable, validate in Settings |
| 429 ambiguity (capacity vs quota) | Prefer quota IDs; treat bare 429 as capacity → switch models first |
| Safari MediaRecorder/container quirks | MIME negotiation + WAV transcode fallback + iOS testing |
| localStorage ~5MB | Text-only recents capped at 100; blobs in IndexedDB; usage meter |
| Daily quota resets unclear | Compute midnight PT; otherwise cool 1h; show a reset estimate |
| Long recordings hit request limits | 10-min cap, 12MB inline threshold, Files API path, clear progress |
| Burmese font weight/latency | Self-host subset + system fallback; preload critical weights |

**Open questions**

1. Confirm the name **Pyaw** (ပြော) and whether UI copy should be English, Burmese, or bilingual.
2. Deployment target (Vercel/Netlify/GitHub Pages) — affects `base` path and SW scope.
3. Do you want timestamps or speaker labels in v1? Plan assumes neither.
4. Should keys be session-only by default (safer) or persist until removed (more convenient)?
5. Is a tiny serverless key proxy acceptable later, or must this stay 100% static?

---

## 13. First implementation slice

If we start now, build in this order:

1. `classifier.ts` + `orchestrator.ts` with mocked tests — verify the “busy → model, quota → key” contract before any UI.
2. Recorder card + waveform, with a local fake transcript.
3. Wire real Gemini streaming, result card, copy.
4. Recents + settings keys/models.
5. PWA + offline queue + polish.
