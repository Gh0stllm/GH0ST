"""Run only on the authorized existing Big worker, with two CPU threads."""
from pathlib import Path
import ctypes,hashlib,importlib.util,json,os,subprocess,sys,tarfile,time,urllib.request,venv
HERE=Path(__file__).resolve().parent
CACHE=HERE/'.cache';CACHE.mkdir(exist_ok=True)
EVIDENCE=HERE/'evidence';EVIDENCE.mkdir(exist_ok=True)
MODEL='6dc6dd216d0c4b12b81b0844244423e53bb8d7e4c726b8e6205683708971ef1f'
blob=(CACHE/'model.bin').read_bytes();assert len(blob)==4401034 and hashlib.sha256(blob).hexdigest()==MODEL
assert hashlib.sha256((CACHE/'runtime.wasm').read_bytes()).hexdigest()=='d7ebddffb302ab1ffe5a13edc2d06109d8375ab143bfa923d1af9e2c139052c5'
assert hashlib.sha256((HERE/'pinned_runtime.cpp').read_bytes()).hexdigest()=='ca9ba3e41edfcb911537814c6247fce1feecf9bc969b19dcea39e5ad387dc931'
assert hashlib.sha256((HERE/'model_layout.h').read_bytes()).hexdigest()=='b7e3388f00a1032d672d22dfd33794c513c7d09d8f83f01ddc0e1b8fd9fec32b'
os.environ.update(OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1',MKL_NUM_THREADS='1')
allowed=sorted(os.sched_getaffinity(0));os.sched_setaffinity(0,allowed[-2:])
fast=Path('/root/gl3-llm');fast.mkdir(exist_ok=True)
sdk=fast/'wasi-sdk-25.0-x86_64-linux';archive=fast/'wasi-sdk-25.0-x86_64-linux.tar.gz'
url='https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-25/'+archive.name
if not sdk.exists():
    if not archive.exists():urllib.request.urlretrieve(url,archive)
    with tarfile.open(archive) as tf:
        for m in tf.getmembers():assert (fast/m.name).resolve().is_relative_to(fast.resolve())
        tf.extractall(fast)
env=fast/'venv';python=env/'bin/python'
if not python.exists():venv.create(env,with_pip=True)
subprocess.run([str(python),'-m','pip','install','--disable-pip-version-check','numpy==2.3.5','pycryptodome==3.23.0'],check=True)
if sys.prefix!=str(env):os.execv(str(python),[str(python),str(Path(__file__).resolve())])
from Crypto.Hash import keccak
page_bytes=24000
pages=[blob[i:i+page_bytes] for i in range(0,len(blob),page_bytes)]
header='#pragma once\nconstexpr uint32_t PAGE_BYTES=24000,PAGE_COUNT='+str(len(pages))+';\nconstexpr uint8_t PAGE_SHA256[PAGE_COUNT][32]={\n'
header+=',\n'.join('{'+','.join(str(x) for x in hashlib.sha256(p).digest())+'}' for p in pages)+'\n};\n'
arithmetic_text='GH0ST/TinyStories-1M/INT8-Q12/runtime-ca9ba3e41edfcb911537814c6247fce1feecf9bc969b19dcea39e5ad387dc931/v1/context64/layers8/logits50257'
arithmetic_id=hashlib.sha256(arithmetic_text.encode()).digest()
header+='constexpr uint8_t ARITHMETIC_ID[32]={'+','.join(str(x) for x in arithmetic_id)+'};\n'
selectors={}
for name,signature in [('MODEL_INFO','modelInfo()'),('REGISTER_PAGE','registerPage(uint32,address)'),('INFER','infer(uint256,uint32[])'),('RESULT','result(address)')]:
    h=keccak.new(digest_bits=256);h.update(signature.encode());selector=h.hexdigest()[:8];selectors[signature]='0x'+selector;header+='constexpr uint32_t SELECTOR_'+name+'=0x'+selector+';\n'
(HERE/'page_manifest.h').write_text(header)
common=['-std=c++17','-O2','-fno-exceptions','-fno-rtti','-fwrapv','-fno-vectorize','-fno-slp-vectorize','-I',str(HERE)]
cmd=[str(sdk/'bin/clang++'),*common,str(HERE/'adapter.cpp'),'-nostartfiles','-Wl,--no-entry','-Wl,--export-memory','-Wl,--export=user_entrypoint','-Wl,--stack-first','-Wl,-z,stack-size=262144','-Wl,--max-memory=8388608','-o',str(CACHE/'tinystories-stylus.wasm')]
subprocess.run(cmd,check=True)
subprocess.run(['/usr/bin/clang++',*common,str(HERE/'pinned_runtime.cpp'),'-shared','-fPIC','-o',str(CACHE/'libruntime.so')],check=True)
descriptor=json.loads((CACHE/'reference/model-descriptor.json').read_text());data=CACHE/'reference/data';data.mkdir(exist_ok=True)
for t in descriptor['tensors']:
    t['file']=str(t['id'])+'.bin';payload=blob[t['offset']:t['offset']+t['bytes']];assert hashlib.sha256(payload).hexdigest()==t['sha256'];(data/t['file']).write_bytes(payload)
(data/'manifest.json').write_text(json.dumps(descriptor))
spec=importlib.util.spec_from_file_location('oracle',CACHE/'reference/reference_oracle.py');oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
lib=ctypes.CDLL(str(CACHE/'libruntime.so'))
for name in ['gh_model_ptr','gh_logits_ptr','gh_checkpoint_ptr']:getattr(lib,name).restype=ctypes.c_size_t
ctypes.memmove(lib.gh_model_ptr(),blob,len(blob));assert lib.gh_seal_model()==0
import numpy as np
goldens=[]
for prompt in [[7454],[7454,2402],[7454,2402,257,640]+[None]*60]:
    assert lib.gh_reset()==0;reference=oracle.IntegerNeo(data)
    checked_positions=0
    for index,token in enumerate(prompt):
        if token is None:token=int(actual.argmax());prompt[index]=token
        expected=reference.step(token);assert lib.gh_begin(token)==0
        while lib.gh_phase()!=11:assert lib.gh_advance(lib.gh_step(),512)==0
        actual=np.ctypeslib.as_array((ctypes.c_int32*50257).from_address(lib.gh_logits_ptr())).copy();assert np.array_equal(actual,expected)
        checked_positions+=1
    raw=actual.astype('<i4').tobytes();state=ctypes.string_at(lib.gh_checkpoint_ptr(),lib.gh_checkpoint_export())
    name='prompt-'+str(len(prompt));(CACHE/(name+'-logits.bin')).write_bytes(raw)
    context_check=None
    if len(prompt)==64:
        before=state;assert lib.gh_begin(7454)==-2;after=ctypes.string_at(lib.gh_checkpoint_ptr(),lib.gh_checkpoint_export());assert before==after;context_check={'sixtyFifthTokenRejected':True,'completeStateUnchanged':True}
    goldens.append({'prompt':prompt,'nextToken':int(actual.argmax()),'logitsSHA256':hashlib.sha256(raw).hexdigest(),'checkpointSHA256':hashlib.sha256(state).hexdigest(),'checkpointBytes':len(state),'logitsFile':name+'-logits.bin','allLogitsCompared':50257,'completePositionsCompared':checked_positions,'intermediateLogitsCompared':50257*checked_positions,'contextBoundary':context_check})
(CACHE/'goldens.json').write_text(json.dumps(goldens,indent=2)+'\n')
report={'schema':'gl3.llm.stylus-build.v1','scope':'Runpod-only exact full existing model and genuine Stylus ABI adapter build; no validity proof','allExecutionOnRunpod':True,'cpuAffinity':sorted(os.sched_getaffinity(0)),'modelBytes':len(blob),'modelSHA256':MODEL,'arithmeticID':arithmetic_id.hex(),'arithmeticIDPreimage':arithmetic_text,'pageBytes':page_bytes,'pageCount':len(pages),'selectors':selectors,'wasiSDK':{'url':url,'archiveSHA256':hashlib.sha256(archive.read_bytes()).hexdigest()},'command':cmd,'nativeOracleGoldens':goldens,'artifacts':{}}
for p in [HERE/'adapter.cpp',HERE/'pinned_runtime.cpp',HERE/'page_manifest.h',HERE/'model_layout.h',CACHE/'tinystories-stylus.wasm',CACHE/'runtime.wasm']:
    body=p.read_bytes();report['artifacts'][p.name]={'bytes':len(body),'SHA256':hashlib.sha256(body).hexdigest()}
(EVIDENCE/'build.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
