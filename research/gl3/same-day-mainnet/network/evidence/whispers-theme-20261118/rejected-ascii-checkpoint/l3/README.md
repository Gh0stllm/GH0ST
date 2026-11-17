# GH0ST GL3 — WebGL frontend

Live: https://l3.gh0st.fyi/

Production deploy: `6afcbc6fd97541394127c7f5`, published after actual desktop/mobile GPU review. The previous production source is preserved in `../evidence/webgl-redesign-20261118/checkpoint-r3/`. This redesign changes only the dedicated L3 site. It does not deploy a chain, change the bridge or publish the main GH0ST website.

## Experience

The fullscreen Three.js sculpture uses extruded beveled GH0ST brackets, a smoked-glass housing, ivory face lights, three physical chain layers, environment reflections, bloom and a fogged floor. Scroll and lifecycle controls move the camera between chapters. Amber fragments represent actual recently verified blocks; ambient particles are decorative.

The page keeps the existing chain/genesis identity checks, exact native-unit formatting, real block/gas/transaction readings, EIP-6963 add-network controls, receipt-bound addresses and project-run validator disclosures. ZK and LLM validity proofs are not live. Automated demonstration activity is not presented as organic adoption or a throughput measurement.

Primary actions are **Bridge GH0ST** and **Start building**. The latter opens the actual network parameters and add-wallet controls. Adding the network requests no account access or signature.

## Performance and failure behavior

- Pixel ratio is capped at 1.5; mobile uses 140 ambient particles and a 30fps render budget. Desktop uses 400 particles and 45fps. Geometry and face/block instances are bounded.
- A single animation loop pauses when the document is hidden or both presentation chapters are offscreen. Reduced motion and manual pause use explicit static redraws for meaningful changes.
- A failed renderer, shader failure or lost context enables the labeled static fallback. Network tools remain independent. A permanent fallback removes listeners and disposes the bloom/composer/scene resources.
- Actual live-block fragments clear on RPC or identity failure. Identity mismatches also hide old numerical readings; ordinary RPC failures label prior readings stale.

## Build and evidence

All compilation and CPU checks ran on the existing Runpod lane. Three.js 0.187.0 was downloaded from the official npm registry and its package SHA-512 integrity verified. The archive SHA-256 is `ff540832ded0cfe919764d24a3d88f3e2a05f23303f876423e4f893841e90728`. The bundled scene is self-hosted; no external library CDN is required. Its MIT license is served at `/licenses/THREE.txt`.

The retained functional suite passed 33 cases, and scene policy checks passed 8 groups. The final lifecycle cleanup rebuilt successfully and the focused policy checks passed again. These CPU checks do not claim to render WebGL.

The parent agent performed actual Mac GPU browser checks at 1280×720 and 390×844. Both reported `data-renderer="webgl"` and no horizontal overflow. The desktop primary CTA occupied y 587.9–645.4, within 720px. Four-step interaction, pause/resume, no-wallet feedback and FAQ opening passed. CUA viewport-resize commands timed out; those are recorded as tool limitations. Fresh-tab actual renders passed. The final deployment adds only reviewed lifecycle cleanup to the graphics/HTML-reviewed draft.

After publication, actual custom-host HTTPS checks fetched 16 L3/unchanged-bridge assets successfully, including the exact reviewed scene bundle. The actual hosted L3 module verified chain 4663001 and its genesis, then rendered real public RPC data: head 1800, gas 0.00001 GH0ST/gas, latest-block transaction count 2 and four block rows at 20:44:53 UTC. These are timestamped observations, not permanent network metrics. This final probe used a minimal DOM; GPU proof is the separate parent browser review.

Evidence: `../evidence/webgl-redesign-20261118/`, particularly `publication-review.json`, `live/publication.json`, `actual-public-probe.json`, source hashes and the preserved initial drafts/failures. No signing key was read and no financial transaction was sent by this frontend task.
