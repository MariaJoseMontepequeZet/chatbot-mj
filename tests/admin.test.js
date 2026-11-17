'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { start, adminClient, camperClient } = require('./helpers');
const P = require('../public/shared/prompt.js');

test('el administrador crea cuentas con contraseña temporal y el camper debe cambiarla', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const r = await admin.post('/api/admin/users', { name: 'Ana Pérez', username: 'ana.perez', role: 'camper', groupId: 1 });
    assert.strictEqual(r.status, 200);
    assert.match(r.json.tempPassword, /^[A-Za-z0-9]{10}$/);
    const c = env.client();
    const login = await c.post('/api/login', { username: 'ana.perez', password: r.json.tempPassword });
    assert.strictEqual(login.json.user.mustChange, true);
    assert.strictEqual((await c.get('/api/conversations')).json.code, 'must_change');
    assert.strictEqual((await admin.post('/api/admin/users', { name: 'Otra', username: 'ANA.PEREZ' })).status, 409);
    assert.strictEqual((await admin.post('/api/admin/users', { name: 'Mal', username: 'a b' })).status, 400);
});

test('desactivar cuenta cierra sus sesiones y bloquea el ingreso; reactivar lo permite', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const camper = await camperClient(env, admin, 'ana.perez', 1);
    const id = (await admin.get('/api/admin/users')).json.users.find((u) => u.username === 'ana.perez').id;
    assert.strictEqual((await camper.get('/api/me')).status, 200);
    assert.strictEqual((await admin.patch('/api/admin/users/' + id, { active: false })).status, 200);
    assert.strictEqual((await camper.get('/api/me')).status, 401);
    const c = env.client();
    assert.strictEqual((await c.post('/api/login', { username: 'ana.perez', password: 'Camper12345' })).status, 403);
    await admin.patch('/api/admin/users/' + id, { active: true });
    assert.strictEqual((await c.post('/api/login', { username: 'ana.perez', password: 'Camper12345' })).status, 200);
});

test('restablecer contraseña da una nueva temporal e invalida la anterior', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    await camperClient(env, admin, 'ana.perez', 1);
    const id = (await admin.get('/api/admin/users')).json.users.find((u) => u.username === 'ana.perez').id;
    const r = await admin.post('/api/admin/users/' + id + '/reset');
    assert.strictEqual(r.status, 200);
    const c = env.client();
    assert.strictEqual((await c.post('/api/login', { username: 'ana.perez', password: 'Camper12345' })).status, 401);
    const ok = await c.post('/api/login', { username: 'ana.perez', password: r.json.tempPassword });
    assert.strictEqual(ok.json.user.mustChange, true);
});

test('protecciones: no desactivarse, no dejar sin administradores, no borrarse', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const me = (await admin.get('/api/me')).json.user;
    assert.strictEqual((await admin.patch('/api/admin/users/' + me.id, { active: false })).status, 400);
    assert.strictEqual((await admin.patch('/api/admin/users/' + me.id, { role: 'camper' })).status, 400);
    assert.strictEqual((await admin.del('/api/admin/users/' + me.id)).status, 400);
    // segundo administrador: ahora sí se puede quitar el primero, pero no el último
    const second = (await admin.post('/api/admin/users', { name: 'Segundo', username: 'segundo', role: 'admin' })).json;
    const other = env.client();
    await other.post('/api/login', { username: 'segundo', password: second.tempPassword });
    await other.post('/api/password', { current: second.tempPassword, next: 'Segundo12345' });
    assert.strictEqual((await other.patch('/api/admin/users/' + me.id, { active: false })).status, 200);
    assert.strictEqual((await other.patch('/api/admin/users/' + second.id, { active: false })).status, 400);
});

test('importar cuentas desde CSV genera usuarios únicos y reporta errores', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const csv = 'Nombre,usuario\nMaría José López,\nMaría José López,\nCarlos Ruiz,cruiz\n,sinnombre\nPedro Gómez,a b';
    const r = await admin.post('/api/admin/users/import', { csv: csv, groupId: 1 });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.json.created.map((u) => u.username), ['maria.lopez', 'maria.lopez2', 'cruiz']);
    assert.strictEqual(r.json.errors.length, 2);
    r.json.created.forEach((u) => assert.match(u.tempPassword, /^[A-Za-z0-9]{10}$/));
});

test('agentes: versiones, restaurar y validación', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const a1 = (await admin.get('/api/admin/agents/1')).json;
    assert.strictEqual(a1.version, 1);
    const f2 = Object.assign({}, a1.ficha, { tono: 'Muy formal' });
    const up = await admin.put('/api/admin/agents/1', { ficha: f2, note: 'Más formal' });
    assert.strictEqual(up.json.version, 2);
    assert.strictEqual((await admin.put('/api/admin/agents/1', { ficha: Object.assign({}, f2, { rasgos: [9, 9, 9, 9, 9] }) })).status, 400);
    const detail = (await admin.get('/api/admin/agents/1')).json;
    assert.strictEqual(detail.versions.length, 2);
    assert.strictEqual(detail.ficha.tono, 'Muy formal');
    const rest = await admin.post('/api/admin/agents/1/restore', { version: 1 });
    assert.strictEqual(rest.json.version, 3);
    assert.strictEqual((await admin.get('/api/admin/agents/1')).json.ficha.tono, P.DEFAULT_FICHA.tono);
    assert.strictEqual((await admin.post('/api/admin/agents/1/restore', { version: 99 })).status, 404);
});

