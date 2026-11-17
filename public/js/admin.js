/* Panel del administrador: usuarios, grupos, consumo, conversaciones, actividad y ajustes. */
(function () {
    'use strict';
    const App = window.App;
    const { $, el, toast } = App.ui;
    const api = App.api;

    let tab = 'users';

    /* ---------- Utilidades de construcción ---------- */
    const body = function () { return $('adminBody'); };

    function card(title, sub) {
        const c = el('section', 'card');
        if (title) c.appendChild(el('h2', null, title));
        if (sub) c.appendChild(el('p', 'hint', sub));
        return c;
    }

    function field(label, input, hint) {
        const f = el('div', 'field');
        const l = el('label', null, label);
        if (!input.id) input.id = 'f' + Math.random().toString(36).slice(2, 9);
        l.setAttribute('for', input.id);
        f.appendChild(l);
        f.appendChild(input);
        if (hint) f.appendChild(el('small', 'hint', hint));
        return f;
    }

    function input(type, value, attrs) {
        const i = document.createElement('input');
        i.type = type || 'text';
        if (value !== undefined && value !== null) i.value = value;
        Object.keys(attrs || {}).forEach(function (k) { i.setAttribute(k, attrs[k]); });
        return i;
    }

    function textarea(value, rows, attrs) {
        const t = document.createElement('textarea');
        t.rows = rows || 3;
        t.value = value || '';
        Object.keys(attrs || {}).forEach(function (k) { t.setAttribute(k, attrs[k]); });
        return t;
    }

    function select(options, value) {
        const s = document.createElement('select');
        options.forEach(function (o) { const op = el('option', null, o.label); op.value = o.value; s.appendChild(op); });
        s.value = value === null || value === undefined ? '' : String(value);
        return s;
    }

    function button(text, cls, handler) {
        const b = el('button', cls || '', text);
        b.type = 'button';
        b.addEventListener('click', function () {
            b.disabled = true;
            Promise.resolve().then(handler).catch(function (e) { toast(e.message || 'Ocurrió un error.', 'error'); }).then(function () { b.disabled = false; });
        });
        return b;
    }

    function table(headers, rows, emptyText) {
        const wrap = el('div', 'table-wrap');
        const t = el('table', 'tbl');
        const thead = el('thead');
        const hr = el('tr');
        headers.forEach(function (h) { hr.appendChild(el('th', null, h)); });
        thead.appendChild(hr);
        t.appendChild(thead);
        const tb = el('tbody');
        if (!rows.length) {
            const tr = el('tr');
            const td = el('td', 'empty-cell', emptyText || 'Sin datos.');
            td.colSpan = headers.length;
            tr.appendChild(td);
            tb.appendChild(tr);
        }
        rows.forEach(function (r) {
            const tr = el('tr');
            r.forEach(function (cell) {
                const td = el('td');
                if (cell instanceof Node) td.appendChild(cell); else td.textContent = cell == null ? '' : String(cell);
                tr.appendChild(td);
            });
            tb.appendChild(tr);
        });
        t.appendChild(tb);
        wrap.appendChild(t);
        return wrap;
    }

    const money = function (n) { return '$' + (n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)); };
    const num = function (n) { return Number(n || 0).toLocaleString('es'); };

    /* ======================= USUARIOS ======================= */
    async function renderUsers() {
        const root = body();
        root.textContent = '';
        const [u, g] = await Promise.all([api.get('/api/admin/users'), api.get('/api/admin/groups')]);
        const groupOpts = [{ value: '', label: 'Sin grupo' }].concat(g.groups.map(function (x) { return { value: x.id, label: x.name }; }));

        const top = el('div', 'grid-2');

        // Crear usuario
        const create = card('Nuevo usuario', 'Se crea con una contraseña temporal que verás una sola vez; la persona la cambia al entrar.');
        const nName = input('text', '', { maxlength: 80, autocomplete: 'off' });
        const nUser = input('text', '', { maxlength: 32, autocomplete: 'off', placeholder: 'ej. ana.perez' });
        const nRole = select([{ value: 'camper', label: 'Camper' }, { value: 'admin', label: 'Administrador' }], 'camper');
        const nGroup = select(groupOpts, '');
        create.appendChild(field('Nombre completo', nName));
        create.appendChild(field('Usuario', nUser, '3 a 32 caracteres: letras, números, punto, guion.'));
        const row = el('div', 'two');
        row.appendChild(field('Rol', nRole));
        row.appendChild(field('Grupo', nGroup));
        create.appendChild(row);
        create.appendChild(button('Crear cuenta', 'cta', async function () {
            const r = await api.post('/api/admin/users', { name: nName.value, username: nUser.value, role: nRole.value, groupId: nGroup.value || null });
            App.ui.showSecrets('Cuenta creada', 'Entrega esta contraseña temporal a la persona. No se volverá a mostrar; si se pierde, usa "Restablecer clave".', [{ name: nName.value.trim(), username: r.username, tempPassword: r.tempPassword }], 'cuenta-' + r.username + '.csv');
            await renderUsers();
        }));
        top.appendChild(create);

        // Importar lista
        const imp = card('Importar lista', 'Una persona por línea: "Nombre" o "Nombre,usuario". Si no pones usuario se genera (nombre.apellido).');
        const csv = textarea('', 6, { placeholder: 'Ana Pérez\nLuis Díaz,luis.diaz\nMaría José López' });
        const iGroup = select(groupOpts, '');
        imp.appendChild(field('Lista', csv));
        imp.appendChild(field('Grupo para todos', iGroup));
        imp.appendChild(button('Importar cuentas', 'cta', async function () {
            const r = await api.post('/api/admin/users/import', { csv: csv.value, groupId: iGroup.value || null });
            if (r.created.length) App.ui.showSecrets('Cuentas creadas (' + r.created.length + ')', 'Descarga el CSV o cópialo: estas contraseñas temporales no se volverán a mostrar.' + (r.errors.length ? ' Hubo ' + r.errors.length + ' líneas con error: ' + r.errors.join(' ') : ''), r.created, 'cuentas-importadas.csv');
            else toast(r.errors.join(' ') || 'No se creó ninguna cuenta.', 'error');
            await renderUsers();
        }));
        top.appendChild(imp);
        root.appendChild(top);

        // Lista
        const list = card('Cuentas (' + u.users.length + ')');
        const search = input('search', '', { placeholder: 'Buscar por nombre o usuario…', 'aria-label': 'Buscar cuentas' });
        list.appendChild(search);
        const holder = el('div');
        list.appendChild(holder);

        const draw = function () {
            const q = search.value.trim().toLowerCase();
            const rows = u.users.filter(function (x) { return !q || x.name.toLowerCase().indexOf(q) !== -1 || x.username.toLowerCase().indexOf(q) !== -1; }).map(function (x) {
                const gs = select(groupOpts, x.groupId);
                gs.setAttribute('aria-label', 'Grupo de ' + x.name);
                gs.addEventListener('change', async function () {
                    try { await api.patch('/api/admin/users/' + x.id, { groupId: gs.value || null }); toast('Grupo actualizado.', 'ok'); x.groupId = gs.value ? Number(gs.value) : null; }
                    catch (e) { toast(e.message, 'error'); gs.value = x.groupId === null ? '' : String(x.groupId); }
                });
                const actions = el('div', 'row-actions');
                actions.appendChild(button(x.active ? 'Desactivar' : 'Reactivar', 'ghost small', async function () {
                    if (x.active && !window.confirm('¿Desactivar la cuenta de ' + x.name + '? Se cerrará su sesión y no podrá entrar.')) return;
                    await api.patch('/api/admin/users/' + x.id, { active: !x.active });
                    await renderUsers();
                }));
                actions.appendChild(button('Restablecer clave', 'ghost small', async function () {
                    if (!window.confirm('¿Restablecer la contraseña de ' + x.name + '? Se cerrará su sesión.')) return;
                    const r = await api.post('/api/admin/users/' + x.id + '/reset');
                    App.ui.showSecrets('Contraseña restablecida', 'Entrega esta contraseña temporal a ' + x.name + '. No se volverá a mostrar.', [{ name: x.name, username: r.username, tempPassword: r.tempPassword }], 'clave-' + r.username + '.csv');
                }));
                actions.appendChild(button('Eliminar', 'ghost small danger', async function () {
                    if (!window.confirm('¿Eliminar la cuenta de ' + x.name + ' y TODAS sus conversaciones? No se puede deshacer.\n\nSi solo quieres que no entre más, usa "Desactivar".')) return;
                    await api.del('/api/admin/users/' + x.id);
                    toast('Cuenta eliminada.', 'ok');
                    await renderUsers();
                }));
                const status = el('span', 'pill ' + (x.active ? 'ok' : 'off'), x.active ? (x.mustChange ? 'Clave pendiente' : 'Activa') : 'Desactivada');
                return [x.name, x.username, x.role === 'admin' ? 'Administrador' : 'Camper', gs, status, App.ui.formatDate(x.lastLogin), String(x.today), actions];
            });
            holder.textContent = '';
            holder.appendChild(table(['Nombre', 'Usuario', 'Rol', 'Grupo', 'Estado', 'Último acceso', 'Hoy', 'Acciones'], rows, 'No hay cuentas que coincidan.'));
        };
        search.addEventListener('input', draw);
        draw();
        root.appendChild(list);
    }

    /* ======================= GRUPOS ======================= */
    async function renderGroups() {
        const root = body();
        root.textContent = '';
        const [g, a] = await Promise.all([api.get('/api/admin/groups'), api.get('/api/admin/agents')]);
        const agentOpts = [{ value: '', label: 'Agente por defecto (Kirunel)' }].concat(a.agents.map(function (x) { return { value: x.id, label: x.name + ' · v' + x.version }; }));

        const nw = card('Nuevo grupo', 'Un grupo (cohorte o curso) tiene su propio agente, sus datos de clase y su límite de mensajes.');
        const nName = input('text', '', { maxlength: 60, placeholder: 'ej. Cohorte 5 – Tarde' });
        nw.appendChild(field('Nombre del grupo', nName));
        nw.appendChild(button('Crear grupo', 'cta', async function () {
            await api.post('/api/admin/groups', { name: nName.value });
            toast('Grupo creado.', 'ok');
            await renderGroups();
        }));
        root.appendChild(nw);

        g.groups.forEach(function (x) {
            const c = card(x.name, x.members + (x.members === 1 ? ' persona' : ' personas') + ' en este grupo.');
            const name = input('text', x.name, { maxlength: 60 });
            const agent = select(agentOpts, x.agentId);
            const limit = input('number', x.dailyLimit === null ? '' : x.dailyLimit, { min: 0, max: 10000, placeholder: 'General' });
            const sug = textarea(x.suggestions, 3, { maxlength: 1000, placeholder: '¿Qué temas veremos esta semana?\n¿Cuándo es la próxima entrega?' });
            const cohort = textarea(x.cohortData, 8, { maxlength: 5000, placeholder: 'Horarios de clases para los estudiantes: lunes a viernes, 8:00 a 12:00\nTema que será impartido: ...\nFechas de entrega para proyectos: ...\nFechas de pruebas de conocimiento: ...' });
            const r1 = el('div', 'three');
            r1.appendChild(field('Nombre', name));
            r1.appendChild(field('Agente', agent));
            r1.appendChild(field('Mensajes por día (Campers)', limit, 'Vacío = usar el límite general.'));
            c.appendChild(r1);
            c.appendChild(field('Datos de la cohorte (horarios, temas, fechas)', cohort, 'Una línea por dato. El agente solo puede responder con lo que escribas aquí; usa [COMPLETAR …] si aún no lo tienes.'));
            c.appendChild(field('Preguntas sugeridas (máx. 4)', sug, 'Una por línea. Aparecen en la pantalla de bienvenida.'));
            const actions = el('div', 'row-actions');
            actions.appendChild(button('Guardar cambios', 'cta', async function () {
                await api.put('/api/admin/groups/' + x.id, { name: name.value, agentId: agent.value || null, dailyLimit: limit.value === '' ? null : Number(limit.value), cohortData: cohort.value, suggestions: sug.value });
                toast('Grupo guardado.', 'ok');
                await renderGroups();
            }));
            actions.appendChild(button('Eliminar grupo', 'ghost danger', async function () {
                if (!window.confirm('¿Eliminar el grupo "' + x.name + '"? Sus ' + x.members + ' integrantes quedarán sin grupo.')) return;
                await api.del('/api/admin/groups/' + x.id);
                await renderGroups();
            }));
            c.appendChild(actions);
            root.appendChild(c);
        });
    }

    /* ======================= CONSUMO ======================= */
    async function renderUsage(days) {
        days = days || 30;
        const root = body();
        root.textContent = '';
        const u = await api.get('/api/admin/usage?days=' + days);

        if (u.month.alert) {
            root.appendChild(el('div', 'banner warn', 'Atención: llevas ' + money(u.month.cost) + ' este mes (' + u.month.percent + '% del presupuesto de ' + money(u.month.budget) + ').'));
        }

        const head = el('div', 'usage-head');
        const sel = select([{ value: 7, label: 'Últimos 7 días' }, { value: 30, label: 'Últimos 30 días' }, { value: 90, label: 'Últimos 90 días' }], days);
        sel.addEventListener('change', function () { renderUsage(Number(sel.value)).catch(function (e) { toast(e.message, 'error'); }); });
        head.appendChild(sel);
        root.appendChild(head);

        const totalMsgs = u.users.reduce(function (s, x) { return s + x.messages; }, 0);
        const cards = el('div', 'stat-grid');
        const stat = function (label, value, sub) {
            const s = el('div', 'stat');
            s.appendChild(el('span', 'stat-label', label));
            s.appendChild(el('b', 'stat-value', value));
            if (sub) s.appendChild(el('span', 'stat-sub', sub));
            return s;
        };
        cards.appendChild(stat('Mensajes (' + days + ' días)', num(totalMsgs)));
        cards.appendChild(stat('Costo estimado', money(u.totalCost), 'en ' + days + ' días'));
        cards.appendChild(stat('Este mes', money(u.month.cost), u.month.budget > 0 ? u.month.percent + '% de ' + money(u.month.budget) : 'sin presupuesto definido'));
        cards.appendChild(stat('Personas activas', String(u.users.length)));
        root.appendChild(cards);

        // Barras de los últimos 14 días
        const chart = card('Mensajes por día (últimos 14 días)');
        const bars = el('div', 'bars');
        const max = Math.max.apply(null, [1].concat(u.daily.map(function (d) { return d.messages; })));
        const byDay = {};
        u.daily.forEach(function (d) { byDay[d.day] = d.messages; });
        for (let i = 13; i >= 0; i--) {
            const day = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
            const n = byDay[day] || 0;
            const col = el('div', 'bar-col');
            const b = el('div', 'bar-v');
            b.style.height = Math.max(2, Math.round(n / max * 100)) + '%';
            b.title = day + ': ' + n + ' mensajes';
            col.appendChild(el('span', 'bar-n', n ? String(n) : ''));
            col.appendChild(b);
            col.appendChild(el('span', 'bar-d', day.slice(8)));
            bars.appendChild(col);
        }
        chart.appendChild(bars);
        root.appendChild(chart);

        const perUser = card('Consumo por persona');
        perUser.appendChild(table(['Persona', 'Usuario', 'Grupo', 'Mensajes', 'Tokens (entrada / salida)', 'Costo est.'], u.users.map(function (x) {
            return [x.name, x.username, x.groupName, num(x.messages), num(x.promptTokens) + ' / ' + num(x.completionTokens), money(x.cost)];
        }), 'Aún no hay consumo en este período.'));
        perUser.appendChild(el('p', 'hint', u.note));
        root.appendChild(perUser);
    }

    /* ======================= CONVERSACIONES ======================= */
    async function renderConvs(userId) {
        const root = body();
        root.textContent = '';
        const [users, list] = await Promise.all([api.get('/api/admin/users'), api.get('/api/admin/conversations' + (userId ? '?userId=' + userId : ''))]);
        root.appendChild(el('div', 'banner info', 'Las conversaciones se guardan y el equipo docente puede revisarlas para mejorar al agente. Cada lectura queda registrada en "Actividad".'));

        const head = el('div', 'usage-head');
        const sel = select([{ value: '', label: 'Todas las personas' }].concat(users.users.map(function (x) { return { value: x.id, label: x.name + ' (' + x.username + ')' }; })), userId || '');
        sel.setAttribute('aria-label', 'Filtrar por persona');
        sel.addEventListener('change', function () { renderConvs(sel.value ? Number(sel.value) : null).catch(function (e) { toast(e.message, 'error'); }); });
        head.appendChild(sel);
        root.appendChild(head);

        const layout = el('div', 'grid-2 convs');
        const left = card('Conversaciones (' + list.conversations.length + ')');
        const right = card('Detalle');
        right.appendChild(el('p', 'hint', 'Elige una conversación de la lista para leerla.'));
        const detail = el('div', 'transcript');
        right.appendChild(detail);

        left.appendChild(table(['Persona', 'Título', 'Msj', '👎', 'Actualizada', ''], list.conversations.map(function (c) {
            const open = button('Leer', 'ghost small', async function () {
                const d = await api.get('/api/admin/conversations/' + c.id);
                detail.textContent = '';
                detail.appendChild(el('h3', null, d.title + ' — ' + d.userName));
                d.messages.forEach(function (m) {
                    const b = el('div', 'bubble ' + (m.role === 'user' ? 'tr-user' : 'md'));
                    if (m.role === 'user') b.textContent = m.content; else App.ui.renderMarkdown(b, m.content);
                    const wrap = el('div', 'tr-row ' + m.role);
                    wrap.appendChild(el('span', 'tr-meta', (m.role === 'user' ? d.userName : 'Agente') + ' · ' + App.ui.formatDate(m.createdAt) + (m.feedback === -1 ? ' · marcada como no útil' : m.feedback === 1 ? ' · marcada como útil' : '')));
                    wrap.appendChild(b);
                    detail.appendChild(wrap);
                });
            });
            return [c.userName, c.title, String(c.messages), c.negative ? String(c.negative) : '', App.ui.formatDate(c.updatedAt), open];
        }), 'No hay conversaciones.'));
        layout.appendChild(left);
        layout.appendChild(right);
        root.appendChild(layout);
    }

    /* ======================= ACTIVIDAD ======================= */
    const ACTIONS = {
        login: 'Inició sesión', 'password.change': 'Cambió su contraseña', 'user.create': 'Creó una cuenta', 'user.import': 'Importó cuentas',
        'user.update': 'Modificó una cuenta', 'user.reset': 'Restableció una contraseña', 'user.delete': 'Eliminó una cuenta',
        'group.create': 'Creó un grupo', 'group.update': 'Modificó un grupo', 'group.delete': 'Eliminó un grupo',
        'agent.create': 'Creó un agente', 'agent.update': 'Guardó una versión del agente', 'agent.restore': 'Restauró una versión', 'agent.delete': 'Eliminó un agente',
        'settings.update': 'Cambió los ajustes', 'conversation.review': 'Leyó una conversación', bootstrap: 'Creó el primer administrador'
    };

    async function renderAudit() {
        const root = body();
        root.textContent = '';
        const a = await api.get('/api/admin/audit?limit=200');
        const c = card('Actividad reciente', 'Registro de inicios de sesión y de los cambios que se hacen en cuentas, grupos, agentes y ajustes.');
        c.appendChild(table(['Fecha', 'Quién', 'Qué', 'Detalle'], a.entries.map(function (e) {
            return [App.ui.formatDate(e.at), e.actor || 'sistema', ACTIONS[e.action] || e.action, e.detail];
        }), 'Aún no hay actividad.'));
        root.appendChild(c);
    }

    /* ======================= AJUSTES ======================= */
    async function renderSettings() {
        const root = body();
        root.textContent = '';
        const s = await api.get('/api/admin/settings');
        const c = card('Ajustes generales');
        c.appendChild(el('div', 'banner ' + (s.apiKeyConfigured ? 'ok' : 'warn'),
            s.apiKeyConfigured ? 'La API key de OpenAI está configurada en el servidor (nunca llega al navegador).' : 'Falta la API key: agrega OPENAI_API_KEY en el archivo .env del servidor y reinícialo. Mientras tanto el chat no responderá.'));
        const limit = input('number', s.defaultDailyLimit, { min: 0, max: 10000 });
        const budget = input('number', s.monthlyBudgetUsd, { min: 0, step: '0.5' });
        c.appendChild(field('Mensajes por día para cada Camper (límite general)', limit, 'Los grupos pueden tener su propio límite. El administrador no tiene límite.'));
        c.appendChild(field('Presupuesto mensual estimado (USD)', budget, 'Al llegar al 80% verás un aviso en "Consumo". Pon 0 para desactivarlo.'));
        c.appendChild(button('Guardar ajustes', 'cta', async function () {
            await api.put('/api/admin/settings', { defaultDailyLimit: Number(limit.value), monthlyBudgetUsd: Number(budget.value) });
            toast('Ajustes guardados.', 'ok');
        }));
        root.appendChild(c);
    }

    /* ======================= NAVEGACIÓN ======================= */
    const RENDERERS = { users: renderUsers, groups: renderGroups, usage: renderUsage, convs: renderConvs, audit: renderAudit, settings: renderSettings };

    async function render(name) {
        tab = name;
        Array.prototype.forEach.call(document.querySelectorAll('[data-admin]'), function (b) {
            const on = b.dataset.admin === name;
            b.classList.toggle('active', on);
            if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
        });
        try { await RENDERERS[name](); } catch (e) { toast(e.message, 'error'); }
    }

    function init() {
        Array.prototype.forEach.call(document.querySelectorAll('[data-admin]'), function (b) {
            b.addEventListener('click', function () { render(b.dataset.admin); });
        });
    }

    App.admin = {
        init: init,
        start: function () { tab = 'users'; },
        show: function () { return render(tab); },
        reset: function () { body().textContent = ''; tab = 'users'; }
    };
})();
