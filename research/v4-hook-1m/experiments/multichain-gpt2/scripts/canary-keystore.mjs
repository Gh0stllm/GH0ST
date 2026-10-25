// Local encrypted signer setup only. No provider, signing or broadcast is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {StringDecoder} from 'node:string_decoder';
import {Wallet,getAddress} from 'ethers';
import {HERE} from './build.mjs';
import {parseCanaryArgs} from './canary-plan.mjs';
import {validAddress,equal,checkedOutput} from './canary-runtime.mjs';

export const DEFAULT_CANARY_KEYSTORE=path.join(HERE,'deployments/canary-signer.json');
export const CANARY_KEYSTORE_ERRORS=Object.freeze({
  KEYSTORE_CONFIG_INVALID:'Configured public admin or setup options are invalid.',
  KEYSTORE_PATH_INVALID:'Keystore path must be an ignored deployments JSON file without symlinks.',
  KEYSTORE_TTY_REQUIRED:'A private interactive terminal is required.',
  KEYSTORE_INPUT_CANCELED:'Private terminal input canceled.',
  KEYSTORE_INPUT_FAILED:'Private terminal input failed. Invalid prompt or terminal problem.',
  KEYSTORE_INPUT_TOO_LONG:'Private input is too long.',
  KEYSTORE_INVALID_KEY_ENCODING:'Invalid private-key encoding. Enter the wallet private key as 64 hexadecimal characters, with optional 0x prefix.',
  KEYSTORE_INVALID_KEY:'Invalid private key. The entered value is not a usable wallet key.',
  KEYSTORE_ADDRESS_MISMATCH:'Wallet does not match configured admin. No encrypted file was created.',
  KEYSTORE_PASSWORD_TOO_SHORT:'Use a password of at least 12 characters.',
  KEYSTORE_PASSWORD_INVALID:'Password is invalid or too long.',
  KEYSTORE_PASSWORD_MISMATCH:'Passwords differ.',
  KEYSTORE_ENCRYPTION_FAILED:'Keystore encryption failed. No encrypted file was created.',
  KEYSTORE_WRITE_FAILED:'Unable to save new encrypted keystore. Check local storage permissions and available space.',
  KEYSTORE_EXISTS:'Refusing to overwrite an existing keystore.',
  KEYSTORE_FILE_INVALID:'Plaintext secrets or an invalid encrypted keystore were found.',
  KEYSTORE_PERMISSIONS:'Keystore permissions must be 0600.',
  KEYSTORE_UNLOCK_FAILED:'Unable to unlock encrypted keystore. Check the password.',
});
export class CanaryKeystoreError extends Error{constructor(code){super(CANARY_KEYSTORE_ERRORS[code]??CANARY_KEYSTORE_ERRORS.KEYSTORE_CONFIG_INVALID);this.name='CanaryKeystoreError';this.code=Object.hasOwn(CANARY_KEYSTORE_ERRORS,code)?code:'KEYSTORE_CONFIG_INVALID';}}
const requireSafe=(condition,code)=>{if(!condition)throw new CanaryKeystoreError(code);};
const safeFailure=(error,code)=>error instanceof CanaryKeystoreError?error:new CanaryKeystoreError(code);
export function canaryKeystorePath(input=DEFAULT_CANARY_KEYSTORE){
  try{
  const file=checkedOutput(input),relative=path.relative(HERE,file);
  requireSafe(relative.startsWith('deployments'+path.sep)&&file.endsWith('.json'),'KEYSTORE_PATH_INVALID');
  let current=HERE;for(const part of relative.split(path.sep)){current=path.join(current,part);if(fs.existsSync(current))requireSafe(!fs.lstatSync(current).isSymbolicLink(),'KEYSTORE_PATH_INVALID');}
  return file;
  }catch(error){throw safeFailure(error,'KEYSTORE_PATH_INVALID');}
}
function expectedAdmin(configFile){try{const c=JSON.parse(fs.readFileSync(checkedOutput(configFile),'utf8'));requireSafe(validAddress(c.admin),'KEYSTORE_CONFIG_INVALID');return getAddress(c.admin);}catch(error){throw safeFailure(error,'KEYSTORE_CONFIG_INVALID');}}

