"""Conservative, prompt-independent magnitude bounds for the fixed Q12 model."""
from pathlib import Path
import hashlib
import json
import numpy as np

BASE = Path(__file__).resolve().parents[2]
Q = 4096


def main():
    protocol = json.loads((BASE / "contracts/protocol.json").read_text())
    blob = (BASE / "model/weights.bin").read_bytes()
    tables = (BASE / "model/tables.bin").read_bytes()
    sigmoid = np.frombuffer(tables, dtype=">u4", count=257, offset=1024)
    exponent = np.frombuffer(tables, dtype=">u4", count=257, offset=2052)
    assert int(sigmoid.max()) <= 65536 and int(exponent[0]) > 0
    tensors = {e["name"]: np.frombuffer(blob, dtype=">i2", count=e["elements"], offset=e["byte_offset"])
               .astype(np.int64).reshape(e["shape"]) for e in protocol["weights"]["tensor_layout"]}

    def norm_linear_bound(weights, gamma):
        # If d=floor(sqrt(floor(sum(x*x)/128)+17)), then d>=4 and
        # sum(x*x)/d**2 < 128*(1+2/d-16/d**2) <= 136.
        # Cauchy bounds the unrounded gamma/weight dot; norm truncation
        # contributes strictly less than sum(abs(weights)) before /4096.
        squares = ((weights * gamma[None, :]) ** 2).sum(axis=1)
        upper = (np.sqrt(136 * squares.astype(np.float64)) + np.abs(weights).sum(axis=1)) / Q
        # An additional integer unit comfortably covers floating bound evaluation.
        return np.ceil(upper).astype(np.int64) + 1

    def linear_bound(weights, magnitudes):
        return (np.abs(weights) * magnitudes[None, :]).sum(axis=1) // Q + 1

    hidden = np.abs(tensors["model.embed_tokens.weight"]).max(axis=0)
    layers = []
    for layer in range(4):
        prefix = f"model.layers.{layer}."
        gamma = tensors[prefix + "input_layernorm.weight"]
        post_gamma = tensors[prefix + "post_attention_layernorm.weight"]
        query = norm_linear_bound(tensors[prefix + "self_attn.q_proj.weight"], gamma)
        key = norm_linear_bound(tensors[prefix + "self_attn.k_proj.weight"], gamma)
        value = norm_linear_bound(tensors[prefix + "self_attn.v_proj.weight"], gamma)
        attention = np.concatenate([value[:32], value[:32], value[32:], value[32:]])
        projected = linear_bound(tensors[prefix + "self_attn.o_proj.weight"], attention)
        gate = norm_linear_bound(tensors[prefix + "mlp.gate_proj.weight"], post_gamma)
        up = norm_linear_bound(tensors[prefix + "mlp.up_proj.weight"], post_gamma)
        # abs(SiLU(gate)) <= abs(gate) for the exact uint16-probability table.
        product = gate * up // Q + 1
        down = linear_bound(tensors[prefix + "mlp.down_proj.weight"], product)
        hidden = hidden + projected + down
        layers.append({"layer": layer, "q_max": int(query.max()), "k_max": int(key.max()),
                       "v_max": int(value.max()), "rotated_q_max": int(2 * query.max()),
                       "rotated_k_max": int(2 * key.max()),
                       "attention_output_projection_max": int(projected.max()),
                       "gate_max": int(gate.max()), "up_max": int(up.max()),
                       "silu_product_max": int(product.max()), "down_projection_max": int(down.max()),
                       "residual_hidden_max": int(hidden.max())})
    head = norm_linear_bound(tensors["model.embed_tokens.weight"], tensors["model.norm.weight"])
    maximum = max(int(hidden.max()), int(head.max()),
                  max(max(value for name, value in layer.items() if name != "layer") for layer in layers))
    result = {"description": "Conservative analytic bounds for all valid token contexts using unchanged Q12 weights; includes RMS epsilon and truncation",
              "weights_sha256": hashlib.sha256(blob).hexdigest(), "tables_sha256": hashlib.sha256(tables).hexdigest(),
              "nonnegative_exponents_and_nonzero_max_score_weight_verified": True,
              "silu_probability_bound_verified": int(sigmoid.max()) <= 65536,
              "normalized_l2_bound": "4096 * sqrt(136)", "rounding_margin": "ceil upper bounds plus one integer unit",
              "layers": layers, "final_logit_max": int(head.max()), "all_int32_checked_outputs_safe": maximum < 2 ** 31}
    assert result["all_int32_checked_outputs_safe"]
    (Path(__file__).parent / "analytic-range-bounds.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
