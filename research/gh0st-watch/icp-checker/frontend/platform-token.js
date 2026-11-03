const GH0ST_MAINNET = '0x2eb2849cde7957b86d0dfd4b59e450a9f9d15559';

export function isPlatformToken(network, address) {
  return network === 'mainnet' && typeof address === 'string' && address.toLowerCase() === GH0ST_MAINNET;
}
