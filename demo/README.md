# Walkthrough recording

`submission-walkthrough.mp4` (1:56, 1280×800) is the demo for the assignment. It was recorded on 25 October 2026 against the app running locally (`npm start`) with **live Gemini generation** (`gemini-3.5-flash-lite`, free tier). Nothing in it is mocked. The two generation waits are played at 8× speed and labelled on screen. In real time, the ten FlocCare articles took about 2½ minutes and the two Harbor & Bean articles about 30 seconds.

What it shows, mapped to the brief:

1. **Ten separate pages for ten topics:** FlocCare is entered with ten healthcare-communication topics, and one page is published per topic, each at its own URL `/p/<project-id>/<topic-slug>`.
2. **A well-formatted ~1,000-word article on each page:** the first article is scrolled top to bottom (introduction, H2 sections, a list, conclusion), and every page shows its word count. The recorded run produced 947–1049 words per article.
3. **Consistent layout with the user's logo and brand colour:** all ten pages are opened in turn. Each has the same header with the uploaded logo, the brand-colour accents (`#0E7C86`), and the same footer.
4. **All pages hosted:** the pages are served by the running app and stay available after generation, listed in "The collection" with copy-link buttons.
5. **Reusable for multiple use cases:** a second brand, Harbor & Bean (coffee, `#7A4A2A`, its own logo), is generated on the same platform. Both collections then sit side by side, each page keeping its own branding.

Still frames: `home-desktop.png`, `form-filled.png`, `generated-collection.png`, `article-final.png`, `second-brand-article.png`. Demo logos: `floccare-logo.png` and `harbor-bean-logo.png`. Both are simple placeholder marks drawn for this demo, not official artwork.

The topics and articles are AI drafts for demonstration. Health-related text needs fact checking and review by a qualified professional before real publication.

## Offline demo

`mock-llm.mjs` is a fixture endpoint that speaks both the Gemini and OpenRouter formats and returns illustrative ~1,000-word articles, for running the app without a key. Start `node demo/mock-llm.mjs`, set both `GEMINI_API_BASE` and `OPENROUTER_API_BASE` to `http://127.0.0.1:3101`, set `DATA_DIR` to a temporary folder, run `npm start`, and enter any nonempty placeholder key in the form.
