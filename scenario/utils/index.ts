import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { BigNumber, BigNumberish, Contract, ContractReceipt, ContractTransaction, Event, EventFilter, constants, utils } from 'ethers';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { CometContext } from '../context/CometContext';
import CometAsset from '../context/CometAsset';
import { exp } from '../../test/helpers';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/utils';
import { ProposalState, OpenProposal } from '../context/Gov';
import { debug } from '../../plugins/deployment_manager/Utils';
import { COMP_WHALES } from '../../src/deploy';
import relayMessage from './relayMessage';
import { mineBlocks, setNextBaseFeeToZero, setNextBlockTimestamp } from './hreUtils';
import { BaseBridgeReceiver, CometInterface } from '../../build/types';
import CometActor from './../context/CometActor';
import { isBridgeProposal } from './isBridgeProposal';

export { mineBlocks, setNextBaseFeeToZero, setNextBlockTimestamp };

export const MAX_ASSETS = 15;
export const UINT256_MAX = 2n ** 256n - 1n;

export interface ComparativeAmount {
  val: number;
  op: ComparisonOp;
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

export function expectApproximately(expected: bigint, actual: bigint, precision = 0n) {
  expect(BigNumber.from(abs(expected - actual))).to.be.lte(BigNumber.from(precision));
}

export function expectBase(expected: bigint, actual: bigint, precision = 2n) {
  expectApproximately(expected, actual, precision);
}

export function expectRevertCustom(tx: Promise<ContractReceipt | ContractTransaction>, custom: string) {
  return tx
    .then(_ => { throw new Error('Expected transaction to be reverted'); })
    .catch(e => {
      const selector = utils.keccak256(custom.split('').reduce((a, s) => a + s.charCodeAt(0).toString(16), '0x')).slice(2, 2 + 8);
      const patterns = [
        new RegExp(`custom error '${custom.replace(/[()]/g, '\\$&')}'`),
        new RegExp(`unrecognized custom error with selector ${selector}`),
        new RegExp(`unrecognized custom error \\(return data: 0x${selector}\\)`)
      ];
      for (const pattern of patterns)
        if (pattern.test(e.message) || pattern.test(e.reason))
          return;
      throw new Error(`Expected revert message in one of [${patterns}], but reverted with: ${e.message}`);
    });
}

export function expectRevertMatches(tx: Promise<ContractReceipt>, patterns: RegExp[]) {
  return tx
    .then(_ => { throw new Error('Expected transaction to be reverted'); })
    .catch(e => {
      for (const pattern of patterns)
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

export function requireNumber(o: object, key: string, err: string): number {
  let value: unknown = o[key];
  if (value === undefined) {
    throw new Error(err);
  }
  if (typeof value !== 'number') {
    throw new Error(`${err} [requirement ${key} required to be number type]`);
  }
  return value;
}

export function optionalNumber(o: object, key: string): number | undefined {
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
    } else {
      throw new Error(`Invalid actor name: ${name}`);
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
      const assetIndex = name.match(/[0-9]+/g)![0];
      ({ asset } = await comet.getAssetInfo(assetIndex));
    } else if (baseAssetRegex.test(name)) {
      // If name matches "base"
      asset = await comet.baseToken();
    } else {
      throw new Error(`Invalid asset name: ${name}`);
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
      toTransfer = max(exp(amount.val, decimals) - existingBalance, 0n);
      break;
    case ComparisonOp.LTE:
      // `toTransfer` should not be positive
      toTransfer = min(exp(amount.val, decimals) - existingBalance, 0n);
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
        'GTE': />=\s*(-?\d+)/,
        'GT': />\s*(-?\d+)/,
        'LTE': /<=\s*(-?\d+)/,
        'LT': /<\s*(-?\d+)/,
        'EQ': /==\s*(-?\d+)/,
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

export async function isValidAssetIndex(ctx: CometContext, assetNum: number): Promise<boolean> {
  const comet = await ctx.getComet();
  return assetNum < await comet.numAssets();
}

export async function isTriviallySourceable(ctx: CometContext, assetNum: number, amount: number): Promise<boolean> {
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

export async function isBulkerSupported(ctx: CometContext): Promise<boolean> {
  const bulker = await ctx.getBulker();
  return bulker == null ? false : true;
}

export async function hasMinBorrowGreaterThanOne(ctx: CometContext): Promise<boolean> {
  const comet = await ctx.getComet();
  const minBorrow = (await comet.baseBorrowMin()).toBigInt();
  return minBorrow > 1n;
}

type DeploymentCriterion = {
  network?: string;
  deployment?: string;
}

export function matchesDeployment(ctx: CometContext, deploymentCriteria: DeploymentCriterion[]): boolean {
  const currentDeployment = {
    network: ctx.world.base.network,
    deployment: ctx.world.base.deployment
  };

  function matchesCurrentDeployment(deploymentCriterion: DeploymentCriterion) {
    for (const [k, v] of Object.entries(deploymentCriterion)) {
      if (currentDeployment[k] !== v) return false;
    }
    return true;
  }

  return deploymentCriteria.some(matchesCurrentDeployment);
}

export async function isRewardSupported(ctx: CometContext): Promise<boolean> {
  const rewards = await ctx.getRewards();
  const comet = await ctx.getComet();
  if (rewards == null) return false;

  const [rewardTokenAddress] = await rewards.rewardConfig(comet.address);
  if (rewardTokenAddress === constants.AddressZero) return false;

  return true;
}

export function isBridgedDeployment(ctx: CometContext): boolean {
  return ctx.world.auxiliaryDeploymentManager !== undefined;
}

export async function fetchLogs(
  contract: Contract,
  filter: EventFilter,
  fromBlock: number,
  toBlock: number,
  BLOCK_SPAN = 2047 // NB: sadly max for fuji is LESS than 2048
): Promise<Event[]> {
  if (toBlock - fromBlock > BLOCK_SPAN) {
    const midBlock = fromBlock + BLOCK_SPAN;
    const logs = await contract.queryFilter(filter, fromBlock, midBlock);
    return logs.concat(await fetchLogs(contract, filter, midBlock + 1, toBlock));
  } else {
    return contract.queryFilter(filter, fromBlock, toBlock);
  }
}

export async function executeOpenProposal(
  dm: DeploymentManager,
  { id, startBlock, endBlock }: OpenProposal
) {
  const governor = await dm.getContractOrThrow('governor');
  const blockNow = await dm.hre.ethers.provider.getBlockNumber();
  const blocksUntilStart = startBlock.toNumber() - blockNow;
  const blocksUntilEnd = endBlock.toNumber() - Math.max(startBlock.toNumber(), blockNow);

  if (blocksUntilStart > 0) {
    await mineBlocks(dm, blocksUntilStart);
  }

  const compWhales = dm.network === 'mainnet' ? COMP_WHALES.mainnet : COMP_WHALES.testnet;

  if (blocksUntilEnd > 0) {
    for (const whale of compWhales) {
      try {
        // Voting can fail if voter has already voted
        const voter = await impersonateAddress(dm, whale);
        await setNextBaseFeeToZero(dm);
        await governor.connect(voter).castVote(id, 1, { gasPrice: 0 });
      } catch (err) {
        debug(`Error while voting for ${whale}`, err.message);
      }
    }
    await mineBlocks(dm, blocksUntilEnd);
  }

  // Queue proposal (maybe)
  if (await governor.state(id) == ProposalState.Succeeded) {
    await setNextBaseFeeToZero(dm);
    await governor.queue(id, { gasPrice: 0 });
  }

  // Execute proposal (maybe, w/ gas limit so we see if exec reverts, not a gas estimation error)
  if (await governor.state(id) == ProposalState.Queued) {
    const block = await dm.hre.ethers.provider.getBlock('latest');
    const proposal = await governor.proposals(id);
    await setNextBlockTimestamp(dm, Math.max(block.timestamp, proposal.eta.toNumber()) + 1);
    await setNextBaseFeeToZero(dm);
    await governor.execute(id, { gasPrice: 0, gasLimit: 12000000 });
  }
}

// Instantly executes some actions through the governance proposal process
export async function fastGovernanceExecute(
  dm: DeploymentManager,
  proposer: SignerWithAddress,
  targets: string[],
  values: BigNumberish[],
  signatures: string[],
  calldatas: string[]
) {
  const governor = await dm.getContractOrThrow('governor');

  await setNextBaseFeeToZero(dm);

  const proposeTxn = await (
    await governor.connect(proposer).propose(
      targets,
      values,
      signatures,
      calldatas,
      'FastExecuteProposal',
      { gasPrice: 0 }
    )
  ).wait();
  const proposeEvent = proposeTxn.events.find(event => event.event === 'ProposalCreated');
  const [id, , , , , , startBlock, endBlock] = proposeEvent.args;

  await executeOpenProposal(dm, { id, startBlock, endBlock });
}

export async function fastL2GovernanceExecute(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  proposer: SignerWithAddress,
  targets: string[],
  values: BigNumberish[],
  signatures: string[],
  calldatas: string[]
) {
  const startingBlockNumber = await governanceDeploymentManager.hre.ethers.provider.getBlockNumber();
  await fastGovernanceExecute(
    governanceDeploymentManager,
    proposer,
    targets,
    values,
    signatures,
    calldatas
  );

  await relayMessage(governanceDeploymentManager, bridgeDeploymentManager, startingBlockNumber);
}

export async function createCrossChainProposal(context: CometContext, l2ProposalData: string, bridgeReceiver: BaseBridgeReceiver) {
  const govDeploymentManager = context.world.auxiliaryDeploymentManager!;
  const bridgeDeploymentManager = context.world.deploymentManager!;
  const proposer = await context.getProposer();
  const bridgeNetwork = bridgeDeploymentManager.network;
  const targets: string[] = [];
  const values: BigNumberish[] = [];
  const signatures: string[] = [];
  const calldata: string[] = [];

  // Create the chain-specific wrapper around the L2 proposal data
  switch (bridgeNetwork) {
    case 'arbitrum':
    case 'arbitrum-goerli': {
      const inbox = await govDeploymentManager.getContractOrThrow('arbitrumInbox');
      const refundAddress = constants.AddressZero;
      const createRetryableTicketCalldata = utils.defaultAbiCoder.encode(
        [
          'address', 'uint256', 'uint256', 'address', 'address', 'uint256', 'uint256', 'bytes'
        ],
        [
          bridgeReceiver.address, // address to,
          0,                      // uint256 l2CallValue,
          0,                      // uint256 maxSubmissionCost,
          refundAddress,          // address excessFeeRefundAddress,
          refundAddress,          // address callValueRefundAddress,
          0,                      // uint256 gasLimit,
          0,                      // uint256 maxFeePerGas,
          l2ProposalData,         // bytes calldata data
        ]
      );
      targets.push(inbox.address);
      values.push(0);
      signatures.push('createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)');
      calldata.push(createRetryableTicketCalldata);
      break;
    }
    case 'base':
    case 'base-goerli': {
      const sendMessageCalldata = utils.defaultAbiCoder.encode(
        ['address', 'bytes', 'uint32'],
        [bridgeReceiver.address, l2ProposalData, 1_000_000] // XXX find a reliable way to estimate the gasLimit
      );
      const baseL1CrossDomainMessenger = await govDeploymentManager.getContractOrThrow(
        'baseL1CrossDomainMessenger'
      );

      targets.push(baseL1CrossDomainMessenger.address);
      values.push(0);
      signatures.push('sendMessage(address,bytes,uint32)');
      calldata.push(sendMessageCalldata);
      break;
    }
    case 'mumbai':
    case 'polygon': {
      const sendMessageToChildCalldata = utils.defaultAbiCoder.encode(
        ['address', 'bytes'],
        [bridgeReceiver.address, l2ProposalData]
      );
      const fxRoot = await govDeploymentManager.getContractOrThrow('fxRoot');

      targets.push(fxRoot.address);
      values.push(0);
      signatures.push('sendMessageToChild(address,bytes)');
      calldata.push(sendMessageToChildCalldata);
      break;
    }
    case 'linea-goerli': {
      const sendMessageCalldata = utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'bytes'],
        [bridgeReceiver.address, 0, l2ProposalData]
      );
      const lineaMessageService = await govDeploymentManager.getContractOrThrow(
        'lineaMessageService'
      );
      targets.push(lineaMessageService.address);
      values.push(0);
      signatures.push('sendMessage(address,uint256,bytes)');
      calldata.push(sendMessageCalldata);
      break;
    }
    case 'optimism': {
      const sendMessageCalldata = utils.defaultAbiCoder.encode(
        ['address', 'bytes', 'uint32'],
        [bridgeReceiver.address, l2ProposalData, 2_500_000]
      );
      const opL1CrossDomainMessenger = await govDeploymentManager.getContractOrThrow(
        'opL1CrossDomainMessenger'
      );

      targets.push(opL1CrossDomainMessenger.address);
      values.push(0);
      signatures.push('sendMessage(address,bytes,uint32)');
      calldata.push(sendMessageCalldata);
      break;
    }
    case 'scroll': 
    case 'scroll-goerli': {
      const sendMessageCalldata = utils.defaultAbiCoder.encode(
        ['address', 'uint256', 'bytes', 'uint256'],
        [bridgeReceiver.address, 0, l2ProposalData, 1_000_000] // XXX find a reliable way to estimate the gasLimit
      );
      const scrollMessenger = await govDeploymentManager.getContractOrThrow(
        'scrollMessenger'
      );
      targets.push(scrollMessenger.address);
      values.push(exp(1, 18)); // XXX fees are paid via msg.value
      signatures.push('sendMessage(address,uint256,bytes,uint256)');
      calldata.push(sendMessageCalldata);
      break;
    }
    default:
      throw new Error(
        `No cross-chain proposal constructor implementation for ${govDeploymentManager.network} -> ${bridgeNetwork}`
      );
  }

  await fastL2GovernanceExecute(
    govDeploymentManager,
    bridgeDeploymentManager,
    proposer,
    targets,
    values,
    signatures,
    calldata
  );
}

export async function executeOpenProposalAndRelay(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  openProposal: OpenProposal
) {
  const startingBlockNumber = await governanceDeploymentManager.hre.ethers.provider.getBlockNumber();
  await executeOpenProposal(governanceDeploymentManager, openProposal);

  if (await isBridgeProposal(governanceDeploymentManager, bridgeDeploymentManager, openProposal)) {
    await relayMessage(governanceDeploymentManager, bridgeDeploymentManager, startingBlockNumber);
  } else {
    console.log(
      `[${governanceDeploymentManager.network} -> ${bridgeDeploymentManager.network}] Proposal ${openProposal.id} doesn't target bridge; not relaying`
    );
    return;
  }
}

async function getLiquidationMargin({ comet, actor, baseLiquidity, factorScale }): Promise<bigint> {
  const numAssets = await comet.numAssets();
  let liquidity = baseLiquidity;
  for (let i = 0; i < numAssets; i++) {
    const { asset, priceFeed, scale, liquidateCollateralFactor } = await comet.getAssetInfo(i);
    const collatBalance = (await comet.collateralBalanceOf(actor.address, asset)).toBigInt();
    const collatPrice = (await comet.getPrice(priceFeed)).toBigInt();
    const collatValue = collatBalance * collatPrice / scale.toBigInt();
    liquidity += collatValue * liquidateCollateralFactor.toBigInt() / factorScale;
  }

  return liquidity;
}

/*
invariant:
((borrowRate / factorScale) * timeElapsed) * (baseBalanceOf * price / baseScale) = -liquidationMargin

isolating for timeElapsed:
timeElapsed = -liquidationMargin / (baseBalanceOf * price / baseScale) / (borrowRate / factorScale);
*/
export async function timeUntilUnderwater({ comet, actor, fudgeFactor = 0n }: { comet: CometInterface, actor: CometActor, fudgeFactor?: bigint }): Promise<number> {
  const baseBalance = await actor.getCometBaseBalance();
  const baseScale = (await comet.baseScale()).toBigInt();
  const basePrice = (await comet.getPrice(await comet.baseTokenPriceFeed())).toBigInt();
  const baseLiquidity = baseBalance * basePrice / baseScale;
  const utilization = await comet.getUtilization();
  const borrowRate = (await comet.getBorrowRate(utilization)).toBigInt();
  const factorScale = (await comet.factorScale()).toBigInt();
  const liquidationMargin = await getLiquidationMargin({ comet, actor, baseLiquidity, factorScale });

  if (liquidationMargin < 0) {
    return 0; // already underwater
  }

  // XXX throw error if baseBalanceOf is positive and liquidationMargin is positive
  return Number((-liquidationMargin * factorScale / baseLiquidity / borrowRate) + fudgeFactor);
}
