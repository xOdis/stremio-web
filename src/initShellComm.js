// Qt WebChannel → chrome.webview bridge shim
// Allows useShell.ts (WebView2-style IPC) to work with the Qt desktop shell.
// Shell calls window.initShellComm() via runJavaScript after page load.

(function () {
    // stremio-shell-ng (WebView2): the native chrome.webview already speaks the
    // {id, args} IPC protocol the host parses (RPCRequest). Re-wrapping messages
    // into the Qt WebChannel shape here DROPS the required `id` field, so every
    // outgoing event (app-ready, mpv-*) is silently discarded by the shell.
    // Only install the Qt bridge when there is no native WebView2 transport.
    if (typeof window.chrome === 'object' && window.chrome.webview) {
        return;
    }

    if (!window.qt || !window.qt.webChannelTransport) return;

    var QtMsgTypes = {
        signal: 1,
        propertyUpdate: 2,
        init: 3,
        idle: 4,
        debug: 5,
        invokeMethod: 6,
        connectToSignal: 7,
        disconnectFromSignal: 8,
        setProperty: 9,
        response: 10,
    };

    var listeners = [];
    var pendingInit = [];
    var initialized = false;

    // Fake chrome.webview that useShell.ts will detect
    window.chrome = window.chrome || {};
    window.chrome.webview = {
        addEventListener: function (_type, listener) {
            listeners.push(listener);
            // Deliver any INIT events that arrived before this listener
            // registered (e.g. shell responded faster than React mounted)
            pendingInit.forEach(function (envelope) {
                try {
                    listener(envelope);
                } catch (_e) {}
            });
        },
        removeEventListener: function (_type, listener) {
            var idx = listeners.indexOf(listener);
            if (idx !== -1) listeners.splice(idx, 1);
        },
        postMessage: function (data) {
            var msg = JSON.parse(data);
            var qt = window.qt.webChannelTransport;

            if (msg.type === QtMsgTypes.init) {
                // App requests INIT handshake — forward to Qt
                qt.send(JSON.stringify({ type: QtMsgTypes.init }));
            } else if (msg.type === QtMsgTypes.invokeMethod) {
                // App → Shell: translate to Qt invokeMethod
                qt.send(JSON.stringify({
                    type: QtMsgTypes.invokeMethod,
                    object: 'transport',
                    method: 'onEvent',
                    args: msg.args,
                }));
            }
        },
    };

    // Remove the legacy neutering that useShell.ts applies at module load.
    // We re-assert our onmessage handler after a microtask to run after useShell.ts.
    var _originalOnmessage = window.qt.webChannelTransport.onmessage;

    function installHandler() {
        var qt = window.qt.webChannelTransport;

        // If useShell.ts already neutered it (line 6), restore ours
        qt.onmessage = function (message) {
            var msg;
            try {
                msg = JSON.parse(message.data);
            } catch (_e) {
                return;
            }

            // INIT response (id === 0): extract properties and signals, subscribe to signals,
            // then emit as WebView2-style INIT event
            if (msg.id === 0 && msg.data && msg.data.transport) {
                var transport = msg.data.transport;
                var props = transport.properties || [];
                var signals = transport.signals || [];

                // Subscribe to all signals
                signals.forEach(function (sig) {
                    qt.send(JSON.stringify({
                        type: QtMsgTypes.connectToSignal,
                        object: 'transport',
                        signal: sig[1],
                    }));
                });

                // Translate to WebView2 INIT format
                var event = {
                    type: QtMsgTypes.init,
                    data: { transport: { properties: props } },
                };
                var envelope = { data: JSON.stringify(event) };

                if (initialized) {
                    // Already initialized — just emit (e.g., crash recovery reload)
                    listeners.forEach(function (fn) { fn(envelope); });
                } else {
                    // First init — queue for listeners that haven't registered yet
                    initialized = true;
                    pendingInit.push(envelope);
                }
                return;
            }

            // Signal from Qt transport
            if (msg.object === 'transport' && msg.type === QtMsgTypes.signal) {
                var signalEvent = { type: QtMsgTypes.signal, args: msg.args };
                var signalEnvelope = { data: JSON.stringify(signalEvent) };
                listeners.forEach(function (fn) { fn(signalEnvelope); });
                return;
            }

            // Property update (type 2) — re-emit as INIT with updated properties
            if (msg.id === 0 && msg.type === QtMsgTypes.propertyUpdate && msg.data && msg.data.transport) {
                var updateProps = msg.data.transport.properties || [];
                var updateEvent = {
                    type: QtMsgTypes.init,
                    data: { transport: { properties: updateProps } },
                };
                listeners.forEach(function (fn) { fn({ data: JSON.stringify(updateEvent) }); });
            }
        };

        // Flush any INIT events that arrived before listeners registered
        pendingInit.forEach(function (envelope) {
            listeners.forEach(function (fn) { fn(envelope); });
        });
        pendingInit = [];
    }

    // Install immediately in case useShell.ts hasn't run yet
    installHandler();

    // Re-install after microtask to override useShell.ts neutering (line 6)
    Promise.resolve().then(installHandler);

    // Define initShellComm — shell calls this via runJavaScript after page load.
    // Must be idempotent (shell may call again after crash recovery).
    window.initShellComm = function () {
        // Already set up — no-op
    };
})();
