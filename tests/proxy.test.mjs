import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createOvisProxy} from '../packages/herdr-live/proxy.mjs';

async function fixture(t) {
  const seen=[];
  const sockets=new Set();
  const html='<!doctype html><title>upstream application bytes</title>';
  const upstream=http.createServer((req,res)=>{
    seen.push({path:req.url,method:req.method,headers:req.headers});
    res.writeHead(200,{
      'content-type':'text/html',
      'content-security-policy':"default-src 'self'; script-src 'self'; frame-ancestors 'none'",
      'set-cookie':'fixture=not-a-user-cookie; HttpOnly',
    });
    res.end(html);
  });
  upstream.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  upstream.on('upgrade',(req,socket)=>{
    seen.push({path:req.url,method:'UPGRADE',headers:req.headers});
    const accept=createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const text=Buffer.from('upstream-wire-text');
    socket.write(Buffer.concat([Buffer.from([0x81,text.length]),text]));
  });
  await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
  const upstreamOrigin=`http://127.0.0.1:${upstream.address().port}`;
  const proxy=createOvisProxy({upstreamOrigin,parentOrigin:'http://127.0.0.1:50759',port:0});
  const {origin}=await proxy.listen();
  t.after(async()=>{
    await proxy.close();
    for(const socket of sockets)socket.destroy();
    await new Promise(r=>upstream.close(r));
  });
  return {proxy,origin,upstreamOrigin,seen,html};
}

function rawRequest(url,headers={}) {
  return new Promise((resolve,reject)=>{
    const req=http.get(url,{headers},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString()}));
    });
    req.on('error',reject);
  });
}

test('only plain loopback origins and loopback listener are accepted',()=>{
  assert.throws(()=>createOvisProxy({upstreamOrigin:'http://example.com'}),/loopback/);
  assert.throws(()=>createOvisProxy({upstreamOrigin:'http://127.0.0.1:7317/path'}),/loopback/);
  assert.throws(()=>createOvisProxy({upstreamOrigin:'http://operator@127.0.0.1:7317'}),/loopback/);
  assert.throws(()=>createOvisProxy({host:'0.0.0.0'}),/127.0.0.1/);
});

test('serves unchanged application bytes and narrowly changes framing policy',async t=>{
  const f=await fixture(t);
  const response=await rawRequest(f.origin+'/');
  assert.equal(response.status,200);
  assert.equal(response.body,f.html);
  assert.equal(response.headers['content-security-policy'],"default-src 'self'; script-src 'self'; frame-ancestors 'self' http://127.0.0.1:50759");
  assert.equal(response.headers['set-cookie'],undefined);
});

test('paired origin rewrite preserves upstream origin checks and drops credentials',async t=>{
  const f=await fixture(t);
  await rawRequest(f.origin+'/api/session?fixture=yes',{Origin:f.origin,Cookie:'fixture=not-a-user-cookie',Authorization:'Bearer fixture-only','X-Forwarded-For':'203.0.113.9'});
  const received=f.seen[0];
  assert.equal(received.path,'/api/session?fixture=yes');
  assert.equal(received.headers.origin,f.upstreamOrigin);
  assert.equal(received.headers.host,new URL(f.upstreamOrigin).host);
  assert.equal(received.headers.cookie,undefined);
  assert.equal(received.headers.authorization,undefined);
  assert.equal(received.headers['x-forwarded-for'],undefined);
});

test('foreign browser origins and unexpected Host never reach upstream',async t=>{
  const f=await fixture(t);
  assert.equal((await rawRequest(f.origin+'/api/session',{Origin:'https://unrelated.example'})).status,403);
  assert.equal((await rawRequest(f.origin+'/api/session',{Host:'unrelated.example'})).status,403);
  assert.equal(f.seen.length,0);
});

test('native WebSocket upgrade and text frame cross facade unchanged',async t=>{
  const f=await fixture(t);
  const ws=new WebSocket(f.origin.replace('http:','ws:')+'/ws?fixture=yes');
  const message=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('WebSocket forwarding timed out')),3000);
    ws.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
    ws.onerror=()=>{clearTimeout(timer);reject(new Error('WebSocket forwarding failed'));};
  });
  assert.equal(message,'upstream-wire-text');
  assert.equal(f.seen[0].path,'/ws?fixture=yes');
  assert.equal(f.proxy.stats().websocketConnections,1);
  ws.close();
});

test('foreign-origin WebSocket upgrade is rejected before an upstream connection',async t=>{
  const f=await fixture(t);
  const response=await rawRequest(f.origin+'/ws',{
    Origin:'https://unrelated.example',Upgrade:'websocket',Connection:'Upgrade','Sec-WebSocket-Key':Buffer.alloc(16,7).toString('base64'),'Sec-WebSocket-Version':'13',
  });
  assert.equal(response.status,403);
  assert.equal(f.seen.length,0);
});
