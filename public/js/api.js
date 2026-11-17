/* Cliente de la API: peticiones JSON y lectura de respuestas en streaming (SSE). */
(function () {
    'use strict';
    window.App = window.App || {};

    class ApiError extends Error {
        constructor(status, message, code) {
            super(message);
            this.status = status;
            this.code = code || '';
        }
    }

    async function readJson(res) {
        try { return await res.json(); } catch (e) { return null; }
    }

    function toError(res, json) {
        const err = new ApiError(res.status, (json && json.error) || ('Error ' + res.status), json && json.code);
        if (res.status === 401 && err.code === 'auth' && window.App.onAuthExpired) window.App.onAuthExpired();
        return err;
    }

    async function request(method, url, body) {
        let res;
        try {
            res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: body === undefined ? undefined : JSON.stringify(body)
            });
        } catch (e) {
            throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet.', 'network');
        }
        const json = await readJson(res);
        if (!res.ok) throw toError(res, json);
        return json;
    }

    // POST que devuelve eventos SSE; llama onEvent(evento) por cada uno.
    async function stream(url, body, onEvent, signal) {
        let res;
        try {
            res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify(body),
                signal: signal
            });
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            throw new ApiError(0, 'No hay conexión con el servidor. Revisa tu internet.', 'network');
        }
        if (!res.ok) throw toError(res, await readJson(res));

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                buffer += decoder.decode(chunk.value, { stream: true });
                const blocks = buffer.split('\n\n');
                buffer = blocks.pop();
                for (let i = 0; i < blocks.length; i++) {
                    const line = blocks[i].trim();
                    if (line.indexOf('data:') !== 0) continue;
                    try { onEvent(JSON.parse(line.slice(5))); } catch (e) { if (e instanceof SyntaxError) continue; throw e; }
                }
            }
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            if (e instanceof ApiError) throw e;
            throw new ApiError(0, 'Se cortó la conexión mientras llegaba la respuesta.', 'network_mid');
        }
    }

    window.App.api = {
        ApiError: ApiError,
        get: function (u) { return request('GET', u); },
        post: function (u, b) { return request('POST', u, b === undefined ? {} : b); },
        put: function (u, b) { return request('PUT', u, b); },
        patch: function (u, b) { return request('PATCH', u, b); },
        del: function (u) { return request('DELETE', u); },
        stream: stream
    };
})();
