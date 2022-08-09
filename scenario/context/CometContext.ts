import { Signer, Contract, utils, BigNumberish } from 'ethers';
import { World, buildScenarioFn } from '../../plugins/scenario';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { debug } from '../../plugins/deployment_manager/Utils';
import {
  TokenBalanceConstraint,
  ModernConstraint,
  PauseConstraint,
  UtilizationConstraint,
  CometBalanceConstraint,
  MigrationConstraint,
  ProposalConstraint,
} from '../constraints';
import CometActor from './CometActor';
import CometAsset from './CometAsset';
import {
  Comet,
  CometInterface,
  ProxyAdmin,
  ERC20,
  ERC20__factory,
  Configurator,
  SimpleTimelock,
  CometProxyAdmin,
  GovernorSimple,
  IGovernorBravo,
} from '../../build/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { sourceTokens } from '../../plugins/scenario/utils/TokenSourcer';
import { ProtocolConfiguration, deployComet } from '../../src/deploy';
import { AddressLike, getAddressFromNumber, resolveAddress } from './Address';
import { Requirements } from '../constraints/Requirements';

type ActorMap = { [name: string]: CometActor };
type AssetMap = { [name: string]: CometAsset };

export interface CometProperties {
  deploymentManager: DeploymentManager;
  actors: ActorMap;
  assets: AssetMap;
  comet: CometInterface;
  configurator: Configurator;
  proxyAdmin: ProxyAdmin;
  timelock: SimpleTimelock;
  governor: GovernorSimple;
}

export class CometContext {
  world: World;
  deploymentManager: DeploymentManager;
  actors: ActorMap;
  assets: AssetMap;

  // COMP biggest whales
  // XXX find a better way to do this without hardcoding whales
  voters = [
    '0xea6c3db2e7fca00ea9d7211a03e83f568fc13bf7',
    '0x61258f12c459984f32b83c86a6cc10aa339396de',
    '0x9aa835bc7b8ce13b9b0c9764a52fbf71ac62ccf1',
    '0x683a4f9915d6216f73d6df50151725036bd26c02',
    '0xa1b61405791170833070c0ea61ed28728a840241',
    '0x88fb3d509fc49b515bfeb04e23f53ba339563981',
    '0x8169522c2c57883e8ef80c498aab7820da539806'
  ];

  constructor(world: World) {
    this.world = world;
    this.deploymentManager = world.deploymentManager; // NB: backwards compatibility (temporary?)
    this.actors = {};
    this.assets = {};
  }

  async getComet(): Promise<CometInterface> {
    return this.deploymentManager.contract('comet');
  }

  async getCometAdmin(): Promise<CometProxyAdmin> {
    return this.deploymentManager.contract('cometAdmin');
  }

  async getConfigurator(): Promise<Configurator> {
    return this.deploymentManager.contract('configurator');
  }

  async getTimelock(): Promise<SimpleTimelock> {
    return this.deploymentManager.contract('timelock');
  }

  async getGovernor(): Promise<GovernorSimple> {
    return this.deploymentManager.contract('governor');
  }

  async getConfiguration(): Promise<ProtocolConfiguration> {
    const comet = await this.getComet();
    const configurator = await this.getConfigurator();
    return configurator.getConfiguration(comet.address);
  }

  async upgrade(configOverrides: ProtocolConfiguration): Promise<CometContext> {
    const { world } = this;

    const oldComet = await this.getComet();
    const admin = await world.impersonateAddress(await oldComet.governor(), 10n**18n);

    const deploySpec = { cometMain: true, cometExt: true };
    const deployed = await deployComet(this.deploymentManager, deploySpec, configOverrides, admin);

    await this.deploymentManager.spider(deployed);
    await this.setAssets();

    debug('Upgraded comet...');

    return this;
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
    const contracts = await this.deploymentManager.contracts();
    const fauceteer = contracts.get('fauceteer');
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
      dm: this.deploymentManager,
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
    await this.world.hre.network.provider.send('hardhat_setNextBlockBaseFeePerGas', ['0x0']);
  }

  async setNextBlockTimestamp(timestamp: number) {
    await this.world.hre.ethers.provider.send('evm_setNextBlockTimestamp', [timestamp]);
  }

  async mineBlocks(blocks: number) {
    await this.world.hre.network.provider.send('hardhat_mine', [`0x${blocks.toString(16)}`]);
  }

