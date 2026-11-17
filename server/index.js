'use strict';
const { createApp } = require('./app');

const app = createApp();
app.server.listen(app.cfg.port, function () {
    console.log('ChatBot MJ escuchando en http://localhost:' + app.cfg.port);
    if (!app.cfg.openaiKey) {
        console.warn('AVISO: falta OPENAI_API_KEY; el chat no responderá hasta que la configures en el archivo .env.');
    }
    if (app.boot) {
        console.log('\n=== Primer inicio ===');
        console.log('Se creó la cuenta de administrador:');
        console.log('  usuario:    ' + app.boot.username);
        console.log('  contraseña: ' + app.boot.password + (app.boot.generated ? '  (generada; cámbiala al entrar)' : '  (tomada de ADMIN_PASSWORD; cámbiala al entrar)'));
        console.log('=====================\n');
    }
});

function shutdown() { app.close().then(function () { process.exit(0); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
