"""One bounded owned process-group supervisor. No chain-specific test bypass CLI."""
from pathlib import Path
import ctypes,errno,fcntl,json,os,signal,subprocess,time

class SupervisionError(Exception):
    pass

def private_dir(path):
    path=Path(path)
    if path.is_symlink():raise SupervisionError('directory_symlink_refused')
    path.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.stat().st_uid!=os.getuid() or path.stat().st_mode&0o077:
        raise SupervisionError('directory_permissions_refused')
    return path

class Supervisor:
    def __init__(self,argv,state_dir,*,env=None,cwd=None,max_restarts=3,backoff=2.0,max_backoff=30.0,grace=30.0,poll=.2,before_start=None):
        if not 0<=max_restarts<=10 or not 0<backoff<=60 or not backoff<=max_backoff<=300 or not 0<grace<=120:
            raise SupervisionError('invalid_supervision_bounds')
        self.argv=list(argv);self.state_dir=Path(state_dir);self.env=env;self.cwd=cwd
        self.max_restarts=max_restarts;self.backoff=backoff;self.max_backoff=max_backoff;self.grace=grace;self.poll=poll
        self.before_start=before_start;self.stop_signal=None;self.events=[];self.child=None
    def request_stop(self,signum,frame=None):
        self.stop_signal=signum
    def event(self,kind,**data):
        item={'event':kind,'UTC':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'monotonic':time.monotonic(),**data}
        self.events.append(item)
        with (self.state_dir/'lifecycle.jsonl').open('a') as stream:
            os.chmod(stream.name,0o600);stream.write(json.dumps(item,separators=(',',':'))+'\n')
    @staticmethod
    def _group_signal(pid,signum):
        try:os.killpg(pid,signum)
        except ProcessLookupError:pass
    @staticmethod
    def _child_start(parent):
        # Direct child cannot survive an abruptly lost supervisor unnoticed.
        libc=ctypes.CDLL(None,use_errno=True)
        if libc.prctl(1,signal.SIGKILL,0,0,0)!=0:os._exit(125) # PR_SET_PDEATHSIG
        if os.getppid()!=parent:os._exit(125)
    def run(self):
        private_dir(self.state_dir)
        lock_path=self.state_dir/'operator.lock'
        fd=os.open(lock_path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600);lease=os.fdopen(fd,'a');os.chmod(lock_path,0o600)
        try:fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:lease.close();raise SupervisionError('another_supervisor_owns_state')
        previous={s:signal.getsignal(s) for s in [signal.SIGTERM,signal.SIGINT]}
        for s in previous:signal.signal(s,self.request_stop)
        result={'status':'NOT_STARTED','attempts':0,'exitCode':1};restarts=0
        try:
            while not self.stop_signal:
                if self.before_start is not None:self.before_start()
                parent=os.getpid();attempt=restarts+1;started=time.monotonic()
                # No daemon output is retained: untrusted errors can echo credentials.
                self.child=subprocess.Popen(self.argv,cwd=self.cwd,env=self.env,stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True,pass_fds=(lease.fileno(),),preexec_fn=lambda:self._child_start(parent))
                pid=self.child.pid
                self.event('child_started',pid=pid,attempt=attempt,childOutputPolicy='discard; lifecycle-only logging')
                got=0;deadline=None;escalated=False
                try:
                    while True:
                        got,status,usage=os.wait4(pid,os.WNOHANG)
                        if got:break
                        if self.stop_signal and deadline is None:
                            self.event('stop_forwarded',pid=pid,signal=signal.Signals(self.stop_signal).name)
                            self._group_signal(pid,signal.SIGTERM);deadline=time.monotonic()+self.grace
                        if deadline is not None and time.monotonic()>=deadline and not escalated:
                            self._group_signal(pid,signal.SIGKILL);escalated=True;self.event('stop_escalated',pid=pid,signal='SIGKILL')
                        time.sleep(self.poll)
                finally:
                    if not got:
                        self._group_signal(pid,signal.SIGKILL);got,status,usage=os.wait4(pid,0)
                    code=os.waitstatus_to_exitcode(status);self.child.returncode=code
                    # Clean any remaining members of this owned group before reuse.
                    self._group_signal(pid,signal.SIGTERM)
                    time.sleep(min(self.poll,.05));self._group_signal(pid,signal.SIGKILL)
                    self.event('child_exit',pid=pid,attempt=attempt,exitCode=code,seconds=time.monotonic()-started,maxRSSKiB=usage.ru_maxrss,requestedStop=self.stop_signal is not None)
                    result={'status':'STOPPED' if self.stop_signal else 'UNEXPECTED_CHILD_EXIT','attempts':attempt,'lastChildExitCode':code,'exitCode':0 if self.stop_signal else 1}
                    self.child=None
                if self.stop_signal:break
                if restarts>=self.max_restarts:
                    result['status']='RESTART_BUDGET_EXHAUSTED';self.event('restart_budget_exhausted',attempts=attempt);break
                delay=min(self.backoff*2**restarts,self.max_backoff);restarts+=1
                self.event('restart_wait',seconds=delay,restarts=restarts)
                until=time.monotonic()+delay
                while time.monotonic()<until and not self.stop_signal:time.sleep(min(self.poll,until-time.monotonic()))
            if self.stop_signal and result['status']=='NOT_STARTED':result={'status':'STOPPED_BEFORE_START','attempts':0,'exitCode':0}
        except Exception:
            # Never serialize raw exceptions: they can include secret URL/config values.
            self.event('supervisor_failed',reason='validation_or_spawn_failed');result={'status':'FAIL_CLOSED','attempts':result['attempts'],'exitCode':1}
        finally:
            if self.child is not None and self.child.returncode is None:
                self._group_signal(self.child.pid,signal.SIGKILL)
                try:_,status,_=os.wait4(self.child.pid,0);self.child.returncode=os.waitstatus_to_exitcode(status)
                except ChildProcessError:pass
            for s,handler in previous.items():signal.signal(s,handler)
            (self.state_dir/'result.json').write_text(json.dumps(result,indent=2)+'\n');os.chmod(self.state_dir/'result.json',0o600)
            lease.close()
        return result
