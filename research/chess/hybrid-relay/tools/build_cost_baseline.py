#!/usr/bin/env python3
"""Isolated cost comparison only: restore old search polling in a temporary crate.

Production source/artifact is never modified. The synthetic35step fixture later
compares actual HTTP bookings on both versions; neither runs model inference.
"""
import json,shutil,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1];work=root/'target/cost-baseline-source';work.mkdir(parents=True,exist_ok=True)
for name in ['Cargo.toml','Cargo.lock']:shutil.copy2(root/name,work/name)
shutil.copytree(root/'src',work/'src',dirs_exist_ok=True)
shutil.copytree(root/'examples',work/'examples',dirs_exist_ok=True)
p=work/'Cargo.toml';s=p.read_text().replace('path = "../hybrid-brain"','path = '+json.dumps(str(root.parent/'hybrid-brain')));p.write_text(s)
p=work/'src/canister.rs';s=p.read_text();start=s.index('            let last_advisory = state()');end=s.index('            progress(&c).await',start)
s=s[:start]+'''            if (turn.updates > 0 && turn.updates % 8 == 0)
                || now() > state().last_checked_at.saturating_add(60) {
                let p=poll(&c).await?;
                if p.active!=turn.game_id {let mut s=state();s.turn=None;save(s);return Ok(());}
            }
'''+s[end:];p.write_text(s)
subprocess.run(['cargo','build','--locked','--manifest-path',str(work/'Cargo.toml'),'--features','canister','--release','--target','wasm32-unknown-unknown','--target-dir',str(root/'target/cost-baseline-build')],check=True)
print(root/'target/cost-baseline-build/wasm32-unknown-unknown/release/gh0st_chess_hybrid_relay.wasm')
