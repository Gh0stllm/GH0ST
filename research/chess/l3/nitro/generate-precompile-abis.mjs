import fs from 'node:fs';import path from 'node:path';import solc from '../../node_modules/solc/index.js';
const root=process.cwd(),pin=JSON.parse(fs.readFileSync('evidence/precompile-interface-pin.json'));
const dir=path.join(root,pin.source);const sources={};
for(const name of fs.readdirSync(dir).filter(x=>x.endsWith('.sol')))sources[name]={content:fs.readFileSync(path.join(dir,name),'utf8')};
const out=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{outputSelection:{'*':{'*':['abi']}}}})));
const errors=(out.errors??[]).filter(e=>e.severity==='error');if(errors.length)throw Error(errors.map(e=>e.formattedMessage).join('\n'));
let count=0;for(const [file,contracts]of Object.entries(out.contracts))for(const[name,c]of Object.entries(contracts)){const dest=path.join(root,'.cache/nitro-build/contracts-local/out/precompiles',file);fs.mkdirSync(dest,{recursive:true});fs.writeFileSync(path.join(dest,name+'.json'),JSON.stringify({abi:c.abi,bytecode:{object:''}}));count++;}
console.log(JSON.stringify({compiler:solc.version(),contracts:count}));
