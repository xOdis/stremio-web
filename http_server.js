#!/usr/bin/env node

// Copyright (C) 2017-2023 Smart code 203358507
// Local dev server for the desktop shell — zero dependencies (plain Node),
// so a fresh checkout runs with nothing but Node.js installed.

const INDEX_CACHE = 0;
const ASSETS_CACHE = 0;
const HTTP_PORT = 8081;

const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const build_path = path.resolve(__dirname, 'build');
const index_path = path.join(build_path, 'index.html');
const logPath = path.join(__dirname, 'server.log');

// Self-signed dev cert (localhost.pfx) is optional: the desktop shell uses
// the plain-HTTP listener below, so TLS is only started when the cert file
// exists. Generate one if you need HTTPS locally.
const CERT_FILE = path.join(__dirname, 'localhost.pfx');
const HAS_TLS = fs.existsSync(CERT_FILE);
const TLS_OPTS = HAS_TLS ? {
    pfx: fs.readFileSync(CERT_FILE),
    passphrase: 'stremio-dev',
} : null;

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    fs.appendFileSync(logPath, line);
    console.info(line.trim());
}

log('=== Server starting (port ' + HTTP_PORT + ') ===');

// Block service-worker registration so the desktop shell never caches via SW.
// The shell is a native app and does not need a PWA service worker; the SW
// was intercepting navigation and serving stale cached content, which broke
// the page load (load event never fired -> splash stuck).
const BLOCK_SW = `<script>(function(){
  try {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.register = function() {
        console.log('[local-dev] service worker registration blocked');
        return Promise.reject(new Error('blocked'));
      };
      if (navigator.serviceWorker.addEventListener) {
        navigator.serviceWorker.addEventListener = function() {};
      }
    }
    if (window.Workbox) { window.Workbox = function(){ return { register: function(){return Promise.reject('blocked');}, addEventListener:function(){}, update:function(){return Promise.reject('blocked');} }; }; }
  } catch (e) { console.error(e); }
  function ping(type, msg) {
    try {
      var url = '/__probe?type=' + encodeURIComponent(type) + (msg ? '&msg=' + encodeURIComponent(String(msg)) : '');
      var i = new Image();
      i.src = url;
    } catch (e) {}
  }
  window.__probe = ping;
  document.addEventListener('DOMContentLoaded', function(){ ping('domcontentloaded'); });
  window.addEventListener('load', function(){ ping('load'); });
  window.addEventListener('error', function(e){ ping('error', (e.message||'') + ' @ ' + (e.filename||'') + ':' + (e.lineno||'')); });
  window.addEventListener('unhandledrejection', function(e){ ping('reject', (e.reason && e.reason.message) || e.reason); });
  // Report the IPC environment the host binary exposes
  var ipc = 'none';
  try {
    if (window.chrome && window.chrome.webview) ipc = 'chrome.webview';
    else if (window.qt && window.qt.webChannelTransport) ipc = 'qt.webChannelTransport';
    else if (window.qt) ipc = 'qt(other)';
  } catch (e) {}
  ping('ipc-env', ipc);
  ping('has-initShellComm', typeof window.initShellComm);

  // Test the WebView2 IPC channel: listen for shell -> page messages, and post an INIT.
  if (window.chrome && window.chrome.webview) {
    try {
      window.chrome.webview.addEventListener('message', function(e) {
        ping('shell-msg', (e && e.data) ? String(e.data).slice(0, 200) : 'empty');
      });
      window.chrome.webview.postMessage(JSON.stringify({ id: 0, type: 3 })); // INIT
      ping('posted-init', 'ok');
    } catch (e) {
      ping('posted-init', 'ERR ' + (e && e.message));
    }
  }
  ping('script-injected');
})();</script>`;

// Remove any external <script> tags (http/https/protocol-relative) from the
// served HTML. The desktop shell does not need Chromecast/Apple-auth CDN
// scripts, and they can hang the page load under Qt WebEngine. Local hashed
// assets (e.g. ee44.../scripts/main.js) are kept.
function stripExternalScripts(html) {
    return html.replace(/<script[^>]*\ssrc\s*=\s*["']\s*(https?:)?\/\/[^"']+["'][^>]*>\s*<\/script>/gi, '');
}

