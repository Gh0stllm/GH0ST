// Exact pinned Nitro parent accumulator/preimage encodings. Runpod-only helper.
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
export const E=createRequire('/root/dispute/package.json')('ethers');
export function delayedMessageHash(m){return E.keccak256(E.solidityPacked(['uint8','address','uint64','uint64','uint256','uint256','bytes32'],[m.kind,m.sender,m.blockNumber,m.timestamp,m.index,m.baseFee,E.keccak256(m.rawData)]));}
export function delayedAccumulator(previous,m){return E.keccak256(E.concat([previous,delayedMessageHash(m)]));}
export function delayedGuestWire(m){
 const wire=E.solidityPacked(['uint8','uint256','uint64','uint64','uint256','uint256','bytes'],[m.kind,BigInt(m.sender),m.blockNumber,m.timestamp,m.index,m.baseFee,m.rawData]);
 assert.equal(E.dataLength(wire),113+E.dataLength(m.rawData));return wire;
}
export function sequencerHeader(h){const result=E.solidityPacked(['uint64','uint64','uint64','uint64','uint64'],[h.minTimestamp,h.maxTimestamp,h.minBlockNumber,h.maxBlockNumber,h.afterDelayedCount]);assert.equal(E.dataLength(result),40);return result;}
export function sequencerFullData(h,payload){return E.concat([sequencerHeader(h),payload]);}
export function sequencerAccumulator(previous,h,payload,delayedAcc){return E.keccak256(E.concat([previous,E.keccak256(sequencerFullData(h,payload)),delayedAcc]));}
export function assertInitialCalldataFormat(h,payload,maxDataSize=104857){
 assert(E.dataLength(sequencerFullData(h,payload))<=maxDataSize);assert(BigInt(h.minTimestamp)<=BigInt(h.maxTimestamp));assert(BigInt(h.minBlockNumber)<=BigInt(h.maxBlockNumber));
 // Initial GL3 calldata-only profile: force-inclusion/empty and direct Brotli.
 // DAS/tree-DAS/blob/customDA/zero-heavy remain rejected until explicitly reviewed.
 assert(E.dataLength(payload)===0||E.getBytes(payload)[0]===0,'Unsupported batch format');
}
export function outboxItem(m){return E.keccak256(E.solidityPacked(['address','address','uint256','uint256','uint256','uint256','bytes'],[m.l2Sender,m.to,m.l2Block,m.l1Block,m.timestamp,m.value,m.data]));}
export function outboxRoot(proof,index,m){let result=E.keccak256(outboxItem(m)),path=BigInt(index);assert(proof.length<256);assert(path<(1n<<BigInt(proof.length)));for(const sibling of proof){result=E.keccak256((path&1n)?E.concat([sibling,result]):E.concat([result,sibling]));path>>=1n;}return result;}
