'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

// Carga un archivo .env simple (CLAVE=valor) sin pisar variables ya definidas.
function loadEnv(file) {
    if (!fs.existsSync(file)) return;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(function (line) {
        const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
        if (!m || line.trim().startsWith('#')) return;
        const v = m[2].replace(/^["']|["']$/g, '');
        if (process.env[m[1]] === undefined) process.env[m[1]] = v;
    });
}

// Devuelve la configuración. `overrides` permite cambiarla en las pruebas.
function getConfig(overrides) {
    loadEnv(path.join(root, '.env'));
    const env = process.env;
    return Object.assign({
        root: root,
        publicDir: path.join(root, 'public'),
        port: Number(env.PORT) || 3000,
        dbPath: env.DB_PATH || path.join(root, 'data', 'app.db'),
        openaiKey: env.OPENAI_API_KEY || '',
        openaiUrl: env.OPENAI_URL || 'https://api.openai.com/v1/chat/completions',
        secureCookies: env.COOKIE_SECURE === '1',
        timezone: env.APP_TIMEZONE || 'America/Bogota',
        defaultDailyLimit: Number(env.DEFAULT_DAILY_LIMIT) || 40,
        sessionIdleMinutes: Number(env.SESSION_IDLE_MINUTES) || 120,
        sessionMaxHours: Number(env.SESSION_MAX_HOURS) || 12,
        adminUser: env.ADMIN_USER || 'admin',
        adminPassword: env.ADMIN_PASSWORD || '',
        maxInputChars: 1000,
        historyMessages: 16,
        tokensShort: 200,
        tokensCode: 450,
        fetch: null // se rellena con fetch global; se puede inyectar en pruebas
    }, overrides || {});
}

module.exports = { getConfig };
