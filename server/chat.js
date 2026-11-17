'use strict';
const { now, getSetting } = require('./db');
const PromptLib = require('../public/shared/prompt.js');

const MODELS = ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4o'];
const DEFAULT_MODEL = 'gpt-4o-mini';

// Precios aproximados en USD por millón de tokens (solo para estimar el gasto).
const PRICES = {
    'gpt-4o-mini': { input: 0.15, output: 0.60 },
    'gpt-4.1-mini': { input: 0.40, output: 1.60 },
    'gpt-4o': { input: 2.50, output: 10.00 }
};

function estimateCost(model, promptTokens, completionTokens) {
    const p = PRICES[model] || PRICES[DEFAULT_MODEL];
    return (promptTokens * p.input + completionTokens * p.output) / 1000000;
}

// Más margen de tokens si la pregunta trata de código.
function tokenBudget(text, cfg) {
    const codeHint = /```|c[oó]digo|funci[oó]n|ejemplo|error|bug|script|clase|bucle|array|html|css|javascript|\bjs\b|sql|python/i;
    return codeHint.test(text || '') ? cfg.tokensCode : cfg.tokensShort;
}

function todayText(cfg) {
    try {
        return new Date().toLocaleDateString('es', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: cfg.timezone
        });
    } catch (e) {
        return new Date().toISOString().slice(0, 10);
    }
}

function utcDayStart() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function utcMonthStart() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

function usageToday(db, userId) {
    return db.prepare(
        "SELECT COUNT(*) AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.user_id = ? AND m.role = 'user' AND m.created_at >= ?"
    ).get(userId, utcDayStart()).n;
}

function dailyLimitFor(db, cfg, user) {
    if (user.role === 'admin') return null; // el administrador no tiene límite
    let limit = null;
    if (user.groupId) {
        const g = db.prepare('SELECT daily_limit FROM groups WHERE id = ?').get(user.groupId);
        if (g && g.daily_limit != null) limit = g.daily_limit;
    }
    if (limit == null) limit = Number(getSetting(db, 'default_daily_limit', cfg.defaultDailyLimit));
    return limit;
}

function agentFor(db, user) {
    let group = null;
    let ficha = null;
    if (user.groupId) {
        group = db.prepare('SELECT * FROM groups WHERE id = ?').get(user.groupId);
        if (group && group.agent_id) {
            const a = db.prepare('SELECT ficha FROM agents WHERE id = ?').get(group.agent_id);
            if (a) { try { ficha = JSON.parse(a.ficha); } catch (e) { ficha = null; } }
        }
    }
    return { group: group, ficha: ficha || PromptLib.DEFAULT_FICHA };
}

function systemPromptFor(db, cfg, user) {
    const a = agentFor(db, user);
    return PromptLib.buildPrompt(a.ficha, { extraDomain: a.group ? a.group.cohort_data : '', today: todayText(cfg) });
}

function suggestionsFor(db, user) {
    const a = agentFor(db, user);
    const own = a.group ? PromptLib.lines(a.group.suggestions) : [];
    return own.length ? own.slice(0, 4) : ['¿Qué temas veremos esta semana?', '¿Cuándo es la próxima entrega?', 'Explícame qué es una función'];
}

// Mensajes recientes completos + memoria breve de lo que se preguntó antes.
function buildUpstreamMessages(db, cfg, conversationId, systemPrompt) {
    const all = db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').all(conversationId);
    const recent = all.slice(-cfg.historyMessages);
    const older = all.slice(0, all.length - recent.length);
    const messages = [{ role: 'system', content: systemPrompt }];
    const asked = older.filter(function (m) { return m.role === 'user'; }).slice(-6)
        .map(function (m) { return '"' + m.content.slice(0, 80).replace(/\s+/g, ' ') + '"'; });
    if (asked.length) {
        messages.push({ role: 'system', content: 'Memoria de la conversación: antes el estudiante preguntó sobre ' + asked.join('; ') + '.' });
    }
    let start = 0;
    while (start < recent.length && recent[start].role !== 'user') start++;
    recent.slice(start).forEach(function (m) { messages.push({ role: m.role, content: m.content }); });
    return messages;
}

function friendlyUpstreamError(status) {
    if (status === 401 || status === 403) return 'El servicio de IA no está configurado correctamente. Avisa al administrador.';
    if (status === 429) return 'El servicio de IA alcanzó su límite de uso. Inténtalo de nuevo en unos minutos.';
    if (status === 404) return 'El modelo elegido no está disponible. Prueba con otro.';
    if (status >= 500) return 'El servicio de IA tiene problemas ahora mismo. Inténtalo de nuevo en unos segundos.';
    return 'No se pudo completar la solicitud al servicio de IA.';
}

/* Llama al modelo y retransmite la respuesta al navegador como eventos SSE:
   {delta}, {done, truncated, messageId}, {error}. Devuelve el texto final y los tokens usados. */
async function streamCompletion(opts) {
    const cfg = opts.cfg;
    const res = opts.res;
    if (!cfg.openaiKey) {
        return { fail: { status: 503, error: 'El servidor no tiene la API key configurada. Avisa al administrador.' } };
    }

    const controller = new AbortController();
    let clientGone = false;
    res.on('close', function () {
        if (!res.writableEnded) { clientGone = true; controller.abort(); }
    });

    let upstream;
    try {
        upstream = await (cfg.fetch || fetch)(cfg.openaiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.openaiKey },
            body: JSON.stringify({
                model: opts.model,
                messages: opts.messages,
                max_tokens: opts.maxTokens,
                temperature: 0.7,
                stream: true,
                stream_options: { include_usage: true }
            }),
            signal: controller.signal
        });
    } catch (e) {
        if (clientGone) return { aborted: true, text: '' };
        return { fail: { status: 502, error: 'No hay conexión con el servicio de IA. Inténtalo de nuevo.' } };
    }
    if (!upstream.ok) {
        return { fail: { status: upstream.status === 429 ? 503 : 502, error: friendlyUpstreamError(upstream.status), upstreamStatus: upstream.status } };
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
    });
    const emit = function (evt) { if (!res.writableEnded && !res.destroyed) res.write('data: ' + JSON.stringify(evt) + '\n\n'); };

    let text = '';
    let finish = null;
    let usage = null;
    let aborted = false;
    let streamError = '';

    try {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer += decoder.decode(chunk.value, { stream: true });
            const parts = buffer.split('\n');
            buffer = parts.pop();
            for (let i = 0; i < parts.length; i++) {
                const line = parts[i].trim();
                if (line.indexOf('data:') !== 0) continue;
                const data = line.slice(5).trim();
                if (!data || data === '[DONE]') continue;
                let json;
                try { json = JSON.parse(data); } catch (e) { continue; }
                const c = json.choices && json.choices[0];
                if (c && c.delta && c.delta.content) {
                    text += c.delta.content;
                    emit({ delta: c.delta.content });
                }
                if (c && c.finish_reason) finish = c.finish_reason;
                if (json.usage) usage = json.usage;
            }
        }
    } catch (e) {
        if (clientGone || (e && e.name === 'AbortError')) aborted = true;
        else streamError = 'Se cortó la conexión con el servicio de IA.';
    }

    const promptTokens = usage ? usage.prompt_tokens : Math.ceil(JSON.stringify(opts.messages).length / 4);
    const completionTokens = usage ? usage.completion_tokens : Math.ceil(text.length / 4);
    return { text: text, truncated: finish === 'length', aborted: aborted, streamError: streamError, promptTokens: promptTokens, completionTokens: completionTokens, emit: emit };
}

function saveAssistant(db, conversationId, model, r) {
    let content = r.text;
    if (r.aborted) content += ' …(detenido)';
    if (r.truncated) content += '\n\n(Respuesta recortada por límite de longitud. Pídeme que continúe o hazme una pregunta más específica.)';
    const info = db.prepare(
        'INSERT INTO messages (conversation_id, role, content, model, prompt_tokens, completion_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(conversationId, 'assistant', content, model, r.promptTokens || 0, r.completionTokens || 0, now());
    db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now(), conversationId);
    return { id: Number(info.lastInsertRowid), content: content };
}

module.exports = {
    MODELS, DEFAULT_MODEL, PRICES, estimateCost, tokenBudget, todayText,
    utcDayStart, utcMonthStart, usageToday, dailyLimitFor, agentFor,
    systemPromptFor, suggestionsFor, buildUpstreamMessages, streamCompletion, saveAssistant
};
