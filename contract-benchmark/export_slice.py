"""Export a small genuine LFM matrix/activation slice for integer-kernel parity.

Offline build step. This does not evaluate full-model quantization quality.
"""
import hashlib
import json
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from transformers.utils import logging

ROOT = Path(__file__).resolve().parent


def main():
    logging.disable_progress_bar()
    torch.set_num_threads(4)
    torch.use_deterministic_algorithms(True)
    lock = json.loads((ROOT.parent / 'model-lock.json').read_text())
    tokenizer = AutoTokenizer.from_pretrained(lock['model_id'], revision=lock['revision'], trust_remote_code=False)
    model = AutoModelForCausalLM.from_pretrained(lock['model_id'], revision=lock['revision'],
        trust_remote_code=False, dtype=torch.float32, attn_implementation='eager').eval()
    name = 'model.layers.0.feed_forward.w1'
    module = model.get_submodule(name)
    captured = []
    def capture(_module, inputs):
        captured.append(inputs[0][0, -1].detach().clone())
    hook = module.register_forward_pre_hook(capture)
    prompt = [{'role': 'user', 'content': 'Set my goal to learn Solidity.'}]
    inputs = tokenizer.apply_chat_template(prompt, add_generation_prompt=True,
        tokenize=True, return_tensors='pt', return_dict=True)
    with torch.inference_mode():
        model(**inputs, use_cache=False)
    hook.remove()
    x = captured[0]
    w = module.weight[:4].detach().float()
    assert list(w.shape) == [4, 1024] and list(x.shape) == [1024]
    ws = w.abs().amax(dim=1) / 7
    xs = x.abs().max() / 32767
    qw = torch.round(w / ws[:, None]).clamp(-7, 7).to(torch.int64)
    qx = torch.round(x / xs).clamp(-32767, 32767).to(torch.int64)
    sums = (qw * qx[None, :]).sum(dim=1).tolist()
    flat = qw.flatten().tolist()
    packed = bytes((flat[i] & 15) | ((flat[i + 1] & 15) << 4) for i in range(0, len(flat), 2))
    activation_bytes = b''.join(int(v).to_bytes(2, 'little', signed=True) for v in qx.tolist())
    fp = (w @ x).tolist()
    restored = [int(s) * float(ws[i]) * float(xs) for i, s in enumerate(sums)]
    report = {'model': lock, 'tensor': name + '.weight', 'rows': 4, 'cols': 1024,
        'row_selection': [0, 1, 2, 3], 'activation_position': 'last prompt token, input to w1',
        'messages': prompt, 'input_token_ids': inputs['input_ids'][0].tolist(),
        'weight_quantization': 'symmetric per-row int4 [-7,7], max-abs/7, ties-to-even rounding',
        'activation_quantization': 'symmetric int16 [-32767,32767], max-abs/32767',
        'weight_scales': ws.tolist(), 'activation_scale': float(xs),
        'packed_weights_hex': packed.hex(), 'packed_activations_hex': activation_bytes.hex(),
        'weights_sha256': hashlib.sha256(packed).hexdigest(),
        'activations_sha256': hashlib.sha256(activation_bytes).hexdigest(),
        'expected_integer_outputs': sums, 'float32_outputs': fp,
        'rescaled_integer_outputs_for_comparison_only': restored,
        'absolute_errors': [abs(a-b) for a,b in zip(fp,restored)],
        'limitations': ['Contract benchmark stops at integer accumulation; scales are not applied by the contract.',
            'This is four rows of one projection, not a complete layer or token.',
            'One activation slice does not establish quantized model quality.']}
    (ROOT / 'lfm-slice.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'shape': [4,1024], 'integer_outputs': sums, 'absolute_errors': report['absolute_errors']}))


if __name__ == '__main__':
    main()
