"""Unchanged quantized N0VA numerical reference: neural sentences, no forced EOS.

Local CPU arithmetic reference only. This does not measure EVM gas, transaction
capacity, or neural quality at a new model checkpoint.
"""
import argparse,hashlib,importlib.util,json,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
VOICE=HERE.parents[1]
REFERENCE=VOICE/'voice-v8/evm/reference.py'
spec=importlib.util.spec_from_file_location('nova_original_reference',REFERENCE)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sha=lambda x:hashlib.sha256(x).hexdigest()
canonical=lambda x:json.dumps(x,separators=(',',':')).encode()
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--model-dir',type=Path,default=VOICE/'nova-optimization/selected')
 parser.add_argument('--seeds',type=int,default=16)
 parser.add_argument('--max-words',type=int,default=64)
 parser.add_argument('--out',type=Path,default=HERE/'sentence-reference.json')
 args=parser.parse_args();assert 1<=args.seeds<=16 and 1<=args.max_words<=256
 model=module.Reference(args.model_dir)
 baseline=VOICE/'nova-optimization/flat-full-test/integration-results.json'
 old=json.loads(baseline.read_text());buyfeatures=list(map(int,old['swaps'][0]['features']))
 featuresets=[('fixed-neutral',[0,0,0,0,1024,1024]),('representative-buy',buyfeatures)]
 report={'status':'RUNNING','scope':'LOCAL_CPU_NUMERICAL_REFERENCE_ONLY','evm_gas_measured':False,'transaction_throughput_measured':False,'public_transactions':0,'reference_source_sha256':sha(REFERENCE.read_bytes()),'checkpoint_sha256':model.meta['checkpoint_sha256'],'reference_npz_sha256':sha((args.model_dir/'reference.npz').read_bytes()),'temperature_q10':512,'max_words':args.max_words,'seeds':list(range(42,42+args.seeds)),'feature_source_report':str(baseline),'feature_source_report_sha256':sha(baseline.read_bytes()),'feature_policy':'Features frozen for every neural word of each sentence; hidden state and sample index advance per word.','scenarios':[]}
 args.out.parent.mkdir(parents=True,exist_ok=True)
 def save():args.out.write_text(json.dumps(report,indent=2)+'\n')
 save();start=time.monotonic()
 for name,features in featuresets:
  scenario={'name':name,'features':features,'sentences':[]};report['scenarios'].append(scenario)
  for seed_int in report['seeds']:
   seed=f'0x{seed_int:064x}';previous=8192;previous_punct=0;hidden=[0]*(2*model.H);words=[];scalar=seed_int==42
   for index in range(args.max_words):
    step=model.step(previous,previous_punct,hidden,features,seed,index,512,scalar=scalar)
    words.append({'index':index,'token':int(step['token']),'punct':int(step['punct']),'text':step['text'],'terminal':bool(step['terminal']),'hidden_sha256':sha(canonical(step['hidden'])),'scores_sha256':sha(canonical(step['scores']))})
    previous=step['token'];previous_punct=step['punct'];hidden=step['hidden']
    if step['terminal']:break
   sentence={'seed_int':seed_int,'seed':seed,'initial_previous':8192,'initial_punct':0,'initial_hidden_all_zero':True,'words':words,'word_count':len(words),'terminal':bool(words[-1]['terminal']),'sentence':' '.join(row['text'] for row in words),'scalar_dot_cross_checks':scalar}
   if seed_int==42:sentence['final_hidden']=hidden
   scenario['sentences'].append(sentence);save();print(name,seed_int,len(words),sentence['terminal'],sentence['sentence'],flush=True)
  counts=[row['word_count']for row in scenario['sentences']]
  scenario['summary']={'sentences':len(counts),'naturally_completed':sum(row['terminal']for row in scenario['sentences']),'cap_hits':sum(not row['terminal']for row in scenario['sentences']),'minimum_words':min(counts),'maximum_words':max(counts),'mean_words':sum(counts)/len(counts),'distinct_sentences':len({row['sentence']for row in scenario['sentences']})}
 report['matching_texts_across_feature_scenarios']=sum(a['sentence']==b['sentence']for a,b in zip(report['scenarios'][0]['sentences'],report['scenarios'][1]['sentences']));report['quality_notice']='Successful execution and terminal completion do not imply fluent grammar, coherence, uniqueness for all seeds, or market-responsive text.';report['status']='PASS_REFERENCE_EXECUTION';report['elapsed_cpu_reference_seconds']=time.monotonic()-start;report['latency_notice']='Elapsed time is local CPU reference execution, not EVM or mainnet latency.';save()
 text=['# N0VA neural sentence reference — local CPU only','','Unchanged quantized model. Each sentence starts with zero hidden state and BOS. Neural punctuation ends generation; no EOS or punctuation is forced. This is not an EVM gas or throughput test.','']
 for scenario in report['scenarios']:
  text+=['## '+scenario['name'], '', 'Frozen features: `'+json.dumps(scenario['features'])+'`.','']
  for row in scenario['sentences']:
   text.append(f"- Seed {row['seed_int']}: {row['word_count']} words, natural terminal={row['terminal']}: {row['sentence']}")
  text+=['',json.dumps(scenario['summary']),'']
 text+=['',f"Matching texts across the two feature scenarios: {report['matching_texts_across_feature_scenarios']}/{args.seeds}.",'',report['quality_notice']]
 args.out.with_suffix('.md').write_text('\n'.join(text)+'\n')
 print(json.dumps({'status':report['status'],'report':str(args.out),'summaries':{row['name']:row['summary']for row in report['scenarios']}}),flush=True)
if __name__=='__main__':main()
