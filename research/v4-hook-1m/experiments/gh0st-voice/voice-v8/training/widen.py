#!/usr/bin/env python3
"""Float Net2Wider conversion for the V7 two-layer word/punctuation GRU.

Only checkpoint tensors are read. No optimizer, corpus, generation corpus,
network, chain, or training calls are made. Adjacent replica channels are used:
the widened channel index j maps to the source index j // factor.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import torch
from torch.nn import functional as F
from safetensors.torch import load_file, save_file

MATRICES = ('wx1', 'wh1', 'wx2', 'wh2')
INPUT_EMBEDS = ('embedding.weight', 'punct_embedding.weight')
OUTPUT_WEIGHTS = ('groups.weight', 'words.weight', 'punct_head.weight')
UNCHANGED = ('group_bias.weight', 'word_bias.weight', 'punct_bias', 'word_punct_bias.weight')
KEYS = set(MATRICES + INPUT_EMBEDS + OUTPUT_WEIGHTS + UNCHANGED +
           ('wf', 'bh1', 'bh2', 'domain.weight'))


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as src:
        for chunk in iter(lambda: src.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def validate(source: dict[str, torch.Tensor]) -> dict:
    if set(source) != KEYS:
        raise ValueError(f'Unexpected tensor keys: missing={sorted(KEYS-set(source))}, '
                         f'extra={sorted(set(source)-KEYS)}')
    h = source['wx1'].shape[1]
    v = source['words.weight'].shape[0]
    p = source['punct_embedding.weight'].shape[0]
    g = source['groups.weight'].shape[0]
    d = source['domain.weight'].shape[0]
    shapes = {k: (3*h, h) for k in MATRICES}
    shapes.update({'embedding.weight': (v+2, h), 'punct_embedding.weight': (p,h),
        'wf': (3*h,6), 'bh1': (3*h,), 'bh2': (3*h,), 'domain.weight': (d,3*h),
        'groups.weight': (g,h), 'words.weight': (v,h), 'punct_head.weight': (p,h),
        'group_bias.weight': (g,1), 'word_bias.weight': (v,1),
        'punct_bias': (p,), 'word_punct_bias.weight': (v,p)})
    for name, expected in shapes.items():
        t = source[name]
        if tuple(t.shape) != expected:
            raise ValueError(f'{name}: expected{expected}, got{tuple(t.shape)}')
        if not t.is_floating_point() or not torch.isfinite(t).all():
            raise ValueError(f'{name}: nonfinite or nonfloating source tensor')
    if v % g:
        raise ValueError('Vocabulary must divide into an integer number of words per group')
    return dict(hidden_width=h, vocabulary=v, input_vocabulary=v+2, punctuation=p,
                groups=g, words_per_group=v//g, domains=d, features=6, layers=2)


def widen(source: dict[str, torch.Tensor], factor: int) -> dict[str, torch.Tensor]:
    shape = validate(source)
    h = shape['hidden_width']
    if factor < 1 or not isinstance(factor, int):
        raise ValueError('factor must be a positive integer')
    out = {}
    for name in MATRICES:
        # Repeat within each r/z/n gate, never across the flattened gate axis.
        out[name] = (source[name].reshape(3,h,h).repeat_interleave(factor,1)
                     .repeat_interleave(factor,2).reshape(3*h*factor,h*factor)/factor)
    for name in INPUT_EMBEDS:
        out[name] = source[name].repeat_interleave(factor,1)
    for name in OUTPUT_WEIGHTS:
        out[name] = source[name].repeat_interleave(factor,1)/factor
    for name in ('bh1','bh2'):
        out[name] = source[name].reshape(3,h).repeat_interleave(factor,1).reshape(-1)
    out['wf'] = source['wf'].reshape(3,h,6).repeat_interleave(factor,1).reshape(3*h*factor,6)
    out['domain.weight'] = (source['domain.weight'].reshape(-1,3,h)
                            .repeat_interleave(factor,2).reshape(-1,3*h*factor))
    for name in UNCHANGED:
        out[name] = source[name].clone()
    return {name: out[name].contiguous() for name in sorted(out)}


def audit_mapping(source: dict[str, torch.Tensor], result: dict[str, torch.Tensor], factor: int) -> dict:
    """Check every output value using indexed source channels independently."""
    h = source['wx1'].shape[1]
    idx = torch.arange(h*factor)//factor
    checks = {}
    for name, actual in result.items():
        t = source[name]
        if name in MATRICES:
            expected = t.reshape(3,h,h)[:,idx,:][:,:,idx].reshape(3*h*factor,h*factor)/factor
        elif name in INPUT_EMBEDS:
            expected = t[:,idx]
        elif name in OUTPUT_WEIGHTS:
            expected = t[:,idx]/factor
        elif name in ('bh1','bh2'):
            expected = t.reshape(3,h)[:,idx].reshape(-1)
        elif name == 'wf':
            expected = t.reshape(3,h,6)[:,idx,:].reshape(3*h*factor,6)
        elif name == 'domain.weight':
            expected = t.reshape(-1,3,h)[:,:,idx].reshape(-1,3*h*factor)
        else:
            expected = t
        ok = torch.equal(actual,expected)
        checks[name] = dict(pass_exact=ok, values=actual.numel(), shape=list(actual.shape))
        if not ok:
            raise AssertionError(f'Full tensor mapping mismatch: {name}')
    return dict(status='PASS', output_values_checked=sum(t.numel() for t in result.values()),
                tensors=checks)


def cell(incoming, state, recurrent):
    ir,iz,inn = incoming.chunk(3,-1)
    hr,hz,hn = F.linear(state,recurrent).chunk(3,-1)
    r,z = torch.sigmoid(ir+hr),torch.sigmoid(iz+hz)
    return z*state+(1-z)*torch.tanh(inn+r*hn)


def step(tensors, word, punct, state, domain, features):
    x = tensors['embedding.weight'][word]+tensors['punct_embedding.weight'][punct]
    incoming = (F.linear(x,tensors['wx1'])+tensors['bh1']+
                tensors['domain.weight'][domain]+F.linear(features,tensors['wf']))
    first = cell(incoming,state[0],tensors['wh1'])
    second = cell(F.linear(first,tensors['wx2'])+tensors['bh2'],state[1],tensors['wh2'])
    groups = F.linear(second,tensors['groups.weight'],tensors['group_bias.weight'][:,0])
    words = F.linear(second,tensors['words.weight'],tensors['word_bias.weight'][:,0])
    vocabulary = tensors['words.weight'].shape[0]
    punctuation = (F.linear(second,tensors['punct_head.weight'])+tensors['punct_bias']+
                   (word<vocabulary)[:,None]*tensors['word_punct_bias.weight'][word.clamp_max(vocabulary-1)])
    return (first,second),(groups,words,punctuation)


def audit_function(source, result, factor, steps=16, tolerance=2e-5):
    """Diagnostic FP32 parity, not a fixed-point or EVM parity claim."""
    spec = validate(source)
    gen = torch.Generator().manual_seed(73519)
    batch = 3
    h = spec['hidden_width']
    state = tuple(torch.randn(batch,h,generator=gen)*.2 for _ in range(2))
    wide_state = tuple(s.repeat_interleave(factor,-1) for s in state)
    maxima = dict(layer1=0.,layer2=0.,group_logits=0.,all_word_logits=0.,punctuation_logits=0.)
    for at in range(steps):
        word = torch.randint(spec['input_vocabulary'],(batch,),generator=gen)
        punct = torch.randint(spec['punctuation'],(batch,),generator=gen)
        domain = torch.arange(batch)%spec['domains']
        features = torch.randn(batch,6,generator=gen)*.2
        state,logits = step(source,word,punct,state,domain,features)
        wide_state,wide_logits = step(result,word,punct,wide_state,domain,features)
        pairs = [(wide_state[i],state[i].repeat_interleave(factor,-1))for i in range(2)]
        pairs += list(zip(wide_logits,logits))
        for name,(actual,expected) in zip(maxima,pairs):
            error = float((actual-expected).abs().max())
            maxima[name] = max(maxima[name],error)
            if not torch.allclose(actual,expected,atol=tolerance,rtol=tolerance):
                raise AssertionError(f'Float forward parity failed at step{at}/{name}: {error}')
    return dict(status='PASS',steps=steps,batch=batch,seed=73519,
                features='bounded deterministic nonzero diagnostics; conversion also preserves wf',
                states='nonzero initial states, adjacent replicated channels',
                all_output_heads='every group and lexical logit; all punctuation classes',
                tolerance_atol=tolerance,tolerance_rtol=tolerance,max_absolute_error=maxima,
                caveat='Float accumulation order differs; this is not quantized/EVM parity.')


def jitter(tensors, factor, std, seed):
    """Optional independent post-clone perturbation, explicitly not preserving output."""
    gen = torch.Generator().manual_seed(seed)
    changed = {}
    # Leave direct biases, domain, input-only features, and lexical punctuation
    # priors intact. Perturb neural channel weights only.
    for name in MATRICES+INPUT_EMBEDS+OUTPUT_WEIGHTS:
        noise = torch.randn(tensors[name].shape,generator=gen,dtype=torch.float32)*std
        tensors[name] = (tensors[name]+noise).contiguous()
        changed[name] = float(noise.abs().max())
    return dict(enabled=True,std=std,seed=seed,changed_tensors=changed,
                status='POST_CLONE_PERTURBATION_NOT_FUNCTION_PRESERVING')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True,help='Source safetensors file or checkpoint folder')
    parser.add_argument('--output',type=Path,required=True,help='New output folder; must not exist')
    parser.add_argument('--target-width',type=int,default=512)
    parser.add_argument('--vocabulary',type=Path,help='Optional unchanged vocabulary JSON to copy and hash')
    parser.add_argument('--jitter-std',type=float,default=0.,help='Optional FP32 weight noise, applied only after exact-clone audits')
    parser.add_argument('--jitter-seed',type=int,default=73520)
    parser.add_argument('--audit-steps',type=int,default=16)
    args = parser.parse_args()
    torch.set_num_threads(1)
    source_file = (args.source/'model.safetensors'if args.source.is_dir()else args.source).resolve()
    if args.output.exists():
        parser.error('Output path already exists; choose a new directory')
    if args.jitter_std < 0 or not math.isfinite(args.jitter_std):
        parser.error('jitter-std must be finite and nonnegative')
    if args.audit_steps < 1:
        parser.error('audit-steps must be positive')
    source_hash = digest(source_file)
    source = {k:v.float() for k,v in load_file(str(source_file),device='cpu').items()}
    spec = validate(source)
    if args.target_width < spec['hidden_width'] or args.target_width % spec['hidden_width']:
        parser.error('target-width must be a positive integer multiple of source width')
    factor = args.target_width//spec['hidden_width']
    result = widen(source,factor)
    exact_audit = audit_mapping(source,result,factor)
    float_audit = audit_function(source,result,factor,steps=args.audit_steps)
    noise = jitter(result,factor,args.jitter_std,args.jitter_seed) if args.jitter_std else dict(enabled=False)
    if digest(source_file) != source_hash:
        raise RuntimeError('Source changed during conversion')
    vocab_info = None
    vocab_bytes = None
    if args.vocabulary:
        vocab_bytes = args.vocabulary.read_bytes()
        vocab = json.loads(vocab_bytes)
        if not isinstance(vocab,list) or len(vocab)!=spec['vocabulary']:
            raise ValueError('Vocabulary JSON must contain the unchanged output word list')
        vocab_info = dict(source=str(args.vocabulary.resolve()),sha256=hashlib.sha256(vocab_bytes).hexdigest(),
                          output='vocabulary.json',words=len(vocab),transformation='none')
    args.output.mkdir(parents=True,exist_ok=False)
    output_file = args.output/'model.safetensors'
    save_file(result,str(output_file),metadata={'format':'pt','conversion':'float-net2wider-gru2',
        'source_sha256':source_hash,'source_hidden_width':str(spec['hidden_width']),
        'target_hidden_width':str(args.target_width),'jitter_std':str(args.jitter_std)})
    if vocab_bytes is not None:
        (args.output/'vocabulary.json').write_bytes(vocab_bytes)
    config = dict(architecture='two_layer_gru_word_and_punctuation',**spec)
    config['hidden_width'] = args.target_width
    config['bos_token_id'],config['input_only_unk_token_id'] = spec['vocabulary'],spec['vocabulary']+1
    config['punctuation_suffixes'] = ['',',','.','!','?'] if spec['punctuation']==5 else None
    (args.output/'config.json').write_text(json.dumps(config,indent=2)+'\n')
    manifest = dict(status='FLOAT_EXACT_CLONE_AUDITS_PASS'if not args.jitter_std else'FLOAT_CLONE_PASS_THEN_JITTERED',
        execution='CPU offline conversion only; no training/network/chain calls',
        source_file=str(source_file),source_sha256=source_hash,source_dimensions=spec,
        target_hidden_width=args.target_width,integer_factor=factor,
        mapping='target channel j maps to source j//factor; gate order r,z,n retained',
        source_float_parameter_values=sum(t.numel()for t in source.values()),
        output_float_parameter_values=sum(t.numel()for t in result.values()),
        stored_wf_note='wf rows retained and replicated without scaling; training may keep this tensor frozen',
        vocabulary=vocab_info or dict(transformation='No output vocabulary rows reordered or changed; no vocabulary file supplied'),
        exact_tensor_mapping_audit=exact_audit,float_function_audit=float_audit,jitter=noise,
        optimizer='not copied; any later training must explicitly create a new optimizer',
        output={'file':'model.safetensors','sha256':digest(output_file),'bytes':output_file.stat().st_size},
        converter_sha256=digest(Path(__file__)))
    (args.output/'widen-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({k:manifest[k]for k in ['status','source_sha256','target_hidden_width','integer_factor','output_float_parameter_values','output','float_function_audit']},indent=2))


if __name__ == '__main__':
    main()
