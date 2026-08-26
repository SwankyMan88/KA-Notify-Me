// Dev-only static server so the popup can be reviewed in a real browser.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.png': 'image/png',
  '.wav': 'audio/wav',
};

createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^[/]+/, '');
  try {
    const body = await readFile(join(ROOT, path));
    // No caching: ES modules are cached by URL, and a stale one served during
    // testing looks exactly like a change that did not work.
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store, must-revalidate',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(8931, () => console.log('preview on http://localhost:8931'));
