#!/usr/bin/env python3
"""Bounded, local large-corpus voice training with explicit source balancing."""
from __future__ import annotations
import argparse,collections,json,math,sys,time
from pathlib import Path
import numpy as np
import torch
from common import RESEARCH,Streams,load_model,mask_for,validate,constrain,audit,free_generate,sha,save
from unlikelihood import exempt_token_mask,training_loss_for,FUNCTION_WORDS
from device_support import move_batch,cpu_snapshot,constrain_on_device,host_counts,configure_trainable


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--cache',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--checkpoint',type=Path,default=RESEARCH/'experiments/simplestories-v2/model-cache')
    p.add_argument('--target-tokens',type=int,default=4_000_000);p.add_argument('--max-steps',type=int,default=10_000)
    p.add_argument('--batch-size',type=int,default=16);p.add_argument('--block-size',type=int,default=128)
    p.add_argument('--context-warmup',type=int,default=64)
    p.add_argument('--source-weights',type=json.loads,default={'authored':.1,'compositional':.15,'public_domain':.15,'licensed_teacher':.6})
    p.add_argument('--quote-fraction',type=float,default=.25);p.add_argument('--learning-rate',type=float,default=1e-5)
    p.add_argument('--weight-decay',type=float,default=.01);p.add_argument('--warmup-fraction',type=float,default=.03)
    p.add_argument('--validation-blocks',type=int,default=256);p.add_argument('--eval-every',type=int,default=250)
    p.add_argument('--snapshot-every',type=int,default=500);p.add_argument('--log-every',type=int,default=100)
    p.add_argument('--probe-tokens',type=int,default=512);p.add_argument('--seed',type=int,default=20261024)
    p.add_argument('--device',choices=['cpu','mps'],default='cpu')
    p.add_argument('--trainable',choices=['all','top2','body'],default='all')
    p.add_argument('--threads',type=int,default=2);p.add_argument('--stop-after-degenerate',type=int,default=0)
    p.add_argument('--min-training-tokens',type=int,default=2_000_000)
    p.add_argument('--unlikelihood-alpha',type=float,default=0.0,help='Training-only content-word penalty; try 0.2 in an ablation, zero preserves CE-only training')
    p.add_argument('--unlikelihood-window',type=int,default=32)
    a=p.parse_args()
    if not math.isfinite(a.unlikelihood_alpha) or a.unlikelihood_alpha<0 or not 1<=a.unlikelihood_window<=64:
        raise ValueError('Unlikelihood alpha must be finite and nonnegative; window must be 1..64')
    if not 0<a.context_warmup<a.block_size<=512 or not 0<=a.quote_fraction<=1:raise ValueError('Invalid sampler configuration')
    if min(a.target_tokens,a.max_steps,a.batch_size,a.validation_blocks,a.eval_every,a.snapshot_every,a.probe_tokens)<1:raise ValueError('Positive training bounds required')
    if a.output.exists() and any(a.output.iterdir()):raise ValueError('Output must be new/empty')
    if a.device=='mps' and not torch.backends.mps.is_available():raise ValueError('MPS unavailable in this execution environment')
    device=torch.device(a.device)
    a.output.mkdir(parents=True,exist_ok=True);torch.set_num_threads(a.threads);torch.manual_seed(a.seed)
    streams=Streams(a.cache)
    weights=a.source_weights
    if not isinstance(weights,dict) or any(not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 for v in weights.values()) or abs(sum(weights.values())-1)>1e-8:
        raise ValueError('Source weights must be nonnegative numbers summing to one')
    if any(k not in streams.meta['streams']['train'] for k in weights):raise ValueError('Requested source stream missing')
    model,tok=load_model(a.checkpoint)
    trainable_count=configure_trainable(model,a.trainable)
    model=model.to(device);mask=mask_for(a.block_size).to(device)
    exempt=(exempt_token_mask(tok) if a.unlikelihood_alpha else torch.zeros(len(tok),dtype=torch.bool)).to(device)
    rng=np.random.default_rng(a.seed);vrng=np.random.default_rng(a.seed+991)
    validation=[]
    for begin in range(0,a.validation_blocks,a.batch_size):
        validation.append(move_batch(streams.batch('validation',vrng,min(a.batch_size,a.validation_blocks-begin),a.block_size,a.context_warmup,weights,a.quote_fraction),device))
    config={k:str(v) if isinstance(v,Path) else v for k,v in vars(a).items()}
    report={'status':'RUNNING','scope':'Local device-aware fine-tuning only; no network, wallet or deployment actions.',
            'device':str(device),'batch_size':a.batch_size,'trainable_mode':a.trainable,'trainable_parameters':trainable_count,'optimizer_initialization':'New AdamW state; no prior optimizer state loaded',
            'checkpoint_export':'Fresh FP32 CPU model copy; active model and optimizer never move devices',
            'configuration':config,'cache_fingerprint':streams.meta['fingerprint'],
            'packing':'Contiguous within each paragraph; sample a new same-source document at each boundary, without EOS or separators.',
            'source_kind_counts':streams.meta['streams'],'checkpoint_sha256':sha(a.checkpoint/'model.safetensors'),
            'tokenizer_sha256':sha(a.checkpoint/'tokenizer.json'),'parameters':sum(p.numel() for p in model.parameters()),
            'runner_sha256':sha(Path(__file__)),'common_sha256':sha(Path(__file__).with_name('common.py')),
            'selection_policy':'Save every new plain-CE validation minimum and requested periodic/final snapshot. Select lowest CE among saved snapshots passing explicit basic guards; full language review is still required.',
            'validation_policy':'Plain cross-entropy only on fixed held-out blocks; never adds the unlikelihood objective.',
            'training_objective':{'formula':'(CE_sum + alpha * UL_sum) / supervised_next_tokens','alpha':a.unlikelihood_alpha,
                'window':a.unlikelihood_window,'duplicate_threshold':2,'gold_next_token_excluded':True,
                'reserved_ids_exempt':list(range(32)),'function_words':sorted(FUNCTION_WORDS),
                'negative_ids_exempt':exempt.nonzero().flatten().tolist(),
                'deduplication':'one penalty per distinct eligible word per supervised position'},
            'history':[],'snapshots':[],'manual_quality_review_required':True}
    save(a.output/'training-report.json',report)
    authored_stream=streams.arrays['train','authored']
    authored_12grams={authored_stream[i:i+12].tobytes() for i in range(max(0,len(authored_stream)-11))}
    optimizer=torch.optim.AdamW((p for p in model.parameters() if p.requires_grad),lr=a.learning_rate,weight_decay=a.weight_decay,foreach=False)
    start=time.monotonic();seen=0;token_mix=collections.Counter();window_mix=collections.Counter();quote_count=0;projected=torch.zeros(2,dtype=torch.int64,device=device);loss_totals=collections.Counter()
    best_eligible=float('inf');lowest_validation=float('inf');best_snapshot=None;last_snapshot=None;degenerate=0;last_validation=None;last_step=0
    def measure(step,snapshot):
        nonlocal best_eligible,lowest_validation,best_snapshot,last_snapshot,degenerate,last_validation
        metrics=validate(model,validation,mask);last_validation=metrics
        new_minimum=metrics['loss']<lowest_validation
        lowest_validation=min(lowest_validation,metrics['loss'])
        requested_snapshot=snapshot
        snapshot=snapshot or new_minimum
        row={'step':step,'trained_target_tokens':seen,'validation':metrics,'elapsed_seconds':time.monotonic()-start,
             'new_validation_minimum':new_minimum,'requested_snapshot':requested_snapshot}
        report['history'].append(row)
        if snapshot:
            snapshot_model=cpu_snapshot(model)
            numeric=audit(snapshot_model)
            if not numeric['eligible']:raise ValueError('Weight export bounds violated')
            probe=free_generate(snapshot_model,tok,(0,42),a.probe_tokens)
            for stream in probe['streams']:
                ids=stream['tokens'];covered=set()
                for i in range(max(0,len(ids)-11)):
                    if np.asarray(ids[i:i+12],dtype='<u2').tobytes() in authored_12grams:covered.update(range(i,i+12))
                stream['authored_copy_12gram_fraction']=len(covered)/max(1,len(ids))
                stream['guards']['authored_copy_coverage_ok']=stream['authored_copy_12gram_fraction']<=.60
                stream['passes_basic_guards']=all(stream['guards'].values())
            probe['passes_basic_guards']=all(stream['passes_basic_guards'] for stream in probe['streams'])
            probe['copy_metric_limit']='Matches only the supplied authored training stream; not the pretrained corpus or proof of originality.'
            directory=a.output/f'checkpoint-{step:06d}';directory.mkdir()
            snapshot_model.save_pretrained(directory,safe_serialization=True);tok.save_pretrained(directory)
            save(directory/'probe.json',probe);save(directory/'quantization-audit.json',numeric)
            metadata={'step':step,'trained_target_tokens':seen,'validation':metrics,'cache_fingerprint':streams.meta['fingerprint'],
                      'source_token_mix':dict(token_mix),'source_window_mix':dict(window_mix),'configuration':config,
                      'weight_file_sha256':sha(directory/'model.safetensors'),'probe_passes_basic_guards':probe['passes_basic_guards'],
                      'manual_quality_review_required':True,'training_loss_components':dict(loss_totals),
                      'projected_parameter_values':host_counts(projected)}
            save(directory/'training-metadata.json',metadata)
            record=metadata|{'path':str(directory.resolve()),'probe_sha256':sha(directory/'probe.json')};report['snapshots'].append(record);last_snapshot=record
            if step==0:report['baseline_snapshot']=record
            if probe['passes_basic_guards']:
                degenerate=0
                if step>0 and metrics['loss']<best_eligible:
                    best_eligible=metrics['loss'];best_snapshot=record
                    save(a.output/'best-candidate.json',record)
            else:degenerate+=1
            row['snapshot_path']=str(directory);row['basic_generation_guards']=probe['passes_basic_guards']
            row['probe_metrics']=[{k:s[k] for k in ['seed','repeated4_fraction','longest_constant_token_run','distinct_token_ids','authored_copy_12gram_fraction','guards']} for s in probe['streams']]
        report['trained_target_tokens']=seen;report['source_token_mix']=dict(token_mix);report['source_window_mix']=dict(window_mix)
        report['quote_seeded_windows']=quote_count;report['projected_parameter_values']=host_counts(projected)
        report['training_loss_components']=dict(loss_totals)
        if seen:report['training_mean_objectives']={'cross_entropy':loss_totals['ce_sum']/seen,
            'unlikelihood':loss_totals['unlikelihood_sum']/seen,
            'combined':(loss_totals['ce_sum']+a.unlikelihood_alpha*loss_totals['unlikelihood_sum'])/seen}
        report['source_effective_passes']={kind:token_mix[kind]/streams.meta['streams']['train'][kind]['unique_corpus_tokens'] for kind in streams.meta['streams']['train']}
        report['best_candidate']=best_snapshot;report['last_snapshot']=last_snapshot;save(a.output/'training-report.json',report)
        print(json.dumps(row),flush=True);model.train()
    try:
        measure(0,True)
        for step in range(1,a.max_steps+1):
            batch=move_batch(streams.batch('train',rng,a.batch_size,a.block_size,a.context_warmup,weights,a.quote_fraction),device)
            model.train();optimizer.zero_grad(set_to_none=True)
            fraction=min(seen/a.target_tokens,1.);warm=a.warmup_fraction
            multiplier=fraction/warm if fraction<warm else .1+.9*.5*(1+math.cos(math.pi*(fraction-warm)/max(1-warm,1e-9)))
            multiplier=max(multiplier,1/max(1,a.target_tokens))
            for group in optimizer.param_groups:group['lr']=a.learning_rate*multiplier
            loss,n,components=training_loss_for(model,batch,mask,exempt,a.unlikelihood_alpha,a.unlikelihood_window)
            if not bool(torch.isfinite(loss)):raise ValueError('Nonfinite training loss')
            (loss/n).backward();norm=float(torch.nn.utils.clip_grad_norm_(model.parameters(),1.))
            optimizer.step();clipped_this_step=constrain_on_device(model);projected.add_(clipped_this_step);loss_totals.update(components);seen+=n;token_mix.update(batch[2]);window_mix.update(batch[3]);quote_count+=sum(batch[4]);last_step=step
            if step%a.log_every==0:print(json.dumps({'step':step,'trained_target_tokens':seen,'train_loss':float(loss.detach())/n,'cross_entropy':components['ce_sum']/n,
                'unlikelihood':components['unlikelihood_sum']/n,'weighted_unlikelihood':a.unlikelihood_alpha*components['unlikelihood_sum']/n,
                'negative_candidates':components['negative_candidates'],'positions_with_negatives':components['positions_with_negatives'],
                'clipped_parameter_values_this_step':host_counts(clipped_this_step),'gradient_norm':norm,'lr':optimizer.param_groups[0]['lr'],'elapsed_seconds':time.monotonic()-start}),flush=True)
            final=seen>=a.target_tokens or step==a.max_steps
            if step%a.eval_every==0 or step%a.snapshot_every==0 or final:
                measure(step,step%a.snapshot_every==0 or final)
            if seen>=a.min_training_tokens and a.stop_after_degenerate and degenerate>=a.stop_after_degenerate:
                report['status']='STOPPED_DEGENERACY';break
            if final:break
        if report['status']=='RUNNING':report['status']='COMPLETE'
        report['completed_steps']=last_step;report['trained_target_tokens']=seen;report['elapsed_seconds']=time.monotonic()-start
        report['target_reached']=seen>=a.target_tokens
        report['candidate_status']='ELIGIBLE_FINETUNED_SNAPSHOT_PENDING_REVIEW' if best_snapshot else 'NO_FINETUNED_SNAPSHOT_PASSED_BASIC_GUARDS'
        save(a.output/'training-report.json',report)
        print(json.dumps({'status':report['status'],'steps':last_step,'target_tokens':seen,'best_candidate':best_snapshot,'elapsed_seconds':report['elapsed_seconds']}),flush=True)
    except BaseException as error:
        report['status']='FAILED';report['error']=str(error);report['completed_steps']=last_step;report['trained_target_tokens']=seen
        save(a.output/'training-report.json',report);raise

if __name__=='__main__':main()
