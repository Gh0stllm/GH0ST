// Independent ethers interoperability vector; all signing keys are public synthetic test fixtures.
import fs from 'node:fs';
import {Interface,Transaction,SigningKey,verifyTypedData} from 'ethers';
const raw=JSON.parse(fs.readFileSync(new URL('../../hybrid-brain/evidence/end-to-end.json',import.meta.url)));
const s=raw.signed_move, m=s.move;
const move={gameId:m.game_id,player:m.player,ply:m.ply,positionHash:m.position_hash,transcriptHash:m.transcript_hash,encodedMove:m.encoded_move,engineConfigHash:m.engine_config_hash,validUntil:m.valid_until};
const contract=raw.local_evm_deployment.contract;
const types={BotMove:[{name:'gameId',type:'bytes32'},{name:'player',type:'address'},{name:'ply',type:'uint32'},{name:'positionHash',type:'bytes32'},{name:'transcriptHash',type:'bytes32'},{name:'encodedMove',type:'uint16'},{name:'engineConfigHash',type:'bytes32'},{name:'validUntil',type:'uint64'}]};
const attestor=verifyTypedData({name:'GH0ST Hybrid Chess',version:'1',chainId:4663,verifyingContract:contract},types,move,s.signature);
const abi=new Interface(['function playBotMove((bytes32 gameId,address player,uint32 ply,bytes32 positionHash,bytes32 transcriptHash,uint16 encodedMove,bytes32 engineConfigHash,uint64 validUntil),bytes)']);
const data=abi.encodeFunctionData('playBotMove',[move,s.signature]);
const key=new SigningKey('0x'+'22'.repeat(32));
const tx=Transaction.from({type:2,chainId:4663,nonce:17,maxFeePerGas:40_000_000,maxPriorityFeePerGas:0,gasLimit:2_000_000,to:contract,value:0,data});
const unsigned=tx.unsignedSerialized,hash=tx.unsignedHash;tx.signature=key.sign(hash);
const v={scope:'Independent ethers EIP1559/ABI fixture using frozen genuine local Stockfish24m signed move; no mainnet signing',botAttestor:attestor,contract,signedMove:s,calldata:data,transaction:{nonce:17,maxPriorityFeePerGas:0,maxFeePerGas:40_000_000,gasLimit:2_000_000},unsignedPayload:unsigned,signingHash:hash,signature:tx.signature.serialized,serialized:tx.serialized,hash:tx.hash,from:tx.from};
fs.writeFileSync(new URL('../tests/transaction-vector.json',import.meta.url),JSON.stringify(v,null,2)+'\n');
console.log(JSON.stringify({scope:v.scope,signingHash:hash,hash:tx.hash,from:tx.from}));
