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
