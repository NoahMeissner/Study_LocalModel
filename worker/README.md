# Study relay (Cloudflare Worker)

Receives finished sessions from the page, stores each in KV, emails the CSV via
Mailgun. Deploy once:

    cd worker
    npx wrangler kv namespace create RESULTS      # paste the id into wrangler.toml
    npx wrangler secret put MAILGUN_API_KEY
    npx wrangler secret put MAILGUN_DOMAIN
    npx wrangler secret put STUDY_TOKEN           # any random string
    npx wrangler deploy

Then set `window.LARP_SUBMIT_URL = "https://larp-study-relay.<account>.workers.dev/submit"`
and `window.LARP_SUBMIT_TOKEN` (same string) in `index.html`.

Retrieve everything later, independent of email:

    npx wrangler kv key list --binding RESULTS
    npx wrangler kv key get --binding RESULTS "<key>" > larp_P-xxxx.json
