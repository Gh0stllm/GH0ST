"""Harmless Python dummy-process regressions; never launches Nitro or a network listener."""
from pathlib import Path
import argparse,copy,json,os,signal,subprocess,sys,tempfile,time
from operator_runtime import Supervisor,SupervisionError
from operator_bootstrap import config_checks,database_layout

SENTINEL='GL3_RPC_DUMMY_SECRET_NOT_A_REAL_CREDENTIAL'
SELF=Path(__file__).resolve()
def wait(predicate,seconds=4):
    until=time.monotonic()+seconds
    while time.monotonic()<until:
        value=predicate()
        if value:return value
        time.sleep(.02)
    raise AssertionError('bounded dummy wait expired')
def child(mode,ready):
    if mode=='crash':raise SystemExit(17)
    signal.signal(signal.SIGTERM,signal.SIG_IGN if mode=='ignore' else lambda s,f:sys.exit(0))
    Path(ready).write_text(str(os.getpid()));print(SENTINEL,flush=True)
    while True:time.sleep(.05)
def worker(mode,state,ready):
    try:
        sup=Supervisor([sys.executable,str(SELF),'--child',mode,'--ready',ready],state,max_restarts=2,backoff=.03,max_backoff=.06,grace=.15,poll=.02)
        result=sup.run();print(json.dumps(result));return result['exitCode']
    except SupervisionError:
        print(json.dumps({'status':'LOCK_REFUSED'}));return 2

def events(state):
    p=Path(state)/'lifecycle.jsonl'
    return [json.loads(x) for x in p.read_text().splitlines()] if p.exists() else []
def stop_worker(p,state,ready):
    pid=int(Path(ready).read_text());p.send_signal(signal.SIGTERM)
    stdout,stderr=p.communicate(timeout=5)
    assert p.returncode==0,(p.returncode,stdout,stderr)
    assert not Path('/proc/'+str(pid)).exists(),'dummy child was not reaped'
    assert SENTINEL not in stdout+stderr+(Path(state)/'lifecycle.jsonl').read_text()
    return events(state)
