#!/usr/bin/env python3
"""Run the pinned icpp installation with all toolchains inside this project.

icpp has no prefix option. Rebase its public configuration before loading any
command modules; never change HOME, the active ICP identity, or global Rust.
"""
import os
from pathlib import Path
import icpp.config_default as config

root = Path(__file__).resolve().parents[1]
old = str(config.ICPP_ROOT)
new = str(root / ".cache" / "toolchain")
for key, value in list(vars(config).items()):
    if isinstance(value, Path) and str(value).startswith(old):
        setattr(config, key, Path(str(value).replace(old, new, 1)))
    elif isinstance(value, str) and old in value:
        setattr(config, key, value.replace(old, new))
os.environ["CARGO_TARGET_DIR"] = str(config.RUST_COMPILER_ROOT / "target")
os.environ["CARGO_HOME"] = str(config.RUST_COMPILER_ROOT)
os.environ["RUSTUP_HOME"] = str(config.RUST_COMPILER_ROOT)

from icpp.__main__ import app
app()
