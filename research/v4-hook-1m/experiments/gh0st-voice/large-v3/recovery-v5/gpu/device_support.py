"""Device helpers: active model stays put; probes/export use new CPU models."""
import copy
import torch
from transformers import AutoModelForCausalLM


def is_trainable_name(name, mode):
    if mode == 'all':
        return True
    if mode == 'top2':
        return name.startswith(('model.layers.2.', 'model.layers.3.'))
    if mode == 'body':
        return name.startswith(tuple(f'model.layers.{i}.' for i in range(4)))
    raise ValueError(f'Unknown trainable mode: {mode}')


def configure_trainable(model, mode):
    for name, parameter in model.named_parameters():
        parameter.requires_grad_(is_trainable_name(name, mode))
    return sum(parameter.numel() for parameter in model.parameters() if parameter.requires_grad)


def move_batch(batch, device):
    return (batch[0].to(device), batch[1].to(device), *batch[2:])


@torch.no_grad()
def cpu_snapshot(model):
    result = AutoModelForCausalLM.from_config(copy.deepcopy(model.config), attn_implementation='eager')
    result.load_state_dict({k: v.detach().to('cpu', copy=True) for k, v in model.state_dict().items()})
    result.float()
    result.eval()
    return result


@torch.no_grad()
def constrain_on_device(model):
    """Clamp every step, but keep counts on-device until a reporting boundary."""
    device = next(model.parameters()).device
    counts = torch.zeros(2, dtype=torch.int64, device=device)
    for parameter in model.parameters():
        if not parameter.requires_grad:
            continue
        index = 0 if parameter.ndim == 2 else 1
        low, high = (-.5, 2047/4096) if index == 0 else (-8., 32767/4096)
        counts[index] += ((parameter < low) | (parameter > high)).sum()
        parameter.clamp_(low, high)
    return counts


def host_counts(counts):
    values = counts.detach().cpu().tolist()
    return {'matrix': int(values[0]), 'norm': int(values[1])}
