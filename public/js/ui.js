/* Utilidades de interfaz: elementos, avisos, tema, tamaño de letra, formato de respuestas y descargas. */
(function () {
    'use strict';
    window.App = window.App || {};

    const $ = function (id) { return document.getElementById(id); };

    function el(tag, cls, text) {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }

    function store(key, value) {
        try {
            if (value === undefined) return localStorage.getItem(key);
            localStorage.setItem(key, value);
        } catch (e) { /* almacenamiento no disponible */ }
        return null;
    }

    /* ---------- Avisos (toasts) ---------- */
    function toast(message, type) {
        const box = $('toasts');
        if (!box) return;
        const t = el('div', 'toast ' + (type || ''), message);
        t.setAttribute('role', type === 'error' ? 'alert' : 'status');
        box.appendChild(t);
        setTimeout(function () { t.classList.add('out'); setTimeout(function () { t.remove(); }, 300); }, type === 'error' ? 6000 : 3500);
    }

    /* ---------- Tema y tamaño de letra ---------- */
    function applyTheme(mode) {
        const dark = mode === 'dark' || (mode !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        const btn = $('themeBtn');
        if (btn) { btn.textContent = dark ? 'Tema claro' : 'Tema oscuro'; btn.setAttribute('aria-pressed', String(!dark)); }
    }

    function initPrefs() {
        let mode = store('mj_theme') || 'dark';
        applyTheme(mode);
        let size = Number(store('mj_fs'));
        if (![0, 1, 2].includes(size)) size = 1;
        document.documentElement.dataset.fs = String(size);
        const themeBtn = $('themeBtn');
        if (themeBtn) themeBtn.addEventListener('click', function () {
            mode = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
            store('mj_theme', mode);
            applyTheme(mode);
        });
        const set = function (n) { size = Math.min(2, Math.max(0, n)); document.documentElement.dataset.fs = String(size); store('mj_fs', String(size)); };
        const up = $('fontUp'); const down = $('fontDown');
        if (up) up.addEventListener('click', function () { set(size + 1); });
        if (down) down.addEventListener('click', function () { set(size - 1); });
    }

    /* ---------- Formato de respuestas (markdown seguro, sin innerHTML) ---------- */
    function renderInline(parent, text) {
        const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\s][^*\n]*\*)/g;
        let last = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
            if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
            const tok = m[0];
            let node;
            if (tok.charAt(0) === '`') { node = el('code', null, tok.slice(1, -1)); }
            else if (tok.indexOf('**') === 0) { node = el('strong', null, tok.slice(2, -2)); }
            else { node = el('em', null, tok.slice(1, -1)); }
            parent.appendChild(node);
            last = m.index + tok.length;
        }
        if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    }

    function renderBlocks(container, text) {
        let para = null;
        let list = null;
        text.split('\n').forEach(function (raw) {
            const line = raw.replace(/\s+$/, '');
            if (!line.trim()) { para = null; list = null; return; }
            const heading = /^#{1,6}\s+(.*)$/.exec(line);
            if (heading) {
                para = null; list = null;
                const h = el('p', 'md-h');
                renderInline(h, heading[1]);
                container.appendChild(h);
                return;
            }
            const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
            if (item) {
                para = null;
                const ordered = !!item[2];
                if (!list || list.ordered !== ordered) {
                    const node = el(ordered ? 'ol' : 'ul');
                    container.appendChild(node);
                    list = { node: node, ordered: ordered };
                }
                const li = el('li');
                renderInline(li, item[3]);
                list.node.appendChild(li);
                return;
            }
            list = null;
            if (!para) { para = el('p'); container.appendChild(para); } else { para.appendChild(document.createElement('br')); }
            renderInline(para, line);
        });
    }

    function copyText(text, button) {
        if (!(navigator.clipboard && navigator.clipboard.writeText)) return;
        navigator.clipboard.writeText(text).then(function () {
            if (!button) return;
            const old = button.textContent;
            button.textContent = '¡Copiado!';
            setTimeout(function () { button.textContent = old; }, 1500);
        }, function () { /* sin permiso */ });
    }

    function codeBlock(code, lang) {
        const wrap = el('div', 'codeblock');
        const head = el('div', 'codeblock-head');
        head.appendChild(el('span', null, lang || 'código'));
        const copy = el('button', 'copy-code', 'Copiar');
        copy.type = 'button';
        copy.addEventListener('click', function () { copyText(code, copy); });
        head.appendChild(copy);
        const pre = el('pre');
        pre.appendChild(el('code', null, code));
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
                if (nl !== -1 && /^[\w+#.-]*$/.test(part.slice(0, nl).trim())) { lang = part.slice(0, nl).trim(); code = part.slice(nl + 1); }
                container.appendChild(codeBlock(code.replace(/\n$/, ''), lang));
            } else if (part) {
                renderBlocks(container, part);
            }
        });
    }

    function download(filename, text, type) {
        const blob = new Blob([text], { type: type || 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
    }

    function formatDate(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        return isNaN(d) ? '—' : d.toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' });
    }

    /* ---------- Diálogo con datos que se muestran una sola vez (contraseñas temporales) ---------- */
    function showSecrets(title, intro, rows, csvName) {
        const dlg = $('secretsDialog');
        $('secretsTitle').textContent = title;
        $('secretsIntro').textContent = intro;
        const body = $('secretsBody');
        body.textContent = '';
        const table = el('table', 'tbl');
        const head = el('tr');
        ['Nombre', 'Usuario', 'Contraseña temporal'].forEach(function (h) { head.appendChild(el('th', null, h)); });
        table.appendChild(head);
        rows.forEach(function (r) {
            const tr = el('tr');
            tr.appendChild(el('td', null, r.name || ''));
            tr.appendChild(el('td', null, r.username));
            tr.appendChild(el('td', 'mono', r.tempPassword));
            table.appendChild(tr);
        });
        body.appendChild(table);
        const csv = 'nombre,usuario,contraseña_temporal\n' + rows.map(function (r) {
            return [r.name || '', r.username, r.tempPassword].map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
        }).join('\n');
        $('secretsCopy').onclick = function () { copyText(rows.map(function (r) { return r.username + '\t' + r.tempPassword; }).join('\n'), $('secretsCopy')); };
        $('secretsCsv').onclick = function () { download(csvName || 'cuentas.csv', csv, 'text/csv'); };
        dlg.showModal();
    }

    window.App.ui = {
        $: $, el: el, store: store, toast: toast, initPrefs: initPrefs,
        renderMarkdown: renderMarkdown, copyText: copyText, download: download,
        formatDate: formatDate, showSecrets: showSecrets
    };
})();
