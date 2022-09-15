import { BigNumberish } from 'ethers';
import { World, buildScenarioFn } from '../../plugins/scenario';
import { debug } from '../../plugins/deployment_manager/Utils';
import {
  TokenBalanceConstraint,
  ModernConstraint,
  PauseConstraint,
  UtilizationConstraint,
  CometBalanceConstraint,
  MigrationConstraint,
  // ProposalConstraint,
  FilterConstraint,
} from '../constraints';
import CometActor from './CometActor';
import CometAsset from './CometAsset';
import { ProposalState, OpenProposal } from './Gov';
import {
  CometInterface,
  ERC20__factory,
  Configurator,
  SimpleTimelock,
  CometProxyAdmin,
  IGovernorBravo,
  CometRewards,
  Fauceteer,
  Bulker,
} from '../../build/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { sourceTokens } from '../../plugins/scenario/utils/TokenSourcer';
import { ProtocolConfiguration, deployComet, COMP_WHALES } from '../../src/deploy';
import { AddressLike, getAddressFromNumber, resolveAddress } from './Address';
import { Requirements } from '../constraints/Requirements';
import { DeploymentManager } from '../../plugins/deployment_manager';
import { impersonateAddress } from '../../plugins/scenario/World';

export type ActorMap = { [name: string]: CometActor };
export type AssetMap = { [name: string]: CometAsset };

export interface CometProperties {
  actors: ActorMap;
  assets: AssetMap;
  comet: CometInterface;
  configurator: Configurator;
  proxyAdmin: CometProxyAdmin;
  timelock: SimpleTimelock;
  governor: IGovernorBravo;
  rewards: CometRewards;
  bulker: Bulker;
}

export async function setNextBaseFeeToZero(dm: DeploymentManager) {
  await dm.hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
}

export async function mineBlocks(dm: DeploymentManager, blocks: number) {
  await dm.hre.network.provider.send('hardhat_mine', [`0x${blocks.toString(16)}`]);
}

export async function setNextBlockTimestamp(dm: DeploymentManager, timestamp: number) {
  await dm.hre.ethers.provider.send('evm_setNextBlockTimestamp', [timestamp]);
}

