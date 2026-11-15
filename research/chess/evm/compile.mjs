import { compile } from './lib.mjs';
const artifacts = compile();
console.log(`Compiled RHChessChallengeVault: ${artifacts.RHChessChallengeVault.runtimeBytes} runtime bytes. Local artifacts and ABI written.`);
