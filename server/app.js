'use strict';
const http = require('http');
const { getConfig } = require('./config');
const { openDb, now, audit, getSetting, setSetting } = require('./db');
const A = require('./auth');
const C = require('./chat');
const H = require('./http');
const PromptLib = require('../public/shared/prompt.js');

class HttpError extends Error {
    constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
function must(cond, status, message) { if (!cond) throw new HttpError(status, message); }

const DEMO_COHORT = [
    'Horarios de clases para los estudiantes: lunes a viernes de 8:00 a.m. a 12:00 m. (teoría) y de 2:00 p.m. a 5:00 p.m. (práctica en laboratorio)',
    'Tema que será impartido: JavaScript: funciones, arreglos y manejo del DOM',
    'Fechas de entrega para proyectos: [COMPLETAR fechas]',
    'Fechas de pruebas de conocimiento: [COMPLETAR fechas]'
].join('\n');

/* ---------- Datos iniciales: primer administrador, agente y grupo de ejemplo ---------- */
function bootstrap(db, cfg) {
    if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return null;
    const t = now();
    const ficha = JSON.stringify(PromptLib.DEFAULT_FICHA);
    const agent = db.prepare('INSERT INTO agents (name, ficha, version, updated_at) VALUES (?, ?, 1, ?)').run(PromptLib.DEFAULT_FICHA.nombre, ficha, t);
    db.prepare('INSERT INTO agent_versions (agent_id, version, ficha, created_at, note) VALUES (?, 1, ?, ?, ?)').run(Number(agent.lastInsertRowid), ficha, t, 'Versión inicial');
    db.prepare('INSERT INTO groups (name, agent_id, cohort_data, suggestions) VALUES (?, ?, ?, ?)')
        .run('Grupo demo', Number(agent.lastInsertRowid), DEMO_COHORT, '');
    const generated = !cfg.adminPassword;
    const password = cfg.adminPassword || A.tempPassword();
    db.prepare('INSERT INTO users (username, name, role, pass_hash, active, must_change, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)')
        .run(cfg.adminUser, 'Administrador', 'admin', A.hashPassword(password), t);
    audit(db, null, 'bootstrap', 'Se creó el primer administrador: ' + cfg.adminUser);
    return { username: cfg.adminUser, password: password, generated: generated };
}

function slugName(name, db) {
    const plain = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/);
    let base = plain.length > 1 ? plain[0] + '.' + plain[plain.length >= 4 ? plain.length - 2 : plain.length - 1] : (plain[0] || 'usuario');
    base = base.slice(0, 28);
    let candidate = base;
    let n = 2;
    while (db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate)) { candidate = base + n; n++; }
    return candidate;
}

function userRowOut(u) {
    return {
        id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active,
        groupId: u.group_id, groupName: u.group_name || '', lastLogin: u.last_login, createdAt: u.created_at,
        mustChange: !!u.must_change, today: u.today || 0
    };
}

