'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start, adminClient, camperClient } = require('./helpers');

test('no existe registro público de cuentas', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const c = env.client();
    assert.strictEqual((await c.post('/api/register', { username: 'intruso', password: 'Intruso123' })).status, 404);
    assert.strictEqual((await c.post('/api/admin/users', { name: 'X', username: 'xxx' })).status, 401);
});

test('login: credenciales incorrectas dan el mismo mensaje exista o no el usuario', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const c = env.client();
    const a = await c.post('/api/login', { username: 'admin', password: 'mala' });
    const b = await c.post('/api/login', { username: 'noexiste', password: 'mala' });
    assert.strictEqual(a.status, 401);
    assert.strictEqual(b.status, 401);
    assert.strictEqual(a.json.error, b.json.error);
});

test('login correcto crea cookie httpOnly SameSite=Strict y no devuelve el hash', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const c = env.client();
    const r = await c.post('/api/login', { username: 'admin', password: 'Admin1234' });
    assert.strictEqual(r.status, 200);
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.strictEqual(r.json.user.mustChange, true);
    assert.doesNotMatch(r.text, /scrypt|pass_hash/);
});

test('bloqueo temporal tras 5 intentos fallidos', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const c = env.client();
    for (let i = 0; i < 5; i++) await c.post('/api/login', { username: 'admin', password: 'mala' + i });
    const r = await c.post('/api/login', { username: 'admin', password: 'Admin1234' });
    assert.strictEqual(r.status, 429);
    assert.match(r.json.error, /Espera/);
});

test('con contraseña temporal solo se puede cambiar la contraseña', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const c = env.client();
    await c.post('/api/login', { username: 'admin', password: 'Admin1234' });
    const blocked = await c.get('/api/admin/users');
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual(blocked.json.code, 'must_change');
    assert.strictEqual((await c.get('/api/me')).status, 200);
    assert.strictEqual((await c.post('/api/password', { current: 'Admin1234', next: 'corta' })).status, 400);
    assert.strictEqual((await c.post('/api/password', { current: 'Admin1234', next: 'sololetras' })).status, 400);
    assert.strictEqual((await c.post('/api/password', { current: 'Admin1234', next: 'Admin1234' })).status, 400);
    assert.strictEqual((await c.post('/api/password', { current: 'equivocada', next: 'Nueva12345' })).status, 400);
    assert.strictEqual((await c.post('/api/password', { current: 'Admin1234', next: 'Nueva12345' })).status, 200);
    assert.strictEqual((await c.get('/api/admin/users')).status, 200);
});

test('cerrar sesión invalida la cookie', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const c = await adminClient(env);
    const old = c.cookie;
    await c.post('/api/logout');
    const again = env.client(); again.cookie = old;
    assert.strictEqual((await again.get('/api/me')).status, 401);
});

test('un camper no puede usar la API de administración', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const camper = await camperClient(env, admin, 'ana.perez', 1);
    for (const [m, p] of [['GET', '/api/admin/users'], ['GET', '/api/admin/usage'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/agents'], ['PUT', '/api/admin/settings']]) {
        assert.strictEqual((await camper.req(m, p, m === 'GET' ? undefined : {})).status, 403, m + ' ' + p);
    }
});

test('las escrituras desde otro origen se rechazan (CSRF)', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const c = await adminClient(env);
    const r = await c.post('/api/admin/groups', { name: 'Hack' }, { Origin: 'https://sitio-malo.example' });
    assert.strictEqual(r.status, 403);
});

test('sesión caducada por inactividad', async (t) => {
    const env = await start({ sessionIdleMinutes: 0.0001 }); t.after(() => env.app.close());
    const c = env.client();
    await c.post('/api/login', { username: 'admin', password: 'Admin1234' });
    await new Promise((r) => setTimeout(r, 50));
    const r = await c.get('/api/me');
    assert.strictEqual(r.status, 401);
    assert.strictEqual(r.json.code, 'auth');
});
