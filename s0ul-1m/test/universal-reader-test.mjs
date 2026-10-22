import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import solc from 'solc';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroAddress, AbiCoder, keccak256, toUtf8Bytes, toBeHex } from 'ethers';

const MOCK_SOURCE = String.raw`// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @dev In-memory test source only. All setters intentionally lack access control.
contract UniversalReaderMock {
    // ERC165 modes: 0 canonical selected interfaces; 1 always true;
    // 2 invalid-id returns2; 3 invalid-id returns31; 4 invalid-id reverts;
    // 5 standard-id false; 6 standard-id returns2; 7 standard-id returns31;
    // 8 standard-id reverts; 9 every response false; 10 burn35k then canonical.
    // Interface flags: bit1 ERC721, bit2 ERC1155, bit4 ERC2981.
    uint8 public erc165Mode;
    uint8 public interfaceFlags;

    // Getter modes: 0 fixed32; 1 empty; 2 return2048; 3 return2049;
    // 4 return65536; 5 revert65536; 6 exhaust gas; 7 attempt direct SSTORE;
    // 8 call a stateful target then return fixed32; 9 revert;
    // 10 return31; 11 return64; 12 return33.
    struct Getter { bool configured; uint8 mode; uint256 value; }
    mapping(bytes4 => Getter) private getters;
    uint256 public counter;
    address public callbackTarget;
    bytes public callbackData;

    function setERC165(uint8 mode, uint8 flags) external { erc165Mode = mode; interfaceFlags = flags; }
    function configureGetter(bytes4 selector, uint8 mode, uint256 value) external {
        getters[selector] = Getter(true, mode, value);
    }
    function clearGetter(bytes4 selector) external { delete getters[selector]; }
    function configureCallback(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
    function bump() external { ++counter; }

    fallback() external {
        if (msg.sig == 0x01ffc9a7) {
            require(msg.data.length >= 36, "short ERC165 calldata");
            bytes4 id = abi.decode(msg.data[4:], (bytes4));
            uint8 mode = erc165Mode;
            if (mode == 10) {
                uint256 started = gasleft();
                while (started - gasleft() < 35_000) {}
            }
            bool invalid = id == 0xffffffff;
            bool standard = id == 0x01ffc9a7;
            if ((invalid && mode == 4) || (standard && mode == 8)) revert("ERC165 probe rejected");
            if ((invalid && mode == 3) || (standard && mode == 7)) {
                assembly { mstore(0, 1) return(0, 31) }
            }
            if ((invalid && mode == 2) || (standard && mode == 6)) {
                assembly { mstore(0, 2) return(0, 32) }
            }
            uint256 answer;
            if (mode == 1) answer = 1;
            else if (mode != 9 && !(standard && mode == 5)) {
                uint8 flags = interfaceFlags;
                if (standard || (id == 0x80ac58cd && (flags & 1) != 0)
                    || (id == 0xd9b67a26 && (flags & 2) != 0)
                    || (id == 0x2a55205a && (flags & 4) != 0)) answer = 1;
            }
            assembly { mstore(0, answer) return(0, 32) }
        }

        Getter memory getter = getters[msg.sig];
        require(getter.configured, "unconfigured getter");
        uint8 selected = getter.mode;
        uint256 word = getter.value;
        if (selected == 1) { assembly { return(0, 0) } }
        if (selected == 2) { assembly { mstore(0, word) return(0, 2048) } }
        if (selected == 3) { assembly { mstore(0, word) return(0, 2049) } }
        if (selected == 4) { assembly { mstore(0, word) return(0, 65536) } }
        if (selected == 5) { assembly { mstore(0, word) revert(0, 65536) } }
        if (selected == 6) { assembly { for { } 1 { } { } } }
        if (selected == 7) { ++counter; }
        if (selected == 8) {
            address target = callbackTarget;
            bytes memory data = callbackData;
            // The caller's STATICCALL ancestry must also prohibit this callee's writes.
            assembly { pop(call(30000, target, 0, add(data, 32), mload(data), 0, 0)) }
        }
        if (selected == 9) revert("configured getter rejected");
        if (selected == 10) { assembly { mstore(0, word) return(0, 31) } }
        if (selected == 11) { assembly { mstore(0, word) mstore(32, word) return(0, 64) } }
        if (selected == 12) { assembly { mstore(0, word) return(0, 33) } }
        assembly { mstore(0, word) return(0, 32) }
    }
}

contract UniversalReaderCounterMock {
    uint256 public counter;
    function bump() external { ++counter; }
}
`;

