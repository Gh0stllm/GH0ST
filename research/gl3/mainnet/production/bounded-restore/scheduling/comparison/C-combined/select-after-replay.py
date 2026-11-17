from pathlib import Path
import time,subprocess,json
r=Path('/root/bounded-restore/fast-comparison/C-combined');o=r/'interpreter'
while not (o/'replay-result.json').exists():time.sleep(5)
if not json.loads((o/'replay-result.json').read_text())['passed']:(o/'selection-exit.json').write_text(json.dumps({'skipped':True,'reason':'Interpreter did not finish with matching state'})+'\n')
else:
 with (o/'selection.log').open('w') as log:p=subprocess.run(['python3',str(r/'select-proofs.py')],stdout=log,stderr=subprocess.STDOUT)
 (o/'selection-exit.json').write_text(json.dumps({'exitCode':p.returncode})+'\n')