function sendText(res, status, body, type) {
    res.writeHead(status, {
        'content-type': type || 'text/html; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(body);
}

function serveIndex(req, res) {
    fs.readFile(index_path, 'utf8', (err, html) => {
        if (err) {
            log(`INDEX_ERROR ${req.url}: ${err.message}`);
            sendText(res, 500, 'err', 'text/plain');
            return;
        }
        let out = html;
        out = stripExternalScripts(out);
        out = out.replace('<head>', '<head>' + BLOCK_SW);
        sendText(res, 200, out);
        log(`SERVED index.html (${out.length} bytes) to ${req.url}`);
    });
}

// Same-origin reverse proxy to the Stremio streaming server.
// The UI origin (127.0.0.1:8082) is not allowed by the server's CORS policy,
// so core's requests would be blocked. Proxying keeps everything same-origin.
// NOTE: stremio-core strips any path from streamingServerUrl and treats it as
// an origin only, so the catch-all fallback at the bottom is what actually
// serves the proxied traffic; this mount is just an explicit alias.
const PROXY_PATH = '/streaming-server';
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 11470;

// Mirrors express app.use(mount, ...) semantics: the handler receives req.url
// with the mount prefix stripped.
function stripMount(url, mount) {
    if (url === mount) return '/';
    if (url.startsWith(mount + '/')) return url.slice(mount.length);
    return null;
}

function proxyRequest(res, options, tag, req, transport) {
    const client = transport || http;
    const upstream = client.request(options, (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
    });
    upstream.on('error', (err) => {
        log(`${tag} ${req.method} ${req.url}: ${err.message}`);
        if (!res.headersSent) {
            sendText(res, 502, `${tag.toLowerCase()} error`, 'text/plain');
        } else {
            res.end();
        }
    });
    req.pipe(upstream);
}

function proxyToStreamingServer(req, res, targetPath) {
    proxyRequest(res, {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: targetPath,
        method: req.method,
        headers: Object.assign({}, req.headers, { host: `${SERVER_HOST}:${SERVER_PORT}` }),
    }, 'PROXY_ERROR', req, http);
}

// Same-origin proxies for CORS-restricted external segment APIs.
const EXTERNAL_PROXY_ROUTES = {
    '/proxy/introdb': { host: 'api.introdb.app', tls: true },
};

// Translation proxy for meta descriptions. Primary: unofficial Google
// endpoint on clients5.google.com (the translate.googleapis.com gtx
// endpoint is heavily rate-limited). Fallback: MyMemory API.
// Response: {"translated": "..."}.
function translateViaGoogle(text, target, onResponse, onError) {
    const upstreamPath = `/translate_a/t?client=dict-chrome-ex&sl=auto&tl=${encodeURIComponent(target)}&q=${encodeURIComponent(text)}`;
    const upstream = https.request({
        host: 'clients5.google.com',
        port: 443,
        path: upstreamPath,
        method: 'GET',
        headers: {
            host: 'clients5.google.com',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
            accept: 'application/json',
        },
    }, (up) => {
        let body = '';
        up.on('data', (chunk) => { body += chunk; });
        up.on('end', () => {
            if (up.statusCode !== 200) {
                onError(new Error('google upstream ' + up.statusCode));
                return;
            }
            try {
                const data = JSON.parse(body);
                // Shape: [["translated text","source_lang"], ...]
                const translated = Array.isArray(data) ?
                    data.map((segment) => Array.isArray(segment) ? String(segment[0] ?? '') : '').join('')
                    :
                    '';
                if (translated.length === 0) {
                    onError(new Error('google empty translation'));
                    return;
                }
                onResponse(translated);
            } catch (err) {
                onError(err);
            }
        });
    });
    upstream.on('error', onError);
    upstream.end();
}

function translateViaMyMemory(text, target, onResponse, onError) {
    const upstreamPath = `/get?q=${encodeURIComponent(text)}&langpair=en|${encodeURIComponent(target)}`;
    const upstream = https.request({
        host: 'api.mymemory.translated.net',
        port: 443,
        path: upstreamPath,
        method: 'GET',
        headers: {
            host: 'api.mymemory.translated.net',
            'user-agent': 'StremioDev/1.0',
            accept: 'application/json',
        },
    }, (up) => {
        let body = '';
        up.on('data', (chunk) => { body += chunk; });
        up.on('end', () => {
            if (up.statusCode !== 200) {
                onError(new Error('mymemory upstream ' + up.statusCode));
                return;
            }
            try {
                const data = JSON.parse(body);
                const translated = typeof data?.responseData?.translatedText === 'string' ? data.responseData.translatedText : '';
                if (translated.length === 0) {
                    onError(new Error('mymemory empty translation'));
                    return;
                }
                onResponse(translated);
            } catch (err) {
                onError(err);
            }
        });
    });
    upstream.on('error', onError);
    upstream.end();
}

// TMDB trending (this week) proxy. Reads the v3 API key from
// tmdb.config.json (server-side only — never sent to the browser).
// Resolves each trending item's IMDb id via TMDB external-ids and
// returns a normalized, Cinemeta-shaped list: { metas: [...] }.
const TMDB_CONFIG_PATH = path.join(__dirname, 'tmdb.config.json');
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

function readTmdbApiKey() {
    try {
        const config = JSON.parse(fs.readFileSync(TMDB_CONFIG_PATH, 'utf8'));
        return typeof config?.apiKey === 'string' && config.apiKey.trim().length > 0 ? config.apiKey.trim() : null;
    } catch (_e) {
        return null;
    }
}

function tmdbRequest(upstreamPath) {
    return new Promise((resolve, reject) => {
        const upstream = https.request({
            host: 'api.themoviedb.org',
            port: 443,
            path: upstreamPath,
            method: 'GET',
            headers: {
                host: 'api.themoviedb.org',
                'user-agent': 'StremioDev/1.0',
                accept: 'application/json',
            },
        }, (up) => {
            let body = '';
            up.on('data', (chunk) => { body += chunk; });
            up.on('end', () => {
                if (up.statusCode !== 200) {
                    reject(new Error('tmdb upstream ' + up.statusCode));
                    return;
                }
                try {
                    resolve(JSON.parse(body));
                } catch (err) {
                    reject(err);
                }
            });
        });
        upstream.on('error', reject);
        upstream.end();
    });
}

function tmdbToMeta(result, resolvedType, imdbId) {
    const type = resolvedType === 'tv' ? 'series' : 'movie';
    const name = result.title ?? result.name ?? null;
    const posterPath = result.poster_path ?? null;
    return {
        id: imdbId,
        type,
        name,
        poster: posterPath !== null ? `${TMDB_IMAGE_BASE}/w500${posterPath}` : null,
        imdbRating: typeof result.vote_average === 'number' && result.vote_average > 0 ? result.vote_average.toFixed(1) : null,
        releaseInfo: (result.release_date ?? result.first_air_date ?? '').slice(0, 4)
    };
}

async function handleTmdbTrending(req, res) {
    const apiKey = readTmdbApiKey();
    if (apiKey === null) {
        sendText(res, 503, 'tmdb key not configured', 'text/plain');
        return;
    }
    try {
        const trending = await tmdbRequest(`/3/trending/all/week?api_key=${encodeURIComponent(apiKey)}`);
        const results = Array.isArray(trending?.results) ? trending.results : [];
        const withImdb = await Promise.all(results.slice(0, 24).map(async (result) => {
            const resolvedType = result.media_type === 'tv' ? 'tv' : 'movie';
            try {
                const external = await tmdbRequest(`/3/${resolvedType}/${result.id}/external_ids?api_key=${encodeURIComponent(apiKey)}`);
                if (typeof external?.imdb_id !== 'string' || !external.imdb_id.startsWith('tt')) {
                    return null;
                }
                return tmdbToMeta(result, resolvedType, external.imdb_id);
            } catch (_e) {
                return null;
            }
        }));
        const metas = withImdb.filter((meta) => meta !== null && meta.name !== null);
        sendText(res, 200, JSON.stringify({ metas }), 'application/json; charset=utf-8');
    } catch (err) {
        log(`TMDB_ERROR: ${err.message}`);
        sendText(res, 502, 'tmdb error', 'text/plain');
    }
}

// Subtitle font support: exposes the on-disk path of assets/fonts so the
// desktop shell can point mpv's libass at it (sub-fonts-dir) — bundled or
// drop-in fonts then work without installing them on Windows. Points at
// the source assets folder (same machine as the shell), independent of
// webpack build output.
const FONTS_DIR = path.resolve(__dirname, 'assets', 'fonts');

// Player settings persistence: saves to a JSON file on disk so settings
// survive even if the shell clears WebView2 localStorage on relaunch.
const PLAYER_SETTINGS_PATH = path.join(__dirname, 'player-settings.json');

function handlePlayerSettings(req, res) {
    if (req.method === 'GET') {
        try {
            const data = fs.readFileSync(PLAYER_SETTINGS_PATH, 'utf8');
            sendText(res, 200, data, 'application/json; charset=utf-8');
        } catch (_e) {
            sendText(res, 200, '{}', 'application/json; charset=utf-8');
        }
        return;
    }
    if (req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
            try {
                JSON.parse(body); // validate
                fs.writeFileSync(PLAYER_SETTINGS_PATH, body, 'utf8');
                sendText(res, 200, '{"ok":true}', 'application/json; charset=utf-8');
            } catch (e) {
                sendText(res, 400, 'invalid json', 'text/plain');
            }
        });
        return;
    }
    sendText(res, 405, 'method not allowed', 'text/plain');
}

