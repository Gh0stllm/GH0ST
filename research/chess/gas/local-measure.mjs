// Artificial isolated EVM only. No RPC, identity, signing service or real funds.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserProvider, ContractFactory, Wallet, sha256, toUtf8Bytes } from 'ethers';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const require=createRequire(resolve(root,'package.json'));
const ganache=require('ganache'),solc=require('solc');
const source=readFileSync(resolve(root,'evm-tests/fixtures.sol'),'utf8');
const compiled=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources:{'fixtures.sol':{content:source}},settings:{optimizer:{enabled:true,runs:200},viaIR:true,evmVersion:'shanghai',metadata:{bytecodeHash:'none'},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}})));
assert.equal((compiled.errors||[]).filter(e=>e.severity==='error').length,0);
const tokenArtifact=compiled.contracts['fixtures.sol'].ChessTestToken;
const vaultArtifact=JSON.parse(readFileSync(resolve(root,'evm/artifacts.json'),'utf8')).contracts.RHChessChallengeVault;
const eip=ganache.provider({logging:{quiet:true},wallet:{mnemonic:'test test test test test test test test test test test junk',totalAccounts:4,defaultBalance:1000},chain:{chainId:31337,hardfork:'shanghai',allowUnlimitedContractSize:true,allowUnlimitedInitCodeSize:true,time:new Date('2026-11-15T00:00:00Z')},miner:{blockGasLimit:32000000,timestampIncrement:1}});
const provider=new BrowserProvider(eip,undefined,{cacheTimeout:-1});provider.pollingInterval=10;
const owner=await provider.getSigner(0),player=await provider.getSigner(1),relayer=await provider.getSigner(2);
const ownerAddress=await owner.getAddress(),playerAddress=await player.getAddress();
const attestor=new Wallet('0x'+'11'.repeat(32)); // Public fixture key; no production use.
const config=sha256(toUtf8Bytes('LOCAL GAS MEASURE ONLY'));
const rows=[];
async function measured(label,promise){const tx=await promise,r=await tx.wait();assert.equal(r.status,1);const row={label,gasUsed:r.gasUsed.toString(),localReceiptHash:r.hash,localBlock:r.blockNumber};rows.push(row);console.log(JSON.stringify(row));return r;}
async function deploy(label,artifact,args=[]){const c=await new ContractFactory(artifact.abi,artifact.bytecode,owner).deploy(...args);await measured(label,Promise.resolve(c.deploymentTransaction()));await c.waitForDeployment();return c;}
const types={GameResult:[{name:'gameId',type:'bytes32'},{name:'player',type:'address'},{name:'principalHash',type:'bytes32'},{name:'nonce',type:'uint256'},{name:'finalPositionHash',type:'bytes32'},{name:'transcriptHash',type:'bytes32'},{name:'result',type:'uint8'},{name:'engineConfigHash',type:'bytes32'},{name:'completedAt',type:'uint64'},{name:'issuedAt',type:'uint64'},{name:'validUntil',type:'uint64'}]};
function payload(n){const out=Buffer.alloc(n);for(let i=0;i<n;i+=32)createHash('sha256').update(`GH0ST_READ_ONLY_DATA_SHARD_${i}`).digest().copy(out,i,0,Math.min(32,n-i));return out;}
function createShard(runtimeBytes){const runtime=Buffer.concat([Buffer.from([0]),payload(runtimeBytes-1)]),s=runtimeBytes.toString(16).padStart(6,'0');return '0x62'+s+'620000105f3962'+s+'5ff3'+runtime.toString('hex');}
try {
  const token=await deploy('LOCAL MOCK token deployment',{abi:tokenArtifact.abi,bytecode:'0x'+tokenArtifact.evm.bytecode.object},[18]);
  const vault=await deploy('LEGACY ICP-attested vault deployment',vaultArtifact,[token.target,ownerAddress,attestor.address,config]);
  const fee=25000n*10n**18n,prize=100000n*10n**18n;
  await measured('LOCAL fixture mint owner',token.mint(ownerAddress,prize*10n));
  await measured('LOCAL fixture mint player',token.mint(playerAddress,fee*10n));
  await measured('LEGACY pool exact approval',token.approve(vault.target,prize*10n));
  await measured('LEGACY manual pool funding',vault.fundPool(prize*10n));
  await measured('LEGACY enable entries',vault.setPaused(false));
  const principal=sha256(toUtf8Bytes('fake raw ICP principal gas fixture'));
  for(const [nonce,result] of [[1n,1],[2n,2],[3n,3],[4n,6]]){
    await measured(`LEGACY exact fee approval fresh nonce ${nonce}`,token.connect(player).approve(vault.target,fee));
    await measured(`LEGACY enter and reserve nonce ${nonce}`,vault.connect(player).enterGame(principal,nonce));
    const gameId=await vault.gameIdFor(playerAddress,nonce),game=await vault.games(gameId);
    const receipt={gameId,player:playerAddress,principalHash:principal,nonce,finalPositionHash:sha256(toUtf8Bytes('local final FEN')),transcriptHash:sha256(toUtf8Bytes('local game transcript')),result,engineConfigHash:config,completedAt:game.openedAt,issuedAt:game.openedAt,validUntil:game.reconciliationDeadline};
    const sig=await attestor.signTypedData({name:'GH0ST RH Chess Challenge',version:'1',chainId:31337,verifyingContract:vault.target},types,receipt);
    await measured(`LEGACY settle outcome ${result} nonce ${nonce}`,vault.connect(relayer).settleGame(receipt,sig));
  }
  for(const n of [24576,98304]){
    const r=await measured(`DATA shard deploy ${n} runtime bytes`,owner.sendTransaction({data:createShard(n),gasLimit:30000000}));
    assert.equal((await provider.getCode(r.contractAddress)).length,2+n*2);
  }
  const report={scope:'Fresh isolated Ganache Shanghai receipts. Existing attested vault only, MOCK token with hostile-token logic in normal mode; not a native chess engine or RH paid gameplay. Large-code flags model size capacity, not Nitro pricing.',generatedAt:new Date().toISOString(),versions:{solc:solc.version(),ganache:require('ganache/package.json').version},chainId:31337,compilerRuntimeBytes:vaultArtifact.runtimeBytes,vaultSourceSha256:createHash('sha256').update(readFileSync(resolve(root,'contracts/RHChessChallengeVault.sol'))).digest('hex'),largeCodeFlags:{allowUnlimitedContractSize:true,allowUnlimitedInitCodeSize:true,actualRHLimitTestedSeparately:true},receipts:rows};
  writeFileSync(new URL('./local-gas-receipts.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
}finally{await eip.disconnect();}
