import { expect } from 'chai';
import { ContractReceipt } from 'ethers';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { BigNumber, BigNumberish, utils, Contract, Event, EventFilter } from 'ethers';
import { CometContext } from './context/CometContext';
import CometAsset from './context/CometAsset';
import { exp } from '../test/helpers';

export const NUM_ASSETS = 15;

export interface ComparativeAmount {
  val: number,
  op: ComparisonOp,
}

export enum ComparisonOp {
  GTE,
  GT,
  LTE,
  LT,
  EQ
}

export const max = (...args) => args.reduce((m, e) => e > m ? e : m);
export const min = (...args) => args.reduce((m, e) => e < m ? e : m);

export function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export function expectApproximately(expected: bigint, actual: bigint, precision: bigint = 0n) {
  expect(BigNumber.from(abs(expected - actual))).to.be.lte(BigNumber.from(precision));
}

export function expectRevertMatches(tx: Promise<ContractReceipt>, patterns: RegExp | RegExp[]) {
  return tx
    .then(_ => { throw new Error('Expected transaction to be reverted') })
    .catch(e => {
      for (const pattern of [].concat(patterns))
        if (pattern.test(e.message))
          return;
      throw new Error(`Expected revert message in one of ${patterns}, but reverted with: ${e.message}`);
    });
}

export function requireString(o: object, key: string, err: string): string {
  let value: unknown = o[key];
  if (value === undefined) {
    throw new Error(err);
  }
  if (typeof value !== 'string') {
    throw new Error(`${err} [requirement ${key} required to be string type]`);
  }
  return value;
}

