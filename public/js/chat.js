/* Chat del Camper: historial, mensajes con streaming, valoración, exportar y límites de uso. */
(function () {
    'use strict';
    const App = window.App;
    const { $, el, toast } = App.ui;
    const api = App.api;

    const MAX_INPUT = 1000;
    const TRUNC_NOTE = '\n\n(Respuesta recortada por límite de longitud. Pídeme que continúe o hazme una pregunta más específica.)';
    const NOT_UNDERSTOOD = 'No entendí. Explícamelo de otra forma, con un ejemplo más simple.';

    let me = null;
    let conversations = [];
    let currentId = null;
    let title = '';
    let messages = []; // { id?, role, content, feedback?, streaming?, isError?, noRetry?, bubble? }
    let sending = false;
    let controller = null;

    const messagesEl = function () { return $('messages'); };

    /* ---------- Historial ---------- */
    async function loadConversations() {
        try { conversations = (await api.get('/api/conversations')).conversations; } catch (e) { conversations = []; }
        const current = conversations.filter(function (c) { return c.id === currentId; })[0];
        if (current) { title = current.title; renderBar(); }
        renderHistory();
    }

    function renderHistory() {
        const list = $('historyList');
        list.textContent = '';
        if (!conversations.length) {
            list.appendChild(el('li', 'history-empty', 'Aún no hay conversaciones.'));
            return;
        }
        conversations.forEach(function (c) {
            const li = el('li', 'history-item' + (c.id === currentId ? ' active' : ''));
            const open = el('button', 'history-open', c.title);
            open.type = 'button';
            open.title = c.title + ' · ' + App.ui.formatDate(c.updatedAt);
            if (c.id === currentId) open.setAttribute('aria-current', 'true');
            open.addEventListener('click', function () { openConversation(c.id); });
            const ren = el('button', 'history-act', '✎');
            ren.type = 'button';
            ren.setAttribute('aria-label', 'Renombrar conversación');
            ren.addEventListener('click', function () { renameConversation(c); });
            const del = el('button', 'history-act', '×');
            del.type = 'button';
            del.setAttribute('aria-label', 'Borrar conversación');
            del.addEventListener('click', function () { deleteConversation(c); });
            li.appendChild(open);
            li.appendChild(ren);
            li.appendChild(del);
            list.appendChild(li);
        });
    }

    async function renameConversation(c) {
        const t = window.prompt('Nuevo nombre de la conversación:', c.title);
        if (t === null || !t.trim()) return;
        try { await api.patch('/api/conversations/' + c.id, { title: t.trim() }); if (c.id === currentId) title = t.trim(); await loadConversations(); renderBar(); }
        catch (e) { toast(e.message, 'error'); }
    }

    async function deleteConversation(c) {
        if (!window.confirm('¿Borrar la conversación "' + c.title + '"? No se puede deshacer.')) return;
        try {
            await api.del('/api/conversations/' + c.id);
            if (c.id === currentId) newChat();
            await loadConversations();
        } catch (e) { toast(e.message, 'error'); }
    }

    function mapServer(list) {
        return list.map(function (m) { return { id: m.id, role: m.role, content: m.content, feedback: m.feedback }; });
    }

    async function openConversation(id) {
        if (sending) return;
        try {
            const data = await api.get('/api/conversations/' + id);
            currentId = data.id;
            title = data.title;
            messages = mapServer(data.messages);
            renderAll();
            renderHistory();
            closeDrawer();
        } catch (e) { toast(e.message, 'error'); }
    }

    function newChat() {
        if (sending) return;
        currentId = null;
        title = '';
        messages = [];
        renderAll();
        renderHistory();
        closeDrawer();
        $('prompt').focus();
    }

    async function syncFromServer() {
        if (!currentId) return;
        try {
            const data = await api.get('/api/conversations/' + currentId);
            title = data.title;
            messages = mapServer(data.messages);
            renderAll();
        } catch (e) { /* se mantiene lo que hay en pantalla */ }
    }

    /* ---------- Cabecera del chat y uso diario ---------- */
    function renderBar() {
        $('chatTitle').textContent = title || '';
        $('exportChat').hidden = !messages.length;
    }

    function renderUsage() {
        const chip = $('usageChip');
        const u = me && me.usage;
        if (!u || u.limit == null) { chip.hidden = true; return; }
        chip.hidden = false;
        chip.textContent = 'Hoy: ' + u.today + '/' + u.limit + ' mensajes';
        chip.className = 'usage-chip' + (u.today >= u.limit ? ' full' : u.today >= u.limit * 0.8 ? ' warn' : '');
    }

    /* ---------- Mensajes ---------- */
    function agentInitial() { return ((me && me.agent && me.agent.name) || 'A').charAt(0).toUpperCase(); }

    function renderEmpty() {
        const box = el('div', 'empty');
        box.appendChild(el('div', 'empty-avatar', agentInitial()));
        const first = me && me.user ? me.user.name.split(' ')[0] : '';
        box.appendChild(el('h2', null, (first ? 'Hola, ' + first + '. ' : 'Hola. ') + 'Soy ' + (me ? me.agent.name : 'tu agente')));
        box.appendChild(el('p', null, 'Escríbeme tu duda o elige una pregunta para empezar.'));
        const chips = el('div', 'suggestions');
        ((me && me.suggestions) || []).forEach(function (text) {
            const b = el('button', 'suggestion', text);
            b.type = 'button';
            b.addEventListener('click', function () { send(text); });
            chips.appendChild(b);
        });
        box.appendChild(chips);
        messagesEl().appendChild(box);
    }

    function actionButton(label, handler, pressed) {
        const b = el('button', 'msg-act' + (pressed ? ' on' : ''), label);
        b.type = 'button';
        if (pressed !== undefined) b.setAttribute('aria-pressed', String(!!pressed));
        b.addEventListener('click', handler);
        return b;
    }

    async function rate(m, value) {
        const next = m.feedback === value ? 0 : value;
        try { await api.post('/api/messages/' + m.id + '/feedback', { value: next }); m.feedback = next; renderAll(true); }
        catch (e) { toast(e.message, 'error'); }
    }

    function buildMessage(m, index) {
        const isUser = m.role === 'user';
        const wrap = el('div', 'message ' + (isUser ? 'user' : 'model'));
        wrap.appendChild(el('div', 'avatar', isUser ? 'Tú' : agentInitial()));
        const col = el('div', 'message-col');
        const bubble = el('div');

        if (m.streaming && !m.content) {
            bubble.className = 'bubble typing';
            bubble.setAttribute('aria-label', 'Escribiendo');
            bubble.innerHTML = '<span></span><span></span><span></span>';
        } else if (isUser) {
            bubble.className = 'bubble';
            bubble.textContent = m.content;
        } else if (m.isError) {
            bubble.className = 'bubble error';
            bubble.appendChild(el('div', null, m.content));
            if (index === messages.length - 1 && !sending && !m.noRetry) {
                const retry = el('button', 'retry', 'Reintentar');
                retry.type = 'button';
                retry.addEventListener('click', function () { retryLast(); });
                bubble.appendChild(retry);
            }
        } else {
            bubble.className = 'bubble md';
            App.ui.renderMarkdown(bubble, m.content);
        }
        m.bubble = bubble;
        col.appendChild(bubble);

        const done = !isUser && !m.isError && !m.streaming && m.id;
        if (done) {
            const row = el('div', 'msg-actions');
            row.appendChild(actionButton('Útil', function () { rate(m, 1); }, m.feedback === 1));
            row.appendChild(actionButton('No útil', function () { rate(m, -1); }, m.feedback === -1));
            const copy = actionButton('Copiar', function () { App.ui.copyText(m.content, copy); });
            row.appendChild(copy);
            if (index === messages.length - 1 && !sending) {
                row.appendChild(actionButton('No entendí', function () { send(NOT_UNDERSTOOD); }));
            }
            col.appendChild(row);
        }
        wrap.appendChild(col);
        return wrap;
    }

    function renderAll(keepScroll) {
        const box = messagesEl();
        const top = box.scrollTop;
        box.textContent = '';
        if (!messages.length) renderEmpty();
        messages.forEach(function (m, i) { box.appendChild(buildMessage(m, i)); });
        renderBar();
        if (keepScroll) box.scrollTop = top; else box.scrollTop = box.scrollHeight;
    }

    function updateStreaming(m) {
        if (!m.bubble) return;
        if (m.bubble.classList.contains('typing')) { renderAll(); return; }
        const nearBottom = messagesEl().scrollHeight - messagesEl().scrollTop - messagesEl().clientHeight < 80;
        App.ui.renderMarkdown(m.bubble, m.content);
        if (nearBottom) messagesEl().scrollTop = messagesEl().scrollHeight;
    }

    /* ---------- Envío ---------- */
    function setSending(value) {
        sending = value;
        const btn = $('sendBtn');
        btn.textContent = value ? 'Detener' : 'Enviar';
        btn.classList.toggle('stop', value);
        $('composer').setAttribute('aria-busy', String(value));
    }

    function modelValue() {
        const s = $('modeloSelect');
        return s && !s.hidden ? s.value : undefined;
    }

    async function send(text, opts) {
        opts = opts || {};
        if (sending) return;
        text = String(text || '').trim();
        if (!text) return;
        if (!opts.retry && text.length > MAX_INPUT) { toast('Tu mensaje es muy largo (máximo ' + MAX_INPUT + ' caracteres).', 'error'); return; }

        if (!currentId) {
            try {
                const c = await api.post('/api/conversations');
                currentId = c.id;
                conversations.unshift({ id: c.id, title: c.title, updatedAt: new Date().toISOString() });
                renderHistory();
            } catch (e) { toast(e.message, 'error'); return; }
        }

        if (!opts.retry) messages.push({ role: 'user', content: text });
        const msg = { role: 'assistant', content: '', streaming: true };
        messages.push(msg);
        setSending(true);
        renderAll();
        controller = new AbortController();
        let finished = false;
        let reload = false;

        try {
            await api.stream('/api/conversations/' + currentId + '/messages', { content: text, retry: !!opts.retry, model: modelValue() }, function (evt) {
                if (evt.delta) { msg.content += evt.delta; updateStreaming(msg); }
                if (evt.done) {
                    finished = true;
                    msg.streaming = false;
                    msg.id = evt.messageId;
                    if (evt.truncated) msg.content += TRUNC_NOTE;
                    if (evt.usage && me) { me.usage = evt.usage; renderUsage(); }
                }
                if (evt.error) {
                    finished = true;
                    msg.streaming = false;
                    msg.isError = true;
                    msg.content = evt.error;
                }
            }, controller.signal);
            if (!finished) { reload = true; toast('La respuesta quedó incompleta.', 'error'); }
        } catch (e) {
            if (e && e.name === 'AbortError') {
                msg.streaming = false;
                if (!msg.content) messages.splice(messages.indexOf(msg), 1); else reload = true;
            } else {
                messages.splice(messages.indexOf(msg), 1);
                if (e.status !== 401) {
                    if (e.code === 'network_mid') { reload = true; toast(e.message, 'error'); }
                    else messages.push({ role: 'assistant', content: e.message, isError: true, noRetry: e.code === 'limit' || e.status === 400 || e.status === 404 });
                }
                if (e.code === 'limit' && me && me.usage) { me.usage.today = me.usage.limit; renderUsage(); }
            }
        } finally {
            controller = null;
            setSending(false);
            if (reload) await syncFromServer(); else renderAll(true);
            loadConversations();
            $('prompt').focus();
        }
    }

    function retryLast() {
        const last = messages[messages.length - 1];
        if (!last || !last.isError) return;
        const lastUser = messages.slice().reverse().find(function (m) { return m.role === 'user'; });
        messages.pop();
        send(lastUser ? lastUser.content : '', { retry: true });
    }

    function exportChat() {
        if (!messages.length) return;
        const who = me && me.agent ? me.agent.name : 'Agente';
        const md = '# ' + (title || 'Conversación') + '\n\n' + messages.filter(function (m) { return !m.isError; })
            .map(function (m) { return '**' + (m.role === 'user' ? 'Tú' : who) + ':**\n\n' + m.content; }).join('\n\n---\n\n') + '\n';
        App.ui.download((title || 'conversacion').replace(/[^\w\-áéíóúñ ]+/gi, '').trim().replace(/\s+/g, '-').slice(0, 40) + '.md', md, 'text/markdown');
    }

    /* ---------- Panel del historial en pantallas pequeñas ---------- */
    function closeDrawer() {
        $('history').classList.remove('open');
        $('historyToggle').setAttribute('aria-expanded', 'false');
    }

    /* ---------- Arranque ---------- */
    function init() {
        const prompt = $('prompt');
        prompt.addEventListener('input', function () {
            prompt.style.height = 'auto';
            prompt.style.height = Math.min(prompt.scrollHeight, 200) + 'px';
            const n = prompt.value.length;
            $('charCount').textContent = n > 800 ? n + '/' + MAX_INPUT : '';
        });
        prompt.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                e.preventDefault();
                if (!sending) $('composer').requestSubmit();
            }
        });
        $('sendBtn').addEventListener('click', function (e) {
            if (sending) { e.preventDefault(); if (controller) controller.abort(); }
        });
        $('composer').addEventListener('submit', function (e) {
            e.preventDefault();
            if (sending) return;
            const text = prompt.value;
            if (!text.trim()) return;
            prompt.value = '';
            prompt.style.height = 'auto';
            $('charCount').textContent = '';
            send(text);
        });
        $('newChatBtn').addEventListener('click', newChat);
        $('exportChat').addEventListener('click', exportChat);
        $('historyToggle').addEventListener('click', function () {
            const open = $('history').classList.toggle('open');
            $('historyToggle').setAttribute('aria-expanded', String(open));
        });
        const model = $('modeloSelect');
        const saved = App.ui.store('mj_model');
        if (saved && Array.prototype.some.call(model.options, function (o) { return o.value === saved; })) model.value = saved;
        model.addEventListener('change', function () { App.ui.store('mj_model', model.value); });
    }

    // Se llama cada vez que alguien inicia sesión.
    function start(data) {
        me = data;
        if (controller) controller.abort();
        currentId = null; title = ''; messages = []; conversations = [];
        setSending(false);
        $('agentBadge').textContent = data.agent.name;
        renderUsage();
        renderAll();
        loadConversations();
    }

    function reset() {
        if (controller) controller.abort();
        me = null; currentId = null; title = ''; messages = []; conversations = [];
        messagesEl().textContent = '';
        $('historyList').textContent = '';
    }

    App.chat = { init: init, start: start, reset: reset };
})();
