import { ethers, save } from './lib.mjs';
export const botMoveTypes={BotMove:[{name:'gameId',type:'bytes32'},{name:'player',type:'address'},{name:'ply',type:'uint32'},{name:'positionHash',type:'bytes32'},{name:'transcriptHash',type:'bytes32'},{name:'encodedMove',type:'uint16'},{name:'engineConfigHash',type:'bytes32'},{name:'validUntil',type:'uint64'}]};
export const botMoveDomain=(chainId,verifyingContract)=>({name:'GH0ST Hybrid Chess',version:'1',chainId,verifyingContract});
const signer=new ethers.Wallet('0x'+'11'.repeat(32));
const abi=ethers.AbiCoder.defaultAbiCoder();
const board0=BigInt('0xcabedbac99999999000000000000000000000000000000001111111142365324');
const board=(board0&~(15n<<48n))|(1n<<112n); // e2e4
const initialTranscript=ethers.id('GH0ST_CHESS_INITIAL_V1');
const domain=botMoveDomain(4663,'0x1111111111111111111111111111111111111111');
const message={gameId:ethers.id('TEST ONLY GAME ID'),player:'0x70997970C51812dc3A010C7d01b50e0d17dc79C8',ply:1,positionHash:ethers.keccak256(abi.encode(['uint256','uint8','uint8','bool'],[board,15,20,true])),transcriptHash:ethers.keccak256(abi.encode(['bytes32','uint16'],[initialTranscript,(12<<6)|28])),encodedMove:(52<<6)|36,engineConfigHash:ethers.id('TEST ONLY RETAINED STOCKFISH CONFIG'),validUntil:2_000_000_000};
const digest=ethers.TypedDataEncoder.hash(domain,botMoveTypes,message);
const signature=await signer.signTypedData(domain,botMoveTypes,message);
save('evm/hybrid-botmove-vector.json',{testOnly:true,note:'Synthetic chain4663 typed-data interoperability fixture; no public deployment or approved move.',domain,types:botMoveTypes,message,signer:signer.address,digest,signature,encodedMove:'e7e5'});
console.log(digest);