def spawn(mode,state,ready):
    parent=os.getpid()
    return subprocess.Popen([sys.executable,str(SELF),'--worker',mode,'--state',str(state),'--ready',str(ready)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True,preexec_fn=lambda:Supervisor._child_start(parent))
def cleanup(p,ready):
    if p is not None and p.poll() is None:
        if Path(ready).exists():
            try:os.killpg(int(Path(ready).read_text()),signal.SIGKILL)
            except ProcessLookupError:pass
        p.kill();p.communicate(timeout=3)

def regression(profile):
    start=time.monotonic();cases=[]
    with tempfile.TemporaryDirectory(prefix='supervision-',dir='/workspace/gl3/testnet/withdrawal-recovery') as tmp:
        root=Path(tmp)
        # All commands below are either read-only check/dry-run or this Python dummy.
        for flag in ['--check','--dry-run']:
            snapshots={p:(os.readlink(p),Path(p).lstat().st_ino,Path(p).lstat().st_mtime_ns) for p in ['/root/gl3-base-launch/bin','/root/gl3-base-launch/machines','/root/dispute']}
            x=subprocess.run([sys.executable,str(SELF.with_name('operator_bootstrap.py')),flag,'--profile',str(profile)],capture_output=True,text=True,timeout=10)
            data=json.loads(x.stdout);assert x.returncode==2 and data['readyForOperatorStart'] is False
            assert 'not_selected:review.activationApproved' in data['blockers'] and data['networkCalls']==0 and data['databasesOpened'] is False
            assert snapshots=={p:(os.readlink(p),Path(p).lstat().st_ino,Path(p).lstat().st_mtime_ns) for p in snapshots}
            cases.append({'name':flag+' refuses current incomplete profile without aliases/DB/network mutation','passed':True})
        x=spawn('crash',root/'crash',root/'crash.ready');stdout,stderr=x.communicate(timeout=5)
        assert x.returncode==1;ev=events(root/'crash');assert len([e for e in ev if e['event']=='child_started'])==3
        assert [e['exitCode'] for e in ev if e['event']=='child_exit']==[17,17,17]
        assert any(e['event']=='restart_budget_exhausted' for e in ev)
        cases.append({'name':'three actual dummy exits exhaust two-restart budget','passed':True})
        for mode,expected in [('grace',0),('ignore',-signal.SIGKILL)]:
            state=root/mode;ready=root/(mode+'.ready');p=None
            try:
                p=spawn(mode,state,ready);wait(lambda:ready.exists());ev=stop_worker(p,state,ready)
                assert [e['exitCode'] for e in ev if e['event']=='child_exit']==[expected]
                assert any(e['event']=='stop_forwarded' for e in ev)
                assert any(e['event']=='stop_escalated' for e in ev)==(mode=='ignore')
                cases.append({'name':'graceful SIGTERM stop' if mode=='grace' else 'ignored SIGTERM escalates and reaps SIGKILL','passed':True})
            finally:cleanup(p,ready)
        state=root/'lock';ready=root/'lock.ready';p=None
        try:
            p=spawn('grace',state,ready);wait(lambda:ready.exists())
            q=spawn('crash',state,root/'second.ready');stdout,stderr=q.communicate(timeout=3)
            assert q.returncode==2 and len([e for e in events(state) if e['event']=='child_started'])==1
            stop_worker(p,state,ready);cases.append({'name':'second supervisor cannot own same state/launch child','passed':True})
        finally:cleanup(p,ready)
        assert database_layout(root/'absent-db')=='missing'
        empty=root/'empty-db';empty.mkdir();assert database_layout(empty)=='empty'
        (empty/'unrecognized-file').write_text('dummy metadata only');assert database_layout(empty)=='partial_or_unrecognized'
        cases.append({'name':'missing/empty/partial DB metadata cannot masquerade as complete persisted DB','passed':True})
        # Pure policy fixture, not a configured/approved production profile.
        pf=json.loads(Path(profile).read_text());pf['roles']['mode']='observer';nc=pf['nodeConfig'];st=pf['storage']
        cfg={'chain':{'id':pf['chain']['childChainIdProposal'],'info-files':[nc['chainInfoPath']]},'parent-chain':{'id':4663,'connection':{'url':'$GL3_PARENT_RPC'}},'persistent':{'chain':st['chainPath'],'global-config':st['globalConfigPath'],'db-engine':'pebble','pebble':{'sync-mode':True}},'init':{'genesis-json-file':nc['genesisPath'],'validate-genesis-assertion':True},'ensure-rollup-deployment':True,'validation':{'wasm':{'root-path':pf['runtime']['machinesPath']}},'http':{'addr':'127.0.0.1'}}
        assert config_checks(pf,cfg)==([],[])
        for name,mutate,expected in [('public bind',lambda c:c['http'].update(addr='0.0.0.0'),'non_loopback_bind_refused:http'),('inline RPC',lambda c:c['parent-chain']['connection'].update(url='https://example.invalid/'+SENTINEL),'inline_or_missing_parent_rpc_refused'),('force initializer',lambda c:c['init'].update(force=True),'config_init_override_refused'),('observer posting',lambda c:c.update(node={'batch-poster':{'enable':True}}),'observer_must_disable_active_roles')]:
            candidate=copy.deepcopy(cfg);mutate(candidate);assert expected in config_checks(pf,candidate)[0];cases.append({'name':'policy rejects '+name,'passed':True})
    assert time.monotonic()-start<30
    return {'passed':True,'seconds':time.monotonic()-start,'cases':cases,'scope':'Python dummy process lifecycle and read-only incomplete-profile policy; no Nitro/network/chain/keys/alias installation/host restart','productionServiceTested':False,'replacementBootTested':False}

def main():
    p=argparse.ArgumentParser();p.add_argument('--child',choices=['crash','grace','ignore']);p.add_argument('--worker',choices=['crash','grace','ignore']);p.add_argument('--state');p.add_argument('--ready');p.add_argument('--profile',type=Path);a=p.parse_args()
    if a.child:return child(a.child,a.ready)
    if a.worker:return worker(a.worker,a.state,a.ready)
    result=regression(a.profile);print(json.dumps(result,indent=2));return 0
if __name__=='__main__':raise SystemExit(main())
