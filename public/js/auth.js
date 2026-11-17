/* Inicio de sesión, cambio de contraseña y cierre de sesión. */
(function () {
    'use strict';
    const App = window.App;
    const { $ } = App.ui;
    const api = App.api;

    function show(which) {
        ['boot', 'loginView', 'pwView', 'app'].forEach(function (id) { $(id).hidden = id !== which; });
    }

    function setError(id, msg) {
        const e = $(id);
        e.textContent = msg || '';
        e.hidden = !msg;
    }

    function showLogin(message) {
        show('loginView');
        $('loginPass').value = '';
        setError('loginError', message);
        $('loginUser').focus();
    }

    function showPassword(forced) {
        show('pwView');
        $('pwForm').reset();
        setError('pwError', '');
        $('pwTitle').textContent = forced ? 'Crea tu contraseña' : 'Cambiar contraseña';
        $('pwSub').textContent = forced
            ? 'Es tu primer ingreso (o el administrador restableció tu clave): elige una contraseña propia, mínimo 8 caracteres con letras y números.'
            : 'Elige una contraseña nueva, mínimo 8 caracteres con letras y números.';
        $('pwCancel').hidden = forced;
        $('pwCurrent').focus();
    }

    async function boot() {
        show('boot');
        try {
            const data = await api.get('/api/me');
            App.me = data;
            if (data.user.mustChange) { showPassword(true); return; }
            show('app');
            App.onLogin(data);
        } catch (e) {
            if (e.status === 401) showLogin();
            else showLogin('No se pudo conectar con el servidor. Inténtalo de nuevo.');
        }
    }

    async function logout() {
        try { await api.post('/api/logout'); } catch (e) { /* aunque falle, volvemos al login */ }
        App.me = null;
        if (App.onLogout) App.onLogout();
        showLogin();
    }

    let expiredShown = false;
    App.onAuthExpired = function () {
        if (expiredShown) return;
        expiredShown = true;
        setTimeout(function () { expiredShown = false; }, 1500);
        if (App.onLogout) App.onLogout();
        App.me = null;
        showLogin('Tu sesión caducó. Inicia sesión de nuevo.');
    };

    function init() {
        $('loginShow').addEventListener('click', function () {
            const input = $('loginPass');
            const visible = input.type === 'text';
            input.type = visible ? 'password' : 'text';
            $('loginShow').textContent = visible ? 'Ver' : 'Ocultar';
            $('loginShow').setAttribute('aria-pressed', String(!visible));
        });

        $('loginForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            setError('loginError', '');
            const btn = $('loginBtn');
            btn.disabled = true;
            btn.textContent = 'Entrando…';
            try {
                await api.post('/api/login', { username: $('loginUser').value.trim(), password: $('loginPass').value });
                $('loginPass').value = '';
                await boot();
            } catch (err) {
                setError('loginError', err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Entrar';
            }
        });

        $('pwForm').addEventListener('submit', async function (e) {
            e.preventDefault();
            setError('pwError', '');
            if ($('pwNew').value !== $('pwConfirm').value) { setError('pwError', 'Las contraseñas nuevas no coinciden.'); return; }
            try {
                await api.post('/api/password', { current: $('pwCurrent').value, next: $('pwNew').value });
                App.ui.toast('Contraseña actualizada.', 'ok');
                await boot();
            } catch (err) {
                setError('pwError', err.message);
            }
        });

        $('pwCancel').addEventListener('click', function () { show('app'); });
        $('pwLogout').addEventListener('click', logout);
        $('logoutBtn').addEventListener('click', logout);
        $('changePwBtn').addEventListener('click', function () { closeMenu(); showPassword(false); });

        // Menú de usuario
        $('userBtn').addEventListener('click', function (e) {
            e.stopPropagation();
            const open = $('userPanel').hidden;
            $('userPanel').hidden = !open;
            $('userBtn').setAttribute('aria-expanded', String(open));
        });
        document.addEventListener('click', function (e) { if (!$('userPanel').contains(e.target)) closeMenu(); });
        document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    }

    function closeMenu() {
        $('userPanel').hidden = true;
        $('userBtn').setAttribute('aria-expanded', 'false');
    }

    App.auth = { init: init, boot: boot, logout: logout };
})();