function handleFontsDir(req, res) {
    sendText(res, 200, JSON.stringify({ path: FONTS_DIR }), 'application/json; charset=utf-8');
}

function handleFontsList(req, res) {
    try {
        const fonts = fs.readdirSync(FONTS_DIR)
            .filter((name) => /\.ttf$/i.test(name))
            .map((name) => name.replace(/\.ttf$/i, ''));
        sendText(res, 200, JSON.stringify({ fonts }), 'application/json; charset=utf-8');
    } catch (_e) {
        sendText(res, 200, JSON.stringify({ fonts: [] }), 'application/json; charset=utf-8');
    }
}

function handleTranslate(req, res, query) {
    const text = (query.get('text') || '').slice(0, 5000);
    const target = (query.get('target') || 'en').replace(/[^a-zA-Z-]/g, '').slice(0, 10);
    if (text.length === 0 || target.length === 0) {
        sendText(res, 400, 'missing text/target', 'text/plain');
        return;
    }
    let settled = false;
    const finish = (translated) => {
        if (settled) return;
        settled = true;
        sendText(res, 200, JSON.stringify({ translated }), 'application/json; charset=utf-8');
    };
    const failWithFallback = (err) => {
        log(`TRANSLATE google failed: ${err.message}, trying MyMemory`);
        translateViaMyMemory(text, target, finish, (fallbackErr) => {
            log(`TRANSLATE mymemory failed: ${fallbackErr.message}`);
            if (!settled) {
                settled = true;
                sendText(res, 502, 'translate error', 'text/plain');
            }
        });
    };
    translateViaGoogle(text, target, finish, failWithFallback);
}