function createApp(overrides) {
    const cfg = getConfig(overrides);
    const db = openDb(cfg.dbPath);
    const boot = bootstrap(db, cfg);
    const loginAllowed = A.createIpLimiter(20, 10 * 60000);
    const routes = [];

    const route = function (method, pattern, access, handler) {
        const names = [];
        const re = new RegExp('^' + pattern.replace(/:([a-z]+)/g, function (m, n) { names.push(n); return '([^/]+)'; }) + '$');
        routes.push({ method: method, re: re, names: names, access: access, handler: handler });
    };

    const admins = function () { return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n; };
    const cookie = function (token, maxAge) {
        return 'sid=' + token + '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + maxAge + (cfg.secureCookies ? '; Secure' : '');
    };
    const ownedConv = function (id, user) {
        const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(id, user.id);
        must(conv, 404, 'Conversación no encontrada.');
        return conv;
    };

    /* ============================ AUTENTICACIÓN ============================ */
    route('POST', '/api/login', 'none', function (ctx) {
        must(loginAllowed(ctx.ip), 429, 'Demasiados intentos desde este equipo. Espera unos minutos.');
        const r = A.login(db, ctx.body.username, ctx.body.password);
        if (!r.ok) throw new HttpError(r.status, r.error);
        const token = A.createSession(db, r.userId);
        ctx.res.setHeader('Set-Cookie', cookie(token, cfg.sessionMaxHours * 3600));
        audit(db, r.user, 'login', '');
        return { user: r.user };
    });

    route('POST', '/api/logout', 'none', function (ctx) {
        A.destroySession(db, ctx.token);
        ctx.res.setHeader('Set-Cookie', cookie('', 0));
        return { ok: true };
    });

    route('GET', '/api/me', 'user', function (ctx) {
        const u = ctx.user;
        const a = C.agentFor(db, u);
        return {
            user: u,
            agent: { name: a.ficha.nombre, rol: a.ficha.rol },
            suggestions: C.suggestionsFor(db, u),
            usage: { today: C.usageToday(db, u.id), limit: C.dailyLimitFor(db, cfg, u) },
            models: u.role === 'admin' ? C.MODELS : []
        };
    });

    route('POST', '/api/password', 'user', function (ctx) {
        const current = String(ctx.body.current || '');
        const next = String(ctx.body.next || '');
        const row = db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(ctx.user.id);
        must(A.verifyPassword(current, row.pass_hash), 400, 'La contraseña actual no es correcta.');
        const bad = A.validatePassword(next);
        must(!bad, 400, bad);
        must(next !== current, 400, 'La nueva contraseña debe ser distinta a la actual.');
        db.prepare('UPDATE users SET pass_hash = ?, must_change = 0 WHERE id = ?').run(A.hashPassword(next), ctx.user.id);
        A.destroyUserSessions(db, ctx.user.id);
        const token = A.createSession(db, ctx.user.id);
        ctx.res.setHeader('Set-Cookie', cookie(token, cfg.sessionMaxHours * 3600));
        audit(db, ctx.user, 'password.change', '');
        return { ok: true };
    });

    /* ============================ CHAT ============================ */
    route('GET', '/api/conversations', 'user', function (ctx) {
        return { conversations: db.prepare('SELECT id, title, updated_at AS updatedAt FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT 100').all(ctx.user.id) };
    });

    route('POST', '/api/conversations', 'user', function (ctx) {
        const t = now();
        const info = db.prepare('INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(ctx.user.id, 'Nueva conversación', t, t);
        return { id: Number(info.lastInsertRowid), title: 'Nueva conversación' };
    });

    route('GET', '/api/conversations/:id', 'user', function (ctx) {
        const conv = ownedConv(Number(ctx.params.id), ctx.user);
        const messages = db.prepare('SELECT id, role, content, feedback, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id);
        return { id: conv.id, title: conv.title, messages: messages };
    });

    route('PATCH', '/api/conversations/:id', 'user', function (ctx) {
        const conv = ownedConv(Number(ctx.params.id), ctx.user);
        const title = String(ctx.body.title || '').trim().slice(0, 80);
        must(title, 400, 'El título no puede estar vacío.');
        db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, conv.id);
        return { ok: true };
    });

    route('DELETE', '/api/conversations/:id', 'user', function (ctx) {
        const conv = ownedConv(Number(ctx.params.id), ctx.user);
        db.prepare('DELETE FROM conversations WHERE id = ?').run(conv.id);
        return { ok: true };
    });

    route('POST', '/api/conversations/:id/messages', 'user', async function (ctx) {
        const conv = ownedConv(Number(ctx.params.id), ctx.user);
        // Solo el administrador elige modelo; los Campers usan el modelo económico por defecto.
        const model = (ctx.user.role === 'admin' && C.MODELS.indexOf(ctx.body.model) !== -1) ? ctx.body.model : C.DEFAULT_MODEL;
        let content = String(ctx.body.content || '').trim();

        if (ctx.body.retry) {
            const last = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 1').get(conv.id);
            must(last && last.role === 'user', 400, 'No hay nada que reintentar.');
            content = last.content;
        } else {
            must(content, 400, 'Escribe un mensaje.');
            must(content.length <= cfg.maxInputChars, 400, 'Tu mensaje es muy largo (máximo ' + cfg.maxInputChars + ' caracteres).');
            const limit = C.dailyLimitFor(db, cfg, ctx.user);
            if (limit != null && C.usageToday(db, ctx.user.id) >= limit) {
                throw new HttpError(429, 'Llegaste a tu límite de ' + limit + ' mensajes de hoy. Vuelve mañana o pide más al administrador.', { code: 'limit' });
            }
            const count = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ?').get(conv.id).n;
            db.prepare('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)').run(conv.id, 'user', content, now());
            if (count === 0) db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(content.replace(/\s+/g, ' ').slice(0, 50), conv.id);
            db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conv.id);
        }

        const r = await C.streamCompletion({
            cfg: cfg, res: ctx.res, model: model,
            messages: C.buildUpstreamMessages(db, cfg, conv.id, C.systemPromptFor(db, cfg, ctx.user)),
            maxTokens: C.tokenBudget(content, cfg)
        });
        if (r.fail) throw new HttpError(r.fail.status, r.fail.error, { code: 'upstream' });
        if (r.aborted && !r.text) { ctx.res.end(); return; }
        if (!r.text) {
            r.emit({ error: r.streamError || 'El servicio de IA no devolvió respuesta. Inténtalo de nuevo.' });
            ctx.res.end();
            return;
        }
        const saved = C.saveAssistant(db, conv.id, model, r);
        r.emit({
            done: true, truncated: r.truncated, messageId: saved.id, warning: r.streamError || undefined,
            usage: { today: C.usageToday(db, ctx.user.id), limit: C.dailyLimitFor(db, cfg, ctx.user) }
        });
        ctx.res.end();
    });

    route('POST', '/api/messages/:id/feedback', 'user', function (ctx) {
        const value = Number(ctx.body.value);
        must(value === 1 || value === -1 || value === 0, 400, 'Valoración no válida.');
        const msg = db.prepare("SELECT m.id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ? AND c.user_id = ? AND m.role = 'assistant'").get(Number(ctx.params.id), ctx.user.id);
        must(msg, 404, 'Mensaje no encontrado.');
        db.prepare('UPDATE messages SET feedback = ? WHERE id = ?').run(value, msg.id);
        return { ok: true };
    });

    /* ============================ ADMINISTRACIÓN: USUARIOS ============================ */
    const USER_SELECT = "SELECT u.*, g.name AS group_name, (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = u.id AND m.role = 'user' AND m.created_at >= ?) AS today FROM users u LEFT JOIN groups g ON g.id = u.group_id";

    route('GET', '/api/admin/users', 'admin', function () {
        return { users: db.prepare(USER_SELECT + ' ORDER BY u.role, u.name').all(C.utcDayStart()).map(userRowOut) };
    });

    const checkGroup = function (id) {
        if (id == null || id === '') return null;
        must(db.prepare('SELECT 1 FROM groups WHERE id = ?').get(Number(id)), 400, 'El grupo no existe.');
        return Number(id);
    };

    route('POST', '/api/admin/users', 'admin', function (ctx) {
        const name = String(ctx.body.name || '').trim();
        const username = String(ctx.body.username || '').trim();
        const role = ctx.body.role === 'admin' ? 'admin' : 'camper';
        must(name && name.length <= 80, 400, 'El nombre es obligatorio (máximo 80 caracteres).');
        must(/^[a-z0-9._-]{3,32}$/i.test(username), 400, 'El usuario debe tener 3 a 32 caracteres: letras, números, punto, guion.');
        must(!db.prepare('SELECT 1 FROM users WHERE username = ?').get(username), 409, 'Ya existe un usuario con ese nombre de usuario.');
        const groupId = checkGroup(ctx.body.groupId);
        const temp = A.tempPassword();
        const info = db.prepare('INSERT INTO users (username, name, role, pass_hash, active, must_change, group_id, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)')
            .run(username, name, role, A.hashPassword(temp), groupId, now());
        audit(db, ctx.user, 'user.create', username + ' (' + role + ')');
        return { id: Number(info.lastInsertRowid), username: username, tempPassword: temp };
    });

    route('POST', '/api/admin/users/import', 'admin', function (ctx) {
        const groupId = checkGroup(ctx.body.groupId);
        const lines = String(ctx.body.csv || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean).slice(0, 300);
        must(lines.length, 400, 'Pega al menos una línea: Nombre,usuario');
        const created = [];
        const errors = [];
        lines.forEach(function (line, i) {
            const cols = line.split(/[,;\t]/).map(function (c) { return c.trim(); });
            if (i === 0 && /^(nombre|name)$/i.test(cols[0])) return; // encabezado
            const name = cols[0];
            if (!name || name.length > 80) { errors.push('Línea ' + (i + 1) + ': nombre vacío o muy largo.'); return; }
            let username = cols[1] || slugName(name, db);
            if (!/^[a-z0-9._-]{3,32}$/i.test(username)) { errors.push('Línea ' + (i + 1) + ': usuario no válido (' + username + ').'); return; }
            if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) { errors.push('Línea ' + (i + 1) + ': el usuario ' + username + ' ya existe.'); return; }
            const temp = A.tempPassword();
            db.prepare('INSERT INTO users (username, name, role, pass_hash, active, must_change, group_id, created_at) VALUES (?, ?, ?, ?, 1, 1, ?, ?)')
                .run(username, name, 'camper', A.hashPassword(temp), groupId, now());
            created.push({ name: name, username: username, tempPassword: temp });
        });
        audit(db, ctx.user, 'user.import', created.length + ' cuentas creadas, ' + errors.length + ' errores');
        return { created: created, errors: errors };
    });

    route('PATCH', '/api/admin/users/:id', 'admin', function (ctx) {
        const id = Number(ctx.params.id);
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        must(target, 404, 'Usuario no encontrado.');
        const b = ctx.body;
        const name = b.name !== undefined ? String(b.name).trim() : target.name;
        const role = b.role !== undefined ? (b.role === 'admin' ? 'admin' : 'camper') : target.role;
        const active = b.active !== undefined ? (b.active ? 1 : 0) : target.active;
        const groupId = b.groupId !== undefined ? checkGroup(b.groupId) : target.group_id;
        must(name && name.length <= 80, 400, 'El nombre es obligatorio.');
        if (id === ctx.user.id) must(active === 1 && role === 'admin', 400, 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo.');
        if (target.role === 'admin' && target.active && (role !== 'admin' || !active)) must(admins() > 1, 400, 'Debe quedar al menos un administrador activo.');
        db.prepare('UPDATE users SET name = ?, role = ?, active = ?, group_id = ? WHERE id = ?').run(name, role, active, groupId, id);
        if (!active) A.destroyUserSessions(db, id);
        const changes = [];
        if (active !== target.active) changes.push(active ? 'reactivado' : 'desactivado');
        if (role !== target.role) changes.push('rol ' + role);
        if (groupId !== target.group_id) changes.push('grupo ' + groupId);
        audit(db, ctx.user, 'user.update', target.username + (changes.length ? ': ' + changes.join(', ') : ''));
        return { ok: true };
    });

    route('POST', '/api/admin/users/:id/reset', 'admin', function (ctx) {
        const id = Number(ctx.params.id);
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        must(target, 404, 'Usuario no encontrado.');
        const temp = A.tempPassword();
        db.prepare('UPDATE users SET pass_hash = ?, must_change = 1, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(A.hashPassword(temp), id);
        A.destroyUserSessions(db, id);
        audit(db, ctx.user, 'user.reset', target.username);
        return { username: target.username, tempPassword: temp };
    });

    route('DELETE', '/api/admin/users/:id', 'admin', function (ctx) {
        const id = Number(ctx.params.id);
        const target = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
        must(target, 404, 'Usuario no encontrado.');
        must(id !== ctx.user.id, 400, 'No puedes eliminar tu propia cuenta.');
        if (target.role === 'admin' && target.active) must(admins() > 1, 400, 'Debe quedar al menos un administrador activo.');
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        audit(db, ctx.user, 'user.delete', target.username);
        return { ok: true };
    });

    /* ============================ ADMINISTRACIÓN: GRUPOS ============================ */
    const groupOut = function (g) {
        return { id: g.id, name: g.name, agentId: g.agent_id, cohortData: g.cohort_data, suggestions: g.suggestions, dailyLimit: g.daily_limit, members: g.members };
    };
    const parseGroupBody = function (b, base) {
        const name = b.name !== undefined ? String(b.name).trim() : base.name;
        must(name && name.length <= 60, 400, 'El nombre del grupo es obligatorio (máximo 60 caracteres).');
        const cohort = b.cohortData !== undefined ? String(b.cohortData) : base.cohort_data;
        const sug = b.suggestions !== undefined ? String(b.suggestions) : base.suggestions;
        must(cohort.length <= 5000, 400, 'Los datos del grupo superan 5000 caracteres.');
        must(sug.length <= 1000, 400, 'Las sugerencias superan 1000 caracteres.');
        let agentId = b.agentId !== undefined ? b.agentId : base.agent_id;
        if (agentId === '' || agentId === undefined) agentId = null;
        if (agentId !== null) must(db.prepare('SELECT 1 FROM agents WHERE id = ?').get(Number(agentId)), 400, 'El agente no existe.');
        let limit = b.dailyLimit !== undefined ? b.dailyLimit : base.daily_limit;
        if (limit === '' || limit === undefined) limit = null;
        if (limit !== null) { limit = Number(limit); must(Number.isInteger(limit) && limit >= 0 && limit <= 10000, 400, 'El límite diario debe ser un entero entre 0 y 10000.'); }
        return { name: name, cohort: cohort, sug: sug, agentId: agentId === null ? null : Number(agentId), limit: limit };
    };

    route('GET', '/api/admin/groups', 'admin', function () {
        return { groups: db.prepare('SELECT g.*, (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id) AS members FROM groups g ORDER BY g.name').all().map(groupOut) };
    });

    route('POST', '/api/admin/groups', 'admin', function (ctx) {
        const g = parseGroupBody(ctx.body, { name: '', cohort_data: '', suggestions: '', agent_id: null, daily_limit: null });
        must(!db.prepare('SELECT 1 FROM groups WHERE name = ?').get(g.name), 409, 'Ya existe un grupo con ese nombre.');
        const info = db.prepare('INSERT INTO groups (name, agent_id, cohort_data, suggestions, daily_limit) VALUES (?, ?, ?, ?, ?)').run(g.name, g.agentId, g.cohort, g.sug, g.limit);
        audit(db, ctx.user, 'group.create', g.name);
        return { id: Number(info.lastInsertRowid) };
    });

    route('PUT', '/api/admin/groups/:id', 'admin', function (ctx) {
        const id = Number(ctx.params.id);
        const base = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
        must(base, 404, 'Grupo no encontrado.');
        const g = parseGroupBody(ctx.body, base);
        const dup = db.prepare('SELECT id FROM groups WHERE name = ? AND id <> ?').get(g.name, id);
        must(!dup, 409, 'Ya existe un grupo con ese nombre.');
        db.prepare('UPDATE groups SET name = ?, agent_id = ?, cohort_data = ?, suggestions = ?, daily_limit = ? WHERE id = ?').run(g.name, g.agentId, g.cohort, g.sug, g.limit, id);
        audit(db, ctx.user, 'group.update', g.name);
        return { ok: true };
    });

    route('DELETE', '/api/admin/groups/:id', 'admin', function (ctx) {
        const id = Number(ctx.params.id);
        const g = db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
        must(g, 404, 'Grupo no encontrado.');
        db.prepare('DELETE FROM groups WHERE id = ?').run(id);
        audit(db, ctx.user, 'group.delete', g.name);
        return { ok: true };
    });

    /* ============================ ADMINISTRACIÓN: AGENTES (FICHAS) ============================ */
    route('GET', '/api/admin/agents', 'admin', function () {
        return { agents: db.prepare('SELECT a.id, a.name, a.version, a.updated_at AS updatedAt, (SELECT COUNT(*) FROM groups g WHERE g.agent_id = a.id) AS groups FROM agents a ORDER BY a.name').all() };
    });

    route('GET', '/api/admin/agents/:id', 'admin', function (ctx) {
        const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(ctx.params.id));
        must(a, 404, 'Agente no encontrado.');
        const versions = db.prepare('SELECT v.version, v.created_at AS createdAt, v.note, u.username AS by FROM agent_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.agent_id = ? ORDER BY v.version DESC').all(a.id);
        return { id: a.id, name: a.name, version: a.version, ficha: JSON.parse(a.ficha), versions: versions };
    });

    route('POST', '/api/admin/agents', 'admin', function (ctx) {
        const v = PromptLib.validateFicha(ctx.body.ficha);
        must(v.ok, 400, v.error);
        const t = now();
        const json = JSON.stringify(v.value);
        const info = db.prepare('INSERT INTO agents (name, ficha, version, updated_at, updated_by) VALUES (?, ?, 1, ?, ?)').run(v.value.nombre.trim(), json, t, ctx.user.id);
        const id = Number(info.lastInsertRowid);
        db.prepare('INSERT INTO agent_versions (agent_id, version, ficha, created_at, created_by, note) VALUES (?, 1, ?, ?, ?, ?)').run(id, json, t, ctx.user.id, String(ctx.body.note || 'Versión inicial').slice(0, 120));
        audit(db, ctx.user, 'agent.create', v.value.nombre);
        return { id: id, version: 1 };
    });

    route('PUT', '/api/admin/agents/:id', 'admin', function (ctx) {
        const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(ctx.params.id));
        must(a, 404, 'Agente no encontrado.');
        const v = PromptLib.validateFicha(ctx.body.ficha);
        must(v.ok, 400, v.error);
        const t = now();
        const json = JSON.stringify(v.value);
        const version = a.version + 1;
        db.prepare('UPDATE agents SET name = ?, ficha = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(v.value.nombre.trim(), json, version, t, ctx.user.id, a.id);
        db.prepare('INSERT INTO agent_versions (agent_id, version, ficha, created_at, created_by, note) VALUES (?, ?, ?, ?, ?, ?)').run(a.id, version, json, t, ctx.user.id, String(ctx.body.note || '').slice(0, 120));
        audit(db, ctx.user, 'agent.update', v.value.nombre + ' v' + version);
        return { id: a.id, version: version };
    });

    route('POST', '/api/admin/agents/:id/restore', 'admin', function (ctx) {
        const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(ctx.params.id));
        must(a, 404, 'Agente no encontrado.');
        const old = db.prepare('SELECT * FROM agent_versions WHERE agent_id = ? AND version = ?').get(a.id, Number(ctx.body.version));
        must(old, 404, 'Esa versión no existe.');
        const t = now();
        const version = a.version + 1;
        const f = JSON.parse(old.ficha);
        db.prepare('UPDATE agents SET name = ?, ficha = ?, version = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(f.nombre, old.ficha, version, t, ctx.user.id, a.id);
        db.prepare('INSERT INTO agent_versions (agent_id, version, ficha, created_at, created_by, note) VALUES (?, ?, ?, ?, ?, ?)').run(a.id, version, old.ficha, t, ctx.user.id, 'Restaurada desde la v' + old.version);
        audit(db, ctx.user, 'agent.restore', f.nombre + ' v' + old.version + ' → v' + version);
        return { id: a.id, version: version, ficha: f };
    });

    route('DELETE', '/api/admin/agents/:id', 'admin', function (ctx) {
        const a = db.prepare('SELECT * FROM agents WHERE id = ?').get(Number(ctx.params.id));
        must(a, 404, 'Agente no encontrado.');
        db.prepare('DELETE FROM agents WHERE id = ?').run(a.id);
        audit(db, ctx.user, 'agent.delete', a.name);
        return { ok: true };
    });

    // Prueba rápida de una ficha sin guardarla (no crea conversaciones).
    route('POST', '/api/admin/test', 'admin', async function (ctx) {
        const v = PromptLib.validateFicha(ctx.body.ficha);
        must(v.ok, 400, v.error);
        const question = String(ctx.body.question || '').trim();
        must(question && question.length <= cfg.maxInputChars, 400, 'Escribe una pregunta de prueba (máximo ' + cfg.maxInputChars + ' caracteres).');
        const group = ctx.body.groupId ? db.prepare('SELECT cohort_data FROM groups WHERE id = ?').get(Number(ctx.body.groupId)) : null;
        const model = C.MODELS.indexOf(ctx.body.model) !== -1 ? ctx.body.model : C.DEFAULT_MODEL;
        const r = await C.streamCompletion({
            cfg: cfg, res: ctx.res, model: model, maxTokens: C.tokenBudget(question, cfg),
            messages: [
                { role: 'system', content: PromptLib.buildPrompt(v.value, { extraDomain: group ? group.cohort_data : '', today: C.todayText(cfg) }) },
                { role: 'user', content: question }
            ]
        });
        if (r.fail) throw new HttpError(r.fail.status, r.fail.error, { code: 'upstream' });
        if (r.aborted) { ctx.res.end(); return; }
        r.emit({ done: true, truncated: r.truncated, warning: r.streamError || undefined });
        ctx.res.end();
    });

    /* ============================ ADMINISTRACIÓN: AJUSTES, CONSUMO, REVISIÓN, ACTIVIDAD ============================ */
    route('GET', '/api/admin/settings', 'admin', function () {
        return {
            defaultDailyLimit: Number(getSetting(db, 'default_daily_limit', cfg.defaultDailyLimit)),
            monthlyBudgetUsd: Number(getSetting(db, 'monthly_budget_usd', 0)),
            apiKeyConfigured: !!cfg.openaiKey
        };
    });

    route('PUT', '/api/admin/settings', 'admin', function (ctx) {
        const limit = Number(ctx.body.defaultDailyLimit);
        const budget = Number(ctx.body.monthlyBudgetUsd);
        must(Number.isInteger(limit) && limit >= 0 && limit <= 10000, 400, 'El límite diario debe ser un entero entre 0 y 10000.');
        must(Number.isFinite(budget) && budget >= 0 && budget <= 100000, 400, 'El presupuesto mensual debe ser un número válido.');
        setSetting(db, 'default_daily_limit', limit);
        setSetting(db, 'monthly_budget_usd', budget);
        audit(db, ctx.user, 'settings.update', 'límite diario ' + limit + ', presupuesto mensual ' + budget);
        return { ok: true };
    });

    const costRows = function (since) {
        return db.prepare("SELECT c.user_id AS userId, m.model AS model, SUM(m.prompt_tokens) AS pt, SUM(m.completion_tokens) AS ct FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'assistant' AND m.created_at >= ? GROUP BY c.user_id, m.model").all(since);
    };

    route('GET', '/api/admin/usage', 'admin', function (ctx) {
        const days = Math.min(Math.max(Number(ctx.query.get('days')) || 30, 1), 365);
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const perUser = {};
        db.prepare("SELECT c.user_id AS userId, COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.role = 'user' AND m.created_at >= ? GROUP BY c.user_id").all(since)
            .forEach(function (r) { perUser[r.userId] = { messages: r.n, promptTokens: 0, completionTokens: 0, cost: 0 }; });
        let total = 0;
        costRows(since).forEach(function (r) {
            const e = perUser[r.userId] || (perUser[r.userId] = { messages: 0, promptTokens: 0, completionTokens: 0, cost: 0 });
            const cost = C.estimateCost(r.model, r.pt, r.ct);
            e.promptTokens += r.pt; e.completionTokens += r.ct; e.cost += cost; total += cost;
        });
        const users = db.prepare('SELECT u.id, u.username, u.name, g.name AS groupName FROM users u LEFT JOIN groups g ON g.id = u.group_id').all()
            .map(function (u) { return Object.assign({ id: u.id, username: u.username, name: u.name, groupName: u.groupName || '' }, perUser[u.id] || { messages: 0, promptTokens: 0, completionTokens: 0, cost: 0 }); })
            .filter(function (u) { return u.messages > 0 || u.cost > 0; })
            .sort(function (a, b) { return b.messages - a.messages; });
        const daily = db.prepare("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS messages FROM messages WHERE role = 'user' AND created_at >= ? GROUP BY day ORDER BY day").all(new Date(Date.now() - 13 * 86400000).toISOString());
        let monthCost = 0;
        costRows(C.utcMonthStart()).forEach(function (r) { monthCost += C.estimateCost(r.model, r.pt, r.ct); });
        const budget = Number(getSetting(db, 'monthly_budget_usd', 0));
        return {
            days: days, users: users, daily: daily, totalCost: total,
            month: { cost: monthCost, budget: budget, percent: budget > 0 ? Math.round(monthCost / budget * 100) : null, alert: budget > 0 && monthCost >= budget * 0.8 },
            note: 'Costos estimados con precios aproximados por modelo; confirma el gasto real en tu cuenta de OpenAI.'
        };
    });

    route('GET', '/api/admin/conversations', 'admin', function (ctx) {
        const userId = Number(ctx.query.get('userId')) || null;
        const sql = "SELECT c.id, c.title, c.updated_at AS updatedAt, u.name AS userName, u.username, " +
            "(SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS messages, " +
            "(SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.feedback = -1) AS negative " +
            "FROM conversations c JOIN users u ON u.id = c.user_id " +
            (userId ? 'WHERE c.user_id = ? ' : '') + 'ORDER BY c.updated_at DESC LIMIT 200';
        const stmt = db.prepare(sql);
        return { conversations: userId ? stmt.all(userId) : stmt.all() };
    });

    route('GET', '/api/admin/conversations/:id', 'admin', function (ctx) {
        const conv = db.prepare('SELECT c.id, c.title, u.name AS userName, u.username FROM conversations c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(Number(ctx.params.id));
        must(conv, 404, 'Conversación no encontrada.');
        const messages = db.prepare('SELECT id, role, content, feedback, created_at AS createdAt FROM messages WHERE conversation_id = ? ORDER BY id').all(conv.id);
        audit(db, ctx.user, 'conversation.review', conv.username + ' #' + conv.id);
        return { id: conv.id, title: conv.title, userName: conv.userName, username: conv.username, messages: messages };
    });

    route('GET', '/api/admin/audit', 'admin', function (ctx) {
        const limit = Math.min(Math.max(Number(ctx.query.get('limit')) || 100, 1), 500);
        return { entries: db.prepare('SELECT id, at, actor, action, detail FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) };
    });

    /* ============================ SERVIDOR HTTP ============================ */
    const PASSWORD_EXEMPT = ['/api/me', '/api/logout', '/api/password'];

    const server = http.createServer(async function (req, res) {
        H.securityHeaders(res);
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname;

        if (pathname.indexOf('/api/') !== 0) {
            if (req.method === 'GET' || req.method === 'HEAD') return H.serveStatic(cfg, req, res, pathname);
            res.writeHead(405); res.end(); return;
        }

        try {
            // Defensa CSRF: las escrituras solo se aceptan desde nuestro propio origen.
            if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers.origin) {
                let same = false;
                try { same = new URL(req.headers.origin).host === req.headers.host; } catch (e) { same = false; }
                must(same, 403, 'Origen no permitido.');
            }

            let match = null;
            let allowedOther = false;
            for (let i = 0; i < routes.length; i++) {
                const m = routes[i].re.exec(pathname);
                if (m && routes[i].method === req.method) { match = { r: routes[i], m: m }; break; }
                if (m) allowedOther = true;
            }
            if (!match) throw new HttpError(allowedOther ? 405 : 404, allowedOther ? 'Método no permitido.' : 'No encontrado.');

            const token = H.parseCookies(req.headers.cookie).sid || '';
            const user = A.getSessionUser(db, token, cfg);
            if (match.r.access !== 'none' && !user) throw new HttpError(401, 'Tu sesión caducó. Inicia sesión de nuevo.', { code: 'auth' });
            if (match.r.access === 'admin' && user.role !== 'admin') throw new HttpError(403, 'Solo el administrador puede hacer esto.');
            if (user && user.mustChange && PASSWORD_EXEMPT.indexOf(pathname) === -1 && match.r.access !== 'none') {
                throw new HttpError(403, 'Debes cambiar tu contraseña antes de continuar.', { code: 'must_change' });
            }

            const params = {};
            match.r.names.forEach(function (n, i) { params[n] = decodeURIComponent(match.m[i + 1]); });
            const body = (req.method === 'GET' || req.method === 'HEAD' || req.method === 'DELETE') ? {} : await H.readJson(req);

            const result = await match.r.handler({
                req: req, res: res, db: db, cfg: cfg, user: user, token: token, params: params,
                query: url.searchParams, body: body, ip: req.socket.remoteAddress || ''
            });
            if (res.headersSent || res.writableEnded) return;
            H.sendJson(res, 200, result === undefined ? { ok: true } : result);
        } catch (e) {
            if (res.headersSent) { try { res.end(); } catch (x) { /* ya cerrada */ } return; }
            const status = e.status || 500;
            if (status === 500) console.error('Error interno:', e);
            H.sendJson(res, status, Object.assign({ error: status === 500 ? 'Error interno del servidor.' : e.message }, e.extra || {}));
        }
    });

    return {
        server: server, db: db, cfg: cfg, boot: boot,
        close: function () { return new Promise(function (resolve) { server.close(function () { try { db.close(); } catch (e) { /* ya cerrada */ } resolve(); }); if (server.closeAllConnections) server.closeAllConnections(); }); }
    };
}

module.exports = { createApp };
