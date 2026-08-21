#!/usr/bin/env node

// Copyright (C) 2017-2023 Smart code 203358507

const INDEX_CACHE = 0;
const ASSETS_CACHE = 0;
const HTTP_PORT = 8081;

const express = require('express');
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

function serveIndex(req, res) {
    fs.readFile(index_path, 'utf8', (err, html) => {
        if (err) { res.status(500).send('err'); return; }
        let out = html;
        out = stripExternalScripts(out);
        out = out.replace('<head>', '<head>' + BLOCK_SW);
        res.set('cache-control', 'no-store');
        res.send(out);
        log(`SERVED index.html (${out.length} bytes) to ${req.url}`);
    });
}

const app = express();

app.use((req, res, next) => {
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
    next();
});

app.get('/', serveIndex);
app.get('/index.html', serveIndex);

// Same-origin reverse proxy to the Stremio streaming server.
// The UI origin (127.0.0.1:8082) is not allowed by the server's CORS policy,
// so core's requests would be blocked. Proxying keeps everything same-origin.
// NOTE: stremio-core strips any path from streamingServerUrl and treats it as
// an origin only, so the catch-all fallback at the bottom is what actually
// serves the proxied traffic; this mount is just an explicit alias.
const PROXY_PATH = '/streaming-server';
const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 11470;

function proxyToStreamingServer(req, res) {
    const options = {
        host: SERVER_HOST,
        port: SERVER_PORT,
        path: req.url,
        method: req.method,
        headers: Object.assign({}, req.headers, { host: `${SERVER_HOST}:${SERVER_PORT}` }),
    };
    const upstream = http.request(options, (up) => {
        res.writeHead(up.statusCode, up.headers);
        up.pipe(res);
    });
    upstream.on('error', (err) => {
        log(`PROXY_ERROR ${req.method} ${req.url}: ${err.message}`);
        if (!res.headersSent) {
            res.status(502).send('streaming server proxy error');
        } else {
            res.end();
        }
    });
    req.pipe(upstream);
}

app.use(PROXY_PATH, proxyToStreamingServer);

// Same-origin proxies for CORS-restricted external segment APIs.
const EXTERNAL_PROXY_ROUTES = {
    '/proxy/introdb': { host: 'api.introdb.app', tls: true },
};

Object.keys(EXTERNAL_PROXY_ROUTES).forEach((mount) => {
    const target = EXTERNAL_PROXY_ROUTES[mount];
    const transport = target.tls ? https : http;
    app.use(mount, (req, res) => {
        const options = {
            host: target.host,
            port: target.tls ? 443 : 80,
            path: req.url,
            method: req.method,
            headers: Object.assign({}, req.headers, {
                host: target.host,
                'user-agent': 'StremioDev/1.0',
            }),
        };
        const upstream = transport.request(options, (up) => {
            res.writeHead(up.statusCode, up.headers);
            up.pipe(res);
        });
        upstream.on('error', (err) => {
            log(`EXTERNAL_PROXY_ERROR ${req.method} ${req.url}: ${err.message}`);
            if (!res.headersSent) {
                res.status(502).send('external proxy error');
            } else {
                res.end();
            }
        });
        req.pipe(upstream);
    });
});

app.get('/__probe', (req, res) => {
    log(`PROBE ${req.query.type}${req.query.msg ? ' :: ' + req.query.msg : ''}`);
    res.set('cache-control', 'no-store');
    res.send('1');
});

app.get('/minimal', (_req, res) => {
    res.set('cache-control', 'no-store');
    res.send('<!doctype html><html><head><meta charset="utf-8"><title>minimal</title></head><body><h1>MINIMAL PAGE LOADED</h1><script>try{new Image().src="/__probe?type=minimal-load";}catch(e){}</script></body></html>');
});

// Always serve a no-op service worker so any existing registration update is harmless.
app.get('/service-worker.js', (_req, res) => {
    res.set('cache-control', 'no-store');
    res.set('content-type', 'application/javascript');
    res.send('// service worker disabled for local dev\n');
});

app.use(express.static(build_path, {
    setHeaders: (res, p) => {
        res.set('cache-control', 'no-store');
    }
// Unknown paths fall through to the streaming server: stremio-core strips
// the path from streamingServerUrl, so its requests (settings, torrent
// stats/streams) arrive at root level and must be proxied from here.
})).all('*', (req, res) => {
    log(`PROXY* ${req.method} ${req.url}`);
    proxyToStreamingServer(req, res);
});

if (HAS_TLS) {
    const tlsServer = https.createServer(TLS_OPTS, app);
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
const httpServer = http.createServer(app);
httpServer.on('clientError', (err, socket) => {
    log(`HTTP_CLIENT_ERROR: ${err && err.message}`);
});
httpServer.listen(HTTP_DEV_PORT, '127.0.0.1', () => log(`HTTP server listening on 127.0.0.1:${HTTP_DEV_PORT}`));
