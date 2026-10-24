"""Exact native GRU forward for the existing N0VA two-layer model.

Each batch row is one complete source document, with reset only at its start.
No parameter names, dimensions, gate equations or inference API are changed.
"""
from pathlib import Path
import sys
import torch
from torch.nn import functional as F

LEGACY = Path(__file__).resolve().parents[2] / 'voice-v8' / 'training'
sys.path.append(str(LEGACY))
from model import VoiceModel as OriginalVoiceModel, objective, V, BOS, UNK, Q


class FastVoiceModel(OriginalVoiceModel):
    def forward(self, x, prev_punct, resets, domains, state=None):
        # Data validation guarantees one document/row, initial reset and domain0.
        embedded = self.embedding(x) + self.punct_embedding(prev_punct)
        embedded = F.dropout(embedded, self.dropout, self.training)
        if state is None:
            initial = embedded.new_zeros((2, x.shape[0], self.hidden))
        else:
            initial = torch.stack(state)
        zeros = self.bh1.new_zeros(3 * self.hidden)
        weights = [self.wx1, self.wh1, self.bh1 + self.domain.weight[0], zeros,
                   self.wx2, self.wh2, self.bh2, zeros]
        hidden, final = torch._VF.gru(embedded, initial, weights, True, 2,
                                     0.0, self.training, False, True)
        return hidden, (final[0], final[1])


PACKING_GROUPS = {
    'wh1': (190, 384), 'wx2': (190, 384), 'wh2': (190, 384),
    'groups.weight': (260, 384), 'words.weight': (260, 384),
    'punct_head.weight': (260, 384),
}


@torch.no_grad()
def project_packing(model, limit=15.5):
    """Project row groups onto float L1 balls; exact Q10 export rechecks bounds.

    The 0.5 margin is larger than worst-case nearest rounding of 260 entries.
    Counts remain on device until a checkpoint, avoiding per-update transfers.
    """
    state = model.state_dict(keep_vars=True)
    counts = []
    for name, cuts in PACKING_GROUPS.items():
        start = 0
        for end in cuts:
            group = state[name][:, start:end]
            norm = group.abs().sum(dim=1, keepdim=True)
            counts.append((norm > limit).sum())
            group.mul_((limit / norm.clamp_min(1e-20)).clamp_max(1.0))
            start = end
    return torch.stack(counts)


def packing_names():
    return [f'{name}:{start}:{end}' for name, cuts in PACKING_GROUPS.items()
            for start, end in ((0, cuts[0]), (cuts[0], cuts[1]))]


@torch.no_grad()
def packing_audit(model):
    # Exact signed integers as used by numpy rint in the exporter.
    result = {}
    for name, cuts in PACKING_GROUPS.items():
        quantized = torch.round(model.state_dict()[name].detach().cpu().double() * Q).to(torch.int64)
        start = 0
        for end in cuts:
            maximum = int(quantized[:, start:end].abs().sum(dim=1).max())
            result[f'{name}:{start}:{end}'] = maximum
            if maximum >= 16384:
                raise ValueError(f'Q10 packing overflow: {name}[{start}:{end}] L1={maximum}')
            start = end
    return result
