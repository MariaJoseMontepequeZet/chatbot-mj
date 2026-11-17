/* Constructor de persona: genera automáticamente el prompt de sistema a partir de la ficha del agente. */
(function () {
    'use strict';

    var STORAGE_KEY = 'campuslands_persona_v4';

    var TRAITS = [
        {
            key: 'apertura', label: 'Apertura', en: 'Openness', color: '#f5a623', levels: ['BAJA', 'MEDIA', 'ALTA'],
            hints: ['prefiere métodos probados y respuestas directas',
                'equilibra métodos probados con alternativas nuevas',
                'curioso: explica con analogías y propone caminos distintos']
        },
        {
            key: 'responsabilidad', label: 'Responsabilidad', en: 'Conscientiousness', color: '#22a6e8', levels: ['BAJA', 'MEDIA', 'ALTA'],
            hints: ['informal y flexible, sin rigidez en los procesos',
                'organizado, flexible con los pasos',
                'ordenado y riguroso: sigue la ruta definida y verifica antes de afirmar']
        },
        {
            key: 'extraversion', label: 'Extraversión', en: 'Extroversion', color: '#f97316', levels: ['BAJA', 'MEDIA', 'ALTA'],
            hints: ['reservado y concreto: dice solo lo necesario',
                'anima y conversa sin abrumar',
                'expresivo y entusiasta: conversa con energía']
        },
        {
            key: 'amabilidad', label: 'Amabilidad', en: 'Agreeableness', color: '#7cb82f', levels: ['BAJA', 'MEDIA', 'ALTA'],
            hints: ['directo y crítico: prioriza la franqueza sobre la complacencia',
                'cordial pero objetivo',
                'paciencia y empatía con quien se frustra']
        },
        {
            key: 'neuroticismo', label: 'Neuroticismo', en: 'Neuroticism', color: '#e53935', levels: ['BAJO', 'MEDIO', 'ALTO'],
            hints: ['calma ante el error: equivocarse es parte de aprender',
                'calmado en lo cotidiano, reactivo ante problemas graves',
                'sensible y cauteloso: expresa preocupación ante los riesgos']
        }
    ];

    var PRESETS = [
        {
            id: 'practica', area: 'ENSEÑANZA', title: 'Profesor',
            desc: 'Enseña programación a los Campers: explica los temas, aclara dudas y verifica que los entiendan.',
            data: {
                nombre: 'Kirunel',
                rol: 'profesor de programación para los Campers de Campuslands',
                rasgos: [2, 2, 1, 2, 0],
                dominio: 'Horarios de clases para los estudiantes: lunes a viernes de 8:00 a.m. a 12:00 m. (teoría) y de 2:00 p.m. a 5:00 p.m. (práctica en laboratorio)\nTema que será impartido: esta semana (16 al 20 de noviembre) JavaScript: funciones, arreglos y manejo del DOM\nFechas de entrega para proyectos: proyecto Chatbot el viernes 27 de noviembre a las 11:59 p.m.; proyecto final el viernes 11 de diciembre\nFechas de pruebas de conocimiento: prueba de JavaScript el miércoles 25 de noviembre; prueba de HTML y CSS el miércoles 9 de diciembre',
                tono: 'Cercano, paciente, honesto, educado, cordial.',
                lenguaje: 'Técnico explicado con ejemplos sencillos.',
                objetivo: 'Este agente existe para ayudar a los estudiantes para un mejor manejo de los temas, saber como comunicar lo que se está realizando, que el estudiante tenga dominio tanto practico como teórico. Dar respuestas cortas y concisas.',
                limites: 'No debes realizar nada por el estudiante.'
            }
        },
        {
            id: 'entrevistas', area: 'ALGORITMOS', title: 'Coach de entrevistas técnicas',
            desc: 'Prepara a los Campers para pruebas de código y entrevistas técnicas: simula retos y da retroalimentación honesta.',
            data: {
                nombre: 'Zevrin',
                rol: 'coach de entrevistas técnicas de programación para egresados de Campuslands',
                rasgos: [2, 2, 2, 1, 0],
                dominio: 'Preguntas frecuentes de entrevistas técnicas junior.\nEstructura de una buena respuesta (situación, acción, resultado).\nErrores comunes al explicar un proyecto propio.',
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

    var $ = function (id) { return document.getElementById(id); };
    var state = null;
    var presetId = 'practica';

    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function presetById(id) { return PRESETS.filter(function (p) { return p.id === id; })[0] || PRESETS[0]; }
    function lines(text) {
        return String(text || '').split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    }
    function sentence(text) {
        var t = String(text || '').trim();
        return t && !/[.!?]$/.test(t) ? t + '.' : t;
    }

    function load() {
        try {
            var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (saved && saved.state && saved.state.rasgos && saved.state.rasgos.length === 5) {
                state = saved.state;
                presetId = saved.presetId || 'practica';
                return;
            }
        } catch (e) { /* sin almacenamiento */ }
        state = clone(presetById('practica').data);
    }

    function save() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ presetId: presetId, state: state })); } catch (e) { /* ignore */ }
    }

    /* ---------- Generación automática del prompt ---------- */
    function buildPrompt(s) {
        var name = s.nombre.trim() || 'Agente';
        var rol = s.rol.trim() || 'asistente de Campuslands';
        var out = [];

        out.push('# IDENTIDAD');
        out.push('Eres ' + name + ', ' + rol + '.');
        out.push('');
        out.push('# PERSONALIDAD (modelo de los Cinco Grandes)');
        TRAITS.forEach(function (t, i) {
            out.push('- ' + t.label + ': ' + t.levels[s.rasgos[i]] + ' (' + t.hints[s.rasgos[i]] + ')');
        });

        if (s.objetivo.trim()) {
            out.push('');
            out.push('# OBJETIVO');
            out.push(sentence(s.objetivo));
        }

        out.push('');
        out.push('# CONOCIMIENTO DEL DOMINIO');
        out.push('Úsalo como tu única fuente de datos; si algo no está aquí, dilo con honestidad y no inventes datos:');
        lines(s.dominio).forEach(function (d) {
            var pending = /^(.*?):?\s*\[COMPLETAR[^\]]*\]\s*$/.exec(d);
            if (pending) {
                out.push('- ' + pending[1].trim() + ': todavía no hay datos cargados; dilo con honestidad y remite al equipo docente.');
            } else {
                out.push('- ' + d);
            }
        });

        out.push('');
        out.push('# TONO Y LENGUAJE');
        if (s.tono.trim()) out.push('- Tono: ' + s.tono.trim());
        if (s.lenguaje.trim()) out.push('- Lenguaje: ' + s.lenguaje.trim());

        out.push('');
        out.push('# FORMATO DE RESPUESTA');
        out.push('- Responde siempre en español.');
        out.push('- Respuestas cortas: máximo 3 oraciones (~60 palabras) de explicación, sin rodeos.');
        out.push('- Si muestras código, ponlo en un bloque con ``` indicando el lenguaje; que sea breve y explica solo lo esencial.');
        out.push('- Si el tema es amplio, da lo esencial y ofrece profundizar si te lo piden.');

        out.push('');
        out.push('# LÍMITES');
        lines(s.limites).forEach(function (l) { out.push('- ' + l); });
        out.push('- Eres una simulación: no afirmes tener emociones reales ni conciencia.');
        out.push('- Si una pregunta está fuera de tu dominio, dilo y orienta a la persona hacia quien corresponde.');

        return out.join('\n');
    }

    /* ---------- Validación y puntaje ---------- */
    function evaluate(s) {
        // En modo personalizado no hay perfil ideal con el que comparar
        var ideal = presetId === 'custom' ? null : presetById(presetId).data.rasgos;
        var checks = [];
        TRAITS.forEach(function (t, i) {
            var ok = !ideal || s.rasgos[i] === ideal[i];
            var hint = t.hints[s.rasgos[i]].charAt(0).toUpperCase() + t.hints[s.rasgos[i]].slice(1) + '.';
            checks.push({
                ok: ok,
                trait: t,
                text: ok ? (ideal ? ' encaja. ' : ' definido. ') + hint
                    : ' no encaja con el puesto: se recomienda ' + t.levels[ideal[i]] + '.'
            });
        });
        var nPending = lines(s.dominio).filter(function (l) { return /\[COMPLETAR/i.test(l); }).length;
        checks.push({
            ok: nPending === 0,
            text: nPending === 0 ? 'Todos los datos del dominio están completos.' : 'Faltan datos reales en el dominio: ' + nPending + ' por completar (los marcados [COMPLETAR]).'
        });
        var nDominio = lines(s.dominio).length;
        checks.push({ ok: !!s.nombre.trim(), text: s.nombre.trim() ? 'Tiene nombre propio.' : 'Falta el nombre del agente.' });
        checks.push({ ok: !!s.rol.trim(), text: s.rol.trim() ? 'Define su rol.' : 'Falta definir el rol.' });
        checks.push({ ok: nDominio >= 3, text: 'Conocimiento del dominio: ' + nDominio + ' datos' + (nDominio >= 3 ? '.' : ' (mínimo 3).') });
        checks.push({ ok: !!s.tono.trim(), text: s.tono.trim() ? 'El tono está definido.' : 'Falta definir el tono.' });
        checks.push({ ok: !!s.lenguaje.trim(), text: s.lenguaje.trim() ? 'Define el tipo de lenguaje.' : 'Falta definir el lenguaje.' });
        checks.push({ ok: s.objetivo.trim().length >= 10, text: s.objetivo.trim().length >= 10 ? 'Tiene un objetivo claro (al menos una frase).' : 'Falta un objetivo claro (al menos una frase).' });
        checks.push({ ok: lines(s.limites).length >= 1, text: lines(s.limites).length >= 1 ? 'Declara al menos un límite.' : 'Declara al menos un límite.' });
        var passed = checks.filter(function (c) { return c.ok; }).length;
        return { checks: checks, score: Math.round(passed / checks.length * 100) };
    }

    /* ---------- Render ---------- */
    var SIMPLE = ['nombre', 'rol', 'tono', 'lenguaje', 'objetivo'];

    function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function renderPresets() {
        var box = $('presetCards');
        box.innerHTML = '';
        PRESETS.forEach(function (p) {
            var b = el('button', 'chip' + (p.id === presetId ? ' active' : ''));
            b.type = 'button';
            b.title = p.desc;
            b.appendChild(el('span', 'chip-area', p.area));
            b.appendChild(el('span', 'chip-title', p.title));
            b.addEventListener('click', function () {
                presetId = p.id;
                state = clone(p.data);
                save();
                fillForm();
                renderPresets();
                update();
            });
            box.appendChild(b);
        });

        var custom = el('button', 'chip' + (presetId === 'custom' ? ' active' : ''));
        custom.type = 'button';
        custom.title = 'Tu propia ficha, sin comparar con un perfil ideal';
        custom.appendChild(el('span', 'chip-area', 'PROPIO'));
        custom.appendChild(el('span', 'chip-title', 'Personalizado'));
        custom.addEventListener('click', function () {
            presetId = 'custom';
            save();
            renderPresets();
            update();
        });
        box.appendChild(custom);
    }

    function renderTraits() {
        var box = $('traits');
        box.innerHTML = '';
        TRAITS.forEach(function (t, i) {
            var row = el('div', 'trait');
            row.style.setProperty('--c', t.color);
            var head = el('div', 'trait-head');
            head.appendChild(el('span', 'trait-name', t.label));
            head.appendChild(el('span', 'trait-en', t.en));
            head.appendChild(el('span', 'trait-val'));
            var range = document.createElement('input');
            range.type = 'range';
            range.min = 0; range.max = 2; range.step = 1;
            range.id = 'r-' + i;
            range.setAttribute('aria-label', t.label);
            range.addEventListener('input', function () {
                state.rasgos[i] = Number(range.value);
                save();
                update();
            });
            var ticks = el('div', 'ticks');
            t.levels.forEach(function (l) { ticks.appendChild(el('span', null, l)); });
            row.appendChild(head);
            row.appendChild(range);
            row.appendChild(ticks);
            row.appendChild(el('p', 'trait-hint'));
            box.appendChild(row);
        });
    }

    function mountTags(key, boxId, placeholder) {
        var box = $(boxId);
        box.innerHTML = '';
        var list = lines(state[key]);
        var write = function (arr) {
            state[key] = arr.join('\n');
            save();
            mountTags(key, boxId, placeholder);
            update();
            $(boxId).querySelector('input').focus();
        };
        list.forEach(function (item, idx) {
            var chip = el('span', 'tag');
            chip.appendChild(el('span', null, item));
            var x = el('button', 'tag-x', '×');
            x.type = 'button';
            x.setAttribute('aria-label', 'Quitar');
            x.addEventListener('click', function () { var c = lines(state[key]); c.splice(idx, 1); write(c); });
            chip.appendChild(x);
            box.appendChild(chip);
        });
        var input = document.createElement('input');
        input.type = 'text';
        input.placeholder = placeholder;
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                var parts = lines(input.value);
                if (parts.length) write(lines(state[key]).concat(parts));
            } else if (e.key === 'Backspace' && !input.value) {
                var c = lines(state[key]);
                if (c.length) { c.pop(); write(c); }
            }
        });
        input.addEventListener('paste', function (e) {
            var txt = (e.clipboardData || window.clipboardData).getData('text');
            if (txt.indexOf('\n') !== -1) { e.preventDefault(); write(lines(state[key]).concat(lines(txt))); }
        });
        box.appendChild(input);
    }

    function fillForm() {
        SIMPLE.forEach(function (k) { $('f-' + k).value = state[k]; });
        mountTags('dominio', 'tags-dominio', 'Escribe un dato y presiona Enter…');
        mountTags('limites', 'tags-limites', 'Escribe una regla y presiona Enter…');
    }

    function radarSvg() {
        var cx = 110, cy = 105, R = 78, n = TRAITS.length;
        var pt = function (i, r) {
            var ang = -Math.PI / 2 + i * 2 * Math.PI / n;
            return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
        };
        var ns = 'http://www.w3.org/2000/svg';
        var svg = document.createElementNS(ns, 'svg');
        svg.setAttribute('viewBox', '0 0 220 215');
        svg.setAttribute('class', 'radar');
        [1, 2, 3].forEach(function (lv) {
            var poly = document.createElementNS(ns, 'polygon');
            poly.setAttribute('points', TRAITS.map(function (_, i) { return pt(i, R * lv / 3).join(','); }).join(' '));
            poly.setAttribute('class', 'grid');
            svg.appendChild(poly);
        });
        TRAITS.forEach(function (t, i) {
            var o = pt(i, R);
            var line = document.createElementNS(ns, 'line');
            line.setAttribute('x1', cx); line.setAttribute('y1', cy); line.setAttribute('x2', o[0]); line.setAttribute('y2', o[1]);
            line.setAttribute('class', 'axis');
            svg.appendChild(line);
        });
        var shape = document.createElementNS(ns, 'polygon');
        shape.setAttribute('points', state.rasgos.map(function (v, i) { return pt(i, R * (v + 1) / 3).join(','); }).join(' '));
        shape.setAttribute('class', 'shape');
        svg.appendChild(shape);
        TRAITS.forEach(function (t, i) {
            var d = pt(i, R * (state.rasgos[i] + 1) / 3);
            var c = document.createElementNS(ns, 'circle');
            c.setAttribute('cx', d[0]); c.setAttribute('cy', d[1]); c.setAttribute('r', 4); c.setAttribute('fill', t.color);
            svg.appendChild(c);
            var lp = pt(i, R + 17);
            var tx = document.createElementNS(ns, 'text');
            tx.setAttribute('x', lp[0]); tx.setAttribute('y', lp[1] + 3); tx.setAttribute('text-anchor', 'middle');
            tx.textContent = t.label.slice(0, 3).toUpperCase();
            svg.appendChild(tx);
        });
        return svg;
    }

    function update() {
        var name = state.nombre.trim() || 'Agente';

        // Rasgos
        TRAITS.forEach(function (t, i) {
            var row = $('traits').children[i];
            var range = $('r-' + i);
            range.value = state.rasgos[i];
            range.setAttribute('aria-valuetext', t.levels[state.rasgos[i]]);
            range.style.setProperty('--fill', (state.rasgos[i] * 50) + '%');
            row.querySelector('.trait-val').textContent = t.levels[state.rasgos[i]];
            row.querySelector('.trait-hint').textContent = t.hints[state.rasgos[i]].charAt(0).toUpperCase() + t.hints[state.rasgos[i]].slice(1) + '.';
        });

        // Credencial
        $('avatarLetter').textContent = name.charAt(0).toUpperCase();
        $('cardName').textContent = name;
        $('cardRole').textContent = state.rol.trim() || 'Sin rol definido';
        var radar = $('radarBox');
        radar.innerHTML = '';
        radar.appendChild(radarSvg());

        // Calidad
        var ev = evaluate(state);
        var good = ev.checks.filter(function (c) { return c.ok; }).length;
        $('qualityFill').style.width = ev.score + '%';
        $('qualityFill').className = 'fill ' + (ev.score >= 90 ? 'hi' : ev.score >= 70 ? 'mid' : 'lo');
        $('qualityPct').textContent = ev.score + '%';
        $('qualityLabel').textContent = (ev.score >= 90 ? 'Lista para usar' : ev.score >= 70 ? 'Casi lista' : 'Incompleta') + ' · ' + good + '/' + ev.checks.length + ' comprobaciones';
        var pend = $('pending');
        pend.innerHTML = '';
        var bad = ev.checks.filter(function (c) { return !c.ok; });
        if (!bad.length) {
            pend.appendChild(el('li', 'ok', '✓ Sin pendientes: la ficha cumple todo.'));
        } else {
            bad.forEach(function (c) {
                var li = el('li', 'bad');
                li.appendChild(document.createTextNode('! '));
                if (c.trait) { var b = el('b', null, c.trait.label); b.style.color = c.trait.color; li.appendChild(b); }
                li.appendChild(document.createTextNode(c.text));
                pend.appendChild(li);
            });
        }

        // Puntos de comprobación (uno por criterio)
        var dots = $('dots');
        dots.innerHTML = '';
        ev.checks.forEach(function (c) {
            var d = el('span', 'dot-ck ' + (c.ok ? 'ok' : 'bad'));
            dots.appendChild(d);
        });

        // Leyenda de rasgos junto al radar
        var legend = $('traitLegend');
        legend.innerHTML = '';
        TRAITS.forEach(function (t, i) {
            var it = el('span', 'lg');
            var sw = el('i');
            sw.style.background = t.color;
            it.appendChild(sw);
            it.appendChild(document.createTextNode(t.label + ' '));
            it.appendChild(el('b', null, t.levels[state.rasgos[i]]));
            legend.appendChild(it);
        });

        // Contador de la misión
        $('cnt-objetivo').textContent = state.objetivo.length + ' caracteres';

        $('agentBadge').textContent = name;
        document.dispatchEvent(new CustomEvent('persona:changed'));
    }

    /* ---------- Exportar / importar ficha ---------- */
    function say(msg, isErr) {
        var m = $('ioMsg');
        m.textContent = msg;
        m.className = 'io-msg' + (isErr ? ' err' : '');
        clearTimeout(say.t);
        say.t = setTimeout(function () { m.textContent = ''; }, 4000);
    }

    function slug() {
        return (state.nombre.trim() || 'ficha').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'ficha';
    }

    function exportFicha() {
        var data = { version: 1, tipo: 'ficha-agente', ficha: state };
        var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = slug() + '.ficha.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
        say('Ficha exportada.');
    }

    function validFicha(f) {
        if (!f || typeof f !== 'object') return false;
        var texts = ['nombre', 'rol', 'dominio', 'tono', 'lenguaje', 'objetivo', 'limites'];
        for (var i = 0; i < texts.length; i++) { if (typeof f[texts[i]] !== 'string') return false; }
        return Array.isArray(f.rasgos) && f.rasgos.length === 5 &&
            f.rasgos.every(function (n) { return n === 0 || n === 1 || n === 2; });
    }

    function importFicha(file) {
        var reader = new FileReader();
        reader.onload = function () {
            try {
                var json = JSON.parse(reader.result);
                var f = json && json.ficha ? json.ficha : json;
                if (!validFicha(f)) { say('El archivo no tiene el formato de una ficha.', true); return; }
                var clean = {};
                ['nombre', 'rol', 'dominio', 'tono', 'lenguaje', 'objetivo', 'limites'].forEach(function (k) { clean[k] = f[k].slice(0, 2000); });
                clean.rasgos = f.rasgos.slice();
                state = clean;
                presetId = 'custom';
                save();
                fillForm();
                renderPresets();
                update();
                say('Ficha importada: ' + (state.nombre || 'sin nombre') + '.');
            } catch (e) {
                say('No se pudo leer el archivo JSON.', true);
            }
        };
        reader.readAsText(file);
    }

    /* ---------- Prueba rápida ---------- */
    var testCtl = null;
    function runTest() {
        var api = window.ChatAPI;
        var out = $('testOut');
        var q = $('testQ').value.trim();
        if (!q || !api) return;
        if (testCtl) { testCtl.abort(); return; }
        if (!api.hasAccess()) { api.openKeyDialog(); return; }

        out.hidden = false;
        out.classList.remove('error');
        out.textContent = 'Pensando…';
        $('testGo').textContent = 'Detener';
        testCtl = new AbortController();
        api.ask({
            messages: [{ role: 'system', content: buildPrompt(state) }, { role: 'user', content: q }],
            model: api.getModel(),
            maxTokens: api.tokenBudget(q),
            signal: testCtl.signal,
            onToken: function (t) { api.renderMarkdown(out, t); }
        }).then(function (r) {
            api.renderMarkdown(out, r.text || '(sin contenido)');
        }).catch(function (e) {
            if (e && e.name === 'AbortError') return;
            out.classList.add('error');
            out.textContent = (e && e.friendly) ? e.message : 'No se pudo probar. Inténtalo de nuevo.';
        }).then(function () {
            testCtl = null;
            $('testGo').textContent = 'Probar';
        });
    }

    function wire() {
        SIMPLE.forEach(function (k) {
            $('f-' + k).addEventListener('input', function (e) {
                state[k] = e.target.value;
                // Si cambia el nombre o el rol, ya no es el arquetipo original
                if ((k === 'nombre' || k === 'rol') && presetId !== 'custom' && state[k] !== presetById(presetId).data[k]) {
                    presetId = 'custom';
                    renderPresets();
                }
                save();
                update();
            });
        });

        $('tryChat').addEventListener('click', function () {
            document.querySelector('[data-view=chat]').click();
            var prompt = document.getElementById('prompt');
            if (prompt) prompt.focus();
        });
        $('resetPersona').addEventListener('click', function () {
            if (presetId === 'custom') presetId = PRESETS[0].id;
            state = clone(presetById(presetId).data);
            save();
            fillForm();
            renderPresets();
            update();
        });

        $('exportFicha').addEventListener('click', exportFicha);
        $('importFicha').addEventListener('click', function () { $('importFile').click(); });
        $('importFile').addEventListener('change', function (e) {
            if (e.target.files && e.target.files[0]) importFicha(e.target.files[0]);
            e.target.value = '';
        });
        $('testGo').addEventListener('click', runTest);
        $('testQ').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runTest(); } });
    }

    /* ---------- Vistas (Chat / Agente) ---------- */
    function wireViews() {
        var tabs = document.querySelectorAll('[data-view]');
        Array.prototype.forEach.call(tabs, function (tab) {
            tab.addEventListener('click', function () {
                var view = tab.dataset.view;
                $('chatView').hidden = view !== 'chat';
                $('personaView').hidden = view !== 'persona';
                Array.prototype.forEach.call(tabs, function (t) { t.classList.toggle('active', t === tab); });
            });
        });
    }

    load();
    renderPresets();
    renderTraits();
    fillForm();
    wire();
    wireViews();
    update();

    // API para el chat
    window.Persona = {
        getPrompt: function () { return buildPrompt(state); },
        getName: function () { return state.nombre.trim() || 'Agente'; }
    };
})();
