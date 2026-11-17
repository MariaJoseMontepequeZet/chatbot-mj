'use strict';
const fs = require('fs');
const path = require('path');

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
};

function parseCookies(header) {
    const out = {};
    String(header || '').split(';').forEach(function (part) {
        const i = part.indexOf('=');
        if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
}

function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
}

function sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store'
    });
    res.end(body);
}

function readJson(req, limit) {
    limit = limit || 1000000;
    return new Promise(function (resolve, reject) {
        let size = 0;
        const chunks = [];
        req.on('data', function (c) {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('Solicitud demasiado grande.'), { status: 413 })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', function () {
            if (!chunks.length) return resolve({});
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
        });
        req.on('error', reject);
    });
}

function serveStatic(cfg, req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(cfg.publicDir, rel));
    if (file.indexOf(cfg.publicDir) !== 0) { res.writeHead(403); res.end('Prohibido'); return; }
    fs.stat(file, function (err, st) {
        if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('No encontrado'); return; }
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': 'no-cache'
        });
        fs.createReadStream(file).pipe(res);
    });
}

module.exports = { parseCookies, securityHeaders, sendJson, readJson, serveStatic };