function proxyExternal(req, res, mount, target, targetPath) {
    const transport = target.tls ? https : http;
    proxyRequest(res, {
        host: target.host,
        port: target.tls ? 443 : 80,
        path: targetPath,
        method: req.method,
        headers: Object.assign({}, req.headers, {
            host: target.host,
            'user-agent': 'StremioDev/1.0',
        }),
    }, 'EXTERNAL_PROXY_ERROR', req, transport);
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.eot': 'application/vnd.ms-fontobject',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wasm': 'application/wasm',
    '.pdf': 'application/pdf',
};

// Resolves a request path to an existing file inside build_path, or null.
// Path-traversal safe: resolved target must stay within build_path.
function resolveStatic(pathname) {
    let decoded;
    try {
        decoded = decodeURIComponent(pathname);
    } catch (_e) {
        return null;
    }
    const filePath = path.normalize(path.join(build_path, decoded));
    if (!filePath.startsWith(build_path)) return null;
    try {
        const stat = fs.statSync(filePath);
        if (stat.isFile()) return filePath;
    } catch (_e) {}
    // Directory-style URLs fall back to their index.html.
    const idx = path.join(filePath, 'index.html');
    try {
        const stat = fs.statSync(idx);
        if (stat.isFile()) return idx;
    } catch (_e) {}
    return null;
}

function serveStaticFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
        'content-type': MIME_TYPES[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
    });
    fs.createReadStream(filePath).pipe(res);
}

