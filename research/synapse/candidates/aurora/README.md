---
license: apache-2.0
datasets:
- HuggingFaceFW/fineweb-edu
language:
- en
pipeline_tag: text-generation
---

Important; This new Aurora lineup under AuroraAI-Research, and is the replacement to the inefficient and old ones on my profile, expect more sizes coming soon. 

This tiny language model has exactly 80 thousand parameters, and a large (relative to its parameter count) 4096 vocab size using a factorized vocabulary representation. 

The benchmark scores are the following:  
Wikitext-2 BPB: 3.2902  
BLiMP: 52.31%  
Arc-Easy: 26.05%  

The model was trained on around 40M tokens of fineweb-edu filtered to an educational score of 4 and above, for 2 epochs, 80 million effective tokens.  

The training hardware used was the Xiaomi 14T Pro, pinned to its 4 cortex-X4 CPU cores, the time taken was around 6 hours including the preprocessing, tokenizer training.