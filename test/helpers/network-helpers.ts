import hre from 'hardhat';
import { ethers } from 'hardhat';

interface EthersBigNumberLike {
  toHexString(): string;
}

interface BNLike {
  toNumber(): number;
  toString(base?: number): string;
}

export type NumberLike =
  | number
  | bigint
  | string
  | EthersBigNumberLike
  | BNLike;

/**
 * Sets the balance for the given address.
 *
 * @param address The address whose balance will be edited.
 * @param balance The new balance to set for the given address, in wei.
 */
export async function setBalance(
  address: string,
  balance: NumberLike
): Promise<void> {
  if (!ethers.utils.isAddress(address)) {
    throw new Error(`${address} is not a valid address`);
  }

  let balanceHex: string;
  if (typeof balance === 'bigint' || typeof balance === 'number') {
    balanceHex = `0x${balance.toString(16)}`;
  } else if (typeof balance === 'string') {
    if (!balance.startsWith('0x')) {
      balanceHex = `0x${BigInt(balance).toString(16)}`;
    } else {
      balanceHex = balance;
    }
  } else {
    // This should never happen with the current type signature, but handle it gracefully
    balanceHex = `0x${String(balance)}`;
  }

  // Normalize hex string (remove leading zeros)
  if (balanceHex === '0x0') {
    balanceHex = '0x0';
  } else {
    balanceHex = balanceHex.replace(/^0x0+/, '0x') || '0x0';
  }

  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [address, balanceHex],
  });
}

/**
 * Allows Hardhat Network to sign transactions as the given address
 *
 * @param address The address to impersonate
 */
export async function impersonateAccount(address: string): Promise<void> {
  if (!ethers.utils.isAddress(address)) {
    throw new Error(`${address} is not a valid address`);
  }

  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  });
}

