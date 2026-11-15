// Anonymous, read-only CMC query. No identity, ledger transfer, mint or top-up.
import { Actor, HttpAgent, Certificate, Cbor, reconstruct, lookup_path, lookupResultToBuffer } from '@icp-sdk/core/agent';
import { IDL } from '@icp-sdk/core/candid';
import { Principal } from '@icp-sdk/core/principal';
import { createHash } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
if(process.argv.includes('--help')){console.log('Read-only certified CMC query. Usage: node cmc-rate.mjs [--out-dir directory]');process.exit(0);}
const outputIndex=process.argv.indexOf('--out-dir');
if(outputIndex>=0&&!process.argv[outputIndex+1])throw Error('--out-dir requires a directory');
const outputDir=outputIndex<0?dirname(fileURLToPath(import.meta.url)):resolve(process.argv[outputIndex+1]);
const id='rkp4c-7iaaa-aaaaa-aaaca-cai';
const canisterId=Principal.fromText(id);
const rateType=IDL.Record({timestamp_seconds:IDL.Nat64,xdr_permyriad_per_icp:IDL.Nat64});
const agent=await HttpAgent.create({host:'https://icp-api.io',verifyQuerySignatures:true});
// The SDK's pinned mainnet root key is retained. Never fetch/trust a replacement.
const actor=Actor.createActor(()=>IDL.Service({get_icp_xdr_conversion_rate:IDL.Func([],[IDL.Record({data:rateType,hash_tree:IDL.Vec(IDL.Nat8),certificate:IDL.Vec(IDL.Nat8)})],['query'])}),{agent,canisterId});
const response=await actor.get_icp_xdr_conversion_rate();
const certificate=await Certificate.create({certificate:new Uint8Array(response.certificate),rootKey:agent.rootKey,principal:{canisterId},agent});
const witness=Cbor.decode(new Uint8Array(response.hash_tree));
const digest=await reconstruct(witness);
const certifiedData=lookupResultToBuffer(certificate.lookup_path(['canister',canisterId.toUint8Array(),'certified_data']));
assert.ok(certifiedData,'Missing certified_data');
assert.deepEqual(Buffer.from(digest),Buffer.from(certifiedData),'CMC witness root differs from certified_data');
const leaf=lookupResultToBuffer(lookup_path(['ICP_XDR_CONVERSION_RATE'],witness));
assert.ok(leaf,'Missing certified rate leaf');
const encoded=IDL.encode([rateType],[response.data]);
assert.deepEqual(Buffer.from(leaf),Buffer.from(encoded),'Returned rate differs from certified Candid leaf');
const timestamp=Number(response.data.timestamp_seconds),rate=BigInt(response.data.xdr_permyriad_per_icp);
assert.ok(rate>0n);assert.ok(Math.abs(Date.now()/1000-timestamp)<3600,'Conversion rate too old');
const sha=b=>createHash('sha256').update(Buffer.from(b)).digest('hex');
const record={scope:'Anonymous read-only CMC conversion query; BLS certificate, witness root and exact rate leaf verified against SDK-pinned mainnet root key. No mint or transfer.',checkedAt:new Date().toISOString(),cmcCanister:id,host:'https://icp-api.io',sdk:'@icp-sdk/core 6.1.1',querySignatureVerification:true,blsCertificateVerified:true,witnessRootVerified:true,returnedRateLeafVerified:true,pinnedMainnetRootKeySha256:sha(agent.rootKey),rateTimestampSeconds:timestamp,rateTimestampUTC:new Date(timestamp*1000).toISOString(),xdrPermyriadPerIcp:rate.toString(),xdrPerIcp:Number(rate)/10000,cyclesPerXdr:'1000000000000',cyclesPerIcp:(rate*1000000000000n/10000n).toString(),certificateSha256:sha(response.certificate),witnessRootSha256Hex:Buffer.from(digest).toString('hex'),sources:['https://docs.internetcomputer.org/references/system-canisters/','https://github.com/dfinity/ic/blob/master/rs/nns/cmc/cmc.did']};
mkdirSync(outputDir,{recursive:true});
writeFileSync(join(outputDir,'cmc-rate.json'),JSON.stringify(record,null,2)+'\n');
writeFileSync(join(outputDir,'cmc-witness.json'),JSON.stringify({canisterId:id,checkedAt:record.checkedAt,certificateBase64:Buffer.from(response.certificate).toString('base64'),hashTreeBase64:Buffer.from(response.hash_tree).toString('base64'),rateCandidBase64:Buffer.from(encoded).toString('base64')},null,2)+'\n');
console.log(JSON.stringify(record,null,2));