const handler = (req, res) => {
    const start = Date.now();
    log(`REQ  ${req.method} ${req.url}`);
    res.on('finish', () => {
        log(`DONE ${req.method} ${req.url} -> ${res.statusCode} (${Date.now() - start}ms)`);
    });
    res.on('close', () => {
        if (!res.writableEnded) {
            log(`HUNG ${req.method} ${req.url} (closed before finish, ${Date.now() - start}ms)`);
        }
    });

    let parsed;
    try {
        parsed = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    } catch (_e) {
        sendText(res, 400, 'bad request', 'text/plain');
        return;
    }

    const streamingPath = stripMount(parsed.pathname + (parsed.search || ''), PROXY_PATH);
    if (streamingPath !== null) {
        proxyToStreamingServer(req, res, streamingPath);
        return;
    }

    for (const mount of Object.keys(EXTERNAL_PROXY_ROUTES)) {
        const externalPath = stripMount(parsed.pathname + (parsed.search || ''), mount);
        if (externalPath !== null) {
            proxyExternal(req, res, mount, EXTERNAL_PROXY_ROUTES[mount], externalPath);
            return;
        }
    }

    if (parsed.pathname === '/proxy/translate') {
        handleTranslate(req, res, parsed.searchParams);
        return;
    }

    if (parsed.pathname === '/proxy/tmdb/trending') {
        handleTmdbTrending(req, res);
        return;
    }

    if (parsed.pathname === '/fonts-dir') {
        handleFontsDir(req, res);
        return;
    }

    if (parsed.pathname === '/fonts-list') {
        handleFontsList(req, res);
        return;
    }

    if (parsed.pathname === '/api/player-settings') {
        handlePlayerSettings(req, res);
        return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
        if (parsed.pathname === '/' || parsed.pathname === '/index.html') {
            serveIndex(req, res);
            return;
        }
        if (parsed.pathname === '/__probe') {
            log(`PROBE ${parsed.searchParams.get('type')}${parsed.searchParams.get('msg') ? ' :: ' + parsed.searchParams.get('msg') : ''}`);
            sendText(res, 200, '1', 'text/plain');
            return;
        }
        if (parsed.pathname === '/minimal') {
            sendText(res, 200, '<!doctype html><html><head><meta charset="utf-8"><title>minimal</title></head><body><h1>MINIMAL PAGE LOADED</h1><script>try{new Image().src="/__probe?type=minimal-load";}catch(e){}</script></body></html>');
            return;
        }
        // Always serve a no-op service worker so any existing registration update is harmless.
        if (parsed.pathname === '/service-worker.js') {
            sendText(res, 200, '// service worker disabled for local dev\n', 'application/javascript; charset=utf-8');
            return;
        }
        const staticFile = resolveStatic(parsed.pathname);
        if (staticFile !== null) {
            serveStaticFile(res, staticFile);
            return;
        }
    }

    // Unknown paths fall through to the streaming server: stremio-core strips
    // the path from streamingServerUrl, so its requests (settings, torrent
    // stats/streams) arrive at root level and must be proxied from here.
    log(`PROXY* ${req.method} ${req.url}`);
    proxyToStreamingServer(req, res, parsed.pathname + (parsed.search || ''));
};

if (HAS_TLS) {
    const tlsServer = https.createServer(TLS_OPTS, handler);
    tlsServer.on('tlsClientError', (err, tlsSocket) => {
        log(`TLS_CLIENT_ERROR: ${err && err.message}`);
    });
    tlsServer.on('clientError', (err, socket) => {
        log(`CLIENT_ERROR: ${err && err.message}`);
    });
    tlsServer.listen(HTTP_PORT, () => log(`HTTPS server listening on port: ${HTTP_PORT}`));
} else {
    log(`No localhost.pfx found — skipping HTTPS listener on port: ${HTTP_PORT}`);
}

// Plain-HTTP listener for the desktop shell (stremio-shell-ng --webui-url).
// Bound to loopback only; avoids TLS trust issues with the self-signed cert.
const HTTP_DEV_PORT = 8082;
const httpServer = http.createServer(handler);
httpServer.on('clientError', (err, socket) => {
    log(`HTTP_CLIENT_ERROR: ${err && err.message}`);
});
httpServer.listen(HTTP_DEV_PORT, '127.0.0.1', () => log(`HTTP server listening on 127.0.0.1:${HTTP_DEV_PORT}`));
