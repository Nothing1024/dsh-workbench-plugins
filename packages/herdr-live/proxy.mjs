import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {createSidebarChannel} from './sidebar-channel.mjs';
import {readHerdrPrefs, sanitizeHerdrPrefs, writeHerdrPrefs} from './prefs.mjs';

const HOP_HEADERS = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade']);
const PRIVATE_HEADERS = new Set(['cookie','authorization','referer','forwarded','x-forwarded-for','x-forwarded-host','x-forwarded-proto']);

function loopbackOrigin(value, label) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1','[::1]','localhost'].includes(url.hostname) || url.href.includes('@') || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`${label} must be an HTTP loopback origin`);
  }
  return url;
}

/**
 * A temporary, loopback-only facade for the original Ovis application.
 * API bodies and PTY/WebSocket bytes pass through unchanged. The app document
 * gains an external metadata-only selection adapter; installed Ovis is not modified.
 */
export function createOvisProxy({upstreamOrigin='http://127.0.0.1:7317', parentOrigin='http://127.0.0.1:50759', port=50760, host='127.0.0.1'}={}) {
  let upstream = loopbackOrigin(upstreamOrigin, 'Ovis upstream');
  let parent = loopbackOrigin(parentOrigin, 'DSH parent').origin;
  if (host !== '127.0.0.1') throw new Error('The temporary Ovis facade binds only to 127.0.0.1');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid facade port');
  const sockets = new Set();
  const tunnels = new Set();
  const stats = {httpRequests:0, websocketConnections:0, activeWebSockets:0, deniedRequests:0, upstreamErrors:0};
  let origin;
  let closing=false;
  let sidebar=createSidebarChannel({upstreamOrigin:upstream.origin,parentOrigin:parent});

  function publicConfig(extra = {}) {
    return {
      upstreamOrigin: upstream.origin,
      parentOrigin: parent,
      proxyPort: origin ? Number(new URL(origin).port) : port,
      frameOrigin: origin || `http://127.0.0.1:${port}`,
      ...extra,
    };
  }

  function json(res, status, body, extraHeaders = {}) {
    if (res.writableEnded || res.destroyed) return;
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      vary: 'Origin',
      ...extraHeaders,
    });
    res.end(JSON.stringify(body));
  }

  function allowParent(req, res) {
    if (!origin) return false;
    res.setHeader('Vary', 'Origin');
    if (req.headers.host !== new URL(origin).host || req.headers.origin !== parent) {
      json(res, 403, {error: {code: 'forbidden_origin', message: 'This configuration API is restricted to its DSH parent origin'}});
      return false;
    }
    res.setHeader('Access-Control-Allow-Origin', parent);
    return true;
  }

  async function readJsonBody(req, limit = 16 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) {
        const error = new Error('Request body too large');
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch {
      const error = new Error('Invalid JSON');
      error.status = 400;
      throw error;
    }
  }

  async function probeUpstream(target = upstream.origin) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      const response = await fetch(new URL('/api/session', target), {
        headers: {Accept: 'application/json', Origin: target},
        signal: ac.signal,
      });
      return {ok: response.ok || [401, 403].includes(response.status), status: response.status};
    } catch (error) {
      return {ok: false, error: error.name === 'AbortError' ? 'Ovis 未在超时内响应' : '无法连接 Ovis / Herdr'};
    } finally {
      clearTimeout(timer);
    }
  }

  async function replaceSidebar(nextUpstream, nextParent) {
    if (nextUpstream.origin === upstream.origin && nextParent === parent) return false;
    const previous = sidebar;
    upstream = nextUpstream;
    parent = nextParent;
    sidebar = createSidebarChannel({upstreamOrigin: upstream.origin, parentOrigin: parent});
    try { await previous.close(); } catch { /* previous consumers already gone */ }
    return true;
  }

  function handleMeta(req, res) {
    const pathname = (req.url ?? '').split('?')[0];
    if (pathname !== '/__dsh_herdr/health' && pathname !== '/__dsh_herdr/config') return false;
    if (req.method === 'OPTIONS') {
      if (!allowParent(req, res)) return true;
      const method = req.headers['access-control-request-method'];
      const requested = req.headers['access-control-request-headers'];
      const names = typeof requested === 'string' ? requested.split(',').map(name => name.trim().toLowerCase()).filter(Boolean) : [];
      if ((method !== undefined && !['GET', 'POST', 'OPTIONS'].includes(method)) || names.some(name => name !== 'content-type')) {
        json(res, 403, {error: {code: 'forbidden_preflight', message: 'Only GET, POST, OPTIONS and Content-Type are allowed'}});
      } else {
        res.writeHead(204, {'cache-control': 'no-store', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'});
        res.end();
      }
      return true;
    }
    if (!allowParent(req, res)) return true;
    const run = async () => {
      if (pathname === '/__dsh_herdr/health') {
        if (req.method !== 'GET') { json(res, 405, {error: {code: 'method_not_allowed', message: 'Use GET'}}, {Allow: 'GET, OPTIONS'}); return; }
        const upstreamProbe = await probeUpstream();
        json(res, 200, {ok: upstreamProbe.ok, facade: publicConfig(), upstream: upstreamProbe});
        return;
      }
      if (req.method === 'GET') {
        const stored = await readHerdrPrefs();
        json(res, 200, {ok: true, ...publicConfig(), stored});
        return;
      }
      if (req.method !== 'POST') { json(res, 405, {error: {code: 'method_not_allowed', message: 'Use GET or POST'}}, {Allow: 'GET, POST, OPTIONS'}); return; }
      let body;
      try { body = await readJsonBody(req); }
      catch (error) { json(res, error.status || 400, {error: {code: 'invalid_body', message: error.message}}); return; }
      let next;
      try { next = sanitizeHerdrPrefs({...(await readHerdrPrefs()), ...body}); }
      catch (error) { json(res, 400, {error: {code: 'invalid_config', message: error.message}}); return; }
      const stored = await writeHerdrPrefs(next);
      const nextUpstream = loopbackOrigin(stored.upstreamOrigin, 'Ovis upstream');
      const nextParent = loopbackOrigin(stored.parentOrigin, 'DSH parent').origin;
      const applied = await replaceSidebar(nextUpstream, nextParent);
      const restartRequired = stored.proxyPort !== (origin ? Number(new URL(origin).port) : port);
      json(res, 200, {
        ok: true,
        applied,
        restartRequired,
        message: restartRequired ? '代理端口已保存，重启 DSH 或本插件后生效。接入地址已尝试立即应用。' : (applied ? '接入地址已立即应用。' : '配置已保存。'),
        ...publicConfig({stored}),
      });
    };
    run().catch(() => json(res, 502, {error: {code: 'config_failed', message: '无法更新 Herdr 配置'}}));
    return true;
  }

  function requestAllowed(req) {
    if (!origin || req.headers.host !== new URL(origin).host) return false;
    // Browsers always send their origin for a WebSocket and state-changing fetch.
    // A browser from another site cannot use this facade as a loopback API bridge.
    return !req.headers.origin || req.headers.origin === origin;
  }

  function headersForUpstream(req, upgrade=false) {
    const result = {};
    for (const [name,value] of Object.entries(req.headers)) {
      if (value !== undefined && !PRIVATE_HEADERS.has(name) && (upgrade || !HOP_HEADERS.has(name))) result[name] = value;
    }
    result.host = upstream.host;
    if (req.headers.origin) result.origin = upstream.origin;
    return result;
  }

  function headersForBrowser(headers, upgrade=false) {
    const result = {};
    for (const [name,value] of Object.entries(headers)) {
      if (value === undefined || name === 'set-cookie' || name === 'x-frame-options' || (!upgrade && HOP_HEADERS.has(name))) continue;
      if ((name === 'content-security-policy' || name === 'content-security-policy-report-only') && typeof value === 'string') {
        // Preserve the rest of Ovis's policy, including scripts, connections and file sandboxes.
        result[name] = value.replace(/frame-ancestors\s+[^;]*/gi, `frame-ancestors 'self' ${parent}`);
      } else if (name === 'location' && typeof value === 'string') {
        const redirected = new URL(value, upstream);
        result[name] = redirected.origin === upstream.origin ? `${origin}${redirected.pathname}${redirected.search}${redirected.hash}` : value;
      } else result[name] = value;
    }
    result['cache-control'] = 'no-store';
    return result;
  }

  function deny(res, message='This request origin is not allowed') {
    stats.deniedRequests++;
    res.writeHead(403, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
    res.end(message);
  }

  const server = http.createServer((req,res) => {
    if (handleMeta(req,res)) return;
    if (sidebar.handle(req,res,origin)) return;
    if (!requestAllowed(req)) return deny(res);
    const pathname=new URL(req.url,origin).pathname;
    if(pathname==='/__dsh_herdr/embed-bridge.js'){
      readFile(new URL('./embed-bridge.js',import.meta.url)).then(bytes=>{
        res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(bytes);
      }).catch(()=>{res.writeHead(503,{'content-type':'text/plain'});res.end('Selection bridge unavailable');});
      return;
    }
    stats.httpRequests++;
    const appDocument=req.method==='GET'&&(pathname==='/'||pathname==='/index.html');
    const upstreamHeaders=headersForUpstream(req);
    if(appDocument)upstreamHeaders['accept-encoding']='identity';
    const upstreamRequest = http.request({
      protocol:upstream.protocol,
      hostname:upstream.hostname,
      port:upstream.port || 80,
      method:req.method,
      path:req.url,
      headers:upstreamHeaders,
    }, response => {
      const browserHeaders=headersForBrowser(response.headers);
      if(appDocument&&response.statusCode===200&&String(response.headers['content-type']).includes('text/html')&&!response.headers['content-encoding']){
        const chunks=[];let size=0;
        response.on('data',chunk=>{size+=chunk.length;if(size>1024*1024){response.destroy();res.destroy();}else chunks.push(chunk);});
        response.on('end',()=>{
          let body=Buffer.concat(chunks);
          const html=body.toString('utf8');
          if(/<div\s+id=["']root["']/.test(html)){
            const adapter=`<script defer src="/__dsh_herdr/embed-bridge.js" data-dsh-origin="${parent}"></script>`;
            body=Buffer.from(html.replace('</head>',adapter+'</head>'));
            delete browserHeaders['content-length'];delete browserHeaders.etag;
          }
          res.writeHead(response.statusCode,browserHeaders);res.end(body);
        });
      }else{
        res.writeHead(response.statusCode || 502,browserHeaders);
        response.pipe(res);
      }
      response.on('error', () => res.destroy());
    });
    req.pipe(upstreamRequest);
    req.on('aborted', () => upstreamRequest.destroy());
    res.on('close', () => { if (!res.writableFinished) upstreamRequest.destroy(); });
    upstreamRequest.on('error', () => {
      stats.upstreamErrors++;
      if (!res.headersSent) res.writeHead(502, {'content-type':'text/plain; charset=utf-8','cache-control':'no-store'});
      res.end('Ovis is unavailable. Check the local Ovis service.');
    });
  });

  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.on('upgrade', (req,socket,head) => {
    if (!requestAllowed(req) || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      stats.deniedRequests++;
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    const upstreamRequest = http.request({
      hostname:upstream.hostname,
      port:upstream.port || 80,
      path:req.url,
      method:'GET',
      headers:headersForUpstream(req, true),
    });
    let upstreamSocket;
    const disconnect = () => {
      upstreamRequest.destroy();
      if (upstreamSocket) upstreamSocket.destroy();
      socket.destroy();
    };
    socket.on('error', disconnect);
    socket.on('close', () => { if (upstreamSocket) upstreamSocket.destroy(); else upstreamRequest.destroy(); });
    upstreamRequest.on('upgrade', (response,peer,peerHead) => {
      upstreamSocket = peer;
      stats.websocketConnections++;
      stats.activeWebSockets++;
      tunnels.add(peer);
      peer.on('close', () => {
        tunnels.delete(peer);
        stats.activeWebSockets--;
        socket.destroy();
      });
      peer.on('error', disconnect);
      const headers = headersForBrowser(response.headers, true);
      const status = `HTTP/1.1 ${response.statusCode} ${response.statusMessage}\r\n`;
      socket.write(status + Object.entries(headers).flatMap(([key,value]) => (Array.isArray(value)?value:[value]).map(v=>`${key}: ${v}\r\n`)).join('') + '\r\n');
      if (peerHead.length) socket.write(peerHead);
      if (head.length) peer.write(head);
      socket.pipe(peer);
      peer.pipe(socket);
    });
    upstreamRequest.on('response', response => {
      const headers=headersForBrowser(response.headers);
      socket.write(`HTTP/1.1 ${response.statusCode || 502} ${response.statusMessage || 'Bad Gateway'}\r\n` + Object.entries(headers).map(([key,value])=>`${key}: ${value}\r\n`).join('') + '\r\n');
      response.pipe(socket);
    });
    upstreamRequest.on('error', () => {
      stats.upstreamErrors++;
      if (!socket.destroyed) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    upstreamRequest.end();
  });

  return {
    async listen() {
      await new Promise((resolve,reject) => {server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolve();});});
      origin=`http://${host}:${server.address().port}`;
      return {origin,upstream:upstream.origin,parentOrigin:parent};
    },
    get origin() { return origin; },
    stats() { return {...stats}; },
    config() { return publicConfig(); },
    async close() {
      if (closing) return;
      closing=true;
      const ended=new Promise(resolve=>server.close(resolve));
      await sidebar.close();
      for (const socket of tunnels) socket.destroy();
      for (const socket of sockets) socket.destroy();
      await ended;
    },
  };
}