test('cada grupo puede tener su agente y el chat usa el de su grupo', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const ficha = Object.assign({}, P.DEFAULT_FICHA, { nombre: 'Zevrin', rol: 'coach de entrevistas' });
    const agent = (await admin.post('/api/admin/agents', { ficha: ficha })).json;
    const group = (await admin.post('/api/admin/groups', { name: 'Cohorte 2', agentId: agent.id, cohortData: 'Entrevista simulada: viernes 4 p.m.' })).json;
    const camper = await camperClient(env, admin, 'luis.diaz', group.id);
    assert.strictEqual((await camper.get('/api/me')).json.agent.name, 'Zevrin');
    const id = (await camper.post('/api/conversations')).json.id;
    await camper.post('/api/conversations/' + id + '/messages', { content: 'hola' });
    const system = env.fetchMock.calls[0].body.messages[0].content;
    assert.match(system, /Eres Zevrin/);
    assert.match(system, /Entrevista simulada: viernes 4 p.m./);
    assert.doesNotMatch(system, /lunes a viernes de 8:00/);
});

test('grupos: validaciones de nombre único y límite', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    assert.strictEqual((await admin.post('/api/admin/groups', { name: 'Grupo demo' })).status, 409);
    assert.strictEqual((await admin.put('/api/admin/groups/1', { dailyLimit: -3 })).status, 400);
    assert.strictEqual((await admin.put('/api/admin/groups/1', { agentId: 999 })).status, 400);
    assert.strictEqual((await admin.put('/api/admin/groups/1', { cohortData: 'x'.repeat(5001) })).status, 400);
    assert.strictEqual((await admin.put('/api/admin/groups/1', { dailyLimit: 10, suggestions: 'Pregunta 1\nPregunta 2' })).status, 200);
    const camper = await camperClient(env, admin, 'ana.perez', 1);
    assert.deepStrictEqual((await camper.get('/api/me')).json.suggestions, ['Pregunta 1', 'Pregunta 2']);
});

test('consumo: cuenta mensajes y estima costo; presupuesto dispara alerta', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const camper = await camperClient(env, admin, 'ana.perez', 1);
    const id = (await camper.post('/api/conversations')).json.id;
    await camper.post('/api/conversations/' + id + '/messages', { content: 'uno' });
    await camper.post('/api/conversations/' + id + '/messages', { content: 'dos' });
    assert.strictEqual((await admin.put('/api/admin/settings', { defaultDailyLimit: 40, monthlyBudgetUsd: 0.00005 })).status, 200);
    const u = (await admin.get('/api/admin/usage?days=7')).json;
    const row = u.users.find((x) => x.username === 'ana.perez');
    assert.strictEqual(row.messages, 2);
    assert.strictEqual(row.promptTokens, 200);
    assert.strictEqual(row.completionTokens, 40);
    assert.ok(row.cost > 0);
    assert.strictEqual(u.month.alert, true);
    assert.strictEqual((await admin.put('/api/admin/settings', { defaultDailyLimit: 'mucho', monthlyBudgetUsd: 5 })).status, 400);
});

test('revisión de conversaciones: el administrador las lee y queda registrado', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const camper = await camperClient(env, admin, 'ana.perez', 1);
    const id = (await camper.post('/api/conversations')).json.id;
    await camper.post('/api/conversations/' + id + '/messages', { content: 'mi duda' });
    const list = (await admin.get('/api/admin/conversations')).json.conversations;
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].username, 'ana.perez');
    const detail = (await admin.get('/api/admin/conversations/' + id)).json;
    assert.strictEqual(detail.messages[0].content, 'mi duda');
    const audit = (await admin.get('/api/admin/audit')).json.entries;
    assert.ok(audit.some((e) => e.action === 'conversation.review' && /ana\.perez/.test(e.detail)));
    assert.ok(audit.some((e) => e.action === 'user.create'));
});

test('prueba rápida de una ficha sin guardar y sin crear conversaciones', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const admin = await adminClient(env);
    const r = await admin.post('/api/admin/test', { ficha: P.DEFAULT_FICHA, question: '¿Qué es una variable?', groupId: 1 });
    assert.strictEqual(r.status, 200);
    assert.match(r.text, /Hola /);
    assert.strictEqual((await admin.get('/api/conversations')).json.conversations.length, 0);
    assert.strictEqual((await admin.post('/api/admin/test', { ficha: { nombre: 'x' }, question: 'hola' })).status, 400);
});

test('archivos estáticos: se sirve la app y se bloquea salir de la carpeta pública', async (t) => {
    const env = await start(); t.after(() => env.app.close());
    const c = env.client();
    const home = await c.get('/');
    assert.strictEqual(home.status, 200);
    assert.match(home.text, /ChatBot MJ/);
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    assert.strictEqual((await c.get('/shared/prompt.js')).status, 200);
    assert.notStrictEqual((await c.get('/..%2F..%2Fpackage.json')).status, 200);
    assert.notStrictEqual((await c.get('/../server/app.js')).status, 200);
    assert.strictEqual((await c.get('/no-existe.html')).status, 404);
});
