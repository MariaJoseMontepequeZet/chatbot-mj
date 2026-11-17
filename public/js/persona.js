/* Estudio de personalidad (solo administrador): edita las fichas de los agentes y las guarda en el servidor con versiones. */
(function () {
    'use strict';
    const App = window.App;
    const { $, el, toast } = App.ui;
    const api = App.api;
    const PL = window.PromptLib;

    const COLORS = ['#f5a623', '#22a6e8', '#f97316', '#7cb82f', '#e53935'];
    const EN = ['Openness', 'Conscientiousness', 'Extroversion', 'Agreeableness', 'Neuroticism'];
    const TRAITS = PL.TRAITS.map(function (t, i) { return Object.assign({}, t, { color: COLORS[i], en: EN[i] }); });
    const SIMPLE = ['nombre', 'rol', 'tono', 'lenguaje', 'objetivo'];

    const PRESETS = [
        {
            id: 'practica', area: 'ENSEÑANZA', title: 'Profesor',
            desc: 'Enseña programación a los Campers: explica los temas, aclara dudas y verifica que los entiendan.',
            data: PL.DEFAULT_FICHA
        },
        {
            id: 'entrevistas', area: 'ALGORITMOS', title: 'Coach de entrevistas técnicas',
            desc: 'Prepara a los Campers para pruebas de código y entrevistas técnicas: simula retos y da retroalimentación honesta.',
            data: {
                nombre: 'Zevrin',
                rol: 'coach de entrevistas técnicas de programación para egresados de Campuslands',
                rasgos: [2, 2, 2, 1, 0],
                dominio: 'Retos típicos de lógica y estructuras de datos para perfiles junior.\nCómo pensar en voz alta mientras se resuelve un problema.\nErrores comunes al explicar el código de un proyecto propio.',
                tono: 'Motivador, directo y sereno.',
                lenguaje: 'Claro y práctico, con ejemplos de respuestas modelo.',
                objetivo: 'Ayudar a que el estudiante practique entrevistas y aprenda a explicar su trabajo con seguridad. Dar respuestas cortas y concisas.',
                limites: 'No resuelvas los retos de código por el estudiante.\nNo prometas que conseguirá empleo.'
            }
        },
        {
            id: 'revision', area: 'CALIDAD', title: 'Revisor de código',
            desc: 'Lee el código que el Camper le muestra y señala mejoras con criterio, sin reescribirlo por él.',
            data: {
                nombre: 'Brivex',
                rol: 'revisor de código que da retroalimentación a los Campers',
                rasgos: [1, 2, 0, 1, 0],
                dominio: 'Buenas prácticas de nombres, funciones y estructura.\nErrores comunes en JavaScript, HTML y CSS.\nCriterios de revisión de los proyectos del curso.',
                tono: 'Directo, respetuoso y constructivo.',
                lenguaje: 'Técnico y preciso, señalando línea o fragmento concreto.',
                objetivo: 'Señalar qué mejorar en el código del estudiante y por qué, para que aprenda a corregirlo él mismo. Dar respuestas cortas y concisas.',
                limites: 'No reescribas el código completo por el estudiante.\nNo apruebes ni califiques proyectos.'
            }
        },
        {
            id: 'depuracion', area: 'DEPURACIÓN', title: 'Guía de depuración',
            desc: 'Enseña a encontrar y entender errores en el código con método, sin dar el arreglo directo.',
            data: {
                nombre: 'Lurenta',
                rol: 'guía de depuración de errores para programadores de Campuslands',
                rasgos: [2, 2, 1, 2, 0],
                dominio: 'Cómo leer un mensaje de error y su traza.\nUso de console.log y de las herramientas del navegador.\nPasos para aislar un bug: reproducir, acotar, probar hipótesis.',
                tono: 'Paciente, metódico y alentador.',
                lenguaje: 'Técnico, con ejemplos de errores reales en JavaScript.',
                objetivo: 'Enseñar al estudiante a encontrar la causa de un error por sí mismo, con un método claro. Dar respuestas cortas y concisas.',
                limites: 'No entregues el código corregido: guía con preguntas y pistas.\nNo asumas la causa sin que el estudiante muestre el error.'
            }
        }
    ];

    let state = null;          // ficha que se está editando
    let savedJson = '';        // última versión guardada (para detectar cambios)
    let agentId = null;        // null = agente nuevo sin guardar
    let agentVersion = 0;
    let agents = [];
    let groups = [];
    let versions = [];
    let presetId = 'practica';
    let started = false;

    const clone = function (o) { return JSON.parse(JSON.stringify(o)); };
    const lines = PL.lines;
    const presetById = function (id) { return PRESETS.filter(function (p) { return p.id === id; })[0] || PRESETS[0]; };
    const isDirty = function () { return !state || JSON.stringify(state) !== savedJson; };

    /* ---------- Validación y puntaje ---------- */
    function evaluate(s) {
        const ideal = presetId === 'custom' ? null : presetById(presetId).data.rasgos;
        const checks = [];
        TRAITS.forEach(function (t, i) {
            const ok = !ideal || s.rasgos[i] === ideal[i];
            const hint = t.hints[s.rasgos[i]].charAt(0).toUpperCase() + t.hints[s.rasgos[i]].slice(1) + '.';
            checks.push({
                ok: ok, trait: t,
                text: ok ? (ideal ? ' encaja. ' : ' definido. ') + hint : ' no encaja con la plantilla: se recomienda ' + t.levels[ideal[i]] + '.'
            });
        });
        const nPending = lines(s.dominio).filter(function (l) { return /\[COMPLETAR/i.test(l); }).length;
        checks.push({ ok: nPending === 0, text: nPending === 0 ? 'Todos los datos del dominio están completos.' : 'Faltan datos en el dominio: ' + nPending + ' marcados [COMPLETAR].' });
        const nDominio = lines(s.dominio).length;
        checks.push({ ok: !!s.nombre.trim(), text: s.nombre.trim() ? 'Tiene nombre propio.' : 'Falta el nombre del agente.' });
        checks.push({ ok: !!s.rol.trim(), text: s.rol.trim() ? 'Define su rol.' : 'Falta definir el rol.' });
        checks.push({ ok: nDominio >= 3, text: 'Conocimiento del dominio: ' + nDominio + ' datos' + (nDominio >= 3 ? '.' : ' (mínimo 3).') });
        checks.push({ ok: !!s.tono.trim(), text: s.tono.trim() ? 'El tono está definido.' : 'Falta definir el tono.' });
        checks.push({ ok: !!s.lenguaje.trim(), text: s.lenguaje.trim() ? 'Define el tipo de lenguaje.' : 'Falta definir el lenguaje.' });
        checks.push({ ok: s.objetivo.trim().length >= 10, text: s.objetivo.trim().length >= 10 ? 'Tiene un objetivo claro (al menos una frase).' : 'Falta un objetivo claro (al menos una frase).' });
        checks.push({ ok: lines(s.limites).length >= 1, text: lines(s.limites).length >= 1 ? 'Declara al menos un límite.' : 'Falta declarar al menos un límite.' });
        const passed = checks.filter(function (c) { return c.ok; }).length;
        return { checks: checks, score: Math.round(passed / checks.length * 100) };
    }

    /* ---------- Plantillas ---------- */
    function renderPresets() {
        const box = $('presetCards');
        box.textContent = '';
        PRESETS.forEach(function (p) {
            const b = el('button', 'chip' + (p.id === presetId ? ' active' : ''));
            b.type = 'button';
            b.title = p.desc;
            b.appendChild(el('span', 'chip-area', p.area));
            b.appendChild(el('span', 'chip-title', p.title));
            b.addEventListener('click', function () {
                if (isDirty() && !window.confirm('Esto reemplaza lo que estás editando con la plantilla "' + p.title + '". ¿Continuar?')) return;
                presetId = p.id;
                state = clone(p.data);
                fillForm();
                renderPresets();
                update();
            });
            box.appendChild(b);
        });
        const custom = el('button', 'chip' + (presetId === 'custom' ? ' active' : ''));
        custom.type = 'button';
        custom.title = 'Tu propia ficha, sin comparar con un perfil ideal';
        custom.appendChild(el('span', 'chip-area', 'PROPIO'));
        custom.appendChild(el('span', 'chip-title', 'Personalizado'));
        custom.addEventListener('click', function () { presetId = 'custom'; renderPresets(); update(); });
        box.appendChild(custom);
    }

    /* ---------- Rasgos ---------- */
    function renderTraits() {
        const box = $('traits');
        box.textContent = '';
        TRAITS.forEach(function (t, i) {
            const row = el('div', 'trait');
            row.style.setProperty('--c', t.color);
            const head = el('div', 'trait-head');
            head.appendChild(el('span', 'trait-name', t.label));
            head.appendChild(el('span', 'trait-en', t.en));
            head.appendChild(el('span', 'trait-val'));
            const range = document.createElement('input');
            range.type = 'range';
            range.min = 0; range.max = 2; range.step = 1;
            range.id = 'r-' + i;
            range.setAttribute('aria-label', t.label);
            range.addEventListener('input', function () { state.rasgos[i] = Number(range.value); update(); });
            const ticks = el('div', 'ticks');
            t.levels.forEach(function (l) { ticks.appendChild(el('span', null, l)); });
            row.appendChild(head);
            row.appendChild(range);
            row.appendChild(ticks);
            row.appendChild(el('p', 'trait-hint'));
            box.appendChild(row);
        });
    }

    /* ---------- Etiquetas editables (dominio y límites) ---------- */
    function mountTags(key, boxId, placeholder) {
        const box = $(boxId);
        box.textContent = '';
        const write = function (arr) {
            state[key] = arr.join('\n');
            mountTags(key, boxId, placeholder);
            update();
            $(boxId).querySelector('input').focus();
        };
        lines(state[key]).forEach(function (item, idx) {
            const chip = el('span', 'tag');
            chip.appendChild(el('span', null, item));
            const x = el('button', 'tag-x', '×');
            x.type = 'button';
            x.setAttribute('aria-label', 'Quitar: ' + item);
            x.addEventListener('click', function () { const c = lines(state[key]); c.splice(idx, 1); write(c); });
            chip.appendChild(x);
            box.appendChild(chip);
        });
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder);
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const parts = lines(input.value);
                if (parts.length) write(lines(state[key]).concat(parts));
            } else if (e.key === 'Backspace' && !input.value) {
                const c = lines(state[key]);
                if (c.length) { c.pop(); write(c); }
            }
        });
        input.addEventListener('paste', function (e) {
            const txt = (e.clipboardData || window.clipboardData).getData('text');
            if (txt.indexOf('\n') !== -1) { e.preventDefault(); write(lines(state[key]).concat(lines(txt))); }
        });
        box.appendChild(input);
    }

    function fillForm() {
        SIMPLE.forEach(function (k) { $('f-' + k).value = state[k]; });
        mountTags('dominio', 'tags-dominio', 'Escribe un dato y presiona Enter…');
        mountTags('limites', 'tags-limites', 'Escribe una regla y presiona Enter…');
    }

    /* ---------- Gráfico de radar ---------- */
    function radarSvg() {
        const cx = 110, cy = 105, R = 78, n = TRAITS.length;
        const pt = function (i, r) { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
        const ns = 'http://www.w3.org/2000/svg';
        const mk = function (tag, attrs) { const e = document.createElementNS(ns, tag); Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; };
        const svg = mk('svg', { viewBox: '0 0 220 215', class: 'radar', role: 'img', 'aria-label': 'Gráfico de rasgos de personalidad' });
        [1, 2, 3].forEach(function (lv) {
            svg.appendChild(mk('polygon', { points: TRAITS.map(function (_, i) { return pt(i, R * lv / 3).join(','); }).join(' '), class: 'grid' }));
        });
        TRAITS.forEach(function (t, i) { const o = pt(i, R); svg.appendChild(mk('line', { x1: cx, y1: cy, x2: o[0], y2: o[1], class: 'axis' })); });
        svg.appendChild(mk('polygon', { points: state.rasgos.map(function (v, i) { return pt(i, R * (v + 1) / 3).join(','); }).join(' '), class: 'shape' }));
        TRAITS.forEach(function (t, i) {
            const d = pt(i, R * (state.rasgos[i] + 1) / 3);
            svg.appendChild(mk('circle', { cx: d[0], cy: d[1], r: 4, fill: t.color }));
            const lp = pt(i, R + 17);
            const tx = mk('text', { x: lp[0], y: lp[1] + 3, 'text-anchor': 'middle' });
            tx.textContent = t.label.slice(0, 3).toUpperCase();
            svg.appendChild(tx);
        });
        return svg;
    }

    /* ---------- Actualización de la pantalla ---------- */
    function update() {
        const name = state.nombre.trim() || 'Agente';
        TRAITS.forEach(function (t, i) {
            const row = $('traits').children[i];
            const range = $('r-' + i);
            range.value = state.rasgos[i];
            range.setAttribute('aria-valuetext', t.levels[state.rasgos[i]]);
            range.style.setProperty('--fill', (state.rasgos[i] * 50) + '%');
            row.querySelector('.trait-val').textContent = t.levels[state.rasgos[i]];
            row.querySelector('.trait-hint').textContent = t.hints[state.rasgos[i]].charAt(0).toUpperCase() + t.hints[state.rasgos[i]].slice(1) + '.';
        });

        $('avatarLetter').textContent = name.charAt(0).toUpperCase();
        $('cardName').textContent = name;
        $('cardRole').textContent = state.rol.trim() || 'Sin rol definido';
        $('radarBox').textContent = '';
        $('radarBox').appendChild(radarSvg());

        const ev = evaluate(state);
        const good = ev.checks.filter(function (c) { return c.ok; }).length;
        $('qualityFill').style.width = ev.score + '%';
        $('qualityFill').className = 'fill ' + (ev.score >= 90 ? 'hi' : ev.score >= 70 ? 'mid' : 'lo');
        $('qualityPct').textContent = ev.score + '%';
        $('qualityLabel').textContent = (ev.score >= 90 ? 'Lista para usar' : ev.score >= 70 ? 'Casi lista' : 'Incompleta') + ' · ' + good + '/' + ev.checks.length + ' comprobaciones';
        const pend = $('pending');
        pend.textContent = '';
        const bad = ev.checks.filter(function (c) { return !c.ok; });
        if (!bad.length) {
            pend.appendChild(el('li', 'ok', '✓ Sin pendientes: la ficha cumple todo.'));
        } else {
            bad.forEach(function (c) {
                const li = el('li', 'bad');
                li.appendChild(document.createTextNode('! '));
                if (c.trait) { const b = el('b', null, c.trait.label); b.style.color = c.trait.color; li.appendChild(b); }
                li.appendChild(document.createTextNode(c.text));
                pend.appendChild(li);
            });
        }
        const dots = $('dots');
        dots.textContent = '';
        ev.checks.forEach(function (c) { dots.appendChild(el('span', 'dot-ck ' + (c.ok ? 'ok' : 'bad'))); });

        const legend = $('traitLegend');
        legend.textContent = '';
        TRAITS.forEach(function (t, i) {
            const it = el('span', 'lg');
            const sw = el('i');
            sw.style.background = t.color;
            it.appendChild(sw);
            it.appendChild(document.createTextNode(t.label + ' '));
            it.appendChild(el('b', null, t.levels[state.rasgos[i]]));
            legend.appendChild(it);
        });
        $('cnt-objetivo').textContent = state.objetivo.length + ' caracteres';

        const dirty = isDirty();
        $('dirtyMsg').textContent = agentId === null ? 'Agente nuevo sin guardar' : (dirty ? 'Cambios sin guardar' : '');
        $('saveAgent').disabled = agentId !== null && !dirty;
        $('saveAgent').textContent = agentId === null ? 'Crear agente' : 'Guardar nueva versión';
        $('deleteAgent').hidden = agentId === null;
    }

    function renderAgentSelect() {
        const sel = $('agentSelect');
        sel.textContent = '';
        agents.forEach(function (a) {
            const o = el('option', null, a.name + ' · v' + a.version + (a.groups ? ' · ' + a.groups + (a.groups === 1 ? ' grupo' : ' grupos') : ''));
            o.value = a.id;
            sel.appendChild(o);
        });
        if (agentId === null) {
            const o = el('option', null, '(agente nuevo sin guardar)');
            o.value = '';
            sel.appendChild(o);
            sel.value = '';
        } else {
            sel.value = String(agentId);
        }
        const tg = $('testGroup');
        tg.textContent = '';
        const none = el('option', null, 'Sin datos de grupo');
        none.value = '';
        tg.appendChild(none);
        groups.forEach(function (g) { const o = el('option', null, g.name); o.value = g.id; tg.appendChild(o); });
    }

    function renderVersions() {
        const ul = $('versionList');
        ul.textContent = '';
        if (!versions.length) { ul.appendChild(el('li', 'history-empty', 'Aún no hay versiones.')); return; }
        versions.forEach(function (v) {
            const li = el('li', 'version');
            const info = el('div', 'version-info');
            info.appendChild(el('b', null, 'v' + v.version + (v.version === agentVersion ? ' (activa)' : '')));
            info.appendChild(el('span', null, App.ui.formatDate(v.createdAt) + (v.by ? ' · ' + v.by : '')));
            if (v.note) info.appendChild(el('em', null, v.note));
            li.appendChild(info);
            if (v.version !== agentVersion) {
                const b = el('button', 'ghost small', 'Restaurar');
                b.type = 'button';
                b.addEventListener('click', function () { restore(v.version); });
                li.appendChild(b);
            }
            ul.appendChild(li);
        });
    }

    /* ---------- Carga y guardado en el servidor ---------- */
    async function refreshLists() {
        const a = await api.get('/api/admin/agents');
        agents = a.agents;
        groups = (await api.get('/api/admin/groups')).groups;
    }

    async function loadAgent(id) {
        const a = await api.get('/api/admin/agents/' + id);
        agentId = a.id;
        agentVersion = a.version;
        versions = a.versions;
        state = clone(a.ficha);
        savedJson = JSON.stringify(state);
        presetId = 'custom';
        renderAgentSelect(); renderPresets(); fillForm(); renderVersions(); update();
    }

    function blankAgent() {
        agentId = null; agentVersion = 0; versions = [];
        presetId = PRESETS[0].id;
        state = clone(PRESETS[0].data);
        state.nombre = '';
        savedJson = '';
        renderAgentSelect(); renderPresets(); fillForm(); renderVersions(); update();
    }

    async function saveAgent() {
        const v = PL.validateFicha(state);
        if (!v.ok) { toast(v.error, 'error'); return; }
        const note = $('saveNote').value.trim();
        try {
            let id = agentId;
            if (agentId === null) id = (await api.post('/api/admin/agents', { ficha: state, note: note })).id;
            else await api.put('/api/admin/agents/' + agentId, { ficha: state, note: note });
            $('saveNote').value = '';
            await refreshLists();
            await loadAgent(id);
            toast('Agente guardado (versión ' + agentVersion + ').', 'ok');
            if (App.me && App.me.user) { try { App.me = await api.get('/api/me'); $('agentBadge').textContent = App.me.agent.name; } catch (e) { /* no crítico */ } }
        } catch (e) { toast(e.message, 'error'); }
    }

    async function deleteAgent() {
        if (agentId === null) return;
        const a = agents.filter(function (x) { return x.id === agentId; })[0];
        const extra = a && a.groups ? '\n\nLo usan ' + a.groups + ' grupo(s): quedarán sin agente y usarán el agente por defecto.' : '';
        if (!window.confirm('¿Eliminar el agente "' + (a ? a.name : '') + '" y todas sus versiones?' + extra)) return;
        try {
            await api.del('/api/admin/agents/' + agentId);
            await refreshLists();
            if (agents.length) await loadAgent(agents[0].id); else blankAgent();
            toast('Agente eliminado.', 'ok');
        } catch (e) { toast(e.message, 'error'); }
    }

    async function restore(version) {
        if (isDirty() && !window.confirm('Tienes cambios sin guardar que se perderán. ¿Restaurar la versión ' + version + '?')) return;
        try {
            await api.post('/api/admin/agents/' + agentId + '/restore', { version: version });
            await refreshLists();
            await loadAgent(agentId);
            toast('Versión ' + version + ' restaurada como la versión ' + agentVersion + '.', 'ok');
        } catch (e) { toast(e.message, 'error'); }
    }

    /* ---------- Exportar / importar ---------- */
    function say(msg, isErr) {
        const m = $('ioMsg');
        m.textContent = msg;
        m.className = 'io-msg' + (isErr ? ' err' : '');
        clearTimeout(say.t);
        say.t = setTimeout(function () { m.textContent = ''; }, 4000);
    }

    function slug() { return (state.nombre.trim() || 'ficha').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ficha'; }

    function importFicha(file) {
        const reader = new FileReader();
        reader.onload = function () {
            try {
                const json = JSON.parse(reader.result);
                const v = PL.validateFicha(json && json.ficha ? json.ficha : json);
                if (!v.ok) { say('El archivo no tiene el formato de una ficha: ' + v.error, true); return; }
                state = v.value;
                presetId = 'custom';
                fillForm(); renderPresets(); update();
                say('Ficha importada: ' + state.nombre + '. Recuerda guardarla.');
            } catch (e) { say('No se pudo leer el archivo JSON.', true); }
        };
        reader.readAsText(file);
    }

    /* ---------- Prueba rápida ---------- */
    let testCtl = null;
    async function runTest() {
        const out = $('testOut');
        const q = $('testQ').value.trim();
        if (!q) return;
        if (testCtl) { testCtl.abort(); return; }
        out.hidden = false;
        out.classList.remove('error');
        out.textContent = 'Pensando…';
        $('testGo').textContent = 'Detener';
        testCtl = new AbortController();
        let text = '';
        try {
            const model = $('modeloSelect').value;
            await api.stream('/api/admin/test', { ficha: state, question: q, groupId: $('testGroup').value || null, model: model }, function (evt) {
                if (evt.delta) { text += evt.delta; App.ui.renderMarkdown(out, text); }
                if (evt.error) { out.classList.add('error'); out.textContent = evt.error; }
            }, testCtl.signal);
        } catch (e) {
            if (!(e && e.name === 'AbortError')) { out.classList.add('error'); out.textContent = e.message; }
        } finally {
            testCtl = null;
            $('testGo').textContent = 'Probar';
        }
    }

    /* ---------- Eventos y ciclo de vida ---------- */
    function init() {
        SIMPLE.forEach(function (k) {
            $('f-' + k).addEventListener('input', function (e) {
                state[k] = e.target.value;
                update();
            });
        });
        $('agentSelect').addEventListener('change', async function (e) {
            const target = e.target.value;
            if (isDirty() && !window.confirm('Tienes cambios sin guardar que se perderán. ¿Cambiar de agente?')) { renderAgentSelect(); return; }
            try { if (target === '') blankAgent(); else await loadAgent(Number(target)); } catch (err) { toast(err.message, 'error'); }
        });
        $('newAgent').addEventListener('click', function () {
            if (isDirty() && !window.confirm('Tienes cambios sin guardar que se perderán. ¿Crear un agente nuevo?')) return;
            blankAgent();
        });
        $('saveAgent').addEventListener('click', saveAgent);
        $('deleteAgent').addEventListener('click', deleteAgent);
        $('resetPersona').addEventListener('click', function () {
            if (isDirty() && !window.confirm('Se descartarán tus cambios. ¿Continuar?')) return;
            if (agentId !== null && presetId === 'custom') { loadAgent(agentId).catch(function (e) { toast(e.message, 'error'); }); return; }
            state = clone(presetById(presetId === 'custom' ? PRESETS[0].id : presetId).data);
            fillForm(); update();
        });
        $('exportFicha').addEventListener('click', function () {
            App.ui.download(slug() + '.ficha.json', JSON.stringify({ version: 1, tipo: 'ficha-agente', ficha: state }, null, 2), 'application/json');
            say('Ficha exportada.');
        });
        $('importFicha').addEventListener('click', function () { $('importFile').click(); });
        $('importFile').addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) importFicha(e.target.files[0]);
            e.target.value = '';
        });
        $('testGo').addEventListener('click', runTest);
        $('testQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runTest(); } });
        renderTraits();
    }

    async function start() {
        try {
            await refreshLists();
            if (agents.length) await loadAgent(agents[0].id); else blankAgent();
            started = true;
        } catch (e) { toast(e.message, 'error'); }
    }

    async function show() {
        if (!started) { await start(); return; }
        try { await refreshLists(); renderAgentSelect(); } catch (e) { /* se mantiene lo anterior */ }
    }

    function reset() { started = false; state = null; agentId = null; agents = []; groups = []; versions = []; }

    App.persona = { init: init, start: start, show: show, reset: reset };
})();
