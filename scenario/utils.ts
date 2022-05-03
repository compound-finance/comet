import { expect } from 'chai';
import { BigNumber, BigNumberish } from 'ethers';
import { CometContext } from './context/CometContext';
import CometAsset from './context/CometAsset';
import { ProtocolConfiguration, deployComet } from '../src/deploy';
import { GovernorSimple } from '../build/types';
import { World } from '../plugins/scenario';
import { exp } from '../test/helpers';

export function abs(x: bigint): bigint {
  return x < 0n ? -x : x;
}

export const max = (...args) => args.reduce((m, e) => e > m ? e : m);
export const min = (...args) => args.reduce((m, e) => e < m ? e : m);

export function expectApproximately(expected: bigint, actual: bigint, precision: bigint = 0n) {
  expect(BigNumber.from(abs(expected - actual))).to.be.lte(BigNumber.from(precision));
}

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

export function scaleToDecimals(scale: BigNumberish): number {
  return scale.toString().split('0').length - 1; // # of 0's in scale
}

// Instantly executes some actions through the governance proposal process
// Note: `governor` must be connected to an `admin` signer
export async function fastGovernanceExecute(governor: GovernorSimple, targets: string[], values: BigNumberish[], signatures: string[], calldatas: string[]) {
  let tx = await (await governor.propose(targets, values, signatures, calldatas, 'FastExecuteProposal')).wait();
  let event = tx.events.find(event => event.event === 'ProposalCreated');
  let [ proposalId ] = event.args;

  await governor.queue(proposalId);
  await governor.execute(proposalId);
}

export async function upgradeComet(world: World, context: CometContext, configOverrides: ProtocolConfiguration): Promise<CometContext> {
  console.log('Upgrading to modern...');
  // TODO: Make this deployment script less ridiculous, e.g. since it redeploys tokens right now
  let oldComet = await context.getComet();
  let timelock = await context.getTimelock();
  let cometConfig = { governor: timelock.address, ...configOverrides } // Use old timelock as governor
  let { comet: newComet } = await deployComet(
    context.deploymentManager,
    false,
    cometConfig
  );
  let initializer: string | undefined;
  if (!oldComet.totalsBasic || (await oldComet.totalsBasic()).lastAccrualTime === 0) {
    initializer = (await newComet.populateTransaction.initializeStorage()).data;
  }

  await context.upgradeTo(newComet, world, initializer);
  await context.setAssets();
  await context.spider();

  console.log('Upgraded to modern...');

  return context
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
      throw new Error(`Bad amount: ${amount}`);
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
        [ComparisonOp.GTE]: />=\s*(\d+)/,
        [ComparisonOp.GT]: />\s*(\d+)/,
        [ComparisonOp.LTE]: /<=\s*(\d+)/,
        [ComparisonOp.LT]: /<\s*(\d+)/,
        [ComparisonOp.EQ]: /==\s*(\d+)/,
      });
    case 'object':
      return amount;
    default:
      throw new Error(`Unrecognized amount: ${amount}`);
  }
}

function matchGroup(str, patterns): ComparativeAmount {
  for (const k in patterns) {
    const match = patterns[k].exec(str);
    if (match) return { val: match[1], op: ComparisonOp[k] };
  }
  throw new Error(`No match for ${str} in ${patterns}`);
}
