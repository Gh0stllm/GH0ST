"""Training-only content-word unlikelihood for the fixed WordLevel experiment.

For each supervised next-token prediction, penalize unique content words that
occur at least twice in the latest 32 observed input tokens, except its gold
next token. No future input enters the candidate window. Validation/inference
do not call this module.
"""
import json
import torch
import torch.nn.functional as F


FUNCTION_WORDS = frozenset('''
a an the this that these those i me my mine myself we us our ours ourselves
you your yours yourself yourselves he him his himself she her hers herself
it its itself they them their theirs themselves who whom whose which what
am is are was were be been being do does did doing have has had having
can could may might must shall should will would ought not no nor neither
and or but if then else than as because although though while when where
why how whether until unless since so yet also too very just even only
all any both each either every few many more most much other some such
another same own enough in on at by for from to of with without into onto
over under above below between among through during before after behind
beside near about against around across along toward towards upon within
out off up down here there now once again still already ever never
yes ok okay please
'''.split())


def exempt_token_mask(tokenizer):
    """Map an explicit function-word list; do not exempt content by word length."""
    spec = json.loads(tokenizer.backend_tokenizer.to_str())
    if spec['model']['type'] != 'WordLevel':
        raise ValueError('Content-word unlikelihood requires a WordLevel tokenizer')
    vocabulary = tokenizer.get_vocab()
    mask = torch.zeros(len(vocabulary), dtype=torch.bool)
    mask[:32] = True
    for word in FUNCTION_WORDS:
        index = vocabulary.get(word)
        if index is not None:
            mask[index] = True
    return mask


def repeated_candidates(context_ids, targets, exempt, window=32):
    """Return sorted candidate IDs and eligibility [batch, positions, window].

    context_ids[:, t] is the final observed token for the prediction at t.
    targets[:, t] is its gold NEXT token; -100 marks an unsupervised position.
    Sorting makes duplicate detection O(window log window), with no pairwise
    window tensor or batch/position/vocabulary mask.
    """
    if context_ids.shape != targets.shape or context_ids.ndim != 2:
        raise ValueError('Context and targets need equal [batch, positions] shapes')
    if not 1 <= window <= 64:
        raise ValueError('Window must be between 1 and 64')
    windows = F.pad(context_ids, (window - 1, 0), value=0).unfold(1, window, 1)
    candidates = windows.sort(dim=-1).values
    first = torch.ones_like(candidates, dtype=torch.bool)
    repeated = torch.zeros_like(candidates, dtype=torch.bool)
    if window > 1:
        equal = candidates[..., :-1] == candidates[..., 1:]
        first[..., 1:] = ~equal
        repeated[..., :-1] = equal
    blocked = exempt.to(context_ids.device)[candidates]
    eligible = first & repeated & ~blocked
    eligible &= targets.ne(-100).unsqueeze(-1)
    eligible &= candidates.ne(targets.unsqueeze(-1))
    return candidates, eligible


def unlikelihood_sum(prediction_logits, context_ids, targets, exempt, window=32):
    """Sum -log(1-p(word)) once per eligible word per supervised position."""
    if prediction_logits.shape[:2] != context_ids.shape:
        raise ValueError('Prediction positions must match context positions')
    candidates, eligible = repeated_candidates(context_ids, targets, exempt, window)
    count = int(eligible.sum())
    if count == 0:
        return prediction_logits[..., 0].sum() * 0, {'negative_candidates': 0, 'positions_with_negatives': 0}
    selected = prediction_logits.gather(-1, candidates)
    log_probability = selected - prediction_logits.logsumexp(dim=-1, keepdim=True)
    probability = log_probability.exp().clamp(max=1 - torch.finfo(prediction_logits.dtype).eps)
    penalty = -torch.log1p(-probability)
    value = penalty.masked_fill(~eligible, 0).sum()
    return value, {'negative_candidates': count,
                   'positions_with_negatives': int(eligible.any(dim=-1).sum())}


def training_loss_for(model, batch, attention_mask, exempt, alpha=0.0, window=32):
    """Return summed CE+alpha*UL; divide by supervised targets before backward."""
    inputs, labels = batch[:2]
    logits = model(input_ids=inputs, attention_mask=attention_mask, use_cache=False).logits
    prediction = logits[:, :-1]
    targets = labels[:, 1:]
    count = int(targets.ne(-100).sum())
    if not count:
        raise ValueError('Training batch has no supervised next-token targets')
    ce = F.cross_entropy(prediction.reshape(-1, logits.shape[-1]), targets.reshape(-1),
                         ignore_index=-100, reduction='sum')
    if alpha:
        ul, details = unlikelihood_sum(prediction, inputs[:, :-1], targets, exempt, window)
    else:
        ul = ce.detach() * 0
        details = {'negative_candidates': 0, 'positions_with_negatives': 0}
    total = ce + alpha * ul
    return total, count, {'ce_sum': float(ce.detach()), 'unlikelihood_sum': float(ul.detach()), **details}
