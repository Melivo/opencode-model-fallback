#!/usr/bin/env python3
"""Real OpenCode v2 integration; ALL provider responses are deterministic TEST DATA.
No live config, credentials or paid providers. Private server + XDG isolation.

Parameters keep three concerns apart: --plugin-package (plugin root the host
loads; default: this checkout), --opencode-bin (exact absolute CLI binary;
omitted = developer mode resolving `opencode` from PATH) and --evidence-dir
(default: <repo>/evidence). ROOT stays the repository resource root only.
"""
from typing import Any
import argparse, base64, hashlib, http.server, json, os, pathlib, secrets, shutil, socket, subprocess, sys, tempfile, threading, time, urllib.request
ROOT = pathlib.Path(__file__).resolve().parents[1]
# Strict host environment allowlist: tokens, npm/provider credentials and CI
# identity variables are never inherited. HOME/XDG/TMP are replaced below.
SAFE_ENV_KEYS = ('PATH', 'LANG', 'LANGUAGE', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM',
                 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT')
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--plugin-package', type=pathlib.Path, default=ROOT)
parser.add_argument('--opencode-bin')
parser.add_argument('--evidence-dir', type=pathlib.Path, default=ROOT / 'evidence/general-stream-limit/T02-native')
parser.add_argument('--scratch-root', type=pathlib.Path, help='parent of the private fixture root (default: system temp dir)')
parser.add_argument('--scenario', choices=['all','legacy','general-success','general-exhaustion','general-cold','general-cycles'], default='all')
ARGS = parser.parse_args()
if ARGS.scenario == 'all':
    # Each run gets a fresh native plugin instance, cooldown map and private HOME.
    for scenario in ['legacy','general-success','general-exhaustion','general-cold','general-cycles']:
        dest = ARGS.evidence_dir if scenario == 'legacy' else ARGS.evidence_dir / scenario
        command = [sys.executable, str(pathlib.Path(__file__).resolve()), '--plugin-package', str(ARGS.plugin_package), '--evidence-dir', str(dest), '--scenario', scenario]
        if ARGS.opencode_bin: command += ['--opencode-bin', ARGS.opencode_bin]
        if ARGS.scratch_root: command += ['--scratch-root', str(ARGS.scratch_root)]
        subprocess.run(command, check=True)
    print('ALL NATIVE LEGACY + BUILTIN GENERAL SCENARIOS PASSED')
    raise SystemExit(0)
GENERAL = ARGS.scenario != 'legacy'
CYCLE_LATENCY = 12.2  # fixture provider latency, not plugin retry delay
NATIVE_PACKAGE = '@opencode/ai/providers/openai-compatible'
GENERAL_MODELS = ['claude-opus-5-5','glm-5.3','k3.1-pro','gpt-6.1-sol']
CLAUDE_ENVELOPE = {'error': {'type':'error','code':'claude_session_limit','message':json.dumps({'type':'error','error':{'type':'server_error','code':'server_error','message':"You've hit your 5-hour limit …"}})}}
PLUGIN_PACKAGE = ARGS.plugin_package.resolve(strict=True)
if ARGS.opencode_bin is None:
    # Resolve a real CLI, not a version-manager shim that mutates the child env.
    candidates = [pathlib.Path(p)/'opencode' for p in os.get_exec_path()]
    found = next((str(p.resolve()) for p in candidates if p.is_file() and os.access(p,os.X_OK) and p.resolve().name not in ['mise','asdf']), None)
    if not found: raise SystemExit('opencode not found; pass --opencode-bin <absolute path>')
    OPENCODE_BIN = str(pathlib.Path(found).absolute())  # preserve argv[0] for mise shims
else:
    if not os.path.isabs(ARGS.opencode_bin) or not os.access(ARGS.opencode_bin, os.X_OK):
        raise SystemExit('--opencode-bin must be an absolute executable path')
    OPENCODE_BIN = ARGS.opencode_bin
ARTIFACT = ARGS.evidence_dir.resolve()
ARTIFACT.mkdir(parents=True, exist_ok=True)
SCRATCH = (ARGS.scratch_root or (pathlib.Path('/tmp/opencode') if pathlib.Path('/tmp/opencode').is_dir() else pathlib.Path(tempfile.gettempdir()))).resolve()
SCRATCH.mkdir(parents=True, exist_ok=True)
HOME = pathlib.Path(tempfile.mkdtemp(prefix='fallback-v2-', dir=SCRATCH))
for private in ('home', 'tmp'): (HOME / private).mkdir()
PROJECT = HOME / 'project'
PROJECT.mkdir()
(HOME/'cycle-fixture.txt').write_text('DETERMINISTIC CYCLE CHECKPOINT TEST DATA ONLY\n')
CONFIG = HOME / 'config/opencode'
CONFIG.mkdir(parents=True)
requests = []
model_counts = {}
cycle_names = ('wrap', 'bound', 'cold')
class Fixture(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args): pass
    def do_GET(self):
        # The private observer calls this gate for every native parent/child
        # prompt. Reuse the same real API/environment check as explicit submits.
        if self.path != '/isolation': self.send_error(404); return
        try:
            verify_isolation()
            self.send_response(200); self.end_headers(); self.wfile.write(b'ISOLATED')
        except Exception as error:
            self.send_response(500); self.end_headers(); self.wfile.write(str(error).encode())
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append({'path': self.path, 'body': body, 'time': time.monotonic(), 'fixture_latency':0})
        model = body['model']
        model_counts[model] = model_counts.get(model, 0) + 1
        # Provider latency, NOT a plugin wait: a model's cooldown starts when its
        # failure is processed, so alternation continues natively only while each
        # request outlasts the cooldown. The cold chain has zero latency, making
        # every cooldown coincide: all-cooldown must stop without waiting.
        if model in ('wrap-a','wrap-b','bound-a','bound-b'):
            time.sleep(CYCLE_LATENCY)
        # Native OpenCode caps consecutive retries at ten. A real successful
        # read step on Sol in passes 1–4 resets only that native counter, within
        # the SAME child/job. Plugin pass state must survive these successes.
        checkpoint = (GENERAL and ARGS.scenario == 'general-cycles' and model == GENERAL_MODELS[-1]
                      and model_counts[model] in [1,3,5,7])
        if GENERAL and model in GENERAL_MODELS and not checkpoint:
            if ARGS.scenario == 'general-cycles':
                requests[-1]['fixture_latency'] = CYCLE_LATENCY
                time.sleep(CYCLE_LATENCY)
            if model != GENERAL_MODELS[-1] or ARGS.scenario != 'general-success':
                output = 'data: '+json.dumps(CLAUDE_ENVELOPE)+'\n\ndata: [DONE]\n\n'
                self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.send_header('Content-Length',str(len(output.encode()))); self.end_headers(); self.wfile.write(output.encode())
                return
        limited = (model.startswith(('bound-', 'cold-')) or model == 'wrap-b' or
                   (model == 'wrap-a' and model_counts[model] == 1))
        if limited or model == 'a' or (model == 'b' and any('CASCADE_TEST' in str(m.get('content')) for m in body['messages'])):
            self.send_response(429); self.send_header('Content-Type','application/json'); self.end_headers()
            self.wfile.write(b'{"error":{"message":"TEST DATA rate limit","type":"rate_limit_error"}}')
            return
        delta = {'content': 'CHILD_FIXTURE_OK'}
        if checkpoint:
            delta = {'tool_calls':[{'index':0,'id':'cycle_checkpoint_'+str(model_counts[model]),'type':'function','function':{'name':'read','arguments':json.dumps({'path':str(HOME/'cycle-fixture.txt')})}}]}
        if model == 'parent':
            completed = sum(m.get('role') == 'tool' for m in body['messages'])
            if GENERAL:
                if completed == 0:
                    delta = {'tool_calls':[{'index':0,'id':'fixture_general_call','type':'function','function':{'name':'subagent','arguments':json.dumps({'agent':'general','description':'deterministic builtin general fixture','prompt':'GENERAL_TEST_DATA_ONLY'})}}]}
                else: delta = {'content':'PARENT_CONTINUED_WITH_CHILD_FIXTURE_OK'}
            elif completed < 6:
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
    return {'name':'TEST DATA model', 'package':NATIVE_PACKAGE, 'capabilities':{'tools':True,'input':['text'],'output':['text']}, 'limit':{'context':200000,'output':1024}, 'variants':[{'id':variant, 'body':{'fixture_variant':variant}}]}
chain = [{'model':'fixture-one/a#high'}, {'model':'fixture-two/b#low','request':{'body':{'thinking':{'type':'disabled'}}}}, {'model':'fixture-three/c#medium'}]
cycle_chains = {name: [{'model':f'fixture-one/{name}-a#high'},
    {'model':f'fixture-two/{name}-b#low','request':{'body':{'thinking':{'type':'disabled'}}}}] for name in ['wrap','bound','cold']}
plugin_config = {'version':2,'cooldownMs':10000,'maxCycles':5,'agents':{'worker':{'chain':chain},'cascade':{'chain':chain},
    **{name:{'chain':steps} for name,steps in cycle_chains.items()}}}
config = {'plugins':[{'package':str(PLUGIN_PACKAGE), 'options':{'config':plugin_config}}],
    'agents':{'fixture-parent':{'mode':'primary','model':'fixture-one/parent','system':'TEST DATA: use the deterministic fixture tools','permissions':[{'action':'*','resource':'*','effect':'deny'},{'action':'subagent','resource':'*','effect':'allow'}]},
              **{a:{'mode':'subagent','model':'fixture-one/a#high','system':'TEST DATA child','permissions':[{'action':'*','resource':'*','effect':'deny'}]} for a in ['worker','cascade']},
              **{a:{'mode':'subagent','model':steps[0]['model'],'system':'TEST DATA bounded cycle child','permissions':[{'action':'*','resource':'*','effect':'deny'}]} for a,steps in cycle_chains.items()}},
    'providers':{p:{'name':'Deterministic local TEST DATA', 'package':NATIVE_PACKAGE, 'settings':{'baseURL':f'http://127.0.0.1:{port}/v1'}, 'models':ms} for p,ms in [('fixture-one',{'parent':{'name':'parent TEST DATA','capabilities':{'tools':True},'limit':{'context':200000,'output':1024}},'a':model('high')}),('fixture-two',{'b':model('low')}),('fixture-three',{'c':model('medium')})]}}
for name in cycle_chains:
    config['providers']['fixture-one']['models'][name+'-a'] = model('high')
    config['providers']['fixture-two']['models'][name+'-b'] = model('low')
if GENERAL:
    canonical = json.loads((ROOT/'deployment/model-fallback.v2.json').read_text())
    general_chain = canonical['agents']['general']['chain']
    assert general_chain == [{'model':p+'/'+m+'#low'} for p,m in zip(['claude-code','zai-coding-plan','kimi-code-plan-cn','openai'],GENERAL_MODELS)]
    plugin_config = {'version':2,'cooldownMs':10000 if ARGS.scenario == 'general-cycles' else 300000,
                     'maxCycles':1 if ARGS.scenario == 'general-exhaustion' else 5,'agents':{'general':{'chain':general_chain}}}
    config['plugins'][0]['options']['config'] = plugin_config
    config['agents'] = {'fixture-parent':config['agents']['fixture-parent']}
    config['providers'] = {'fixture-one':{'name':'Local parent TEST DATA','package':NATIVE_PACKAGE,'settings':{'baseURL':f'http://127.0.0.1:{port}/v1'},'models':{'parent':config['providers']['fixture-one']['models']['parent']}}}
    for step in general_chain:
        provider, ref = step['model'].split('/')
        mid = ref.split('#')[0]
        config['providers'][provider] = {'name':'Local general TEST DATA','package':NATIVE_PACKAGE,'settings':{'baseURL':f'http://127.0.0.1:{port}/v1'},'models':{mid:model('low')}}
# Observer runs before the subject. It records untouched retry.error, request/job
# identity and the builtin definition before the subject's transform. It also
# removes every non-fixture provider, then rejects nonlocal primary requests.
OBSERVER = HOME/'observer'
OBSERVER.mkdir()
OBSERVATIONS = HOME/'observations.jsonl'
allowed = list(config['providers'])
observer_source = r"""import { appendFileSync } from 'node:fs';
export default { id: 'fixture.observer', async setup(ctx) {
  const write = (kind, data) => appendFileSync(OBSERVATIONS, JSON.stringify({kind, ...data})+'\n');
  const registrations = [];
  registrations.push(await ctx.provider.transform(editor => {
    for (const provider of editor.list()) {
      const id = provider.provider.id;
      if (!ALLOWED.includes(id)) { editor.remove(id); continue; }
      for (const modelID of provider.models.keys()) if (!MODEL_IDS[id].includes(modelID)) editor.models.remove(id, modelID);
    }
  }));
  registrations.push(await ctx.agent.transform(editor => { write('builtin', {agent:editor.get('general')}); }));
  registrations.push(await ctx.session.hook('prompt', async event => {
    const check = await fetch(ENDPOINT+'/isolation');
    if (!check.ok) throw new Error('PROMPT ISOLATION FAILED: '+await check.text());
    write('prompt', {sessionID:event.sessionID,messageID:event.messageID,prompt:event.prompt,isolationVerified:true});
  }));
  registrations.push(await ctx.session.hook('retry', async event => {
    write('retry', {sessionID:event.sessionID, agent:event.agent, model:event.model, attempt:event.attempt, error:event.error, session:await ctx.session.get({sessionID:event.sessionID})});
  }));
  registrations.push(await ctx.session.hook('http.request', async event => {
    if (event.kind !== 'primary') return;
    if (!event.request.url.startsWith(ENDPOINT+'/')) throw new Error('NONLOCAL FIXTURE REQUEST');
    write('request', {sessionID:event.sessionID, agent:event.agent, model:event.model, session:await ctx.session.get({sessionID:event.sessionID})});
  }));
  return async () => { for (const r of registrations) await r.dispose(); };
}};
"""
observer_source = observer_source.replace('MODEL_IDS',json.dumps({p:list(v['models']) for p,v in config['providers'].items()})).replace('OBSERVATIONS',json.dumps(str(OBSERVATIONS))).replace('ALLOWED',json.dumps(allowed)).replace('ENDPOINT',json.dumps(f'http://127.0.0.1:{port}'))
(OBSERVER/'server.js').write_text(observer_source)
(OBSERVER/'package.json').write_text(json.dumps({'name':'private-fixture-observer','type':'module'}))
config['plugins'].insert(0, {'package':str(OBSERVER)})
OBSERVER_AFTER = HOME/'observer-after'
OBSERVER_AFTER.mkdir()
(OBSERVER_AFTER/'server.js').write_text("import { appendFileSync } from 'node:fs'; export default { id:'fixture.after', async setup(ctx) { return await ctx.agent.transform(editor => appendFileSync("+json.dumps(str(OBSERVATIONS))+", JSON.stringify({kind:'after-builtin',agent:editor.get('general')})+'\\n')); }};")
(OBSERVER_AFTER/'package.json').write_text(json.dumps({'name':'private-fixture-after','type':'module'}))
config['plugins'].append({'package':str(OBSERVER_AFTER)})
(CONFIG/'opencode.json').write_text(json.dumps(config))
password = secrets.token_urlsafe(24)  # ephemeral TEST server password, never printed or persisted
ENV = {k: os.environ[k] for k in SAFE_ENV_KEYS if k in os.environ}
ENV.update({'TMPDIR':str(HOME/'tmp'), 'TEMP':str(HOME/'tmp'), 'TMP':str(HOME/'tmp'), 'HOME':str(HOME/'home'),'OPENCODE_TEST_HOME':str(HOME/'home'), 'OPENCODE_CONFIG_DIR':str(CONFIG), 'XDG_CONFIG_HOME':str(HOME/'config'), 'XDG_DATA_HOME':str(HOME/'data'), 'XDG_CACHE_HOME':str(HOME/'cache'), 'XDG_STATE_HOME':str(HOME/'state'), 'OPENCODE_PASSWORD':password, 'OPENCODE_CONFIG_PROJECT_DISABLE':'true', 'OPENCODE_DISABLE_PROJECT_CONFIG':'1'})
with socket.socket() as s: s.bind(('127.0.0.1',0)); server_port = s.getsockname()[1]
url = f'http://127.0.0.1:{server_port}'
header = {'Authorization':'Basic '+base64.b64encode(('opencode:'+password).encode()).decode(), 'Content-Type':'application/json'}
def api(path, data=None, timeout=60) -> Any:
    req = urllib.request.Request(url+path, data=None if data is None else json.dumps(data).encode(), headers=header)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else None
log = open(ARTIFACT/'v2-server.log','w')
proc = subprocess.Popen([OPENCODE_BIN,'serve','--hostname','127.0.0.1','--port',str(server_port)],cwd=PROJECT,env=ENV,stdout=log,stderr=log)
try:
    for _ in range(150):
        try: info = api('/api/info',timeout=1); break
        except Exception:
            if proc.poll() is not None: raise RuntimeError('private server exited')
            time.sleep(.1)
    else: raise RuntimeError('private server never became ready')
    sources = api('/api/config?location%5Bdirectory%5D='+str(PROJECT))
    (ARTIFACT/'v2-isolated-sources.json').write_text(json.dumps(sources,indent=2))
    assert all(not x.get('path') or pathlib.Path(x['path']).is_relative_to(HOME) for x in sources), 'CONFIG SOURCE OUTSIDE PRIVATE FIXTURE ROOT'
    assert any(x.get('path') == str(CONFIG/'opencode.json') for x in sources), 'fixture config not discovered'
    # Older hosts expose registry inventories while activation is still running.
    # Wait only for the three expected fixture plugins, before ANY prompt; the
    # strict environment/provider/config isolation gate below stays unchanged.
    expected_plugins = {'fixture.observer','fixture.after','smart-coders.model-fallback.v2-local'}
    activation_deadline = time.monotonic() + 30
    while True:
        plugins = api('/api/plugin?location%5Bdirectory%5D='+str(PROJECT), timeout=5)
        (ARTIFACT/'v2-plugin-inventory.json').write_text(json.dumps(plugins,indent=2))
        external = [p for p in plugins['data'] if p['source']['type'] != 'builtin']
        assert {p['id'] for p in external} <= expected_plugins, 'UNEXPECTED FIXTURE PLUGIN'
        assert not any(p['state']['status'] == 'error' for p in external), plugins
        if {p['id'] for p in external} == expected_plugins and all(p['state']['status'] == 'active' for p in plugins['data']):
            break
        if time.monotonic() >= activation_deadline:
            raise RuntimeError('Fixture plugin activation did not complete within 30 seconds: '+json.dumps(plugins))
        time.sleep(.1)
    # This gate runs before EVERY prompt, from the actual native APIs and child
    # process environment, not from assumed input configuration alone.
    isolation_checks = []
    def verify_isolation():
        actual_sources = api('/api/config?location%5Bdirectory%5D='+str(PROJECT))
        assert all(not s.get('path') or pathlib.Path(s['path']).is_relative_to(HOME) for s in actual_sources)
        assert any(s.get('path') == str(CONFIG/'opencode.json') for s in actual_sources)
        actual_plugins = api('/api/plugin?location%5Bdirectory%5D='+str(PROJECT))
        assert {p['id'] for p in actual_plugins['data'] if p['source']['type'] != 'builtin'} == {'fixture.observer','fixture.after','smart-coders.model-fallback.v2-local'}, actual_plugins
        assert all(p['state']['status'] == 'active' for p in actual_plugins['data']), actual_plugins
        subject = next(p for p in actual_plugins['data'] if p['id'] == 'smart-coders.model-fallback.v2-local')
        assert str(PLUGIN_PACKAGE) in json.dumps(subject), 'subject loaded from wrong package'
        providers = api('/api/provider?location%5Bdirectory%5D='+str(PROJECT))
        models = api('/api/model?location%5Bdirectory%5D='+str(PROJECT))
        (ARTIFACT/'v2-effective-providers.json').write_text(json.dumps(providers,indent=2))
        (ARTIFACT/'v2-effective-models.json').write_text(json.dumps(models,indent=2))
        assert {p['id'] for p in providers['data']} == set(allowed), providers
        for p in providers['data']:
            assert p['package'] == NATIVE_PACKAGE and p['settings']['baseURL'] == f'http://127.0.0.1:{port}/v1', p
        assert models['data'] and all(m['providerID'] in allowed and m['package'] == NATIVE_PACKAGE and m['settings']['baseURL'] == f'http://127.0.0.1:{port}/v1' for m in models['data'])
        actual_env = dict(item.split('=',1) for item in pathlib.Path(f'/proc/{proc.pid}/environ').read_text().split('\0') if item)
        assert actual_env == ENV, 'native process environment differs from strict allowlist'
        assert PROJECT.is_relative_to(HOME) and not list(PROJECT.iterdir()), 'project fixture is not empty/private'
        assert all(pathlib.Path(ENV[k]).is_relative_to(HOME) for k in ['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','TMPDIR'])
        assert not list(CONFIG.glob('agents/general.*')), 'builtin general was overridden by a profile'
        evidence = {'sources':actual_sources,'plugins':actual_plugins,'providers':providers,'models':models,
                    'env_keys':sorted(actual_env),'private_paths':{k:ENV[k] for k in ['HOME','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','TMPDIR']},'project':str(PROJECT),'verified_before_prompt':True}
        isolation_checks.append(evidence)
        (ARTIFACT/'v2-isolation-before-prompt.json').write_text(json.dumps(isolation_checks,indent=2))
        return evidence
    agents_before = api('/api/agent?location%5Bdirectory%5D='+str(PROJECT))
    (ARTIFACT/'v2-agents-before-prompt.json').write_text(json.dumps(agents_before,indent=2))
    if GENERAL:
        general = next(a for a in agents_before['data'] if a['id'] == 'general')
        assert general['mode'] == 'subagent' and general['model'] == {'providerID':'claude-code','id':GENERAL_MODELS[0],'variant':'low'}, general
        builtin = [json.loads(line)['agent'] for line in OBSERVATIONS.read_text().splitlines() if json.loads(line)['kind'] == 'builtin'][-1]
        after_builtin = [json.loads(line)['agent'] for line in OBSERVATIONS.read_text().splitlines() if json.loads(line)['kind'] == 'after-builtin'][-1]
        assert {k:v for k,v in after_builtin.items() if k != 'model'} == {k:v for k,v in builtin.items() if k != 'model'}, 'builtin fields changed beyond model'
        assert after_builtin['model'] == general['model']
        # Native browser availability adds deny rules after all transforms. Every
        # original builtin permission must remain an exact prefix in the API.
        assert general['permissions'][:len(builtin['permissions'])] == builtin['permissions']
        assert {k:v for k,v in general.items() if k not in ['model','permissions']} == {k:v for k,v in builtin.items() if k not in ['model','permissions']}
    parent = api('/api/session',{'location':{'directory':str(PROJECT)},'title':'Deterministic TEST DATA parent','agent':'fixture-parent','model':{'providerID':'fixture-one','id':'parent'}})['data']
    sid = parent['id']
    isolation = verify_isolation()
    api('/api/session/'+sid+'/prompt', {'text':'DETERMINISTIC_TEST_DATA_ONLY'})
    try:
        api('/api/experimental/session/'+sid+'/wait',{},timeout=400)
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
    if GENERAL:
        assert len(tool_results) == 1, tool_results
        expected_status = 'completed' if ARGS.scenario == 'general-success' else 'error'
        assert tool_results[0]['state']['status'] == expected_status, tool_results
        data = sessions.get('data',sessions) if isinstance(sessions,dict) else sessions
        children = [s for s in data if s.get('parentID') == sid]
        assert len(children) == 1, 'replay/new child detected'
        child = children[0]
        assert tool_results[0]['id'] == 'fixture_general_call'
        assert tool_results[0]['state']['input'] == {'agent':'general','description':'deterministic builtin general fixture','prompt':'GENERAL_TEST_DATA_ONLY'}
        assert tool_results[0]['state']['metadata']['sessionID'] == child['id'], 'native job result belongs to another child'
        assert child['agent'] == 'general' and child['outcome'] == ('succeeded' if ARGS.scenario == 'general-success' else 'failed'), child
        observations = [json.loads(line) for line in OBSERVATIONS.read_text().splitlines()]
        child_requests = [e for e in observations if e['kind'] == 'request' and e['sessionID'] == child['id']]
        retry_events = [e for e in observations if e['kind'] == 'retry' and e['sessionID'] == child['id']]
        child_prompts = [e for e in observations if e['kind'] == 'prompt' and e['sessionID'] == child['id']]
        assert len(child_prompts) == 1 and child_prompts[0]['isolationVerified'], 'prompt replay/isolation failure'
        assert len(isolation_checks) == 3, 'expected explicit + native parent + native child isolation gates'
        expected = (GENERAL_MODELS + [GENERAL_MODELS[-1]])*4 + GENERAL_MODELS if ARGS.scenario == 'general-cycles' else GENERAL_MODELS
        reqs = [r for r in requests if r['body']['model'] in GENERAL_MODELS]
        assert [r['body']['model'] for r in reqs] == expected, reqs
        assert [r['model']['id'] for r in child_requests] == expected, child_requests
        assert all(e['agent'] == 'general' and e['session']['parentID'] == sid and e['session']['id'] == child['id'] for e in child_requests + retry_events)
        assert all(e['model'].get('variant') == 'low' for e in child_requests + retry_events)
        assert len(retry_events) == (20 if ARGS.scenario == 'general-cycles' else len(expected) - (1 if ARGS.scenario == 'general-success' else 0))
        for event in retry_events:
            assert event['error']['type'] == 'provider.internal', event
            assert json.loads(event['error']['response']['body']) == CLAUDE_ENVELOPE, event
            assert json.loads(event['error']['response']['body'])['error']['code'] == 'claude_session_limit'
        assert all(r['body'].get('fixture_variant') == 'low' and 'thinking' not in r['body'] for r in reqs), 'general override leaked'
        # Native tool result retains the SAME job/session whose requests and
        # retries were observed, and delivers its terminal outcome to the parent.
        (ARTIFACT/'v2-native-observer.json').write_text(json.dumps(observations,indent=2))
        parent_after = api('/api/session/'+sid)['data']
        assert parent_after['agent'] == parent['agent'] and parent_after['model'] == parent['model'], 'parent changed'
        gaps = [b['time']-a['time'] for a,b in zip(reqs,reqs[1:])]
        provider_latency = CYCLE_LATENCY if ARGS.scenario == 'general-cycles' else 0
        overheads = [gap-r['fixture_latency'] for gap,r in zip(gaps,reqs)]
        assert all(0 <= overhead < 5 for overhead in overheads), overheads
        tool_seconds = (tool_results[0]['time']['completed']-tool_results[0]['time']['ran'])/1000
        tool_overhead = tool_seconds-sum(r['fixture_latency'] for r in reqs)
        assert 0 <= tool_overhead < 5, 'terminal stop waited instead of completing immediately'
        child_messages = api('/api/session/'+child['id']+'/message')
        (ARTIFACT/'v2-child-messages.json').write_text(json.dumps(child_messages,indent=2))
        reads = [p for m in child_messages['data'] if m.get('type') == 'assistant' for p in m.get('content',[]) if p.get('type') == 'tool' and p.get('name') == 'read']
        assert len(reads) == (4 if ARGS.scenario == 'general-cycles' else 0)
        assert all(p['state']['status'] == 'completed' and p['state']['input']['path'] == str(HOME/'cycle-fixture.txt') for p in reads)
        summary = {'scenario':ARGS.scenario,'opencode':info,'opencode_bin':OPENCODE_BIN,'plugin_package':str(PLUGIN_PACKAGE),
                   'native_parser':NATIVE_PACKAGE,'original_retry_envelope_verified':True,'test_data_only':True,
                   'isolation_verified':True,'child_id':child['id'],'child':child,'native_tool_result':tool_results[0],
                   'same_child_requests':len(child_requests),'same_child_retries':len(retry_events),'sequence':expected,
                   'all_variants_low':True,'no_thinking_override':True,'parent_model_preserved':True,'parent_continued':True,
                   'request_gaps_seconds':gaps,'fixture_provider_latency_seconds':provider_latency,'native_tool_seconds':tool_seconds,
                   'native_tool_overhead_seconds':tool_overhead,'isolation_gate_count':len(isolation_checks),'successful_native_read_checkpoints':len(reads),
                   'max_switch_overhead_seconds':max(overheads,default=0),
                   'maxCycles':plugin_config['maxCycles'],'cooldownMs':plugin_config['cooldownMs'],'stale_evidence':'unit-only','fixture_home':str(HOME)}
        (ARTIFACT/'v2-integration-result.json').write_text(json.dumps(summary,indent=2))
        print(json.dumps(summary,indent=2))
        raise SystemExit(0)
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
    plugin_entry = next(p for p in plugins['data'] if p['id'] == 'smart-coders.model-fallback.v2-local')
    if PLUGIN_PACKAGE != ROOT:
        assert str(ROOT) not in json.dumps(plugin_entry), 'installed plugin resolved from the checkout'
    a = [r for r in requests if r['body']['model'] == 'a']
    b = [r for r in requests if r['body']['model'] == 'b']
    c = [r for r in requests if r['body']['model'] == 'c']
    assert len(a) == 1, f'preemptive redirect failed: {len(a)} primary requests'
    assert len(b) == 3 and len(c) == 1, f'unexpected request counts b={len(b)}, c={len(c)}'
    assert all(r['body'].get('fixture_variant') == 'low' and r['body'].get('thinking') == {'type':'disabled'} for r in b), 'fallback variant/override missing'
    assert c[0]['body'].get('fixture_variant') == 'medium' and 'thinking' not in c[0]['body'], 'override leaked into next provider'
    summary = {'opencode':subprocess.check_output([OPENCODE_BIN,'--version'],text=True,env=ENV).strip(),'opencode_bin':OPENCODE_BIN,'plugin_package':str(PLUGIN_PACKAGE),'plugin_source':plugin_entry.get('source'),'isolation_verified':True,'children_completed':len(children),'parent_continued':True,'parent_model_preserved':True,'primary_requests':len(a),'fallback1_requests':len(b),'fallback2_requests':len(c),'variants_and_overrides_verified':True,'cycle_sequences':cycle,'maxCycles':5,'fixture_home':str(HOME),'test_data_only':True}
    (ARTIFACT/'v2-integration-result.json').write_text(json.dumps(summary,indent=2))
    print(json.dumps(summary,indent=2))
finally:
    (ARTIFACT/'v2-provider-requests.json').write_text(json.dumps(requests,indent=2))
    proc.terminate()
    try: proc.wait(timeout=10)
    except subprocess.TimeoutExpired: proc.kill(); proc.wait()
    log.close(); fixture.shutdown(); fixture.server_close()
    if OBSERVATIONS.exists(): (ARTIFACT/'v2-native-observer.jsonl').write_bytes(OBSERVATIONS.read_bytes())
    native_log = HOME/'data/opencode/log/opencode.log'
    if native_log.exists():
        (ARTIFACT/'v2-native-runtime.log').write_bytes(native_log.read_bytes())
