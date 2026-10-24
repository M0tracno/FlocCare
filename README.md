# Pagecraft — blog website generator

A working Node.js app that turns a company's name, logo, brand color, and 1–10 topics into a persistent collection of branded blog pages. Each generated article is checked for a 950–1050 word range around the requested 1,000 words. Run the same workflow again to create another company's collection.

## Run locally

Requires Node.js 22.12 or newer. No package installation is needed.

```powershell
npm start
```

Open `http://localhost:3188`. Paste a [Gemini API key](https://aistudio.google.com/app/apikey) or an [OpenRouter API key](https://openrouter.ai/settings/keys) (`sk-or-…`) into the form for each generation request; the prefix decides the provider. The key is sent to the server for the API call and is not saved in the browser or project data. You can instead put `GEMINI_API_KEY` and/or `OPENROUTER_API_KEY` in a `.env` file (copy `.env.example`; `.env` is gitignored and `npm start` loads it). Never commit a real key.

Projects are stored as JSON in `data/projects/` by default. Each page gets a stable route: `/p/<project-id>/<topic-slug>`. A single deployed server therefore hosts every generated page; users can create multiple projects. The app has no user accounts, so a public deployment presents the same project library to everyone. Use it as a private assignment demo or add authentication before multi-user production use.

## Approach and writing model

1. The UI accepts the company identity and up to ten unique topics, validates a six-digit hex color and a logo under 2 MB, and previews the brand.
2. The server asks Google's `gemini-3.5-flash-lite` ([generateContent API](https://ai.google.dev/api/)) for one article per topic, about 7 seconds each. If Gemini fails and a server OpenRouter key is set, it falls back to [OpenRouter's chat completions API](https://openrouter.ai/docs/api-reference/chat-completion) with free models (`OPENROUTER_MODELS`, `google/gemma-4-31b-it:free` first) that OpenRouter tries in order. 429/503 responses are retried twice after 20 seconds. OpenRouter free models are much slower and capped at 50 requests per day per account; a ten-topic run uses 10–30 requests.
3. The prompt requests an original, structured article with an introduction, descriptive sections, useful specifics, and a conclusion. It tells the model to avoid invented statistics, citations, and medical claims. The server counts words and requests a revision if the article falls outside 950–1050 words, up to three attempts. If it still misses, generation fails rather than publishing an undersized article.
4. The server saves the completed collection atomically. A shared page template applies the company name, logo, and brand color to every URL. Generated Markdown is escaped before rendering to prevent HTML injection.

**Editorial limit:** An AI draft is not clinical or regulatory approval. Any healthcare article needs fact checking and review by a qualified professional before public distribution. Free-tier data handling is governed by Google's, OpenRouter's, and each provider's terms, and free tiers may log or train on prompts; avoid entering patient data.

## Test

```powershell
npm test
```

The integration test runs a fake Gemini/OpenRouter endpoint to verify ten published pages, the word-count gate, brand consistency, key-prefix routing, Gemini-to-OpenRouter fallback, persistence across projects, and validation. It does not claim that the fake endpoint proves live model availability or article quality.

## Deploy and host the pages

The included `render.yaml` describes a **paid Starter** Node web service with a persistent disk. Connect this folder/repository to Render as a Blueprint, then open the assigned public service URL. [Render requires a paid service for persistent disks](https://render.com/docs/disks); its free web service loses locally saved articles on restart. The `DATA_DIR` environment variable points to `/var/data/projects`, so articles remain after restarts. A different Node host works if it supplies persistent storage and runs `npm start`.

Render prompts for `GEMINI_API_KEY` and `OPENROUTER_API_KEY` when the Blueprint is created. Leave them blank to have each person provide their own key in the form. A shared server key on an unprotected public deployment lets anyone spend its free-tier quota. HTTPS is required on the final public host for clipboard copying and safe key transport.

## Assignment status

- Generator, branding, reusable project library, and hosted-route architecture: implemented.
- Ten-page creation and word-count behavior: verified with the integration test's fake model endpoint.
- Live AI generation: Gemini verified live on 2026-10-25 (three articles, 986–1008 words, 27 s total). OpenRouter fallback reaches the API live but its free models are slow (minutes per article) and missed the word range in one end-to-end run; treat it as a backup only.
- Public hosting: configuration supplied; actual public URL requires deployment to the owner's hosting account.
- Walkthrough recording: see `demo/` for the local demonstration artifact and its provenance.
