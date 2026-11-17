import * as fs from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {check} from './policy.mjs';
const enc=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():v,2)+'\n';
function privatePath(p,type){const s=fs.lstatSync(p);check(!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o077)===0&&s[type](),'Private journal permissions/ownership differ.');check(fs.realpathSync(p)===p,'Journal parent symlinks are forbidden.');}
export class Journal {
 constructor(directory,planSHA256){
  check(directory.startsWith('/')&&resolve(directory)===directory);privatePath(directory,'isDirectory');
  this.root=directory;this.path=join(directory,'child-setup-journal.json');this.lock=join(directory,'child-setup.lock');
  this.lockFd=fs.openSync(this.lock,'wx',0o600);fs.writeFileSync(this.lockFd,enc({pid:process.pid,planSHA256,createdUTC:new Date().toISOString()}));fs.fsyncSync(this.lockFd);
  try{if(fs.existsSync(this.path)){privatePath(this.path,'isFile');this.value=JSON.parse(fs.readFileSync(this.path));check(this.value.schema==='gh0st.gl3.child-setup.journal.v1'&&this.value.planSHA256===planSHA256&&Array.isArray(this.value.entries),'Journal belongs to a different review.');}else{this.value={schema:'gh0st.gl3.child-setup.journal.v1',planSHA256,entries:[],quote:null};this.save();}}catch(e){this.close();throw e;}
 }
 save(){
  privatePath(this.root,'isDirectory');const temp=join(this.root,'.journal-'+randomBytes(12).toString('hex'));
  const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,enc(this.value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,this.path);const d=fs.openSync(dirname(this.path),'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
 }
 setQuote(q){this.value.quote=q;this.save();}
 intent(entry){check(!this.value.entries.some(x=>x.state!=='confirmed'),'An earlier broadcast needs reconciliation.');check(entry.index===this.value.entries.length);this.value.entries.push({...entry,state:'intent'});this.value.quote=null;this.save();}
 update(index,patch){check(this.value.entries[index]);Object.assign(this.value.entries[index],patch);this.save();}
 close(){if(this.lockFd!=null){fs.closeSync(this.lockFd);this.lockFd=null;fs.unlinkSync(this.lock);}}
}
