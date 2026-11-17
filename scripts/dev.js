'use strict';
/* Modo de desarrollo: arranca el servidor con una IA SIMULADA (no gasta saldo ni necesita API key).
   Usuario: admin · contraseña inicial: Admin1234 (el sistema pedirá cambiarla). Base de datos temporal en data/dev.db. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MOCK_PORT = Number(process.env.MOCK_PORT) || 4010;
const root = path.join(__dirname, '..');
const dbFile = path.join(root, 'data', 'dev.db');
if (!process.env.KEEP_DEV_DB) {
    ['', '-wal', '-shm'].forEach(function (s) { try { fs.unlinkSync(dbFile + s); } catch (e) { /* no existía */ } });
}

function reply(question) {
    if (/c[oó]digo|funci[oó]n|ejemplo|bucle|variable/i.test(question)) {
        return 'Una **función** es un bloque de código reutilizable que recibe datos y devuelve un resultado.\n```js\nfunction saludar(nombre) {\n  return \'Hola, \' + nombre;\n}\nconsole.log(saludar(\'Ana\'));\n```\nPrueba cambiar el nombre y mira qué imprime.';
    }
    if (/entend/i.test(question)) return 'Claro, vamos más simple: piensa en una receta. Los **ingredientes** son los datos y los pasos son el código.';
    return 'Esta semana veremos **JavaScript**: funciones, arreglos y manejo del DOM. ¿Quieres que repasemos alguno?';
}

http.createServer(function (req, res) {
    let raw = '';
    req.on('data', function (c) { raw += c; });
    req.on('end', function () {
        let body = {};
        try { body = JSON.parse(raw); } catch (e) { /* vacío */ }
        const msgs = body.messages || [];
        const last = msgs.length ? msgs[msgs.length - 1].content : '';
        const words = reply(last).split(/(?<=\s)/);
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        let i = 0;
        const timer = setInterval(function () {
            if (i < words.length) {
                res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: words[i++] } }] }) + '\n\n');
            } else {
                clearInterval(timer);
                res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\n');
                res.write('data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 220, completion_tokens: words.length * 2 } }) + '\n\ndata: [DONE]\n\n');
                res.end();
            }
        }, 30);
        res.on('close', function () { clearInterval(timer); });
    });
}).listen(MOCK_PORT, function () {
    process.env.OPENAI_URL = 'http://localhost:' + MOCK_PORT + '/v1/chat/completions';
    process.env.OPENAI_API_KEY = 'clave-falsa-de-desarrollo';
    process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin1234';
    process.env.DB_PATH = dbFile;
    console.log('IA simulada en el puerto ' + MOCK_PORT + ' (solo desarrollo).');
    require('../server/index.js');
});
