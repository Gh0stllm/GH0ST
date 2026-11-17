import subprocess
r=subprocess.run(['python3','/workspace/gl3/zk-tests/warm-verifier-parent/source/verify-cloud.py'])
assert r.returncode==0
subprocess.run(['python3','/workspace/gl3/zk-tests/warm-optimization/finalize-comparison.py'],check=True)
