"""Check proof memcpy/memmove/memset at aligned and overlapping boundaries."""
from pathlib import Path
import ctypes, hashlib, json, platform, random, shutil, subprocess
HERE=Path(__file__).resolve().parent;CACHE=HERE/'.cache';rng=random.Random(19)
out=CACHE/('memory-test.dylib' if platform.system()=='Darwin' else 'memory-test.so')
subprocess.run([shutil.which('clang') or 'cc','-O2','-std=c99','-fno-builtin','-fno-strict-aliasing','-fPIC','-Dmemcpy=gl3test_memcpy','-Dmemmove=gl3test_memmove','-Dmemset=gl3test_memset','-dynamiclib' if platform.system()=='Darwin' else '-shared',str(HERE/'mvp_memory.c'),'-o',str(out)],check=True)
lib=ctypes.CDLL(str(out));move=lib.gl3test_memmove;copy=lib.gl3test_memcpy;fill=lib.gl3test_memset
for f in [move,copy]:f.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_size_t];f.restype=ctypes.c_void_p
fill.argtypes=[ctypes.c_void_p,ctypes.c_int,ctypes.c_size_t];fill.restype=ctypes.c_void_p
cases=0
for n in [0,1,7,8,9,15,16,17,31,32,127,128,129,1023,8193]:
 for src,dst in [(0,0),(0,1),(1,0),(0,8),(8,0),(1,9),(9,1),(16,24),(23,16)]:
  data=bytes(rng.randrange(256) for _ in range(n+64));a=(ctypes.c_ubyte*len(data)).from_buffer_copy(data);p=ctypes.addressof(a)
  expected=bytearray(data);expected[dst:dst+n]=data[src:src+n]
  assert move(p+dst,p+src,n)==p+dst and bytes(a)==expected
  b=(ctypes.c_ubyte*(n+64))();assert copy(ctypes.addressof(b)+dst,p+src,n)==ctypes.addressof(b)+dst
  assert bytes(b)[dst:dst+n]==bytes(a)[src:src+n]
  cases+=2
 for dst in range(8):
  for val in [-1,0,0x5a,0x100,0x1234]:
   a=(ctypes.c_ubyte*(n+32))();p=ctypes.addressof(a);want=bytearray(n+32);want[dst:dst+n]=bytes([val&255])*n
   assert fill(p+dst,val,n)==p+dst and bytes(a)==want;cases+=1
report={'passed':True,'cases':cases,'seed':19,'scope':'byte-exact proof MVP memory helpers including both overlap directions, alignment and fill truncation','sourceSHA256':hashlib.sha256((HERE/'mvp_memory.c').read_bytes()).hexdigest()}
(CACHE/'mvp-memory.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
