from pathlib import Path
import subprocess,os,json,time
R=Path('/workspace/gl3/same-day-mainnet/ops/infra-prepare');E=R/'evidence';f=(E/'bundle-runtime.log').open('w');at=time.monotonic();p=subprocess.Popen(['python3',str(R/'bundle-runtime.py')],stdout=f,stderr=subprocess.STDOUT);_,s,u=os.wait4(p.pid,0);p.returncode=os.waitstatus_to_exitcode(s);f.close();(E/'bundle-runtime-exit.json').write_text(json.dumps({'actualWait4':True,'exitCode':p.returncode,'seconds':time.monotonic()-at,'maxRSSKiB':u.ru_maxrss})+'\n')
