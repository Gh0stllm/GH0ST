import { compile } from './lib.mjs';
const artifacts = compile();
console.log(`Compiled ForgeModel: ${artifacts.ForgeModel.runtimeBytes} runtime bytes; runtime/artifacts.json ready.`);
