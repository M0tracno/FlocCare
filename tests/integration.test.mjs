import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const waitFor = async url => {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('App did not start');
};

test('generates ten persistent branded pages and another project', async () => {
  const article = ['## A useful starting point', ...Array.from({ length: 83 }, () => 'Clear information helps people understand the subject and make thoughtful decisions today.')].join('\n\n');
  const calls = [];
  const upstream = http.createServer(async (req, res) => {
    const gemini = req.url.endsWith(':generateContent');
    calls.push(gemini ? `gemini:${req.headers['x-goog-api-key']}` : `openrouter:${req.headers.authorization}`);
    if (gemini && req.headers['x-goog-api-key'] === 'bad-gemini-key') { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { code: 400, message: 'API key not valid' } })); }
    if (!gemini) assert.equal(req.url, '/chat/completions');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(gemini ? { candidates: [{ content: { parts: [{ text: article }] }, finishReason: 'STOP' }] } : { choices: [{ message: { role: 'assistant', content: article }, finish_reason: 'stop' }] }));
  });
  const mockPort = await listen(upstream);
  const dir = await mkdtemp(join(tmpdir(), 'pagecraft-test-'));
  const appPortServer = http.createServer();
  const appPort = await listen(appPortServer);
  appPortServer.close();
  const child = spawn(process.execPath, ['server.mjs'], {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, PORT: String(appPort), DATA_DIR: dir, GEMINI_API_BASE: `http://127.0.0.1:${mockPort}`, OPENROUTER_API_BASE: `http://127.0.0.1:${mockPort}`, GEMINI_MODEL: 'test-model', OPENROUTER_MODELS: 'test-model', GEMINI_API_KEY: 'bad-gemini-key', OPENROUTER_API_KEY: 'sk-or-server-key' },
    stdio: 'ignore'
  });
  const base = `http://127.0.0.1:${appPort}`;
  try {
    await waitFor(`${base}/api/config`);
    const topics = Array.from({ length: 10 }, (_, i) => `Topic ${i + 1}`);
    const response = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: 'Test Health', color: '#C45A36', topics, apiKey: 'test-key' }) });
    assert.equal(response.status, 201);
    const { project } = await response.json();
    assert.equal(project.pages.length, 10);
    assert.ok(project.pages.every(page => page.wordCount >= 950 && page.wordCount <= 1050));
    for (const page of project.pages) {
      const html = await (await fetch(base + page.url)).text();
      assert.match(html, /Test Health/);
      assert.match(html, /#C45A36/);
      assert.match(html, /A useful starting point/);
    }
    assert.ok(calls.every(call => call === 'gemini:test-key'), 'a non sk-or- form key goes to Gemini only');
    calls.length = 0;
    // No form key: server Gemini key fails, so the request falls back to the server OpenRouter key.
    const second = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: 'Another Brand', color: '#123456', topics: ['Fresh subject'] }) });
    assert.equal(second.status, 201);
    assert.deepEqual(calls, ['gemini:bad-gemini-key', 'openrouter:Bearer sk-or-server-key']);
    const list = await (await fetch(`${base}/api/projects`)).json();
    assert.equal(list.projects.length, 2);
    assert.equal(list.projects[0].companyName, 'Another Brand');
    assert.ok(!JSON.stringify(list).includes('test-key'));
    const invalid = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ companyName: 'Bad', color: 'red', topics: ['x'], apiKey: 'test-key' }) });
    assert.equal(invalid.status, 400);
  } finally {
    child.kill();
    upstream.close();
    await rm(dir, { recursive: true, force: true });
  }
});
