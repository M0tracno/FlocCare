# Walkthrough recording

`submission-walkthrough.mp4` is the screen recording for the assignment. It shows the form, a ten-topic generation run, the resulting page collection, and a published article. `home-desktop.png`, `form-filled.png`, `generated-collection.png`, and `article-final.png` are still frames for quick review.

**Demo provenance:** The recording was made locally with a fixture endpoint (now `mock-llm.mjs`) that returns illustrative 950–1050 word articles, with an earlier version of the app. The mock is used only for the walkthrough and automated testing; normal operation calls Gemini or OpenRouter when a valid key is entered or configured. The fixture text must not be represented as clinically reviewed or as proof of live model quality.

To repeat the same local demo, start `node demo/mock-llm.mjs` in one terminal. In another terminal set both `GEMINI_API_BASE` and `OPENROUTER_API_BASE` to `http://127.0.0.1:3101`, set `DATA_DIR` to a temporary folder, and run `npm start`. Enter any nonempty placeholder key in the form. For actual AI generation, leave both unset and provide a valid Gemini or OpenRouter API key.
