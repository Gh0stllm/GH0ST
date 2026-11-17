import{quantity}from'./core.mjs';
export function observeBlock(previous,block){
 if(!block||!/^0x[0-9a-f]{64}$/i.test(block.hash)||!Array.isArray(block.transactions))throw Error('Invalid observed GL3 header');
 const current={number:quantity(block.number),hash:block.hash.toLowerCase(),timestamp:quantity(block.timestamp)};
 if(!previous)return{current,kind:'baseline',advance:0n,gap:0n,elapsedSeconds:0,pulseSeconds:0};
 if(current.number===previous.number&&current.hash===previous.hash)return{current,kind:'unchanged',advance:0n,gap:0n,elapsedSeconds:0,pulseSeconds:0};
 if(current.number<=previous.number||current.timestamp<previous.timestamp)return{current,kind:'reset',advance:0n,gap:0n,elapsedSeconds:0,pulseSeconds:0};
 const advance=current.number-previous.number,dt=current.timestamp-previous.timestamp;
 const mean=dt>0n&&advance<1000000n?Number(dt)/Number(advance):null;
 return{current,kind:'advance',advance,gap:advance-1n,elapsedSeconds:Number(dt),meanSeconds:mean,pulseSeconds:Math.min(1.5,Math.max(.65,mean??1))};
}