export async function executeOpenProposal(
  dm: DeploymentManager,
  { id, startBlock, endBlock }: OpenProposal
) {
  const governor = await dm.contract('governor');

  if (!governor) {
    throw new Error("cannot execute proposal without governor");
  }

  const blockNow = await dm.hre.ethers.provider.getBlockNumber();
  const blocksUntilStart = startBlock - blockNow;
  const blocksUntilEnd = endBlock - Math.max(startBlock, blockNow);

  if (blocksUntilStart > 0) {
    await mineBlocks(dm, blocksUntilStart);
  }

  if (blocksUntilEnd > 0) {
    for (const whale of COMP_WHALES) {
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
  const state = await governor.state(id);
  if (state == ProposalState.Succeeded) {
    await setNextBaseFeeToZero(dm);
    await governor.queue(id, { gasPrice: 0 });
  }

  const proposal = await governor.proposals(id);
  await setNextBlockTimestamp(dm, proposal.eta.toNumber() + 1);

  // Execute proposal (w/ gas limit so we see if exec reverts, not a gas estimation error)
  await setNextBaseFeeToZero(dm);
  await governor.execute(id, { gasPrice: 0, gasLimit: 12000000 });
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
  const governor = await dm.contract('governor');

  if (!governor) {
    throw new Error("cannot create governance proposal without governor");
  }

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

export class CometContext {
  world: World;
  actors: ActorMap;
  assets: AssetMap;

  constructor(world: World) {
    this.world = world;
    this.actors = {};
    this.assets = {};
  }

  async getProposer(): Promise<SignerWithAddress> {
    return this.world.impersonateAddress(COMP_WHALES[0]);
  }

  async getComet(): Promise<CometInterface> {
    return this.world.deploymentManager.contract('comet');
  }

  async getCometAdmin(): Promise<CometProxyAdmin> {
    return this.world.deploymentManager.contract('cometAdmin');
  }

  async getConfigurator(): Promise<Configurator> {
    return this.world.deploymentManager.contract('configurator');
  }

  async getTimelock(): Promise<SimpleTimelock> {
    return this.world.deploymentManager.contract('timelock');
  }

  async getGovernor(): Promise<IGovernorBravo> {
    return this.world.deploymentManager.contract('governor');
  }

  async getRewards(): Promise<CometRewards> {
    return this.world.deploymentManager.contract('rewards');
  }

  async getBulker(): Promise<Bulker> {
    return this.world.deploymentManager.contract('bulker');
  }

  async getFauceteer(): Promise<Fauceteer> {
    return this.world.deploymentManager.contract('fauceteer');
  }

  async getConfiguration(): Promise<ProtocolConfiguration> {
    const comet = await this.getComet();
    const configurator = await this.getConfigurator();
    return configurator.getConfiguration(comet.address);
  }

  async upgrade(configOverrides: ProtocolConfiguration): Promise<CometContext> {
    const { world } = this;

    const oldComet = await this.getComet();
    const admin = await world.impersonateAddress(await oldComet.governor(), 10n ** 18n);

    const deploySpec = { cometMain: true, cometExt: true };
    const deployed = await deployComet(this.world.deploymentManager, deploySpec, configOverrides, admin);

    await this.world.deploymentManager.spider(deployed);
    await this.setAssets();

    debug('Upgraded comet...');

    return this;
  }

  async bumpSupplyCaps(supplyAmountPerAsset: Record<string, bigint>) {
    const comet = await this.getComet();
    const baseToken = await comet.baseToken();

    // Update supply cap in asset configs if new collateral supply will exceed the supply cap
    let shouldUpgrade = false;
    const newSupplyCaps: Record<string, bigint> = {};
    for (const asset in supplyAmountPerAsset) {
      if (asset !== baseToken) {
        const assetInfo = await comet.getAssetInfoByAddress(asset);
        const currentTotalSupply = (await comet.totalsCollateral(asset)).totalSupplyAsset.toBigInt();
        const newTotalSupply = currentTotalSupply + supplyAmountPerAsset[asset];
        if (newTotalSupply > assetInfo.supplyCap.toBigInt()) {
          shouldUpgrade = true;
          newSupplyCaps[asset] = newTotalSupply * 2n;
        }
      }
    }

    // Set new supply caps in Configurator and do a deployAndUpgradeTo
    if (shouldUpgrade) {
      const gov = await this.world.impersonateAddress(await comet.governor(), 10n ** 18n);
      const cometAdmin = (await this.getCometAdmin()).connect(gov);
      const configurator = (await this.getConfigurator()).connect(gov);
      for (const [asset, cap] of Object.entries(newSupplyCaps)) {
        await configurator.updateAssetSupplyCap(comet.address, asset, cap);
      }
      await cometAdmin.deployAndUpgradeTo(configurator.address, comet.address);
    }
  }

  async allocateActor(name: string, info: object = {}): Promise<CometActor> {
    const { world } = this;
    const { signer } = this.actors;

    const actorAddress = getAddressFromNumber(Object.keys(this.actors).length + 1);
    const actorSigner = await world.impersonateAddress(actorAddress);
    const actor: CometActor = new CometActor(name, actorSigner, actorAddress, this, info);
    this.actors[name] = actor;

    // When we allocate a new actor, how much eth should we warm the account with?
    // This seems to really vary by which network we're looking at, esp. since EIP-1559,
    // which makes the base fee for transactions variable by the network itself.
    await signer.sendEth(actor, world.base.allocation ?? 1.0);

    return actor;
  }

  getAssetByAddress(address: string): CometAsset {
    for (let [name, asset] of Object.entries(this.assets)) {
      if (asset.address.toLowerCase() === address.toLowerCase()) {
        return asset;
      }
    }
    throw new Error(`Unable to find asset by address ${address}`);
  }

  async sourceTokens(amount: number | bigint, asset: CometAsset | string, recipient: AddressLike) {
    const { world } = this;

    let recipientAddress = resolveAddress(recipient);
    let cometAsset = typeof asset === 'string' ? this.getAssetByAddress(asset) : asset;
    let comet = await this.getComet();

    // First, try to source from Fauceteer
    const fauceteer = await this.getFauceteer();
    const fauceteerBalance = fauceteer ? await cometAsset.balanceOf(fauceteer.address) : 0;
    if (amount >= 0 && fauceteerBalance > amount) {
      debug(`Source Tokens: stealing from fauceteer`, amount, cometAsset.address);
      const fauceteerSigner = await world.impersonateAddress(fauceteer.address);
      const fauceteerActor = await buildActor('fauceteerActor', fauceteerSigner, this);
      // make gas fee 0 so we can source from contract addresses as well as EOAs
      await this.setNextBaseFeeToZero();
      await cometAsset.transfer(fauceteerActor, amount, recipientAddress, { gasPrice: 0 });
      return;
    }

    // Second, try to steal from a known actor
    for (let [name, actor] of Object.entries(this.actors)) {
      let actorBalance = await cometAsset.balanceOf(actor);
      if (amount >= 0 && actorBalance > amount) {
        debug(`Source Tokens: stealing from actor ${name}`, amount, cometAsset.address);
        // make gas fee 0 so we can source from contract addresses as well as EOAs
        await this.setNextBaseFeeToZero();
        await cometAsset.transfer(actor, amount, recipientAddress, { gasPrice: 0 });
        return;
      }
    }

    // Third, source from logs (expensive, in terms of node API limits)
    debug('Source Tokens: sourcing from logs...', amount, cometAsset.address);
    await sourceTokens({
      dm: this.world.deploymentManager,
      amount,
      asset: cometAsset.address,
      address: recipientAddress,
      blacklist: [comet.address],
    });
  }

  async setActors(actors?: { [name: string]: CometActor }) {
    this.actors = actors ?? await getActors(this);
  }

  async setAssets(assets?: { [symbol: string]: CometAsset }) {
    this.assets = assets ?? await getAssets(this);
  }

  async setNextBaseFeeToZero() {
    await setNextBaseFeeToZero(this.world.deploymentManager);
  }

  async setNextBlockTimestamp(timestamp: number) {
    await setNextBlockTimestamp(this.world.deploymentManager, timestamp);
  }

  async mineBlocks(blocks: number) {
    await mineBlocks(this.world.deploymentManager, blocks);
  }

  async executeOpenProposal(openProposal: OpenProposal) {
    await executeOpenProposal(this.world.deploymentManager, openProposal);
  }

  // Instantly executes some actions through the governance proposal process
  async fastGovernanceExecute(targets: string[], values: BigNumberish[], signatures: string[], calldatas: string[]) {
    const proposer = await this.getProposer();
    await fastGovernanceExecute(
      this.world.deploymentManager,
      proposer,
      targets,
      values,
      signatures,
      calldatas
    );
  }
}

async function buildActor(name: string, signer: SignerWithAddress, context: CometContext): Promise<CometActor> {
  return new CometActor(name, signer, await signer.getAddress(), context);
}

async function getActors(context: CometContext): Promise<{ [name: string]: CometActor }> {
  const { world } = context;

  const comet = await context.getComet();
  const [
    localAdminSigner,
    localPauseGuardianSigner,
    albertSigner,
    bettySigner,
    charlesSigner
  ] = await world.deploymentManager.getSigners();

  const adminAddress = await comet.governor();
  const pauseGuardianAddress = await comet.pauseGuardian();
  const useLocalAdminSigner = adminAddress === await localAdminSigner.getAddress();
  const useLocalPauseGuardianSigner = pauseGuardianAddress === await localPauseGuardianSigner.getAddress();
  const adminSigner = useLocalAdminSigner ? localAdminSigner : await world.impersonateAddress(adminAddress);
  const pauseGuardianSigner = useLocalPauseGuardianSigner ? localPauseGuardianSigner : await world.impersonateAddress(pauseGuardianAddress);

  return {
    admin: await buildActor('admin', adminSigner, context),
    pauseGuardian: await buildActor('pauseGuardian', pauseGuardianSigner, context),
    albert: await buildActor('albert', albertSigner, context),
    betty: await buildActor('betty', bettySigner, context),
    charles: await buildActor('charles', charlesSigner, context),
    signer: await buildActor('signer', localAdminSigner, context),
  };
}

async function getAssets(context: CometContext): Promise<{ [symbol: string]: CometAsset }> {
  const { deploymentManager } = context.world;

  let comet = await context.getComet();
  let signer = await deploymentManager.getSigner();
  let numAssets = await comet.numAssets();
  let assetAddresses = [
    await comet.baseToken(),
    ...await Promise.all(Array(numAssets).fill(0).map(async (_, i) => {
      return (await comet.getAssetInfo(i)).asset;
    })),
  ];

  return Object.fromEntries(await Promise.all(assetAddresses.map(async (address) => {
    let erc20 = ERC20__factory.connect(address, signer);
    return [await erc20.symbol(), new CometAsset(erc20)];
  })));
}

async function getInitialContext(world: World): Promise<CometContext> {
  const context = new CometContext(world);
  await context.setActors();
  await context.setAssets();
  return context;
}

async function getContextProperties(context: CometContext): Promise<CometProperties> {
  return {
    actors: context.actors,
    assets: context.assets,
    comet: await context.getComet(),
    configurator: await context.getConfigurator(),
    proxyAdmin: await context.getCometAdmin(),
    timelock: await context.getTimelock(),
    governor: await context.getGovernor(),
    rewards: await context.getRewards(),
    bulker: await context.getBulker(),
  }
}

async function forkContext(c: CometContext, w: World): Promise<CometContext> {
  let context = new CometContext(w);
  // We need to reconstruct the actors using the new deployment manager. Otherwise,
  // the new actors will be using the old NonceManagers from the old deployment manager.
  await context.setActors();
  await context.setAssets(Object.entries(c.assets).reduce((a, [name, asset]) => ({ ...a, [name]: CometAsset.fork(asset) }), {}));
  return context;
}

export const constraints = [
  new FilterConstraint(),
  new MigrationConstraint(),
  // new ProposalConstraint(),
  new ModernConstraint(),
  new PauseConstraint(),
  new CometBalanceConstraint(),
  new TokenBalanceConstraint(),
  new UtilizationConstraint(),
];

export const scenario = buildScenarioFn<CometContext, CometProperties, Requirements>(getInitialContext, getContextProperties, forkContext, constraints);
