from pathlib import Path
import os,subprocess,time,json,concurrent.futures
b=Path(__file__).resolve().parents[1]/'.cache';s=b/'nitro-build';sdk=(b/'../../../engine/.cache/toolchain/wasi-sdk/wasi-sdk-25.0').resolve();clang=str(sdk/'bin/clang');ar=str(sdk/'bin/llvm-ar');sysroot=str(sdk/'share/wasi-sysroot');records=[]
def run(args,cwd=s):
 t=time.time();p=subprocess.run(args,cwd=cwd,capture_output=True,text=True);r={'command':args,'exitCode':p.returncode,'seconds':round(time.time()-t,3),'outputTail':(p.stdout+p.stderr)[-3000:]};records.append(r)
 if p.returncode:raise RuntimeError(json.dumps(r))
 return r
try:
 lib=s/'target/lib-wasm';lib.mkdir(parents=True,exist_ok=True);obj=b/'brotli-wasm-objects';obj.mkdir(exist_ok=True)
 for folder,tag in [('common','common'),('dec','dec'),('enc','enc')]:
  files=list((s/'brotli/c'/folder).glob('*.c'))
  def compile(f):
   out=obj/(f.stem+'.o');run([clang,'--target=wasm32-wasip1','--sysroot='+sysroot,'-O3','-fPIC','-DBROTLI_BUILD_PORTABLE','-DBROTLI_STATIC_COMPILATION','-I'+str(s/'brotli/c/include'),'-c',str(f),'-o',str(out)]);return str(out)
  with concurrent.futures.ThreadPoolExecutor(8) as ex:objects=list(ex.map(compile,files))
  run([ar,'rcs',str(lib/('libbrotli'+tag+'-static.a'))]+objects)
 soft=s/'crates/wasm-libraries/soft-float';sf=soft/'SoftFloat/build/Wasm-Clang'
 compilec=clang+' -c -Werror-implicit-function-declaration -DSOFTFLOAT_FAST_INT64 -target wasm32-unknown-unknown --sysroot '+sysroot+' $(SOFTFLOAT_OPTS) $(C_INCLUDES) -O2 -o $@'
 run(['make','-j8','COMPILE_C='+compilec,'MAKELIB='+ar+' crs $@'],sf)
 objects=[]
 for bits in [32,64]:
  out=soft/('bindings'+str(bits)+'.o');run([clang,'--target=wasm32-wasip1','--sysroot='+sysroot,'-I'+str(soft/'SoftFloat/source/include'),'-c',str(soft/('bindings'+str(bits)+'.c')),'-o',str(out)]);objects.append(str(out))
 machines=s/'target/machines/latest';machines.mkdir(parents=True,exist_ok=True)
 exports=['wavm__f'+str(bits)+'_'+op for bits in [32,64] for op in ['abs','neg','ceil','floor','trunc','nearest','sqrt','add','sub','mul','div','min','max','copysign','eq','ne','lt','le','gt','ge']]
 exports += ['wavm__i'+str(bits)+'_'+group+'_'+operand for bits in [32,64] for group in ['trunc','trunc_sat'] for operand in ['f32_s','f32_u','f64_s','f64_u']]
 exports += ['wavm__f'+str(bits)+'_convert_'+operand for bits in [32,64] for operand in ['i32_s','i32_u','i64_s','i64_u']]+['wavm__f32_demote_f64','wavm__f64_promote_f32']
 run([str(sdk/'bin/wasm-ld')]+objects+[str(p) for p in sf.glob('*.o')]+['--no-entry','-o',str(machines/'soft-float.wasm')]+['--export='+x for x in exports])
finally:
 (b/'replay-c-libs-build.json').write_text(json.dumps({'scope':'Actual pinned C companion WASM library compilation','records':records,'allPassed':all(x['exitCode']==0 for x in records)},indent=2)+'\n')
 print(json.dumps({'records':len(records),'allPassed':all(x['exitCode']==0 for x in records)}))
