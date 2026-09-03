# Study_LocalModel

Participant-facing rating platform for the LARP human study ("Can a Local Model
Solve this?"). Static: `index.html` + `style.css` + `app.js`, served by GitHub Pages.

Math in prompts renders with a vendored KaTeX (`katex/`, v0.16.47). The prompt CSV
must carry math between `\( \)` (inline), `\[ \]` or `$$ $$` (display) delimiters;
bare `$` is deliberately not a delimiter so dollar amounts in prompts stay text.

## Stimulus (2026-09-03)

The rating screen shows the prompt text alone — no category label — as the
preregistration's stimulus section requires. `category` stays in the CSV because the
result export carries it.

## Robustness (2026-09-02)

- **CSV parsing** uses vendored Papa Parse (`vendor/`): quoted multi-line prompts
  survive (the previous splitter dropped them silently). A `participant_id`
  column, if present, becomes the participant's ID; duplicate `prompt_id`s are
  refused.
- **Progress persists** in `localStorage` after every screen; a refresh or a
  closed tab resumes where the participant was. "Start over" in the header
  discards the session (needed between participants on a shared machine).
- **Submission**: when `window.LARP_SUBMIT_URL` is set (in `index.html`), the
  finished CSV is POSTed to the relay in `worker/` with retries (1 s / 3 s / 9 s
  backoff, 15 s timeout, 4xx not retried). On failure the download + email
  fallback appears and the payload is queued and re-sent on the next page load.
  The relay stores every submission in KV *before* emailing it via Mailgun, so a
  mail outage never loses data. See `worker/README.md` to deploy.
