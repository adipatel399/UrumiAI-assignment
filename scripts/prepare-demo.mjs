#!/usr/bin/env node
// Create private demo identities/client settings, with no secrets printed.
import {readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
const base=process.env.GATEWAY_URL??'http://gateway.localhost:8080';
const dir=process.env.URUMI_CREDENTIAL_DIR??'.local';
const c=JSON.parse(await readFile(dir+'/platform-credentials.json','utf8'));
let saved;try{saved=JSON.parse(await readFile(dir+'/demo.json','utf8'));}catch{saved={memberEmail:'member@example.test',memberPassword:randomBytes(24).toString('base64url')};}
async function login(email,password){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});if(!r.ok)throw Error('Demo login failed');return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf_token};}
async function api(path,method='GET',body,auth){const r=await fetch(base+'/api/'+path,{method,headers:{'Content-Type':'application/json',Cookie:auth.cookie,'X-CSRF-Token':auth.csrf},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('Demo API failed: '+path+' HTTP '+r.status);return r.status===204?{}:r.json();}
const admin=await login(c.BOOTSTRAP_EMAIL,c.BOOTSTRAP_PASSWORD);
const members=(await api('members','GET',undefined,admin)).members;
if(!members.some(m=>m.email===saved.memberEmail)){
 const i=await api('invitations','POST',{email:saved.memberEmail},admin);
 const r=await fetch(base+'/api/invitations/accept',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:i.invitation.token,password:saved.memberPassword})});if(!r.ok)throw Error('Demo invitation acceptance failed');
}
const member=await login(saved.memberEmail,saved.memberPassword);
if(saved.memberKeyId)await api('keys/'+saved.memberKeyId,'DELETE',undefined,admin);
const key=(await api('keys','POST',{name:'External MCP walkthrough'},member)).key;
saved.memberKey=key.token;saved.memberKeyId=key.id;saved.gatewayUrl=base;
await writeFile(dir+'/demo.json',JSON.stringify(saved,null,2),{mode:0o600});
await writeFile(dir+'/mcp-client.json',JSON.stringify({mcpServers:{urumi:{type:'streamable-http',url:base+'/mcp',headers:{Authorization:'Bearer '+key.token}}}},null,2),{mode:0o600});
console.log('Two demo users and member-only client configuration prepared privately.');
