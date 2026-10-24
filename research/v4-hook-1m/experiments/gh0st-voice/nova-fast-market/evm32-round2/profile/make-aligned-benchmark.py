from pathlib import Path
p=Path(__file__).resolve().parent
s=(p/'profile.mjs').read_text()
s=s.replace("compile(path.join(here,'ProfileModel.sol'))","compile(path.join(here,'aligned/GRU2BatchCheckedModel.sol'))")
start=s.index("const groups=['core'");end=s.index('async function invoke',start)
s=s[:start]+'''const groups=['core','groups','words','vocabulary','fused','punctuation'];let next=0x970000n;
async function inject(dir){const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),catalogs={};for(const group of groups){const data=fs.readFileSync(path.join(dir,group+'.bin'));assert.equal(sha(data),manifest.artifacts[group+'.bin'].sha256);const addresses=[];for(let i=0;i<data.length;i+=24000){const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+data.subarray(i,i+24000).toString('hex')]);addresses.push(a);}const pages=[];for(let i=0;i<addresses.length;i+=1024){const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+addresses.slice(i,i+1024).map(x=>x.slice(2)).join('')]);pages.push(a);}const a=ethers.getAddress(hex(next++,20));await rpc('hardhat_setCode',[a,'0x00'+pages.map(x=>x.slice(2)).join('')]);catalogs[group]=a;}return catalogs;}
const catalogs=[await inject(dir),await inject(path.join(here,'aligned'))];const contracts=[];for(const [i,a]of artifacts.entries()){const r=await send(await new ethers.ContractFactory(a.abi,a.evm.bytecode.object).getDeployTransaction(...groups.map(g=>catalogs[i][g])));assert.equal(r.status,'0x1');contracts.push({address:r.contractAddress,iface:new ethers.Interface(a.abi)});}
'''+s[end:]
start=s.index('const report={scope:');s=s[:start]+'''const report={scope:'LOCAL_ONLY',publicTransactions:0,weightsUnchanged:true,candidate:'aligned18',vectors:[]};
for(const v of vectors){for(const cap of [1,2,3]){const baseline=await invoke(contracts[0],'stepBatchChecked',[...v.input,cap]),candidate=await invoke(contracts[1],'stepBatchChecked',[...v.input,cap]);assert.equal(baseline.out,candidate.out);report.vectors.push({name:v.name,cap,baselineGas:baseline.gas,candidateGas:candidate.gas,reduction:baseline.gas-candidate.gas,hash:ethers.keccak256(baseline.out),parity:true});console.log(json(report.vectors.at(-1)));}}
fs.writeFileSync(path.join(here,'aligned-results.json'),json(report));
'''
(p/'aligned-benchmark.mjs').write_text(s)
