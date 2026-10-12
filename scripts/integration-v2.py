#!/usr/bin/env python3
"""Real OpenCode v2 integration; ALL provider responses are deterministic TEST DATA.
No live config, credentials or paid providers. Private server + XDG isolation.
"""
from typing import Any
import base64, hashlib, http.server, json, os, pathlib, secrets, socket, subprocess, tempfile, threading, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / 'evidence'
ARTIFACT.mkdir(exist_ok=True)
HOME = pathlib.Path(tempfile.mkdtemp(prefix='fallback-v2-', dir='/home/visimeos/.hermes/cache/scratch'))
PROJECT = HOME / 'project'
PROJECT.mkdir()
CONFIG = HOME / 'config/opencode'
CONFIG.mkdir(parents=True)
requests = []
model_counts = {}
cycle_names = ('wrap', 'bound', 'cold')
class Fixture(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append({'path': self.path, 'body': body, 'time': time.monotonic()})
        model = body['model']
        model_counts[model] = model_counts.get(model, 0) + 1
        # Provider latency, NOT a plugin wait: a model's cooldown starts when its
        # failure is processed, so alternation continues natively only while each
        # request outlasts the cooldown. The cold chain has zero latency, making
        # every cooldown coincide: all-cooldown must stop without waiting.
        if model in ('wrap-a','wrap-b','bound-a','bound-b'):
            time.sleep(12.2)
        limited = (model.startswith(('bound-', 'cold-')) or model == 'wrap-b' or
                   (model == 'wrap-a' and model_counts[model] == 1))
        if limited or model == 'a' or (model == 'b' and any('CASCADE_TEST' in str(m.get('content')) for m in body['messages'])):
            self.send_response(429); self.send_header('Content-Type','application/json'); self.end_headers()
            self.wfile.write(b'{"error":{"message":"TEST DATA rate limit","type":"rate_limit_error"}}')
            return
        delta = {'content': 'CHILD_FIXTURE_OK'}
        if model == 'parent':
            completed = sum(m.get('role') == 'tool' for m in body['messages'])
            if completed < 6:
                agent, text = [('worker','FIXTURE_CHILD_TEST'),('worker','FIXTURE_CHILD_TEST'),
                    ('cascade','CASCADE_TEST'),('wrap','WRAP_TEST'),('bound','BOUND_TEST'),('cold','COLD_TEST')][completed]
                delta = {'tool_calls': [{'index': 0, 'id': 'fixture_call_'+str(completed), 'type':'function', 'function': {'name':'subagent', 'arguments':json.dumps({'agent':agent,'description':'deterministic child fixture','prompt':text})}}]}
            else: delta = {'content':'PARENT_CONTINUED_WITH_CHILD_FIXTURE_OK'}
        finish = 'tool_calls' if 'tool_calls' in delta else 'stop'
        frames = [ {'id':'fixture-test-data','object':'chat.completion.chunk','created':0,'model':model,'choices':[{'index':0,'delta':{'role':'assistant', **delta},'finish_reason':None}]},
            {'id':'fixture-test-data','object':'chat.completion.chunk','created':0,'model':model,'choices':[{'index':0,'delta':{},'finish_reason':finish}], 'usage':{'prompt_tokens':10,'completion_tokens':5,'total_tokens':15}} ]
        output = ''.join('data: '+json.dumps(x)+'\n\n' for x in frames)+'data: [DONE]\n\n'
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Content-Length',str(len(output.encode()))); self.end_headers(); self.wfile.write(output.encode())
fixture = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
threading.Thread(target=fixture.serve_forever, daemon=True).start()
port = fixture.server_address[1]
def model(variant):
    return {'name':'TEST DATA model', 'capabilities':{'tools':True,'input':['text'],'output':['text']}, 'limit':{'context':200000,'output':1024}, 'variants':[{'id':variant, 'body':{'fixture_variant':variant}}]}
chain = [{'model':'fixture-one/a#high'}, {'model':'fixture-two/b#low','request':{'body':{'thinking':{'type':'disabled'}}}}, {'model':'fixture-three/c#medium'}]
cycle_chains = {name: [{'model':f'fixture-one/{name}-a#high'},
    {'model':f'fixture-two/{name}-b#low','request':{'body':{'thinking':{'type':'disabled'}}}}] for name in ['wrap','bound','cold']}
plugin_config = {'version':2,'cooldownMs':10000,'maxCycles':5,'agents':{'worker':{'chain':chain},'cascade':{'chain':chain},
    **{name:{'chain':steps} for name,steps in cycle_chains.items()}}}
config = {'plugins':[{'package':str(ROOT), 'options':{'config':plugin_config}}],
    'agents':{'fixture-parent':{'mode':'primary','model':'fixture-one/parent','system':'TEST DATA: use the deterministic fixture tools','permissions':[{'action':'*','resource':'*','effect':'deny'},{'action':'subagent','resource':'*','effect':'allow'}]},
              **{a:{'mode':'subagent','model':'fixture-one/a#high','system':'TEST DATA child','permissions':[{'action':'*','resource':'*','effect':'deny'}]} for a in ['worker','cascade']},
              **{a:{'mode':'subagent','model':steps[0]['model'],'system':'TEST DATA bounded cycle child','permissions':[{'action':'*','resource':'*','effect':'deny'}]} for a,steps in cycle_chains.items()}},
    'providers':{p:{'name':'Deterministic local TEST DATA', 'package':'aisdk:@ai-sdk/openai-compatible', 'settings':{'baseURL':f'http://127.0.0.1:{port}/v1'}, 'models':ms} for p,ms in [('fixture-one',{'parent':{'name':'parent TEST DATA','capabilities':{'tools':True},'limit':{'context':200000,'output':1024}},'a':model('high')}),('fixture-two',{'b':model('low')}),('fixture-three',{'c':model('medium')})]}}
for name in cycle_chains:
    config['providers']['fixture-one']['models'][name+'-a'] = model('high')
    config['providers']['fixture-two']['models'][name+'-b'] = model('low')
(CONFIG/'opencode.json').write_text(json.dumps(config))
password = secrets.token_urlsafe(24)  # ephemeral TEST server password, never printed or persisted
ENV = {k:v for k,v in os.environ.items() if k != 'HOME' and not k.startswith(('OPENCODE_', 'XDG_')) and not any(x in k.upper() for x in ['API_KEY','TOKEN','SECRET','PASSWORD'])}
ENV.update({'HOME':str(HOME/'home'),'OPENCODE_TEST_HOME':str(HOME/'home'), 'OPENCODE_CONFIG_DIR':str(CONFIG), 'XDG_CONFIG_HOME':str(HOME/'config'), 'XDG_DATA_HOME':str(HOME/'data'), 'XDG_CACHE_HOME':str(HOME/'cache'), 'XDG_STATE_HOME':str(HOME/'state'), 'OPENCODE_PASSWORD':password, 'OPENCODE_DISABLE_PROJECT_CONFIG':'1'})
with socket.socket() as s: s.bind(('127.0.0.1',0)); server_port = s.getsockname()[1]
url = f'http://127.0.0.1:{server_port}'
header = {'Authorization':'Basic '+base64.b64encode(('opencode:'+password).encode()).decode(), 'Content-Type':'application/json'}
def api(path, data=None, timeout=60) -> Any:
    req = urllib.request.Request(url+path, data=None if data is None else json.dumps(data).encode(), headers=header)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None
log = open(ARTIFACT/'v2-server.log','w')
proc = subprocess.Popen(['opencode','serve','--hostname','127.0.0.1','--port',str(server_port)],cwd=PROJECT,env=ENV,stdout=log,stderr=log)
try:
    for _ in range(150):
        try: info = api('/api/info',timeout=1); break
        except Exception:
            if proc.poll() is not None: raise RuntimeError('private server exited')
            time.sleep(.1)
    else: raise RuntimeError('private server never became ready')
    sources = api('/api/config?location%5Bdirectory%5D='+str(PROJECT))
    (ARTIFACT/'v2-isolated-sources.json').write_text(json.dumps(sources,indent=2))
    assert not any(x.get('path','').startswith('/home/visimeos/.config/opencode') for x in sources), 'LIVE CONFIG LEAK'
    assert any(x.get('path') == str(CONFIG/'opencode.json') for x in sources), 'fixture config not discovered'
    plugins = api('/api/plugin?location%5Bdirectory%5D='+str(PROJECT))
    (ARTIFACT/'v2-plugin-inventory.json').write_text(json.dumps(plugins,indent=2))
    parent = api('/api/session',{'location':{'directory':str(PROJECT)},'title':'Deterministic TEST DATA parent','agent':'fixture-parent','model':{'providerID':'fixture-one','id':'parent'}})['data']
    sid = parent['id']
    api('/api/session/'+sid+'/prompt', {'text':'DETERMINISTIC_TEST_DATA_ONLY'})
    try:
        api('/api/experimental/session/'+sid+'/wait',{},timeout=180)
    except Exception:
        (ARTIFACT/'v2-parent-messages.json').write_text(json.dumps(api('/api/session/'+sid+'/message'),indent=2))
        (ARTIFACT/'v2-sessions.json').write_text(json.dumps(api('/api/session'),indent=2))
        raise
    messages = api('/api/session/'+sid+'/message')
    sessions = api('/api/session')
    (ARTIFACT/'v2-parent-messages.json').write_text(json.dumps(messages,indent=2))
    (ARTIFACT/'v2-sessions.json').write_text(json.dumps(sessions,indent=2))
    (ARTIFACT/'v2-provider-requests.json').write_text(json.dumps(requests,indent=2))
    assert 'PARENT_CONTINUED_WITH_CHILD_FIXTURE_OK' in json.dumps(messages), 'child results did not reach continued parent'
    tool_results = [p for m in messages['data'] if m.get('type') == 'assistant' for p in m.get('content',[]) if p.get('type') == 'tool' and p.get('name') == 'subagent']
    assert len(tool_results) == 6 and sum(p['state']['status'] == 'completed' for p in tool_results) == 4, 'native child tool results not completed/delivered'
    cycle = {}
    for name in cycle_chains:
        reqs = [r for r in requests if r['body']['model'] == name+'-a' or r['body']['model'] == name+'-b']
        cycle[name] = [r['body']['model'] for r in reqs]
        for r in reqs:
            if r['body']['model'] == name+'-b': assert r['body'].get('thinking') == {'type':'disabled'}, f'{name}: step body override missing'
    assert cycle['wrap'] == ['wrap-a','wrap-b','wrap-a'], f'wrap: {cycle["wrap"]}'
    assert cycle['bound'] == ['bound-a','bound-b']*5, f'bound: {cycle["bound"]}'
    assert cycle['cold'] == ['cold-a','cold-b'], f'cold: {cycle["cold"]}'
    data = sessions.get('data',sessions) if isinstance(sessions,dict) else sessions
    children = [s for s in data if s.get('parentID') == sid]
    assert len(children) == 6, f'Expected six real child jobs, got {len(children)}'
    assert all(s['agent'] in ['worker','cascade','wrap','bound','cold'] and s.get('outcome') in ['succeeded','failed'] for s in children), 'child agent/outcome changed'
    parent_after = api('/api/session/'+sid)['data']
    assert parent_after['agent'] == 'fixture-parent' and parent_after['model']['providerID'] == 'fixture-one' and parent_after['model']['id'] == 'parent' and parent_after['model'].get('variant','default') == 'default', 'parent model or agent changed'
    plugins = api('/api/plugin?location%5Bdirectory%5D='+str(PROJECT))
    (ARTIFACT/'v2-plugin-inventory.json').write_text(json.dumps(plugins,indent=2))
    assert any(p['id'] == 'smart-coders.model-fallback.v2-local' and p['state']['status'] == 'active' for p in plugins['data']), 'plugin not active in private test server'
    a = [r for r in requests if r['body']['model'] == 'a']
    b = [r for r in requests if r['body']['model'] == 'b']
    c = [r for r in requests if r['body']['model'] == 'c']
    assert len(a) == 1, f'preemptive redirect failed: {len(a)} primary requests'
    assert len(b) == 3 and len(c) == 1, f'unexpected request counts b={len(b)}, c={len(c)}'
    assert all(r['body'].get('fixture_variant') == 'low' and r['body'].get('thinking') == {'type':'disabled'} for r in b), 'fallback variant/override missing'
    assert c[0]['body'].get('fixture_variant') == 'medium' and 'thinking' not in c[0]['body'], 'override leaked into next provider'
    summary = {'opencode':subprocess.check_output(['opencode','--version'],text=True).strip(),'isolation_verified':True,'children_completed':len(children),'parent_continued':True,'parent_model_preserved':True,'primary_requests':len(a),'fallback1_requests':len(b),'fallback2_requests':len(c),'variants_and_overrides_verified':True,'cycle_sequences':cycle,'maxCycles':5,'fixture_home':str(HOME),'test_data_only':True}
    (ARTIFACT/'v2-integration-result.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary,indent=2))
finally:
    (ARTIFACT/'v2-provider-requests.json').write_text(json.dumps(requests,indent=2))
    proc.terminate()
    try: proc.wait(timeout=10)
    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    log.close(); fixture.shutdown()
    native_log = HOME/'data/opencode/log/opencode.log'
    if native_log.exists():
        (ARTIFACT/'v2-native-runtime.log').write_bytes(native_log.read_bytes())
