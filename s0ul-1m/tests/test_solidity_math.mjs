import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory } from 'ethers';

const root = fileURLToPath(new URL('../', import.meta.url));
const vectors = JSON.parse(execFileSync('python', ['-c', `
import json,math
import numpy as np
import torch
from s0ul.integer import IntegerModel,_round_div,_multiply,_dot,ONE,LIMIT
from s0ul.model import ModelConfig,S0ULModel
torch.manual_seed(577)
c=ModelConfig(vocab_size=16,dim=8,n_layers=1,n_heads=2,hidden_dim=16,max_seq_len=12)
m=IntegerModel.from_state_dict(S0ULModel(c).state_dict(),c.to_dict())
rng=np.random.default_rng(5338)
def raw(a): return '0x'+np.asarray(a,dtype='<i8').tobytes().hex()
def sat(v): return int(np.count_nonzero(np.abs(v)>LIMIT))
out={}
x=rng.integers(-50000,50001,(1,8),dtype=np.int64)
q=m.arrays['layers.0.attention.q.weight.q'];s=m.arrays['layers.0.attention.q.weight.scale_q24']
out['linear']={'x':x[0].tolist(),'q':'0x'+q.tobytes().hex(),'scales':raw(s),'result':m._linear(x,'layers.0.attention.q.weight')[0].tolist()}
x=np.asarray([[1,0,0,0,0,0,0,0]],dtype=np.int64)
m.arrays['norm.weight.q14']=np.full(8,LIMIT,dtype=np.int64)
m.saturation_count=0
out['norm']={'x':x[0].tolist(),'gains':raw(m.arrays['norm.weight.q14']),'eps':m.eps_q28,'result':m._norm(x,'norm.weight')[0].tolist(),'saturated':m.saturation_count}
x=rng.integers(-LIMIT,LIMIT+1,(3,2,4),dtype=np.int64)
m.saturation_count=0
rot=m._rotate(x)
out['rope']={'x':x[2].flatten().tolist(),'cos':raw(m.arrays['rope.cos_q14'][2]),'sin':raw(m.arrays['rope.sin_q14'][2]),'heads':2,'result':rot[2].flatten().tolist()}
attention=[]
for size,maximum in ((1,5000),(4,90000),(9,LIMIT)):
 q=rng.integers(-maximum,maximum+1,(4,),dtype=np.int64)
 k=rng.integers(-maximum,maximum+1,(size,4),dtype=np.int64)
 v=rng.integers(-LIMIT,LIMIT+1,(size,4),dtype=np.int64)
 scores=_round_div(_multiply(_dot(q[None,:],k.T),m.attention_scale_q14),1<<28)[0]
 weights=m._softmax_weights(scores)
 result=_round_div(_dot(weights[None,:],v)[0],int(np.sum(weights)))
 attention.append({'q':q.tolist(),'keys':k.flatten().tolist(),'values':v.flatten().tolist(),'lut':raw(m.arrays['softmax.exp_q24']),'scale':m.attention_scale_q14,'result':result.tolist()})
for score_values in ((0,1,2,63,64,65),(0,262144,262145)):
 q=np.asarray([2*ONE,0,0,0],dtype=np.int64)
 k=np.asarray([[score,0,0,0] for score in score_values],dtype=np.int64)
 v=rng.integers(-LIMIT,LIMIT+1,(len(score_values),4),dtype=np.int64)
 scores=_round_div(_multiply(_dot(q[None,:],k.T),m.attention_scale_q14),1<<28)[0]
 weights=m._softmax_weights(scores)
 result=_round_div(_dot(weights[None,:],v)[0],int(np.sum(weights)))
 attention.append({'q':q.tolist(),'keys':k.flatten().tolist(),'values':v.flatten().tolist(),'lut':raw(m.arrays['softmax.exp_q24']),'scale':m.attention_scale_q14,'result':result.tolist()})
out['attention']=attention
print(json.dumps(out))
`], { cwd: root, encoding: 'utf8' }));

