import { expect } from 'chai';
import { BigNumber, BigNumberish, utils } from 'ethers';
import { CometContext } from './context/CometContext';
import CometAsset from './context/CometAsset';
import { ProtocolConfiguration, deployComet } from '../src/deploy';
import { GovernorSimple } from '../build/types';
import { World } from '../plugins/scenario';
import { exp } from '../test/helpers';
import { AssetConfigStruct, AssetInfoStructOutput } from '../build/types/Comet';
import { CometInterface } from '../build/types';

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

export function getExpectedBaseBalance(balance: bigint, baseIndexScale: bigint, borrowOrSupplyIndex: bigint): bigint {
  const principalValue = balance * baseIndexScale / borrowOrSupplyIndex;
  const baseBalanceOf = principalValue * borrowOrSupplyIndex / baseIndexScale;
  return baseBalanceOf;
}

export function getInterest(balance: bigint, rate: bigint, seconds: bigint) {
  return balance * rate * seconds / (10n ** 18n);
}

// Instantly executes some actions through the governance proposal process
// Note: `governor` must be connected to an `admin` signer
export async function fastGovernanceExecute(governor: GovernorSimple, targets: string[], values: BigNumberish[], signatures: string[], calldatas: string[]) {
  let tx = await (await governor.propose(targets, values, signatures, calldatas, 'FastExecuteProposal')).wait();
  let event = tx.events.find(event => event.event === 'ProposalCreated');
  let [proposalId] = event.args;

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
    // Deploy a new configurator proxy to set the proper CometConfiguration storage values
    {
      contractsToDeploy: {
        configuratorProxy: true,
        configurator: true,
        comet: true,
        cometExt: true,
        cometFactory: true
      },
      configurationOverrides: cometConfig,
      adminSigner: context.actors['admin'].signer
    }
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

// Increases the supply cap for collateral assets that would go over the supply cap
export async function bumpSupplyCaps(world: World, context: CometContext, supplyAmountPerAsset: Record<string, bigint>) {
  const comet = await context.getComet();
  const configurator = await context.getConfigurator();
  const proxyAdmin = await context.getCometAdmin();

  // Update supply cap in asset configs if new collateral supply will exceed the supply cap
  let shouldUpgrade = false;
  const newSupplyCaps: Record<string, bigint> = {};
  for (const asset in supplyAmountPerAsset) {
    let assetInfo: AssetInfoStructOutput;
    try {
      assetInfo = await comet.getAssetInfoByAddress(asset);
    } catch (e) {
      continue; // skip if asset is not a collateral asset
    }

    const currentTotalSupply = (await comet.totalsCollateral(asset)).totalSupplyAsset.toBigInt();
    let newTotalSupply = currentTotalSupply + supplyAmountPerAsset[asset];
    if (newTotalSupply > assetInfo.supplyCap.toBigInt()) {
      shouldUpgrade = true;
      newSupplyCaps[asset] = newTotalSupply * 2n;
    }
  }

  // Set new supply caps in Configurator and do a deployAndUpgradeTo
  if (shouldUpgrade) {
    const [targets, values, signatures, calldata] = [[], [], [], []];
    for (const asset in newSupplyCaps) {
      targets.push(configurator.address);
      values.push(0);
      signatures.push('updateAssetSupplyCap(address,uint128)');
      calldata.push(utils.defaultAbiCoder.encode(['address', 'uint128'], [asset, newSupplyCaps[asset]]))
    }
    targets.push(proxyAdmin.address);
    values.push(0);
    signatures.push('deployAndUpgradeTo(address,address)');
    calldata.push(utils.defaultAbiCoder.encode(['address', 'address'], [configurator.address, comet.address]));
    await context.fastGovernanceExecute(targets, values, signatures, calldata);
  }
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
