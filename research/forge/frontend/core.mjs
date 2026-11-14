import { AbiCoder, keccak256, toUtf8Bytes, parseUnits } from 'ethers';
export const CHAIN_ID = 4663;
export const PUBLIC_RPC = 'https://rpc.mainnet.chain.robinhood.com';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
export const TOKEN_ADDRESS = '0x2eb2849cDE7957b86d0dFD4B59e450a9F9D15559';
export const FORMAT = 'GH0ST_FORGE_NUMERIC_MLP_Q8_V1';
export const same = (a,b) => String(a).toLowerCase() === String(b).toLowerCase();
export const coder = AbiCoder.defaultAbiCoder();
export const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function parseFee(value) {
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(String(value))) throw new Error('Enter a nonnegative GH0ST amount with up to 18 decimals.');
  const fee = parseUnits(String(value),18);
  if (fee >= 2n ** 96n) throw new Error('This fee exceeds the contract limit.');
  return fee;
}
export function modelHash(model) {
  return keccak256(coder.encode(['bytes32','uint8','uint8','uint8','bytes32','bytes32','bytes32','bytes32'],[keccak256(toUtf8Bytes(FORMAT)),model.shape.input,model.shape.hidden,model.shape.output,model.hashes.featureSchemaHash,model.hashes.labelsHash,model.hashes.datasetHash,keccak256(model.packedWeightsHex)]));
}
export function modelIdentity(address,beneficiary,fee,hash) {
  return keccak256(coder.encode(['uint256','address','address','address','uint96','bytes32'],[CHAIN_ID,address,TOKEN_ADDRESS,beneficiary,fee,hash]));
}
export function constructorArgs(model,beneficiary,fee) {
  if (!same(model.hashes.modelHash,modelHash(model)) || !same(model.hashes.weightsHash,keccak256(model.packedWeightsHex))) throw new Error('Model weight commitments do not match.');
  return [TOKEN_ADDRESS,beneficiary,fee,model.shape.input,model.shape.hidden,model.shape.output,model.hashes.featureSchemaHash,model.hashes.labelsHash,model.hashes.datasetHash,model.packedWeightsHex];
}
export function normalizeTrace(trace) {
  return {hidden:Array.from(trace.hidden,Number),logits:Array.from(trace.logits,Number),classId:Number(trace.classId)};
}
export function assertTrace(actual,expected) {
  if (JSON.stringify(normalizeTrace(actual)) !== JSON.stringify(normalizeTrace(expected))) throw new Error('The on-chain trace differs from the model package. Transactions remain disabled.');
}
export function verifyActionReceipt(receipt,pending,parseLog) {
  if (!same(receipt.hash,pending.hash)) throw new Error('Receipt hash differs from the saved transaction.');
  if (Number(receipt.status)!==1) throw new Error('The transaction reverted. Network gas may have been spent.');
  const e = pending.expected;
  if (!same(receipt.from,pending.wallet)) throw new Error('Receipt sender differs from the saved wallet.');
  if (pending.type==='Deploy model') {
    if (receipt.to != null || !same(receipt.contractAddress,e.address)) throw new Error('Deployment receipt created an unexpected address.');
    return true;
  }
  if (!same(receipt.to,pending.type.startsWith('Approval')?TOKEN_ADDRESS:e.address)) throw new Error('Receipt targets an unexpected contract.');
  const logs = receipt.logs.filter(l=>same(l.address,e.address)).map(l=>{try{return parseLog(l)}catch{return null}}).filter(Boolean);
  if (pending.type==='Record prediction') {
    const events=logs.filter(l=>l.name==='Inference');
    if(events.length!==1) throw new Error('Expected exactly one model Inference event.');
    const a=events[0].args;
    if(!same(a.payer,pending.wallet)||!same(a.modelId,e.modelId)||Number(a.classId)!==e.classId||!same(a.inputHash,e.inputHash)||!same(a.traceHash,e.traceHash)||BigInt(a.fee)!==BigInt(e.fee)) throw new Error('Inference receipt differs from the approved prediction.');
  } else if(pending.type==='Withdraw credits') {
    const events=logs.filter(l=>l.name==='Withdrawal');
    if(events.length!==1||!same(events[0].args.beneficiary,pending.wallet)||BigInt(events[0].args.amount)!==BigInt(e.amount)) throw new Error('Withdrawal receipt differs from the requested credit.');
  } else if(pending.type.startsWith('Approval')) {
    const events=receipt.logs.filter(l=>same(l.address,TOKEN_ADDRESS)).map(l=>{try{return parseLog(l)}catch{return null}}).filter(l=>l?.name==='Approval');
    if(events.length!==1||!same(events[0].args.owner,pending.wallet)||!same(events[0].args.spender,e.address)||BigInt(events[0].args.value)!==BigInt(e.amount)) throw new Error('Approval receipt differs from the exact allowance request.');
  }
  return true;
}
export function readableError(error) {
  if(error?.code===4001||error?.code==='ACTION_REJECTED') return 'Request declined in your wallet. No further action was sent.';
  if(error?.code==='INSUFFICIENT_FUNDS') return 'Your wallet needs ETH for network gas and GH0ST for any model fee.';
  if(error?.code==='TRANSACTION_REPLACED') return 'The transaction was replaced. Check the saved transaction before sending again.';
  return String(error?.shortMessage||error?.reason||error?.message||'The request could not be completed.').slice(0,350);
}
export function downloadFile(filename,text,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
