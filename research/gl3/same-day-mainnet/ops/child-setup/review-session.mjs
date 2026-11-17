// Private resume metadata only. No keys/passwords, arbitrary origins or expiry extension.
import * as fs from 'node:fs';
import {resolve,sep} from 'node:path';
import {check} from './policy.mjs';
export const SESSION_SCHEMA='gh0st.gl3.child-review.resume-session.v1';
export function validateResumeSession(s,planSHA256,now=Date.now()){
 check(s&&typeof s==='object'&&!Array.isArray(s)&&JSON.stringify(Object.keys(s).sort())===JSON.stringify(['schema','planSHA256','port','prefix','expiresAt'].sort()),'Invalid resume session fields.');
 check(s.schema===SESSION_SCHEMA&&/^[a-f0-9]{64}$/.test(planSHA256)&&s.planSHA256===planSHA256,'Resume session plan differs.');
 check(Number.isInteger(s.port)&&s.port>=1024&&s.port<=65535,'Invalid local resume port.');
 check(typeof s.prefix==='string'&&/^\/[a-f0-9]{48}\/$/.test(s.prefix),'Invalid local resume path.');
 check(Number.isSafeInteger(s.expiresAt)&&Number.isSafeInteger(now)&&s.expiresAt>now&&s.expiresAt-now<=2*60*60*1000,'Resume session expired or extends the review deadline.');
 return Object.freeze({...s});
}
export function loadResumeSession(file,planSHA256,reviewRoot,now=Date.now()){
 check(typeof file==='string'&&file.startsWith('/')&&resolve(file)===file&&file.startsWith(reviewRoot+sep),'Resume file must be a canonical private review path.');
 check(fs.realpathSync(file)===file,'Resume session symlinks are forbidden.');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const st=fs.fstatSync(fd);check(st.isFile()&&st.uid===process.getuid()&&(st.mode&0o777)===0o600&&st.nlink===1&&st.size>0&&st.size<=4096,'Resume session file permissions/ownership differ.');return validateResumeSession(JSON.parse(fs.readFileSync(fd,'utf8')),planSHA256,now);}finally{fs.closeSync(fd);}
}
export function createStartupBindingGate(run){
 // Attach rejection handler immediately: failed RPC checks never cause an unhandled
 // crash or leak credential-bearing error text. No financial route passes on failure.
 const result=Promise.resolve().then(run).then(()=>true,()=>false);
 return {wait:async()=>{check(await result,'Live startup binding verification failed. No signature or broadcast was accepted.');return true;}};
}