const sourcePath = fileURLToPath(new URL('../contracts/intel/v2/S0ULUniversalReader.sol', import.meta.url));
// MOCK_SOURCE is an in-memory-only Solidity fixture; it is not deployed to a public chain.
let compiled, sourceSha256, rpc, provider, alice, aliceAddress, reader;
const measurements = {};
function artifact(name) {
  const found = Object.values(compiled.contracts).flatMap(file => Object.entries(file)).find(([key]) => key === name);
  assert.ok(found, 'Missing compiled fixture ' + name); return found[1];
}
async function mined(tx) {
  const sent = await tx, receipt = await provider.getTransactionReceipt(sent.hash) ?? await sent.wait();
  if (Number(receipt.status) !== 1) throw Error(`Local transaction reverted: gasUsed=${receipt.gasUsed} block=${receipt.blockNumber} hash=${sent.hash}`); return receipt;
}
async function deploy(name, args = []) {
  const a = artifact(name), instance = await new ContractFactory(a.abi,a.evm.bytecode.object,alice).deploy(...args,{gasLimit:10_000_000});
  await instance.waitForDeployment(); return instance;
}
const selector = name => keccak256(toUtf8Bytes(name)).slice(0,10);
const coder = AbiCoder.defaultAbiCoder();
async function codeAt(address, bytes) { await rpc.request({method:'evm_setAccountCode',params:[address,bytes]}); }

before(async () => {
  const source = readFileSync(sourcePath,'utf8'); sourceSha256=createHash('sha256').update(source).digest('hex');
  compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{
    'S0ULUniversalReader.sol':{content:source},'UniversalReaderMocks.sol':{content:MOCK_SOURCE},
  },settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',outputSelection:{'*':{'*':['abi','evm.bytecode.object','evm.deployedBytecode.object']}}}})));
  const errors=(compiled.errors??[]).filter(item=>item.severity==='error');
  assert.equal(errors.length,0,errors.map(item=>item.formattedMessage).join('\n'));
  assert.ok(artifact('S0ULUniversalReader').evm.deployedBytecode.object.length/2<=24576);
  rpc=ganache.provider({logging:{quiet:true},chain:{chainId:31338,hardfork:'shanghai'},miner:{blockGasLimit:32_000_000},wallet:{deterministic:true}});
  provider=new BrowserProvider(rpc,undefined,{cacheTimeout:-1,batchStallTime:0}); provider.pollingInterval=10;
  alice=await provider.getSigner(0); aliceAddress=await alice.getAddress(); reader=await deploy('S0ULUniversalReader');
});
after(async () => {
  if(Object.keys(measurements).length)console.log(JSON.stringify({format:'s0ul-universal-reader-local-validation-v1',chain:'in-process Ganache31338/shanghai; no public transactions',compiler:solc.version(),sourceSha256,runtimeBytes:artifact('S0ULUniversalReader').evm.deployedBytecode.object.length/2,gas:measurements}));
  await provider?.destroy(); await rpc?.disconnect();
});

test('any no-code address returns exact uint256 native facts without asserting wallet identity or safety', async () => {
  const target='0x0000000000000000000000000000000000009876', native=(1n<<200n)+999n;
  await rpc.request({method:'evm_setAccountBalance',params:[target,toBeHex(native)]});
  const p=await reader.profile(target); assert.equal(p.nativeBalance,native); assert.equal(p.target,target);
  assert.equal(p.codeBytes,0n); assert.equal(p.scannedBytes,0n); assert.equal(p.complete,true); assert.equal(p.interfaceMask,0n);
  assert.equal(p.ownerAvailable,false); assert.equal(p.implementationAvailable,false); assert.equal(p.assetAvailable,false);
  const zero=await reader.profile(ZeroAddress); assert.equal(zero.codeBytes,0n);
  const [facts,text]=await reader.analyze(target); assert.equal(facts.nativeBalance,native);
  assert.match(text,/does not prove the address is a wallet/); assert.doesNotMatch(text,/\bEOA\b|is safe|guaranteed|will rise|will fall/i);
  const block=await provider.getBlock('latest'); assert.equal(facts.observedAt,BigInt(block.timestamp)); assert.equal(facts.blockCounter,BigInt(block.number));
});