  async executePendingProposal(proposalId: number, startBlock: number, endBlock: number) {
    const governor = await this.getGovernor();

    const blockNow = await this.world.hre.ethers.provider.getBlockNumber();
    const blocksUntilStart = startBlock - blockNow;
    const blocksFromStartToEnd = endBlock - Math.max(startBlock, blockNow);

    if (blocksUntilStart > 0) {
      await this.mineBlocks(blocksUntilStart);
    }

    for (const voter of this.voters) {
      try {
        // Voting can fail if voter has already voted
        const voterSigner = await this.world.impersonateAddress(voter);
        const govAsVoter = await this.world.hre.ethers.getContractAt(
          'IGovernorBravo',
          governor.address,
          voterSigner
        ) as IGovernorBravo;
        await this.setNextBaseFeeToZero();
        await govAsVoter.castVote(proposalId, 1, { gasPrice: 0 });
      } catch (err) {
        debug(`Error while voting ${err}`);
      }
    }
    await this.mineBlocks(blocksFromStartToEnd);

    const adminSigner = await this.world.impersonateAddress(this.voters[0]);
    const governorAsAdmin = await this.world.hre.ethers.getContractAt(
      'IGovernorBravo',
      governor.address,
      adminSigner
    ) as IGovernorBravo;

    // Queue proposal
    await this.setNextBaseFeeToZero();
    const queueTxn = await (await governorAsAdmin.queue(proposalId, { gasPrice: 0 })).wait();
    const queueEvent = queueTxn.events?.find(event => event.event === 'ProposalQueued');
    await this.setNextBlockTimestamp(queueEvent?.args?.eta.toNumber());

    // Execute proposal
    await this.setNextBaseFeeToZero();
    await governorAsAdmin.execute(proposalId, { gasPrice: 0 });
  }

  // Instantly executes some actions through the governance proposal process
  // Note: `governor` must be connected to an `admin` signer
  async fastGovernanceExecute(targets: string[], values: BigNumberish[], signatures: string[], calldatas: string[]) {
    const { world } = this;
    const governor = await this.getGovernor();

    // XXX find a better way to do this without hardcoding whales
    const voters = [
      '0xea6c3db2e7fca00ea9d7211a03e83f568fc13bf7',
      '0x683a4f9915d6216f73d6df50151725036bd26c02'
    ];
    const adminSigner = await world.impersonateAddress(voters[0]);
    const governorAsAdmin = await world.hre.ethers.getContractAt(
      'IGovernorBravo',
      governor.address,
      adminSigner
    ) as IGovernorBravo;

    await this.setNextBaseFeeToZero();
    const proposeTxn = await (await governorAsAdmin.propose(targets, values, signatures, calldatas, 'FastExecuteProposal', { gasPrice: 0 })).wait();
    const proposeEvent = proposeTxn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId, , , , , , startBlock, endBlock] = proposeEvent.args;

    const blocksUntilStart = startBlock - await world.hre.ethers.provider.getBlockNumber();
    const blocksFromStartToEnd = endBlock - startBlock;
    await this.mineBlocks(blocksUntilStart);
    for (const voter of voters) {
      const voterSigner = await world.impersonateAddress(voter);
      const govAsVoter = await world.hre.ethers.getContractAt(
        'IGovernorBravo',
        governor.address,
        voterSigner
      ) as IGovernorBravo;
      await govAsVoter.castVote(proposalId, 1);
    }

    await this.mineBlocks(blocksFromStartToEnd);
    const queueTxn = await (await governorAsAdmin.queue(proposalId)).wait();
    const queueEvent = queueTxn.events.find(event => event.event === 'ProposalQueued');
    let [proposalId_, eta] = queueEvent.args;

    await this.setNextBlockTimestamp(eta.toNumber());
    await governorAsAdmin.execute(proposalId);
  }
}

async function buildActor(name: string, signer: SignerWithAddress, context: CometContext): Promise<CometActor> {
  return new CometActor(name, signer, await signer.getAddress(), context);
}

export async function getActors(context: CometContext): Promise<{ [name: string]: CometActor }> {
  const { world, deploymentManager } = context;

  const comet = await context.getComet();
  const [
    localAdminSigner,
    localPauseGuardianSigner,
    albertSigner,
    bettySigner,
    charlesSigner
  ] = await deploymentManager.getSigners();

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

export async function getAssets(context: CometContext): Promise<{ [symbol: string]: CometAsset }> {
  const { deploymentManager } = context;

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
  await context.deploymentManager.spider();
  await context.setActors();
  await context.setAssets();
  return context;
}

async function getContextProperties(context: CometContext): Promise<CometProperties> {
  return {
    deploymentManager: context.deploymentManager,
    actors: context.actors,
    assets: context.assets,
    comet: await context.getComet(),
    configurator: await context.getConfigurator(),
    proxyAdmin: await context.getCometAdmin(),
    timelock: await context.getTimelock(),
    governor: await context.getGovernor(),
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
  new MigrationConstraint(),
  new ProposalConstraint(),
  new ModernConstraint(),
  new PauseConstraint(),
  new CometBalanceConstraint(),
  new TokenBalanceConstraint(),
  new UtilizationConstraint(),
];

export const scenario = buildScenarioFn<CometContext, CometProperties, Requirements>(getInitialContext, getContextProperties, forkContext, constraints);
