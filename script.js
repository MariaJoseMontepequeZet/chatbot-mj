document.addEventListener('DOMContentLoaded', function () {
    'use strict';

    /* ============================================================
       Configuración
       ============================================================ */
    // Si tienes un backend propio que guarde la API key, pon aquí su URL.
    // Con PROXY_URL definido el navegador NO necesita (ni envía) ninguna key.
    const PROXY_URL = '';
    const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

    const DEFAULT_MODEL = 'gpt-4o-mini';
    const TOKENS_SHORT = 200;        // respuestas normales (cortas)
    const TOKENS_CODE = 450;         // respuestas que llevan código
    const MAX_INPUT_CHARS = 1000;    // longitud máxima del mensaje del estudiante
    const MAX_HISTORY = 16;          // mensajes recientes enviados completos
    const MAX_MEMORY_ITEMS = 6;      // preguntas antiguas resumidas como memoria
    const KEY_STORE = 'campuslands_openai_key';
    const CHAT_STORE = 'campuslands_chat_v1';
    const SUGGESTIONS = [
        '¿Qué temas veremos esta semana?',
        '¿Cuándo es la próxima entrega?',
        'Explícame qué es una función'
    ];

    const $ = function (id) { return document.getElementById(id); };
    const elements = {
        modelSelect: $('modeloSelect'),
        clearChatBtn: $('clearChatBtn'),
        messages: $('messages'),
        composer: $('composer'),
        prompt: $('prompt'),
        sendBtn: $('sendBtn'),
        keyBtn: $('keyBtn'),
        keyDialog: $('keyDialog'),
        keyInput: $('keyInput'),
        keySave: $('keySave'),
        keyClear: $('keyClear'),
        keyClose: $('keyClose')
    };

    let conversation = [];
    let sending = false;
    let controller = null;

    /* ============================================================
       Almacenamiento seguro (puede fallar en modo privado)
       ============================================================ */
    function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
    function storeDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

    function getKey() { return (storeGet(KEY_STORE) || '').trim(); }
    function hasAccess() { return !!PROXY_URL || !!getKey(); }

    function persistChat() {
        const clean = conversation
            .filter(function (m) { return !m.streaming && m.parts[0].text; })
            .map(function (m) { return { role: m.role, parts: m.parts, isError: !!m.isError }; });
        storeSet(CHAT_STORE, JSON.stringify(clean.slice(-60)));
    }

    function loadChat() {
        try {
            const saved = JSON.parse(storeGet(CHAT_STORE));
            if (Array.isArray(saved)) {
                conversation = saved.filter(function (m) {
                    return m && (m.role === 'user' || m.role === 'model') && m.parts && m.parts[0] && typeof m.parts[0].text === 'string';
                });
            }
        } catch (e) { conversation = []; }
    }

    /* ============================================================
       Clave de API (se guarda solo en este navegador)
       ============================================================ */
    function refreshKeyButton() {
        if (PROXY_URL) {
            elements.keyBtn.hidden = true;
            return;
        }
        const ok = !!getKey();
        elements.keyBtn.textContent = ok ? 'Clave ✓' : 'Clave';
        elements.keyBtn.classList.toggle('needs-key', !ok);
        elements.keyBtn.title = ok ? 'API key guardada en este navegador' : 'Falta tu API key de OpenAI';
    }

    function openKeyDialog() {
        elements.keyInput.value = '';
        if (typeof elements.keyDialog.showModal === 'function') {
            elements.keyDialog.showModal();
            elements.keyInput.focus();
        } else {
            const v = window.prompt('Pega tu API key de OpenAI (se guarda solo en este navegador):');
            if (v) { storeSet(KEY_STORE, v.trim()); refreshKeyButton(); }
        }
    }

    elements.keyBtn.addEventListener('click', openKeyDialog);
    elements.keyClose.addEventListener('click', function () { elements.keyDialog.close(); });
    elements.keySave.addEventListener('click', function (e) {
        e.preventDefault();
        const v = elements.keyInput.value.trim();
        if (!v) { elements.keyInput.focus(); return; }
        storeSet(KEY_STORE, v);
        elements.keyInput.value = '';
        elements.keyDialog.close();
        refreshKeyButton();
        elements.prompt.focus();
    });
    elements.keyClear.addEventListener('click', function (e) {
        e.preventDefault();
        storeDel(KEY_STORE);
        elements.keyDialog.close();
        refreshKeyButton();
    });

    /* ============================================================
       Formato de respuestas (markdown seguro, sin innerHTML)
       ============================================================ */
    function renderInline(parent, text) {
        const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)/g;
        let last = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
            const tok = m[0];
            let node;
            if (tok.charAt(0) === '`') {
                node = document.createElement('code');
                node.textContent = tok.slice(1, -1);
            } else if (tok.indexOf('**') === 0) {
                node = document.createElement('strong');
                node.textContent = tok.slice(2, -2);
            } else {
                node = document.createElement('em');
                node.textContent = tok.slice(1, -1);
            }
            parent.appendChild(node);
            last = m.index + tok.length;
        }
        if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    }

    function renderBlocks(container, text) {
        const lines = text.split('\n');
        let para = null;
        let list = null;
        const closePara = function () { para = null; };
        const closeList = function () { list = null; };

        lines.forEach(function (raw) {
            const line = raw.replace(/\s+$/, '');
            if (!line.trim()) { closePara(); closeList(); return; }

            const heading = /^#{1,6}\s+(.*)$/.exec(line);
            if (heading) {
                closePara(); closeList();
                const h = document.createElement('p');
                h.className = 'md-h';
                renderInline(h, heading[1]);
                container.appendChild(h);
                return;
            }

            const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
            if (item) {
                closePara();
                const ordered = !!item[2];
                if (!list || list.ordered !== ordered) {
                    const node = document.createElement(ordered ? 'ol' : 'ul');
                    container.appendChild(node);
                    list = { node: node, ordered: ordered };
                }
                const li = document.createElement('li');
                renderInline(li, item[3]);
                list.node.appendChild(li);
                return;
            }

            closeList();
            if (!para) {
                para = document.createElement('p');
                container.appendChild(para);
            } else {
                para.appendChild(document.createElement('br'));
            }
            renderInline(para, line);
        });
    }

    function buildCodeBlock(code, lang) {
        const wrap = document.createElement('div');
        wrap.className = 'codeblock';
        const head = document.createElement('div');
        head.className = 'codeblock-head';
        const label = document.createElement('span');
        label.textContent = lang || 'código';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'copy-code';
        copy.textContent = 'Copiar';
        copy.addEventListener('click', function () {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(code).then(function () {
                    copy.textContent = '¡Copiado!';
                    setTimeout(function () { copy.textContent = 'Copiar'; }, 1500);
                }, function () { /* sin permiso */ });
            }
        });
        head.appendChild(label);
        head.appendChild(copy);
        const pre = document.createElement('pre');
        const codeEl = document.createElement('code');
        codeEl.textContent = code;
        pre.appendChild(codeEl);
        wrap.appendChild(head);
        wrap.appendChild(pre);
        return wrap;
    }

    function renderMarkdown(container, text) {
        container.textContent = '';
        String(text || '').split('```').forEach(function (part, i) {
            if (i % 2 === 1) {
                let lang = '';
                let code = part;
                const nl = part.indexOf('\n');
                if (nl !== -1 && /^[\w+#.-]*$/.test(part.slice(0, nl).trim())) {
                    lang = part.slice(0, nl).trim();
                    code = part.slice(nl + 1);
                }
                container.appendChild(buildCodeBlock(code.replace(/\n$/, ''), lang));
            } else if (part) {
                renderBlocks(container, part);
            }
        });
    }

    /* ============================================================
       Llamada al modelo (con streaming)
       ============================================================ */
    function friendlyError(status, apiMsg) {
        let msg;
        if (status === 401) msg = 'La API key no es válida o fue revocada. Revísala en el botón "Clave".';
        else if (status === 403) msg = 'Tu cuenta no tiene permiso para usar este modelo. Prueba con otro modelo.';
        else if (status === 404) msg = 'El modelo elegido no existe o no está disponible. Prueba con otro.';
        else if (status === 429) msg = 'Se alcanzó el límite de uso o se agotó el saldo de la API. Espera un momento o revisa tu cuenta de OpenAI.';
        else if (status >= 500) msg = 'El servidor de OpenAI tiene problemas ahora mismo. Intenta de nuevo en unos segundos.';
        else msg = 'No se pudo completar la solicitud (HTTP ' + status + ').';
        const err = new Error(msg);
        err.friendly = true;
        err.detail = apiMsg || '';
        return err;
    }

    async function ask(opts) {
        const headers = { 'Content-Type': 'application/json' };
        if (!PROXY_URL) {
            const key = getKey();
            if (!key) {
                const e = new Error('Falta la API key. Pulsa "Clave" para agregarla.');
                e.friendly = true;
                e.noKey = true;
                throw e;
            }
            headers.Authorization = 'Bearer ' + key;
        }

        const body = {
            model: opts.model || DEFAULT_MODEL,
            messages: opts.messages,
            max_tokens: opts.maxTokens || TOKENS_SHORT,
            temperature: 0.7,
            stream: true
        };

        let res;
        try {
            res = await fetch(PROXY_URL || OPENAI_URL, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(body),
                signal: opts.signal
            });
        } catch (e) {
            if (e && e.name === 'AbortError') throw e;
            const err = new Error('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.');
            err.friendly = true;
            throw err;
        }

        if (!res.ok) {
            let apiMsg = '';
            try { const j = await res.json(); apiMsg = j && j.error && j.error.message; } catch (e) { /* ignore */ }
            throw friendlyError(res.status, apiMsg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let full = '';
        let finish = null;

        while (true) {
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
                try {
                    const json = JSON.parse(data);
                    const c = json.choices && json.choices[0];
                    if (c) {
                        if (c.delta && c.delta.content) {
                            full += c.delta.content;
                            if (opts.onToken) opts.onToken(full);
                        }
                        if (c.finish_reason) finish = c.finish_reason;
                    }
                } catch (e) { /* línea parcial */ }
            }
        }
        return { text: full, truncated: finish === 'length' };
    }

    function systemPrompt() {
        return window.Persona ? window.Persona.getPrompt() : '';
    }

    // Presupuesto de tokens: más margen si la pregunta trata de código
    function tokenBudget(text) {
        const codeHint = /```|c[oó]digo|funci[oó]n|ejemplo|error|bug|script|clase|bucle|array|html|css|javascript|\bjs\b|sql|python/i;
        return codeHint.test(text || '') ? TOKENS_CODE : TOKENS_SHORT;
    }

    // Mensajes recientes completos + memoria breve de lo que se preguntó antes
    function buildMessages(history) {
        const valid = history.filter(function (m) { return !m.isError && m.parts[0].text; });
        const recent = valid.slice(-MAX_HISTORY);
        const older = valid.slice(0, valid.length - recent.length);
        const messages = [{ role: 'system', content: systemPrompt() }];

        const asked = older
            .filter(function (m) { return m.role === 'user'; })
            .slice(-MAX_MEMORY_ITEMS)
            .map(function (m) { return '"' + m.parts[0].text.slice(0, 80).replace(/\s+/g, ' ') + '"'; });
        if (asked.length) {
            messages.push({ role: 'system', content: 'Memoria de la conversación: antes el estudiante preguntó sobre ' + asked.join('; ') + '.' });
        }

        let start = 0;
        while (start < recent.length && recent[start].role !== 'user') start++;
        recent.slice(start).forEach(function (m) {
            messages.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.parts[0].text });
        });
        return messages;
    }

    /* ============================================================
       Interfaz del chat
       ============================================================ */
    function agentName() {
        return window.Persona ? window.Persona.getName() : 'Asistente';
    }

    function scrollToBottom() {
        elements.messages.scrollTop = elements.messages.scrollHeight;
    }

    function renderEmptyState() {
        const box = document.createElement('div');
        box.className = 'empty';
        const av = document.createElement('div');
        av.className = 'empty-avatar';
        av.textContent = agentName().charAt(0).toUpperCase();
        const h = document.createElement('h2');
        h.textContent = 'Hola, soy ' + agentName();
        const p = document.createElement('p');
        p.textContent = hasAccess()
            ? 'Escríbeme tu duda o elige una pregunta para empezar.'
            : 'Para empezar, agrega tu API key con el botón "Clave" de arriba.';
        const chips = document.createElement('div');
        chips.className = 'suggestions';
        SUGGESTIONS.forEach(function (text) {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'suggestion';
            b.textContent = text;
            b.addEventListener('click', function () {
                elements.prompt.value = text;
                elements.composer.requestSubmit();
            });
            chips.appendChild(b);
        });
        box.appendChild(av);
        box.appendChild(h);
        box.appendChild(p);
        box.appendChild(chips);
        elements.messages.appendChild(box);
    }

    function renderMessages() {
        elements.messages.innerHTML = '';
        conversation.forEach(function (msg, index) {
            const isUser = msg.role === 'user';
            const wrapper = document.createElement('div');
            wrapper.className = 'message ' + (isUser ? 'user' : 'model');

            const avatar = document.createElement('div');
            avatar.className = 'avatar';
            avatar.textContent = isUser ? 'Tú' : agentName().charAt(0).toUpperCase();

            const bubble = document.createElement('div');
            const text = msg.parts[0].text;

            if (msg.streaming && !text) {
                bubble.className = 'bubble typing';
                bubble.setAttribute('aria-label', 'Escribiendo');
                bubble.innerHTML = '<span></span><span></span><span></span>';
            } else if (isUser) {
                bubble.className = 'bubble';
                bubble.textContent = text;
            } else if (msg.isError) {
                bubble.className = 'bubble error';
                const t = document.createElement('div');
                t.textContent = text;
                bubble.appendChild(t);
                if (index === conversation.length - 1 && !sending) {
                    const retry = document.createElement('button');
                    retry.type = 'button';
                    retry.className = 'retry';
                    retry.textContent = 'Reintentar';
                    retry.addEventListener('click', function () {
                        conversation.pop();
                        run();
                    });
                    bubble.appendChild(retry);
                }
            } else {
                bubble.className = 'bubble md';
                renderMarkdown(bubble, text);
            }

            wrapper.appendChild(avatar);
            wrapper.appendChild(bubble);
            elements.messages.appendChild(wrapper);
        });

        if (!conversation.length) renderEmptyState();
    }

    function setSending(value) {
        sending = value;
        elements.sendBtn.textContent = value ? 'Detener' : 'Enviar';
        elements.sendBtn.classList.toggle('stop', value);
        elements.composer.setAttribute('aria-busy', value ? 'true' : 'false');
        if (!value) elements.prompt.focus();
    }

    async function run() {
        const lastUser = conversation.filter(function (m) { return m.role === 'user'; }).pop();
        const userText = lastUser ? lastUser.parts[0].text : '';
        const messages = buildMessages(conversation);
        const placeholder = { role: 'model', parts: [{ text: '' }], isError: false, streaming: true };
        conversation.push(placeholder);

        controller = new AbortController();
        setSending(true);
        renderMessages();
        scrollToBottom();

        try {
            const result = await ask({
                messages: messages,
                model: elements.modelSelect.value || DEFAULT_MODEL,
                maxTokens: tokenBudget(userText),
                signal: controller.signal,
                onToken: function (partial) {
                    placeholder.parts[0].text = partial;
                    renderMessages();
                    scrollToBottom();
                }
            });
            placeholder.streaming = false;
            let finalText = result.text || '(sin contenido)';
            if (result.truncated) {
                finalText += '\n\n(Respuesta recortada por límite de longitud. Pídeme que continúe o hazme una pregunta más específica.)';
            }
            placeholder.parts[0].text = finalText;
        } catch (e) {
            if (e && e.name === 'AbortError') {
                placeholder.streaming = false;
                if (placeholder.parts[0].text) {
                    placeholder.parts[0].text += ' …(detenido)';
                } else {
                    conversation.splice(conversation.indexOf(placeholder), 1);
                }
            } else {
                conversation.splice(conversation.indexOf(placeholder), 1);
                conversation.push({ role: 'model', parts: [{ text: (e && e.friendly) ? e.message : 'Ocurrió un error inesperado. Inténtalo de nuevo.' }], isError: true });
                if (e && e.noKey) openKeyDialog();
            }
        } finally {
            controller = null;
            setSending(false);
            renderMessages();
            scrollToBottom();
            persistChat();
            refreshKeyButton();
        }
    }

    /* ============================================================
       Eventos
       ============================================================ */
    elements.clearChatBtn.addEventListener('click', function () {
        if (!conversation.length) return;
        if (!confirm('¿Borrar toda la conversación?')) return;
        if (controller) controller.abort();
        conversation = [];
        persistChat();
        renderMessages();
    });

    elements.prompt.addEventListener('input', function () {
        elements.prompt.style.height = 'auto';
        elements.prompt.style.height = Math.min(elements.prompt.scrollHeight, 200) + 'px';
    });

    // Enter envía; Shift+Enter agrega una línea
    elements.prompt.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault();
            if (!sending) elements.composer.requestSubmit();
        }
    });

    // El botón actúa como "Detener" mientras se genera la respuesta
    elements.sendBtn.addEventListener('click', function (e) {
        if (sending) {
            e.preventDefault();
            if (controller) controller.abort();
        }
    });

    elements.composer.addEventListener('submit', function (e) {
        e.preventDefault();
        if (sending) return;
        const text = (elements.prompt.value || '').trim();
        if (!text) return;

        if (text.length > MAX_INPUT_CHARS) {
            alert('Tu mensaje es muy largo (máximo ' + MAX_INPUT_CHARS + ' caracteres).');
            return;
        }
        if (!hasAccess()) {
            openKeyDialog();
            return;
        }

        conversation.push({ role: 'user', parts: [{ text: text }], isError: false });
        elements.prompt.value = '';
        elements.prompt.style.height = 'auto';
        run();
    });

    document.addEventListener('persona:changed', function () {
        if (!conversation.length) renderMessages();
    });

    /* ============================================================
       Arranque + API para otras vistas (ficha del agente)
       ============================================================ */
    window.ChatAPI = {
        ask: ask,
        renderMarkdown: renderMarkdown,
        tokenBudget: tokenBudget,
        hasAccess: hasAccess,
        openKeyDialog: openKeyDialog,
        getModel: function () { return elements.modelSelect.value || DEFAULT_MODEL; }
    };

    loadChat();
    refreshKeyButton();
    renderMessages();
    scrollToBottom();
});
