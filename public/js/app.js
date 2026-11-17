/* Arranque de la aplicación: vistas por rol y conexión entre módulos. */
(function () {
    'use strict';
    const App = window.App;
    const { $ } = App.ui;

    const ROLE_LABEL = { admin: 'Administrador', camper: 'Camper' };

    function showView(view) {
        $('chatView').hidden = view !== 'chat';
        $('personaView').hidden = view !== 'persona';
        $('adminView').hidden = view !== 'admin';
        Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (t) {
            const on = t.dataset.view === view;
            t.classList.toggle('active', on);
            if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
        });
        if (view === 'persona' && App.persona) App.persona.show();
        if (view === 'admin' && App.admin) App.admin.show();
    }

    App.onLogin = function (data) {
        const isAdmin = data.user.role === 'admin';
        Array.prototype.forEach.call(document.querySelectorAll('.admin-only'), function (n) { n.hidden = !isAdmin; });
        $('userBtn').textContent = data.user.name;
        $('userPanelName').textContent = data.user.name + ' (' + data.user.username + ')';
        $('userPanelRole').textContent = ROLE_LABEL[data.user.role] || data.user.role;
        App.chat.start(data);
        if (isAdmin) { App.persona.start(); App.admin.start(); }
        showView('chat');
    };

    App.onLogout = function () {
        App.chat.reset();
        if (App.persona) App.persona.reset();
        if (App.admin) App.admin.reset();
        Array.prototype.forEach.call(document.querySelectorAll('.admin-only'), function (n) { n.hidden = true; });
        $('userPanel').hidden = true;
    };

    document.addEventListener('DOMContentLoaded', function () {
        App.ui.initPrefs();
        App.auth.init();
        App.chat.init();
        if (App.persona) App.persona.init();
        if (App.admin) App.admin.init();
        Array.prototype.forEach.call(document.querySelectorAll('[data-view]'), function (tab) {
            tab.addEventListener('click', function () { showView(tab.dataset.view); });
        });
        App.auth.boot();
    });
})();