const harness = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import "S0ULMath.sol";
contract MathHarness {
 function read(bytes memory b,uint o) external pure returns(int256){return S0ULMath.readLE(b,o);}
 function divide(int256 n,uint d) external pure returns(int256){return S0ULMath.roundDiv(n,d);}
 function clipping(int256 x) external pure returns(int32,uint){return S0ULMath.clip(x);}
 function root(uint x) external pure returns(uint){return S0ULMath.sqrt(x);}
 function linear(bytes memory q,bytes memory s,int32[] memory x) external pure returns(int32[] memory,uint){return S0ULMath.linear(q,s,x);}
 function norm(int32[] memory x,bytes memory gains,uint eps) external pure returns(int32[] memory,uint){return S0ULMath.norm(x,gains,eps);}
 function rope(int32[] memory x,bytes memory c,bytes memory s,uint h) external pure returns(int32[] memory,uint){return S0ULMath.rope(x,c,s,h);}
 function attention(int32[] memory q,int32[] memory k,int32[] memory v,bytes memory lut,uint scale) external pure returns(int32[] memory){return S0ULMath.attentionHead(q,k,v,lut,scale);}
}`;
const compilation = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity',
  sources: { 'S0ULMath.sol': { content: readFileSync(`${root}contracts/S0ULMath.sol`, 'utf8') },
    'MathHarness.sol': { content: harness } },
  settings: { optimizer: { enabled: true, runs: 200 }, viaIR: true, evmVersion: 'shanghai',
    outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } }
})));
assert.equal((compilation.errors ?? []).filter(e => e.severity === 'error').length, 0,
  (compilation.errors ?? []).map(e => e.formattedMessage).join('\n'));
let rpc, provider, contract;
before(async () => {
  rpc = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, miner: { blockGasLimit: 100_000_000 } });
  provider = new BrowserProvider(rpc); provider.pollingInterval = 10;
  const artifact = compilation.contracts['MathHarness.sol'].MathHarness;
  assert.ok(artifact.evm.deployedBytecode.object.length / 2 <= 24576);
  contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, await provider.getSigner()).deploy();
  await contract.waitForDeployment();
});
after(async () => { await provider?.destroy(); await rpc?.disconnect(); });
const numbers = array => Array.from(array, Number);
const i64 = array => '0x' + array.map(v => {
  const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b.toString('hex');
}).join('');
const signedBytes = array => '0x'+array.map(v => (v&255).toString(16).padStart(2,'0')).join('');

test('signed little-endian reads, ties-away rounding and integer roots match independent boundaries', async () => {
  const values = [0n,1n,-1n,(1n<<63n)-1n,-(1n<<63n)];
  const packed = i64(values);
  for (let i=0;i<values.length;i++) assert.equal(await contract.read(packed,i*8),values[i]);
  await assert.rejects(contract.read(packed,values.length*8-7));
  for (let d=1n;d<10n;d++) for (let n=-17n;n<=17n;n++) {
    const a=n<0n?-n:n, expected=(a/d+(a%d>=d/2n+d%2n?1n:0n))*(n<0n?-1n:1n);
    assert.equal(await contract.divide(n,d),expected);
  }
  await assert.rejects(contract.divide(1,0));
  for (const n of [0n,1n,2n,3n,4n,8n,9n,10n,1048575n**2n,2n**255n,(2n**256n)-1n]) {
    const r=await contract.root(n); assert.ok(r*r<=n && (r+1n)*(r+1n)>n);
  }
});

test('row-major signed INT8 multiplication exactly matches the independent integer reference', async () => {
  const v=vectors.linear,result=await contract.linear(v.q,v.scales,v.x);
  assert.deepEqual(numbers(result[0]),v.result); assert.equal(result[1],0n);
  const saturated=await contract.linear(signedBytes([...Array(8).fill(127),...Array(8).fill(-127)]),i64([16777216,16777216]),Array(8).fill(1048575));
  assert.deepEqual(numbers(saturated[0]),[1048575,-1048575]); assert.equal(saturated[1],2n);
  await assert.rejects(contract.linear('0x80',i64([1]),[1]));
  await assert.rejects(contract.linear('0x01',i64([0]),[1]));
  await assert.rejects(contract.linear('0x01',i64([16777217]),[1]));
  await assert.rejects(contract.linear('0x01',i64([1]),[1048576]));
});

test('RMSNorm and RoPE preserve every reference rounding and clipping boundary', async () => {
  const n=vectors.norm,result=await contract.norm(n.x,n.gains,n.eps);
  assert.deepEqual(numbers(result[0]),n.result); assert.equal(result[1],BigInt(n.saturated));
  const z=await contract.norm(Array(8).fill(0),i64(Array(8).fill(16384)),2684);
  assert.deepEqual(numbers(z[0]),Array(8).fill(0)); assert.equal(z[1],0n);
  const r=vectors.rope,rotation=await contract.rope(r.x,r.cos,r.sin,r.heads);
  assert.deepEqual(numbers(rotation[0]),r.result);
  const clipped=await contract.rope([1048575,1048575],i64([16384]),i64([16384]),1);
  assert.deepEqual(numbers(clipped[0]),[0,1048575]);assert.equal(clipped[1],1n);
  await assert.rejects(contract.norm([1],i64([1048576]),1));
  await assert.rejects(contract.rope([1,2],i64([16385]),i64([0]),1));
});

test('causal attention scores, LUT interpolation and weighted values match integer reference', async () => {
  for (const v of vectors.attention) {
    const output=await contract.attention(v.q,v.keys,v.values,v.lut,v.scale,{gasLimit:50_000_000});
    assert.deepEqual(numbers(output),v.result);
  }
  const v=vectors.attention[0];
  await assert.rejects(contract.attention(v.q,v.keys,v.values,v.lut,0));
  await assert.rejects(contract.attention(v.q,v.keys.slice(1),v.values,v.lut,v.scale));
});