test('bytecode scanner skips PUSH payloads, deduplicates PUSH4 heuristics and never scans beyond its prefix', async () => {
  const address='0x0000000000000000000000000000000000009001';
  const payload='f1faf4f2ff5532f0f5a0a4'.padEnd(64,'f');
  const code='0x7f'+payload+'63deadbeef63deadbeef6301020304'+'f1faf4f2ff5532f0f5a0a4';
  await codeAt(address,code); const p=await reader.profile(address);
  assert.equal(p.codeBytes,BigInt((code.length-2)/2)); assert.equal(p.codeHash,keccak256(code)); assert.equal(p.complete,true);
  assert.equal(p.push4Count,3n); assert.equal(p.selectorCount,2n); assert.deepEqual([...p.selectorCandidates].slice(0,2),['0xdeadbeef','0x01020304']);
  assert.deepEqual([...p.opcodeSignals],[1n,1n,1n,1n,1n,1n,1n,1n,1n,2n]);
  await codeAt(address,'0x63dead'); const truncated=await reader.profile(address);
  assert.equal(truncated.opcodeCount,1n); assert.equal(truncated.push4Count,1n); assert.equal(truncated.selectorCount,0n);
  await codeAt(address,'0x'+Array.from({length:40},(_,i)=>'63'+i.toString(16).padStart(8,'0')).join('')+'00');
  const many=await reader.profile(address); assert.equal(many.push4Count,40n); assert.equal(many.selectorCount,32n);
  assert.equal(await reader.MAX_SELECTOR_SCAN(),4096n);
  await codeAt(address,'0x'+('7f'+'00'.repeat(32)).repeat(124)+'00'.repeat(4)+'63fefefefe00');
  const outside=await reader.profile(address); assert.equal(outside.push4Count,1n); assert.equal(outside.selectorCount,0n,'PUSH4 outside the4096-byte candidate prefix is counted but never presented as a candidate');
  const prefix=('7f'+'00'.repeat(32)).repeat(744)+'00'.repeat(24);
  assert.equal(prefix.length/2,24576);
  await codeAt(address,'0x'+prefix+'ff');
  const [bounded,text]=await reader.analyze(address,{gasLimit:25_000_000});
  assert.equal(bounded.codeBytes,24577n); assert.equal(bounded.scannedBytes,24576n); assert.equal(bounded.complete,false);
  assert.equal(bounded.opcodeSignals[4],0n); assert.equal(bounded.opcodeCount,768n); assert.match(text,/bounded prefix/);
  const unique=Array.from({length:31},(_,i)=>'63'+i.toString(16).padStart(8,'0')).join('');
  const adversarial='0x'+unique+('630000001e').repeat(Math.floor((24576-155)/5))+'00';
  assert.equal((adversarial.length-2)/2,24576);
  await codeAt(address,adversarial);
  measurements.scanRepeated31stSelector=(await mined(alice.sendTransaction({...await reader.profile.populateTransaction(address),gasLimit:31_000_000}))).gasUsed.toString();
  assert.ok(BigInt(measurements.scanRepeated31stSelector)<31_000_000n,'worst-case duplicate comparisons must fit the operational transaction cap');
});

test('ERC165 requires canonical standard support and canonical invalid-id rejection within thirty thousand gas', async () => {
  const target=await deploy('UniversalReaderMock'), address=await target.getAddress();
  await mined(target.setERC165(0,7)); assert.equal((await reader.profile(address)).interfaceMask,15n);
  for(const [flags,mask] of [[0,1],[1,3],[2,5],[4,9]]) {
    await mined(target.setERC165(0,flags)); assert.equal((await reader.profile(address)).interfaceMask,BigInt(mask));
  }
  for(const mode of [1,2,3,4,5,6,7,8,9,10]) {
    await mined(target.setERC165(mode,7));
    assert.equal((await reader.profile(address,{gasLimit:2_000_000})).interfaceMask,0n,'nonconforming mode '+mode);
  }
  const erc165Data=selector('supportsInterface(bytes4)')+coder.encode(['bytes4'],['0x01ffc9a7']).slice(2);
  const direct=await provider.call({to:address,data:erc165Data,gasLimit:100_000});
  assert.equal(coder.decode(['bool'],direct)[0],true,'the expensive fixture responds with sufficient gas but must fail the30k conformance probe');
  await mined(target.setERC165(0,7));
  const [,text]=await reader.analyze(address); assert.match(text,/Reports ERC721/); assert.match(text,/Reports ERC1155/); assert.match(text,/Reports ERC2981/);
  assert.match(text,/not established|misleading|unreachable/);
});

