// Test yardımcıları: bellekte çalışan veritabanıyla sunucu ve çerezli istemci
process.env.DB_PATH = ':memory:';

const { once } = require('node:events');
const { createApp } = require('../src/app');

async function startServer() {
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

// Her istemci kendi oturum çerezini tutar (ayrı kullanıcı gibi davranır)
function client(base) {
  let cookie = '';
  return async function call(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), cookie, ...headers },
      body: body && JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data, headers: res.headers };
  };
}

module.exports = { startServer, client };
