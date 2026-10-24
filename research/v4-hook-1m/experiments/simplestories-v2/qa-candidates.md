# Under-2M question-answering search

Research checked on 2026-10-24. No new model was trained or deployed during this search.

## Best verified research lead: TinyLM chat_d128

The authors' [parameter table](https://raw.githubusercontent.com/ANRGUSC/tlm26/main/reports/master_data.csv) lists `chat_d128` at **988,544 total parameters**, including embeddings. It is a five-layer, width-128 model with a 512-token vocabulary.

The [project results](https://github.com/ANRGUSC/tlm26#instruction-tuned-question-answering) report 97.2% exact-match accuracy on 600 held-out synthetic passage-based questions, with 74.4% accuracy on rare-name copying. These are author-reported narrow reading-comprehension results, not independent verification or evidence of general knowledge answering.

The [fine-tuning script](https://github.com/ANRGUSC/tlm26/blob/main/tinylm/rag_poc/finetune_qa.py) trains on a supplied passage, question and answer. It requires an existing base checkpoint. The [evaluation script](https://github.com/ANRGUSC/tlm26/blob/main/tinylm/rag_poc/eval_qa.py) is also public.

**Availability gap:** the linked [Hugging Face release](https://huggingface.co/h1matthew/tlm26/tree/main) contains only the MoE story-model family. A downloadable trained `chat_d128` checkpoint was not verified. The smallest public MoE variant is 1.57M total parameters, but it should not be represented as the trained QA model.

## Conclusion

A reproducible research direction below 2M exists. A credible, ready-to-run general QA checkpoint below 2M was not found in the checked sources. The next step would be obtaining the authors' QA weights or reproducing the training recipe, followed by independent QA and local EVM gas tests. Parameter count alone does not establish that question processing and answer generation fit the 32M swap ceiling.

The SimpleStories V2 checkpoint tested in this directory is not a substitute: it answered none of three local Q&A probes correctly, and its complete Solidity implementation required roughly 180M gas for one generated token in a local v4 swap.
