
export function getAddressFromNumber(n: number): string {
  // If you think this is weird and hacky to get an address, you're right.
  let zeroAddress = '0000000000000000000000000000000000000000';
  let numberHex = n.toString(16);
  let address = `${zeroAddress}${numberHex}`.slice(-40);

  return '0x' + address;
}

export type AddressLike = string | { address: string };

export function resolveAddress(v: AddressLike): string {
  return typeof(v) === 'string' ? v : v.address;
}
