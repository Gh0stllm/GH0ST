// Compile actual local upstream test contracts omitted by the base-only bindings.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),repo=path.resolve(here,'../../..');
const sliced=process.argv.includes('--sliced');
const vi=process.argv.indexOf('--variant'),variant=vi>=0?process.argv[vi+1]:'';
if(variant&&!/^[a-z0-9-]+$/.test(variant))throw Error('invalid variant');
const suffix=variant?'-'+variant:'';
const source=path.join(here,sliced?'.cache/nitro-sliced'+suffix:'.cache/nitro-chess');
const require=createRequire(path.join(repo,'research/chess/package.json'));
const provenance=path.join(repo,'research/chess/l3/nitro/.cache/contracts-provenance');
const solc=require('solc');
if(!solc.version().startsWith('0.8.30+commit.73712a01'))throw Error('compiler identity');
const entry='contracts-local/src/osp/ReferenceDAProofValidator.sol';
const sources={};
for(const dir of ['contracts-local/src/mocks','contracts-local/src/osp'])for(const name of fs.readdirSync(path.join(source,dir)))if(name.endsWith('.sol'))sources[dir+'/'+name]={content:fs.readFileSync(path.join(source,dir,name),'utf8')};
const output=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:2000},evmVersion:'cancun',outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{import:p=>{
 let file=path.join(source,p);
 if(p.startsWith('@nitro-contracts/'))file=path.join(provenance,'git/nitro-contracts-4341b132cfbdcc980ead03765ca5224ff6cb5d97/src',p.slice('@nitro-contracts/'.length));
 if(p.startsWith('openzeppelin-contracts/'))file=path.join(provenance,'deps/@openzeppelin__contracts/package',p.slice('openzeppelin-contracts/'.length));
 if(p.startsWith('contracts-local/src/precompiles/'))file=path.join(repo,'research/chess/l3/nitro/.cache/nitro-precompile-interfaces-7e88c8cc53c2e96201a23c638f1536557b9cb68b',p.slice('contracts-local/src/precompiles/'.length));

 try{return {contents:fs.readFileSync(file,'utf8')}}catch{return {error:'Pinned source unavailable: '+p}}
}}));
if((output.errors||[]).some(x=>x.severity==='error'))throw Error(JSON.stringify(output.errors));
const local=[];for(const [file,contracts] of Object.entries(output.contracts))if(Object.hasOwn(sources,file))for(const [name,c] of Object.entries(contracts))local.push({name,pkg:'localgen',abi:c.abi,bytecode:c.evm.bytecode.object});
const reader=JSON.parse(fs.readFileSync(path.join(repo,'research/chess/l3/core/integration/root-factory/Reader4844.json'),'utf8'));
const artifacts=[...local,{name:'Reader4844',pkg:'yulgen',abi:reader.abi,bytecode:reader.bytecode.object||reader.bytecode}];
const dir=path.join(here,sliced?'.cache/test-bindings-sliced'+suffix:'.cache/test-bindings');fs.mkdirSync(dir,{recursive:true});
fs.writeFileSync(path.join(dir,'artifacts.json'),JSON.stringify(artifacts));
fs.writeFileSync(path.join(dir,'main.go'),`package main
import("encoding/json";"os";"path/filepath";"github.com/ethereum/go-ethereum/accounts/abi/abigen")
func main(){var rows []struct{Name,Pkg,Bytecode string;Abi json.RawMessage};b,e:=os.ReadFile(os.Args[1]);if e!=nil{panic(e)};if e=json.Unmarshal(b,&rows);e!=nil{panic(e)};for _,pkg:=range []string{"localgen","yulgen"}{var names,abis,bins []string;for _,r:=range rows{if r.Pkg==pkg{names=append(names,r.Name);abis=append(abis,string(r.Abi));bins=append(bins,r.Bytecode)}};s,e:=abigen.Bind(names,abis,bins,nil,pkg,nil,nil);if e!=nil{panic(e)};if e=os.WriteFile(filepath.Join("solgen/go",pkg,"gl3_test_dependencies.go"),[]byte(s),0644);e!=nil{panic(e)}}}
`);
const go=path.join(repo,'research/chess/l3/core/node/.cache/go-1.25.12/go/bin/go');
const p=spawnSync(go,['run','-mod=mod',path.join(dir,'main.go'),path.join(dir,'artifacts.json')],{cwd:source,env:{...process.env,GOTOOLCHAIN:'local'},stdio:'inherit'});
if(p.status!==0)process.exit(p.status||1);
