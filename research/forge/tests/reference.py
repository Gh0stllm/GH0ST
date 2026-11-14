"""Independent unbounded-integer, signed-truncating reference for Forge's wire format."""
import json
import sys


def trunc_div(value, divisor):
    return (1 if value >= 0 else -1) * (abs(value) // divisor)


def forward(model, features):
    packed = bytes.fromhex(model['packedWeights'][2:])
    weights = [int.from_bytes(packed[i:i + 2], 'big', signed=True) for i in range(0, len(packed), 2)]
    f, h, c = model['inputCount'], model['hiddenWidth'], model['classCount']
    assert len(features) == f and all(-256 <= value <= 256 for value in features)
    assert len(weights) == h * f + h + c * h + c
    hidden_bias = h * f
    head = hidden_bias + h
    head_bias = head + c * h
    hidden = [min(32767, max(0, trunc_div(sum(weights[row * f + col] * features[col]
        for col in range(f)), 256) + weights[hidden_bias + row])) for row in range(h)]
    logits = [trunc_div(sum(weights[head + row * h + col] * hidden[col]
        for col in range(h)), 256) + weights[head_bias + row] for row in range(c)]
    return {'hidden': hidden, 'logits': logits, 'classId': max(range(c), key=lambda i: logits[i])}


if __name__ == '__main__':
    fixture_set = json.load(sys.stdin)
    print(json.dumps([{'id': model['id'], 'traces': [forward(model, features)
        for features in model['featureVectors']]} for model in fixture_set['models']]))
