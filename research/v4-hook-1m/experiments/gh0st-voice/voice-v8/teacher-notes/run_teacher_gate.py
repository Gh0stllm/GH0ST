"""Run the frozen local teacher comparison; no data is approved by this runner."""
from pathlib import Path
import subprocess,sys

here=Path(__file__).resolve().parent
voice=here.parent.parent
experiments=voice.parent
prompts=voice/'voice-v7/evaluation/teacher-review/teacher-validation-prompts.jsonl'
for name,checkpoint in [('base',experiments/'gpt2/model-cache'),('adapted',here/'runs/top4-voice-2ep/checkpoint-best')]:
    for seed in (0,42):
        subprocess.run([sys.executable,str(here/'sample_teacher.py'),'--checkpoint',str(checkpoint),
                        '--prompts',str(prompts),'--out',str(here/f'evaluation/{name}-seed{seed}'),
                        '--device','mps','--batch','8','--target-tokens','100000','--max-candidates','8',
                        '--max-new','128','--seed',str(seed)],check=True)
