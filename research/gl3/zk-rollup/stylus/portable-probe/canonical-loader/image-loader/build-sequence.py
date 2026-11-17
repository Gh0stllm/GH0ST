from pathlib import Path
import subprocess,time,json
b=Path('/workspace/gl3/zk-tests/stylus-source/image-loader')
while not(b/'portable-build-result.json').exists():time.sleep(.5)
assert json.loads((b/'portable-build-result.json').read_text())['actualExitCode']==0
subprocess.run(['python3',str(b/'host-build-controller.py')],check=True)