// Direct TTY input bypasses shell/readline history. Characters, including masks,
// are never echoed. Only prompts and a final newline are written.
export async function readHidden(prompt,{input=process.stdin,output=process.stderr}={}){
  requireSafe(input.isTTY===true&&output.isTTY===true&&typeof input.setRawMode==='function','KEYSTORE_TTY_REQUIRED');
  requireSafe(typeof prompt==='string'&&!/[\r\n]/.test(prompt),'KEYSTORE_INPUT_FAILED');
  const wasRaw=Boolean(input.isRaw),wasPaused=input.isPaused(),decoder=new StringDecoder('utf8');
  return new Promise((resolve,reject)=>{let chars=[],done=false,escape=false;
    const clean=()=>{input.removeListener('data',onData);input.removeListener('error',onError);input.removeListener('end',onEnd);process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);try{input.setRawMode(wasRaw);}catch{}if(wasPaused)input.pause();output.write('\n');};
    const finish=(error)=>{if(done)return;done=true;const value=error?null:chars.join('');chars.fill('');chars=[];clean();if(error)reject(error);else resolve(value);};
    const onError=()=>finish(new CanaryKeystoreError('KEYSTORE_INPUT_FAILED'));
    const onEnd=()=>finish(new CanaryKeystoreError('KEYSTORE_INPUT_FAILED'));
    const onSignal=()=>finish(new CanaryKeystoreError('KEYSTORE_INPUT_CANCELED'));
    const onData=chunk=>{for(const ch of decoder.write(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk))){if(done)break;
      if(ch==='\u0003'||ch==='\u0004'){finish(new CanaryKeystoreError('KEYSTORE_INPUT_CANCELED'));break;}
      // A stray Enter (including the LF half of pasted CRLF) must not become
      // an empty password at the next prompt.
      if(ch==='\r'||ch==='\n'){if(chars.length===0)continue;finish();break;}
      if(ch==='\u001b'){escape=true;continue;}if(escape){if(/[A-Za-z~]/.test(ch))escape=false;continue;}
      if(ch==='\u007f'||ch==='\b'){chars.pop();continue;}if(ch==='\u0015'){chars.fill('');chars=[];continue;}
      if(ch.codePointAt(0)<32)continue;chars.push(ch);if(chars.length>4096){finish(new CanaryKeystoreError('KEYSTORE_INPUT_TOO_LONG'));break;}
    }};
    input.on('data',onData);input.on('error',onError);input.on('end',onEnd);process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
    try{input.setRawMode(true);output.write(prompt);input.resume();}catch{finish(new CanaryKeystoreError('KEYSTORE_INPUT_FAILED'));}
  });
}
function checkPassword(password){requireSafe(typeof password==='string','KEYSTORE_PASSWORD_INVALID');requireSafe(password.length>=12,'KEYSTORE_PASSWORD_TOO_SHORT');requireSafe(password.length<=4096&&!/[\r\n\0]/.test(password),'KEYSTORE_PASSWORD_INVALID');}
export function validateCanaryPrivateKey(privateKey,expectedAddress){
  requireSafe(validAddress(expectedAddress),'KEYSTORE_CONFIG_INVALID');
  requireSafe(typeof privateKey==='string'&&/^(?:0x)?[0-9a-fA-F]{64}$/.test(privateKey),'KEYSTORE_INVALID_KEY_ENCODING');
  let wallet;try{wallet=new Wallet(privateKey.startsWith('0x')?privateKey:'0x'+privateKey);}catch{throw new CanaryKeystoreError('KEYSTORE_INVALID_KEY');}
  requireSafe(equal(wallet.address,expectedAddress),'KEYSTORE_ADDRESS_MISMATCH');return wallet;
}
function readEncrypted(file){
  try{file=canaryKeystorePath(file);const info=fs.lstatSync(file);requireSafe(info.isFile()&&info.size>0&&info.size<=1024*1024,'KEYSTORE_FILE_INVALID');
  requireSafe((info.mode&0o777)===0o600,'KEYSTORE_PERMISSIONS');const text=fs.readFileSync(file,'utf8'),data=JSON.parse(text),crypto=data.Crypto??data.crypto;
  requireSafe(data.version===3&&crypto&&typeof crypto.ciphertext==='string'&&/^[0-9a-fA-F]{64}$/.test(crypto.ciphertext),'KEYSTORE_FILE_INVALID');
  for(const field of ['privateKey','private_key','password','mnemonic'])requireSafe(!Object.hasOwn(data,field),'KEYSTORE_FILE_INVALID');
  return text;
  }catch(error){throw safeFailure(error,'KEYSTORE_FILE_INVALID');}
}
export async function createCanaryKeystore({keystoreFile=DEFAULT_CANARY_KEYSTORE,privateKey,password,expectedAddress}){
  const file=canaryKeystorePath(keystoreFile);requireSafe(!fs.existsSync(file),'KEYSTORE_EXISTS');
  const wallet=validateCanaryPrivateKey(privateKey,expectedAddress);checkPassword(password);
  let encrypted;try{encrypted=await wallet.encrypt(password);}catch{throw new CanaryKeystoreError('KEYSTORE_ENCRYPTION_FAILED');}
  try{fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});canaryKeystorePath(file);}catch(error){throw safeFailure(error,'KEYSTORE_WRITE_FAILED');}
  let fd,created=false;try{fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);created=true;fs.writeFileSync(fd,encrypted+'\n');fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);}catch{if(created)try{fs.unlinkSync(file);}catch{}throw new CanaryKeystoreError('KEYSTORE_WRITE_FAILED');}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{throw new CanaryKeystoreError('KEYSTORE_WRITE_FAILED');}}
  return {keystoreFile:file,address:wallet.address};
}
export async function unlockCanaryKeystore({keystoreFile=DEFAULT_CANARY_KEYSTORE,password,expectedAddress}){
  requireSafe(validAddress(expectedAddress),'KEYSTORE_CONFIG_INVALID');requireSafe(typeof password==='string'&&password.length>0&&password.length<=4096,'KEYSTORE_PASSWORD_INVALID');
  const encrypted=readEncrypted(keystoreFile);let wallet;try{wallet=await Wallet.fromEncryptedJson(encrypted,password);}catch{throw new CanaryKeystoreError('KEYSTORE_UNLOCK_FAILED');}
  requireSafe(equal(wallet.address,expectedAddress),'KEYSTORE_ADDRESS_MISMATCH');return wallet;
}
export async function loadCanarySigner({configFile,keystoreFile=DEFAULT_CANARY_KEYSTORE,prompt=readHidden}){
  const expectedAddress=expectedAdmin(configFile);readEncrypted(keystoreFile);let password;
  try{password=await prompt('Keystore password (hidden): ');return await unlockCanaryKeystore({keystoreFile,password,expectedAddress});}finally{password=null;}
}
export async function run(args,{prompt=readHidden}={}){
  if(args.length===1&&args[0]==='--help'){console.log('canary-keystore --config=deployments/canary/manifest.json [--keystore=deployments/canary-signer.json]\nInteractive hidden TTY input only. Saves an encrypted 0600 keystore, verifies the configured admin, and never signs or broadcasts. Existing keystores are verified without replacement.');return;}
  let o;try{o=parseCanaryArgs(args,['config','keystore']);requireSafe(o.config,'KEYSTORE_CONFIG_INVALID');}catch(error){throw safeFailure(error,'KEYSTORE_CONFIG_INVALID');}const expectedAddress=expectedAdmin(o.config),file=canaryKeystorePath(o.keystore);
  if(fs.existsSync(file)){await loadCanarySigner({configFile:o.config,keystoreFile:file,prompt});console.log('Existing encrypted keystore unlocked and wallet address verified. No transaction signed.');return;}
  let privateKey,password,confirmation;
  try{
    privateKey=(await prompt('Private key (hidden): ')).trim();
    const verified=validateCanaryPrivateKey(privateKey,expectedAddress);
    console.log('Verified wallet: '+verified.address);
    while(true){
      password=await prompt('New keystore password, at least 12 characters (hidden): ');
      requireSafe(typeof password==='string','KEYSTORE_INPUT_FAILED');
      try{checkPassword(password);}catch(error){
        if(['KEYSTORE_PASSWORD_TOO_SHORT','KEYSTORE_PASSWORD_INVALID'].includes(error.code)){
          console.log(CANARY_KEYSTORE_ERRORS[error.code]);password=null;continue;
        }throw error;
      }
      confirmation=await prompt('Confirm keystore password (hidden): ');
      requireSafe(typeof confirmation==='string','KEYSTORE_INPUT_FAILED');
      if(password!==confirmation){console.log(CANARY_KEYSTORE_ERRORS.KEYSTORE_PASSWORD_MISMATCH+' Try the new password again.');password=null;confirmation=null;continue;}
      break;
    }
    const result=await createCanaryKeystore({keystoreFile:file,privateKey,password,expectedAddress});
    console.log('Encrypted keystore saved with 0600 permissions. Verified wallet: '+result.address+'. No transaction signed.');
  }catch(error){throw safeFailure(error,'KEYSTORE_INPUT_FAILED');}
  finally{privateKey=null;password=null;confirmation=null;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))run(process.argv.slice(2)).catch(error=>{console.error((CANARY_KEYSTORE_ERRORS[error.code]??'Keystore setup stopped.')+' No transaction signed.');process.exitCode=1;});
