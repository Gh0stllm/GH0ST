"""Full64-position local integer-model parity and context boundary test.

This tests the pinned small model on one greedy continuation. It is not an
all-prompts proof, FP32 quality comparison, blockchain run or fraud proof.
"""
from pathlib import Path
import argparse
import hashlib
import json
import signal
import time
import numpy as np
from test_runtime import Native, Wasm, CACHE, HERE, decode
from reference_oracle import IntegerNeo


def sha(data):
    return hashlib.sha256(data).hexdigest()


def main(export_dir, output):
    descriptor=json.loads((HERE/'model-descriptor.json').read_text())
    blob=(CACHE/'model.bin').read_bytes()
    assert sha(blob)==descriptor['flatModelSHA256']
    runtime_sha=sha((CACHE/'runtime.wasm').read_bytes())
    native=Native(blob)
    wasm=Wasm(blob)
    oracle=IntegerNeo(export_dir/'data')
    prompt=[7454,2402,257,640]
    generated=[]
    records=[]
    restores=[]
    started=time.perf_counter()
    report={
        'scope':'Local full64-token context, native C++ and generic Wasm against the independent integer NumPy oracle; not on-chain execution or fraud proof',
        'model':descriptor['model'],
        'parameters':descriptor['parameters'],
        'modelSHA256':descriptor['flatModelSHA256'],
        'runtimeWasmSHA256':runtime_sha,
        'rowBudgetPerChunk':512,
        'promptTokenIds':prompt,
        'passed':False,
        'records':records,
        'freshInstanceRestores':restores,
        'limitations':[
            'One greedy trajectory, not every prompt',
            'The fixed INT8/Q12 variant differs from FP32',
            'Generic Wasm execution, not Nitro activation or fraud proof',
            'Local timing is not chain throughput, gas or hosting cost',
            'Fixture expected checkpoint hashes are not a production authorization mechanism',
        ],
    }
    try:
        for position in range(64):
            token=prompt[position] if position<len(prompt) else generated[-1]
            expected=oracle.step(token)
            assert native.call('gh_begin',token)==0
            assert wasm.call('gh_begin',token)==0
            chunks=0
            while wasm.call('gh_phase')!=11:
                step=wasm.call('gh_step')
                assert native.call('gh_step')==step
                assert native.call('gh_advance',step,512)==0
                assert wasm.call('gh_advance',step,512)==0
                chunks+=1
                if position in [30,62] and chunks==50:
                    body=wasm.checkpoint()
                    assert native.checkpoint()==body
                    expected_hash=hashlib.sha256(body).digest()
                    replacement=Wasm(blob)
                    assert replacement.restore(body,expected_hash)==0
                    assert replacement.checkpoint()==body
                    wasm=replacement
                    restores.append({'zeroBasedPosition':position,'oneBasedPosition':position+1,
                        'afterChunk':chunks,'step':step+1,'checkpointBytes':len(body),
                        'checkpointSHA256':expected_hash.hex(),
                        'freshInstanceRestoredExactly':True})
            native_logits=native.logits()
            wasm_logits=wasm.logits()
            assert np.array_equal(native_logits,expected),f'Native mismatch at position{position}'
            assert np.array_equal(wasm_logits,expected),f'Wasm mismatch at position{position}'
            native_checkpoint=native.checkpoint()
            wasm_checkpoint=wasm.checkpoint()
            assert native_checkpoint==wasm_checkpoint,f'Checkpoint mismatch at position{position}'
            best=int(np.argmax(expected))
            assert native.call('gh_best_token')==best and wasm.call('gh_best_token')==best
            if position>=len(prompt)-1:
                generated.append(best)
            records.append({'position':position,'inputToken':token,'nextToken':best,
                'allLogitsCompared':50257,'chunkCalls':chunks,
                'logitsI32LESHA256':sha(wasm_logits.astype('<i4').tobytes()),
                'checkpointSHA256':sha(wasm_checkpoint)})

        before_native=native.checkpoint()
        before_wasm=wasm.checkpoint()
        assert native.call('gh_begin',generated[-1])==-2
        assert wasm.call('gh_begin',generated[-1])==-2
        assert native.checkpoint()==before_native
        assert wasm.checkpoint()==before_wasm
        assert before_native==before_wasm
        oracle_keys=oracle.keys.copy()
        oracle_values=oracle.values.copy()
        try:
            oracle.step(generated[-1])
        except ValueError:
            pass
        else:
            raise AssertionError('Oracle accepted65thtoken')
        assert oracle.position==64 and np.array_equal(oracle.keys,oracle_keys) and np.array_equal(oracle.values,oracle_values)
        assert sha((CACHE/'runtime.wasm').read_bytes())==runtime_sha,'Runtime artifact changed during the test'
        tokenizer=export_dir/'tokenizer.json'
        text=decode(prompt+generated,tokenizer) if tokenizer.exists() else None
        report.update({
            'passed':True,
            'positionsCompared':len(records),
            'totalLogitsCompared':len(records)*50257,
            'generatedTokenIds':generated,
            'decodedText':text,
            'contextBoundary':{'sixtyFifthNativeTokenRejected':True,
                'sixtyFifthWasmTokenRejected':True,'rejectionPreservesCompleteNativeWasmState':True,
                'sixtyFifthOracleTokenRejectedWithoutKVMutation':True},
            'allNativeWasmOracleLogitsMatch':True,
            'allNativeWasmCanonicalStatesMatch':True,
            'fullModelLayersPerPosition':8,
            'serverRented':False,'chainBooted':False,'fraudProofExecuted':False,
        })
    except Exception as error:
        report.update({'passed':False,'positionsCompared':len(records),
            'totalLogitsCompared':len(records)*50257,'errorType':type(error).__name__,
            'error':str(error)})
        raise
    finally:
        report['localWallSeconds']=round(time.perf_counter()-started,6)
        output.write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps({key:report[key] for key in ['passed','positionsCompared','totalLogitsCompared','localWallSeconds']},indent=2))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export-dir',type=Path,default=CACHE/'export')
    parser.add_argument('--output',type=Path,default=HERE/'context-evidence.json')
    args=parser.parse_args()
    def timeout_handler(*_):
        raise TimeoutError('Full-context test exceeded90seconds')
    signal.signal(signal.SIGALRM,timeout_handler)
    signal.alarm(90)
    main(args.export_dir,args.output)
