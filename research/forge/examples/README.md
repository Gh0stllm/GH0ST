# Generated game NPC dataset

`npc-actions-generated.csv` is a generated demonstration, not collected gameplay or a benchmark claim. It contains 360 balanced examples (120 each of attack, patrol and retreat) from `generateNpcDataset({seed:41,rows:360})` in the browser training core.

The numeric columns are health, distance, stamina and threat, each on a 0–100 scale. Labels come from interacting thresholds: low health or high threat with low stamina favors retreat; close distance, sufficient health and stamina favors attack; remaining cases favor patrol. This deliberately small scenario makes the numeric model and baseline comparison understandable. It does not establish useful game AI outside this generated dataset.

Load the CSV or use the website's generated demo button. Every displayed training, validation, test, baseline and quantization score must be measured by that run. No precomputed model or score is supplied here.
