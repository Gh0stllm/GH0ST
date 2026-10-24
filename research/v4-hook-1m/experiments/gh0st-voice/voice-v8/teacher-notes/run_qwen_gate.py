"""Two fixed-seed local instruction-teacher evaluations; no data approval."""
from pathlib import Path
import subprocess,sys

here=Path(__file__).resolve().parent
voice=here.parent.parent
prompts=voice/'voice-v7/evaluation/teacher-review/teacher-validation-prompts.jsonl'
for seed in (0,42):
    subprocess.run([sys.executable,str(here/'sample_instruction_teacher.py'),
                    '--checkpoint',str(here/'qwen-cache'),'--prompts',str(prompts),
                    '--out',str(here/f'evaluation/qwen-seed{seed}'),
                    '--device','mps','--attention','sdpa','--batch','8',
                    '--target-tokens','100000','--max-candidates','8',
                    '--max-new','128','--seed',str(seed)],check=True)
