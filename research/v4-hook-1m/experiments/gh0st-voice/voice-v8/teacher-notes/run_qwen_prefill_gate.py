"""Fixed-seed direct-prefix teacher evaluation; no data approval."""
from pathlib import Path
import subprocess,sys
here=Path(__file__).resolve().parent
voice=here.parent.parent
for seed in (0,42):
    subprocess.run([sys.executable,str(here/'sample_instruction_teacher.py'),
        '--checkpoint',str(here/'qwen-cache'),
        '--prompts',str(voice/'voice-v7/evaluation/teacher-review/teacher-validation-prompts.jsonl'),
        '--out',str(here/f'evaluation/qwen-prefill-seed{seed}'),
        '--device','mps','--attention','sdpa','--batch','8','--prefix-mode','assistant-prefill',
        '--target-tokens','100000','--max-candidates','8','--max-new','128','--seed',str(seed)],check=True)
