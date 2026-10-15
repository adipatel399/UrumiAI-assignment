#!/usr/bin/env python3
"""Provision a provider key from a private file without printing it or placing it in process arguments."""
import json, pathlib, subprocess, os
root=pathlib.Path(__file__).resolve().parents[1]
if subprocess.check_output(['kubectl','config','current-context'],text=True).strip()!='k3d-urumi':
    raise SystemExit('Select k3d-urumi for local chat configuration.')
path=root/'.local/llm-credentials.json'
path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
if not path.exists():
    with os.fdopen(os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'w') as f:
        json.dump({'LLM_API_KEY':'','LLM_MODEL':'qwen/qwen3.8-27b','LLM_URL':'https://api.groq.com/openai/v1/chat/completions'},f,indent=2)
    print('Created .local/llm-credentials.json. Add your provider key there, then rerun this script.')
    raise SystemExit(0)
os.chmod(path,0o600)
data=json.loads(path.read_text())
if not data.get('LLM_API_KEY','').strip(): raise SystemExit('Add LLM_API_KEY to .local/llm-credentials.json first. No configuration changed.')
allowed={'LLM_API_KEY','LLM_MODEL','LLM_URL'}
if set(data)-allowed: raise SystemExit('Unexpected configuration fields.')
manifest={'apiVersion':'v1','kind':'Secret','metadata':{'name':'urumi-llm-secrets','namespace':'urumi'},'type':'Opaque','stringData':data}
subprocess.run(['kubectl','apply','-f','-'],input=json.dumps(manifest),text=True,check=True)
subprocess.run(['kubectl','rollout','restart','deployment/urumi-gateway','-n','urumi'],check=True)
print('Provider settings saved in a Kubernetes Secret. Key value was not printed.')