export function requireList<T>(o: object, key: string, err: string): T[] {
  let value: unknown = o[key];
  if (value === undefined) {
    throw new Error(err);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${err} [requirement ${key} required to be list type]`);
  }
  return value as T[];
}

export function requireNumber<T>(o: object, key: string, err: string): number {
  let value: unknown = o[key];
  if (value === undefined) {
    throw new Error(err);
  }
  if (typeof value !== 'number') {
    throw new Error(`${err} [requirement ${key} required to be number type]`);
  }
  return value;
}

export function optionalNumber<T>(o: object, key: string): number {
  let value: unknown = o[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number') {
    throw new Error(`[requirement ${key} required to be number type]`);
  }
  return value;
}

export function* subsets<T>(array: T[], offset = 0): Generator<T[]> {
  while (offset < array.length) {
    const first = array[offset++];
    for (const subset of subsets(array, offset)) {
      subset.push(first);
      yield subset;
    }
  }
  yield [];
}

export function getExpectedBaseBalance(balance: bigint, baseIndexScale: bigint, borrowOrSupplyIndex: bigint): bigint {
  const principalValue = balance * baseIndexScale / borrowOrSupplyIndex;
  const baseBalanceOf = principalValue * borrowOrSupplyIndex / baseIndexScale;
  return baseBalanceOf;
}

export function getInterest(balance: bigint, rate: bigint, seconds: bigint) {
  return balance * rate * seconds / (10n ** 18n);
}

export async function getActorAddressFromName(name: string, context: CometContext): Promise<string> {
  if (name.startsWith('$')) {
    const cometRegex = /comet/;
    let actorAddress: string;
    if (cometRegex.test(name)) {
      // If name matches regex, e.g. "$comet"
      actorAddress = (await context.getComet()).address;
    }
    return actorAddress;
  } else {
    return context.actors[name].address;
  }
}

export async function getAssetFromName(name: string, context: CometContext): Promise<CometAsset> {
  let comet = await context.getComet(); // TODO: can optimize by taking this as an arg instead
  if (name.startsWith('$')) {
    const collateralAssetRegex = /asset[0-9]+/;
    const baseAssetRegex = /base/;
    let asset: string;
    if (collateralAssetRegex.test(name)) {
      // If name matches regex, e.g. "$asset10"
      const assetIndex = name.match(/[0-9]+/g)[0];
      ({ asset } = await comet.getAssetInfo(assetIndex));
    } else if (baseAssetRegex.test(name)) {
      // If name matches "base"
      asset = await comet.baseToken();
    }
    return context.getAssetByAddress(asset);
  } else {
    // If name doesn't match regex, try to find the asset directly from the assets list
    return context.assets[name];
  }
}

// Returns the amount that needs to be transferred to satisfy a constraint
export function getToTransferAmount(amount: ComparativeAmount, existingBalance: bigint, decimals: number): bigint {
  let toTransfer = 0n;
  switch (amount.op) {
    case ComparisonOp.EQ:
      toTransfer = exp(amount.val, decimals) - existingBalance;
      break;
    case ComparisonOp.GTE:
      // `toTransfer` should not be negative
      toTransfer = max(exp(amount.val, decimals) - existingBalance, 0);
      break;
    case ComparisonOp.LTE:
      // `toTransfer` should not be positive
      toTransfer = min(exp(amount.val, decimals) - existingBalance, 0);
      break;
    case ComparisonOp.GT:
      toTransfer = exp(amount.val, decimals) - existingBalance + 1n;
      break;
    case ComparisonOp.LT:
      toTransfer = exp(amount.val, decimals) - existingBalance - 1n;
      break;
    default:
      throw new Error(`Bad amount: ${JSON.stringify(amount)}`);
  }
  return toTransfer;
}

// `amount` should be the unit amount of an asset instead of the gwei amount
export function parseAmount(amount): ComparativeAmount {
  switch (typeof amount) {
    case 'bigint':
      return amount >= 0n ? { val: Number(amount), op: ComparisonOp.GTE } : { val: Number(amount), op: ComparisonOp.LTE };
    case 'number':
      return amount >= 0 ? { val: amount, op: ComparisonOp.GTE } : { val: amount, op: ComparisonOp.LTE };
    case 'string':
      return matchGroup(amount, {
        'GTE': />=\s*(\d+)/,
        'GT': />\s*(\d+)/,
        'LTE': /<=\s*(\d+)/,
        'LT': /<\s*(\d+)/,
        'EQ': /==\s*(\d+)/,
      });
    case 'object':
      return amount;
    default:
      throw new Error(`Unrecognized amount: ${JSON.stringify(amount)}`);
  }
}

function matchGroup(str, patterns): ComparativeAmount {
  for (const k in patterns) {
    const match = patterns[k].exec(str);
    if (match) return { val: match[1], op: ComparisonOp[k] };
  }
  throw new Error(`No match for ${str} in ${patterns}`);
}

export async function modifiedPaths(pattern: RegExp, against: string = 'origin/main'): Promise<string[]> {
  const output = execSync(`git diff --numstat $(git merge-base ${against} HEAD)`);
  const paths = output.toString().split('\n').map(l => l.split(/\s+/)[2]);
  const modified = paths.filter(p => pattern.test(p) && existsSync(p));
  return modified;
}

export async function fetchQuery(
  contract: Contract,
  filter: EventFilter,
  fromBlock: number,
  toBlock: number,
  originalBlock: number,
  MAX_SEARCH_BLOCKS = 40000,
  BLOCK_SPAN = 1000
): Promise<{ recentLogs?: Event[], blocksDelta?: number, err?: Error }> {
  if (originalBlock - fromBlock > MAX_SEARCH_BLOCKS) {
    return { err: new Error(`No events found within ${MAX_SEARCH_BLOCKS} blocks for ${contract.address}`) };
  }
  try {
    let res = await contract.queryFilter(filter, fromBlock, toBlock);
    if (res.length > 0) {
      return { recentLogs: res, blocksDelta: toBlock - fromBlock };
    } else {
      let nextToBlock = fromBlock;
      let nextFrom = fromBlock - BLOCK_SPAN;
      if (nextFrom < 0) {
        return { err: new Error('No events found by chain genesis') };
      }
      return await fetchQuery(contract, filter, nextFrom, nextToBlock, originalBlock);
    }
  } catch (err) {
    if (err.message.includes('query returned more')) {
      let midBlock = (fromBlock + toBlock) / 2;
      return await fetchQuery(contract, filter, midBlock, toBlock, originalBlock);
    } else {
      return { err };
    }
  }
}

export async function isValidAssetIndex(ctx: CometContext, assetNum: number): Promise<boolean> {
  const comet = await ctx.getComet();
  return assetNum < await comet.numAssets();
}

export async function isSourceable(ctx: CometContext, assetNum: number, amount: number): Promise<boolean> {
  const fauceteer = await ctx.getFauceteer();
  // If fauceteer does not exist (e.g. mainnet), then token is likely sourceable from events
  if (fauceteer == null) return true;

  const comet = await ctx.getComet();
  const assetInfo = await comet.getAssetInfo(assetNum);
  const asset = ctx.getAssetByAddress(assetInfo.asset);
  const amountInWei = BigInt(amount) * assetInfo.scale.toBigInt();
  // Fauceteer should have greater than the expected amount of the asset
  return await asset.balanceOf(fauceteer.address) > amountInWei;
}
