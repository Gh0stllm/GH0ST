export const roles={analyst:'Leads with the measured evidence for each contract.',sentinel:'Highlights risk signals and gaps in the available evidence.',guide:'Explains what the saved checks mean in everyday language.'};
export const toolNames={checks:'Contract checks',deployer:'Deployer history',coverage:'Test coverage'};
export function buildConfig(name,personality,addressText,tools,cap) {
  name=name.trim();
  if(!name || new TextEncoder().encode(name).length>40 || /[\u0000-\u001f\u007f-\u009f]/.test(name))throw Error('Use a name of 1 to 40 UTF-8 bytes without control characters.');
  if(!Object.hasOwn(roles,personality))throw Error('Select a personality.');
  const addresses=addressText.trim().split(/\s+/).map(s=>s.toLowerCase());
  if(addresses.length>4 || !addresses.every(a=>/^0x[\da-f]{40}$/.test(a)&&!/^0x0{40}$/.test(a)))throw Error('Enter one to four valid Robinhood mainnet contract addresses.');
  if(new Set(addresses).size!==addresses.length)throw Error('Each watched contract must be different.');
  if(!tools.length||tools.length>3||!tools.every(t=>Object.hasOwn(toolNames,t))||new Set(tools).size!==tools.length)throw Error('Enable at least one supported read-only tool.');
  if(!/^\d+$/.test(cap) || !Number.isSafeInteger(Number(cap)) || Number(cap)>1000000)throw Error('Enter a daily cap from 0 to 1,000,000 whole GH0ST.');
  return {name,personality,addresses,tools,daily_cap:Number(cap)};
}
