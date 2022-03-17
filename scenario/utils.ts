import { expect } from 'chai';
import { BigNumber } from 'ethers';

export function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export function expectApproximately(expected: bigint, actual: bigint, precision: bigint = 0n) {
  expect(BigNumber.from(abs(expected - actual))).to.be.lte(BigNumber.from(precision));
}
