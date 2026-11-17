'use strict';
const { createApp } = require('../server/app');

/* Respuesta simulada del servicio de IA en formato SSE (como la API real). */
function mockFetch(parts, options) {
    options = options || {};
    parts = parts || ['Hola ', 'mundo'];
    const calls = [];
    const f = async function (url, opts) {
        calls.push({ url: url, body: JSON.parse(opts.body), headers: opts.headers });
        if (options.status) {
            return new Response(JSON.stringify({ error: { message: 'detalle-interno-secreto' } }), { status: options.status });
        }
        const enc = new TextEncoder();
        const stream = new ReadableStream({
            start(c) {
                parts.forEach(function (p) { c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: { content: p } }] }) + '\n\n')); });
                c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: options.finish || 'stop' }] }) + '\n\n'));
                c.enqueue(enc.encode('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 20 } }) + '\n\ndata: [DONE]\n\n'));
                c.close();
            }
        });
        return new Response(stream, { status: 200 });
    };
    f.calls = calls;
    return f;
}

class Client {
    constructor(base) { this.base = base; this.cookie = ''; }
    async req(method, path, body, headers) {
        const res = await fetch(this.base + path, {
            method: method,
            headers: Object.assign({ 'Content-Type': 'application/json', Cookie: this.cookie }, headers || {}),
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const set = res.headers.get('set-cookie');
        if (set) this.cookie = set.split(';')[0];
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* no era JSON (SSE o estático) */ }
        return { status: res.status, json: json, text: text, headers: res.headers };
    }
    get(p) { return this.req('GET', p); }
    post(p, b, h) { return this.req('POST', p, b === undefined ? {} : b, h); }
    put(p, b) { return this.req('PUT', p, b); }
    patch(p, b) { return this.req('PATCH', p, b); }
    del(p) { return this.req('DELETE', p); }
}

// Interpreta el cuerpo SSE como lista de eventos.
function sseEvents(text) {
    return text.split('\n\n').map(function (b) { return b.trim(); }).filter(function (b) { return b.indexOf('data:') === 0; })
        .map(function (b) { return JSON.parse(b.slice(5)); });
}

async function start(overrides) {
    const fetchMock = (overrides && overrides.fetch) || mockFetch();
    const app = createApp(Object.assign({ dbPath: ':memory:', openaiKey: 'sk-test', adminPassword: 'Admin1234', fetch: fetchMock }, overrides || {}));
    await new Promise(function (r) { app.server.listen(0, '127.0.0.1', r); });
    const base = 'http://127.0.0.1:' + app.server.address().port;
    return { app: app, base: base, fetchMock: fetchMock, client: function () { return new Client(base); } };
}

// Inicia sesión como administrador y completa el cambio de contraseña obligatorio.
async function adminClient(env) {
    const c = env.client();
    let r = await c.post('/api/login', { username: 'admin', password: 'Admin1234' });
    if (r.status !== 200) throw new Error('No se pudo iniciar sesión: ' + r.text);
    r = await c.post('/api/password', { current: 'Admin1234', next: 'Nuevo12345' });
    if (r.status !== 200) throw new Error('No se pudo cambiar la contraseña: ' + r.text);
    return c;
}

// Crea un camper, inicia sesión con su contraseña temporal y cambia la contraseña.
async function camperClient(env, admin, username, groupId) {
    const created = await admin.post('/api/admin/users', { name: 'Camper ' + username, username: username, role: 'camper', groupId: groupId });
    if (created.status !== 200) throw new Error('No se pudo crear: ' + created.text);
    const c = env.client();
    await c.post('/api/login', { username: username, password: created.json.tempPassword });
    await c.post('/api/password', { current: created.json.tempPassword, next: 'Camper12345' });
    return c;
}

module.exports = { mockFetch, Client, sseEvents, start, adminClient, camperClient };
