#!/usr/bin/env node
// Read-only acceptance probe with credentials loaded from a private file.
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const base=process.env.GATEWAY_URL??'http://gateway.localhost:8080';
const dir=process.env.URUMI_CREDENTIAL_DIR??'.local';
const c=JSON.parse(await readFile(dir+'/platform-credentials.json','utf8'));
const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:c.BOOTSTRAP_EMAIL,password:c.BOOTSTRAP_PASSWORD})});
assert.equal(r.status,200);const data=await r.json();
const headers={'Content-Type':'application/json',Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':data.csrf_token};
const servers=await (await fetch(base+'/api/servers',{headers})).json();
for(const slug of ['store','inventory','knowledge'])assert(servers.servers.some(s=>s.slug===slug&&s.status==='Connected'));assert(servers.servers.filter(s=>s.enabled).every(s=>s.status==='Connected'));
const minted=await fetch(base+'/api/keys',{method:'POST',headers,body:JSON.stringify({name:'Read-only installation verification'})});
assert.equal(minted.status,201);const key=(await minted.json()).key;
const client=new Client({name:'installation-check',version:'1.0.0'});
try {
 await client.connect(new StreamableHTTPClientTransport(new URL(base+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+key.token}}}));
 const count=(await client.listTools()).tools.length;assert.equal(count,servers.servers.filter(s=>s.enabled).reduce((n,s)=>n+s.tools.length,0));assert(count>=8);
 for(const [name,args] of [['store__list_products',{}],['inventory__search',{query:''}],['knowledge__search',{query:''}]]) {
   assert(!(await client.callTool({name,arguments:args})).isError);
 }
 console.log('PASS: login, core registrations, '+count+' aggregated tools, and reads through each core upstream.');
} finally {
 await client.close();
 await fetch(base+'/api/keys/'+key.id,{method:'DELETE',headers});
 await fetch(base+'/api/logout',{method:'POST',headers,body:'{}'});
}
