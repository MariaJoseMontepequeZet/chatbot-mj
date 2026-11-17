'use strict';
const crypto = require('crypto');
const { now } = require('./db');

const SCRYPT = { N: 16384, r: 8, p: 1 };
const MAX_FAILS = 5;
const LOCK_MINUTES = 10;

/* ---------- Contraseñas (scrypt con sal; nunca se guardan en texto) ---------- */
function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
    return 'scrypt$' + salt.toString('hex') + '$' + hash.toString('hex');
}

function verifyPassword(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
    const salt = Buffer.from(parts[1], 'hex');
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length, SCRYPT);
    return crypto.timingSafeEqual(actual, expected);
}

const DUMMY_HASH = hashPassword('no-existe-' + crypto.randomBytes(8).toString('hex'));

function validatePassword(pw) {
    if (typeof pw !== 'string' || pw.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (pw.length > 128) return 'La contraseña es demasiado larga.';
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Usa letras y números en la contraseña.';
    return '';
}

// Contraseña temporal legible (sin caracteres ambiguos como 0/O o 1/l).
function tempPassword() {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
    const digits = '23456789';
    const all = letters + digits;
    const pick = function (set) { return set[crypto.randomInt(set.length)]; };
    const chars = [pick(letters), pick(digits)];
    while (chars.length < 10) chars.push(pick(all));
    for (let i = chars.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        const t = chars[i]; chars[i] = chars[j]; chars[j] = t;
    }
    return chars.join('');
}

/* ---------- Sesiones (el token viaja en cookie httpOnly; en la base solo su hash) ---------- */
const sha = function (s) { return crypto.createHash('sha256').update(s).digest('hex'); };

function createSession(db, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    const t = now();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
        .run(sha(token), userId, t, t);
    return token;
}

function destroySession(db, token) {
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
}

function destroyUserSessions(db, userId) {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

function getSessionUser(db, token, cfg) {
    if (!token) return null;
    const row = db.prepare(
        'SELECT s.token_hash, s.created_at AS s_created, s.last_seen, u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
    ).get(sha(token));
    if (!row) return null;
    const nowMs = Date.now();
    const idle = nowMs - Date.parse(row.last_seen) > cfg.sessionIdleMinutes * 60000;
    const old = nowMs - Date.parse(row.s_created) > cfg.sessionMaxHours * 3600000;
    if (idle || old || !row.active) {
        destroySession(db, token);
        return null;
    }
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), row.token_hash);
    return publicUser(row);
}

function publicUser(u) {
    return {
        id: u.id,
        username: u.username,
        name: u.name,
        role: u.role,
        groupId: u.group_id,
        mustChange: !!u.must_change
    };
}

/* ---------- Inicio de sesión con bloqueo por intentos fallidos ---------- */
function login(db, username, password) {
    const GENERIC = { ok: false, status: 401, error: 'Usuario o contraseña incorrectos.' };
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());

    if (!user) {
        verifyPassword(String(password || ''), DUMMY_HASH); // mismo costo, para no revelar si existe
        return GENERIC;
    }
    if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
        const mins = Math.ceil((Date.parse(user.locked_until) - Date.now()) / 60000);
        return { ok: false, status: 429, error: 'Demasiados intentos. Espera ' + mins + ' min e inténtalo de nuevo.' };
    }
    if (!verifyPassword(String(password || ''), user.pass_hash)) {
        const fails = user.failed_attempts + 1;
        if (fails >= MAX_FAILS) {
            db.prepare('UPDATE users SET failed_attempts = 0, locked_until = ? WHERE id = ?')
                .run(new Date(Date.now() + LOCK_MINUTES * 60000).toISOString(), user.id);
        } else {
            db.prepare('UPDATE users SET failed_attempts = ? WHERE id = ?').run(fails, user.id);
        }
        return GENERIC;
    }
    if (!user.active) {
        return { ok: false, status: 403, error: 'Tu cuenta está desactivada. Habla con el administrador.' };
    }
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login = ? WHERE id = ?').run(now(), user.id);
    return { ok: true, user: publicUser(user), userId: user.id };
}

/* ---------- Límite de intentos por IP (en memoria) ---------- */
function createIpLimiter(max, windowMs) {
    const hits = new Map();
    return function allow(ip) {
        const t = Date.now();
        const list = (hits.get(ip) || []).filter(function (x) { return t - x < windowMs; });
        if (list.length >= max) { hits.set(ip, list); return false; }
        list.push(t);
        hits.set(ip, list);
        return true;
    };
}

module.exports = {
    hashPassword, verifyPassword, validatePassword, tempPassword,
    createSession, destroySession, destroyUserSessions, getSessionUser, publicUser,
    login, createIpLimiter
};
