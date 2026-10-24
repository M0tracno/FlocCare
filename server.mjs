import http from 'node:http';
import { readFile, mkdir, readdir, writeFile, rename } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(import.meta.dirname);
const PUBLIC = join(ROOT, 'public');
const DATA = process.env.DATA_DIR ? resolve(process.env.DATA_DIR) : join(ROOT, 'data', 'projects');
const PORT = Number(process.env.PORT || 3188);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_URL = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
// First model is preferred; OpenRouter falls through the rest when one is rate-limited or down.
const OPENROUTER_MODELS = (process.env.OPENROUTER_MODELS || 'google/gemma-4-31b-it:free,nvidia/nemotron-3-ultra-550b-a55b:free,poolside/laguna-s-2.1:free').split(',').map(x => x.trim()).filter(Boolean);
const OPENROUTER_URL = process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1';
const MAX_BODY = 3_000_000;

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function html(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(value);
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function slugify(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'article';
}
function words(value) {
  return (String(value).replace(/[#*_>`~\[\]()]/g, ' ').match(/\b[\p{L}\p{N}][\p{L}\p{N}'’-]*\b/gu) || []).length;
}
function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r/g, '').split('\n');
  let out = '', paragraph = [], list = [];
  const inline = input => escapeHtml(input).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');
  const flushP = () => { if (paragraph.length) out += `<p>${inline(paragraph.join(' '))}</p>`; paragraph = []; };
  const flushL = () => { if (list.length) out += `<ul>${list.map(item => `<li>${inline(item)}</li>`).join('')}</ul>`; list = []; };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushP(); flushL(); continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { flushP(); flushL(); out += `<h${Math.max(2, heading[1].length)}>${inline(heading[2])}</h${Math.max(2, heading[1].length)}>`; continue; }
    const bullet = line.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    if (bullet) { flushP(); list.push(bullet[1]); continue; }
    flushL(); paragraph.push(line);
  }
  flushP(); flushL();
  return out;
}
async function body(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request is too large. Use a logo under 2 MB.'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid JSON request.'), { status: 400 }); }
}
function validate(input) {
  const companyName = String(input.companyName || '').trim();
  const color = String(input.color || '').trim();
  const logoDataUrl = String(input.logoDataUrl || '');
  const topics = Array.isArray(input.topics) ? input.topics.map(x => String(x).trim()).filter(Boolean) : [];
  if (!companyName || companyName.length > 100) throw Object.assign(new Error('Enter a company name up to 100 characters.'), { status: 400 });
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw Object.assign(new Error('Enter a six-digit hex brand color.'), { status: 400 });
  if (logoDataUrl && !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(logoDataUrl)) throw Object.assign(new Error('Upload a PNG, JPEG, WebP, or GIF logo.'), { status: 400 });
  if (logoDataUrl.length > 2_800_000) throw Object.assign(new Error('Logo must be under 2 MB.'), { status: 400 });
  if (!topics.length || topics.length > 10 || topics.some(x => x.length > 160)) throw Object.assign(new Error('Enter 1 to 10 topics, each under 160 characters.'), { status: 400 });
  if (new Set(topics.map(x => x.toLowerCase())).size !== topics.length) throw Object.assign(new Error('Topics must be unique.'), { status: 400 });
  return { companyName, color, logoDataUrl, topics };
}
async function post(name, url, headers, payload) {
  // ponytail: fixed 20 s backoff on 429/503, two retries; free tiers recover in seconds, daily caps do not.
  for (let retry = 0; ; retry++) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(180_000) });
    const result = await response.json().catch(() => ({}));
    const status = result.error?.code || response.status;
    if ((status === 429 || status === 503) && retry < 2) { await new Promise(r => setTimeout(r, 20_000)); continue; }
    if (!response.ok || result.error) throw new Error(`${name} request failed (${status}): ${result.error?.metadata?.raw || result.error?.message || 'no details'}`);
    return result;
  }
}
// Each provider returns the article text, or '' when the draft was cut off at the token cap.
const PROVIDERS = {
  async gemini(instruction, apiKey) {
    const result = await post('Gemini', `${GEMINI_URL}/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, { 'x-goog-api-key': apiKey },
      { contents: [{ parts: [{ text: instruction }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 8000 } });
    const candidate = result.candidates?.[0];
    return candidate?.finishReason === 'MAX_TOKENS' ? '' : (candidate?.content?.parts || []).map(x => x.text || '').join('').trim();
  },
  async openrouter(instruction, apiKey) {
    const result = await post('OpenRouter', `${OPENROUTER_URL}/chat/completions`, { 'Authorization': `Bearer ${apiKey}`, 'X-Title': 'Pagecraft' },
      { models: OPENROUTER_MODELS, messages: [{ role: 'user', content: instruction }], temperature: 0.7, max_tokens: 12000, reasoning: { effort: 'low', exclude: true } });
    const choice = result.choices?.[0];
    return choice?.finish_reason === 'length' ? '' : String(choice?.message?.content || '').trim();
  }
};
// A key typed in the form picks its provider by prefix; otherwise use server keys, Gemini first, OpenRouter as fallback.
function providersFor(userKey) {
  if (userKey) return [[userKey.startsWith('sk-or-') ? 'openrouter' : 'gemini', userKey]];
  return [['gemini', process.env.GEMINI_API_KEY], ['openrouter', process.env.OPENROUTER_API_KEY]].filter(([, key]) => key);
}
async function complete(instruction, providers) {
  let lastError;
  for (const [name, key] of providers) {
    try { return await PROVIDERS[name](instruction, key); }
    catch (error) { lastError = error; console.error(error.message); }
  }
  throw lastError;
}
async function generatePost(topic, companyName, providers) {
  const prompt = `Write a polished, original blog article in Markdown on: "${topic}". It will be published by ${companyName}. Length is strict: 950–1050 words, excluding the title. Use this structure: an engaging introduction of two paragraphs (about 100 words), then six descriptive H2 sections, each with three paragraphs of about 45–50 words (about 140 words per section) and useful specifics, then a "## Conclusion" of about 80 words. One section may use a short list. Do not add a top-level title because the website supplies it. Do not mention being an AI. Do not fabricate citations, statistics, clinical evidence, product claims, or testimonials. If the topic concerns health, give general educational information and avoid diagnosis or individual treatment recommendations; encourage appropriate professional review. Return only the article Markdown.`;
  let draft = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const n = words(draft);
    const instruction = !draft ? prompt : `${prompt}\n\nThe draft below is ${n} words; it must be 950–1050. ${n < 950 ? `Add about ${1000 - n} words by expanding the sections with concrete detail` : `Cut about ${n - 1000} words by tightening sentences`}, keep the same structure, and return the full revised article only.\n\n${draft}`;
    draft = await complete(instruction, providers);
    if (words(draft) >= 950 && words(draft) <= 1050) return draft;
  }
  throw new Error(`Could not reach 950–1050 words for "${topic}" after 3 attempts (last draft: ${words(draft)} words). Please retry.`);
}
async function save(project) {
  await mkdir(DATA, { recursive: true });
  const target = join(DATA, `${project.id}.json`);
  const temp = `${target}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(project, null, 2), 'utf8');
  await rename(temp, target);
}
async function load(id) {
  if (!/^[a-f0-9-]{36}$/.test(id)) return null;
  try { return JSON.parse(await readFile(join(DATA, `${id}.json`), 'utf8')); }
  catch { return null; }
}
async function list() {
  await mkdir(DATA, { recursive: true });
  const files = (await readdir(DATA)).filter(x => /^[a-f0-9-]{36}\.json$/.test(x));
  const projects = (await Promise.all(files.map(x => load(x.slice(0, -5))))).filter(Boolean);
  return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
function publicProject(project) {
  const { id, companyName, color, logoDataUrl, createdAt, pages } = project;
  return { id, companyName, color, logoDataUrl, createdAt, pages: pages.map(({ slug, title, wordCount }) => ({ slug, title, wordCount, url: `/p/${id}/${slug}` })) };
}
function pageHtml(project, page) {
  const color = project.color;
  const logo = project.logoDataUrl ? `<img class="logo" src="${project.logoDataUrl}" alt="${escapeHtml(project.companyName)} logo">` : `<span class="monogram">${escapeHtml(project.companyName.slice(0, 1).toUpperCase())}</span>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${escapeHtml(page.title)} — ${escapeHtml(project.companyName)}"><title>${escapeHtml(page.title)} | ${escapeHtml(project.companyName)}</title><style>:root{--brand:${color}}*{box-sizing:border-box}body{margin:0;background:#fbfaf7;color:#24282b;font-family:Arial,Helvetica,sans-serif;line-height:1.75}header{border-bottom:1px solid #e8e5de;background:white}.nav{max-width:1040px;margin:auto;padding:18px 24px;display:flex;align-items:center;gap:12px}.logo{max-width:130px;max-height:42px;object-fit:contain}.monogram{display:grid;place-items:center;background:var(--brand);color:white;width:42px;height:42px;border-radius:10px;font-weight:bold}.name{font-size:16px;font-weight:700;text-decoration:none;color:#24282b}main{max-width:760px;margin:70px auto 100px;padding:0 24px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.15em;font-weight:700;color:var(--brand)}h1{font-family:Georgia,serif;font-size:clamp(2.6rem,6vw,4.5rem);line-height:1.1;letter-spacing:-.04em;margin:18px 0 24px}h2{font-family:Georgia,serif;font-size:2rem;line-height:1.2;margin:48px 0 16px}h3{font-size:1.2rem;margin:30px 0 12px}p,li{font-size:1.08rem}p{margin:0 0 20px}li{margin:8px 0}ul{padding-left:24px}article{border-top:4px solid var(--brand);padding-top:34px}.meta{color:#697277;font-size:.9rem;margin-bottom:42px}footer{border-top:1px solid #e8e5de;padding:30px 24px;text-align:center;color:#687174;font-size:.85rem}</style></head><body><header><div class="nav">${logo}<a class="name" href="/">${escapeHtml(project.companyName)}</a></div></header><main><div class="eyebrow">Insights &amp; ideas</div><h1>${escapeHtml(page.title)}</h1><div class="meta">${escapeHtml(project.companyName)} · ${page.wordCount.toLocaleString()} words</div><article>${renderMarkdown(page.markdown)}</article></main><footer>Published by ${escapeHtml(project.companyName)}. Review important information before acting on it.</footer></body></html>`;
}
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
async function handler(req, res) {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (req.method === 'GET' && path === '/api/config') return json(res, 200, { hasServerKey: providersFor('').length > 0, model: process.env.GEMINI_API_KEY ? GEMINI_MODEL : OPENROUTER_MODELS[0] });
    if (req.method === 'GET' && path === '/api/projects') return json(res, 200, { projects: (await list()).map(publicProject) });
    if (req.method === 'POST' && path === '/api/projects') {
      const input = await body(req);
      const { companyName, color, logoDataUrl, topics } = validate(input);
      const providers = providersFor(String(input.apiKey || '').trim());
      if (!providers.length) return json(res, 400, { error: 'Add a Gemini or OpenRouter API key to generate articles, or set GEMINI_API_KEY / OPENROUTER_API_KEY on the server.' });
      const id = randomUUID();
      const used = new Set();
      const pages = [];
      for (const topic of topics) {
        let slug = slugify(topic), n = 2;
        while (used.has(slug)) slug = `${slugify(topic)}-${n++}`;
        used.add(slug);
        const markdown = await generatePost(topic, companyName, providers);
        pages.push({ slug, title: topic, markdown, wordCount: words(markdown) });
      }
      const project = { id, companyName, color, logoDataUrl, createdAt: new Date().toISOString(), pages };
      await save(project);
      return json(res, 201, { project: publicProject(project) });
    }
    const match = req.method === 'GET' && path.match(/^\/p\/([a-f0-9-]{36})\/([a-z0-9-]+)$/);
    if (match) {
      const project = await load(match[1]);
      const page = project?.pages.find(x => x.slug === match[2]);
      return page ? html(res, 200, pageHtml(project, page)) : html(res, 404, '<h1>Page not found</h1>');
    }
    if (req.method === 'GET' && !path.startsWith('/api/')) {
      const relative = path === '/' ? 'index.html' : decodeURIComponent(path.slice(1));
      const file = resolve(PUBLIC, relative);
      if (file !== PUBLIC && !file.startsWith(PUBLIC + '\\') && !file.startsWith(PUBLIC + '/')) return html(res, 403, '<h1>Forbidden</h1>');
      try {
        const content = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
        return res.end(content);
      } catch { /* 404 below */ }
    }
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error.message);
    return json(res, error.status || 500, { error: error.message || 'Unexpected error' });
  }
}
await mkdir(DATA, { recursive: true });
http.createServer(handler).listen(PORT, () => console.log(`Pagecraft running at http://localhost:${PORT}`));
