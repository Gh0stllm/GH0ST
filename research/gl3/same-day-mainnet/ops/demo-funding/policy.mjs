export const OWNER='0x8D6B11CFdF079e27C17e05Cb7Ea81235887691c6';
export const DEMO='0xe03f5f1392072f93795f95f778161ba989e7c32c';
export const GENESIS='0x17b5e6ba05003525c4f3c766d6b3120d88ee87dc7eeba84932027f8917da3483';
export const VALUE=100000n*10n**18n;
const check=(v,m)=>{if(!v)throw Error(m);};
export function validatePlan(p,now=Date.now()){
 check(p?.schema==='gh0st.gl3.demo-funding.v1'&&p.chainId===4663001&&p.genesis===GENESIS,'Unreviewed chain');
 check(p.from===OWNER&&p.to===DEMO&&p.value===VALUE.toString(),'Unreviewed funding recipient or amount');
 check(Number.isSafeInteger(p.nonce)&&p.nonce>=0&&p.expiresAt>now&&p.expiresAt<=now+3*3600000,'Invalid nonce or expired review');
 return p;
}
export function unsigned(p,q,planSHA,now=Date.now()){
 validatePlan(p,now);check(q.planSHA===planSHA&&q.expiresAt>now&&q.expiresAt<=now+65000,'Stale or changed quote');
 check(q.nonce===p.nonce,'Nonce changed');
 const gasLimit=BigInt(q.gasLimit),gasPrice=BigInt(q.gasPrice),observedPrice=BigInt(q.observedPrice);
 check(gasLimit>=21000n&&gasLimit<=16777216n&&observedPrice>0n&&gasPrice>=observedPrice&&gasPrice<=observedPrice*2n,'Unreviewed gas quote');
 return {type:0,chainId:4663001n,to:DEMO,value:VALUE,nonce:p.nonce,data:'0x',gasLimit,gasPrice};
}
export function validateSigned(tx,p,q,planSHA,now=Date.now()){
 const expected=unsigned(p,q,planSHA,now);
 check(tx.from?.toLowerCase()===OWNER.toLowerCase()&&tx.signature,'Unexpected signer');
 for(const k of ['type','chainId','to','value','nonce','data','gasLimit','gasPrice'])check(typeof expected[k]==='bigint'?BigInt(tx[k])===expected[k]:k==='to'?String(tx[k]).toLowerCase()===expected[k].toLowerCase():tx[k]===expected[k],'Signed transfer differs: '+k);
 check(tx.accessList==null&&tx.authorizationList==null&&tx.blobs==null&&tx.maxFeePerGas==null&&tx.maxPriorityFeePerGas==null,'Unexpected transaction fields');
 return expected;
}