test('optional ownership, pause, implementation and asset facts require canonical exact-size words', async () => {
  const target=await deploy('UniversalReaderMock'), address=await target.getAddress();
  const fields=[['owner()','ownerAvailable','owner'],['paused()','pausedAvailable','paused'],['implementation()','implementationAvailable','implementation'],['asset()','assetAvailable','asset']];
  for(const [name] of fields) await mined(target.configureGetter(selector(name),0,name==='paused()'?1:BigInt(aliceAddress)));
  const p=await reader.profile(address);
  assert.equal(p.ownerAvailable,true); assert.equal(p.owner,aliceAddress); assert.equal(p.pausedAvailable,true); assert.equal(p.paused,true);
  assert.equal(p.implementationAvailable,true); assert.equal(p.implementation,aliceAddress); assert.equal(p.assetAvailable,true); assert.equal(p.asset,aliceAddress);
  await mined(target.configureGetter(selector('paused()'),0,0)); assert.equal((await reader.profile(address)).paused,false);
  for(const [name,available] of fields) {
    await mined(target.configureGetter(selector(name),0,name==='paused()'?2:(1n<<200n)|BigInt(aliceAddress)));
    assert.equal((await reader.profile(address))[available],false,'noncanonical '+name+' must not be truncated');
    for(const mode of [1,4,5,6,9,10,11,12]) {
      await mined(target.configureGetter(selector(name),mode,1));
      assert.equal((await reader.profile(address,{gasLimit:2_000_000}))[available],false,'size/failure mode '+mode+' for '+name);
    }
    await mined(target.clearGetter(selector(name)));
  }
});

test('generic reads preserve success and failure while bounding calldata, copied returndata and gas', async () => {
  const target=await deploy('UniversalReaderMock'), address=await target.getAddress(), data='0x12345678';
  await mined(target.configureGetter(data,0,123456));
  let result=await reader.read(address,data); assert.equal(result.status,0n); assert.equal(result.returnSize,32n);
  assert.equal(coder.decode(['uint256'],result.data)[0],123456n);
  for(const [mode,status,size,copied] of [[1,0,0,0],[2,0,2048,2048],[3,2,2049,2048],[4,2,65536,2048],[5,1,65536,2048],[6,1,0,0],[9,1,100,100]]) {
    await mined(target.configureGetter(data,mode,123456)); result=await reader.read(address,data,{gasLimit:1_000_000});
    assert.equal(result.status,BigInt(status),'mode '+mode); assert.equal(result.returnSize,BigInt(size),'mode '+mode);
    assert.equal((result.data.length-2)/2,copied,'mode '+mode);
    if(mode===4||mode===5||mode===6) measurements['readMode'+mode]=(await mined(alice.sendTransaction({...await reader.read.populateTransaction(address,data),gasLimit:1_000_000}))).gasUsed.toString();
  }
  const noCode=await reader.read('0x0000000000000000000000000000000000008123',data);
  assert.equal(noCode.status,0n); assert.equal(noCode.returnSize,0n); assert.equal(noCode.data,'0x','empty success must remain raw facts without inferred interface compatibility');
  await mined(target.configureGetter(data,0,1));
  const maxData=data+'00'.repeat(4096-4); assert.equal((await reader.read(address,maxData)).status,0n);
  await assert.rejects(reader.read(address,maxData+'00')); await assert.rejects(reader.read(address,data,{gasLimit:100_000}));
  await assert.rejects(reader.read(address,data,{value:1n}));
});

test('STATICCALL prevents direct and nested state mutation even when generic reads are mined as transactions', async () => {
  const target=await deploy('UniversalReaderMock'), child=await deploy('UniversalReaderCounterMock');
  const address=await target.getAddress(), data='0x12345678';
  await mined(target.configureGetter(data,7,111));
  assert.equal((await reader.read(address,data)).status,1n); assert.equal(await target.counter(),0n);
  await mined(alice.sendTransaction({...await reader.read.populateTransaction(address,data),gasLimit:1_000_000}));
  assert.equal(await target.counter(),0n);
  await mined(target.configureCallback(await child.getAddress(),child.interface.encodeFunctionData('bump')));
  await mined(target.configureGetter(data,8,222));
  const result=await reader.read(address,data); assert.equal(result.status,0n); assert.equal(coder.decode(['uint256'],result.data)[0],222n);
  await mined(alice.sendTransaction({...await reader.read.populateTransaction(address,data),gasLimit:1_000_000}));
  assert.equal(await child.counter(),0n); assert.equal(await target.counter(),0n);
  await assert.rejects(reader.profile(address,{gasLimit:70_000}),'underfunded profile must revert instead of inventing unsupported interfaces/getters');
});
