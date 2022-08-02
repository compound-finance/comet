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
import { Comet, CometInterface, ProxyAdmin, ERC20, ERC20__factory, Configurator, SimpleTimelock, CometProxyAdmin, GovernorSimple } from '../../build/types';
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

  constructor(world: World) {
    this.world = world;
    this.deploymentManager = world.deploymentManager; // NB: backwards compatibility (temporary?)
    this.actors = {};
    this.assets = {};
  }

  async contracts(): Promise<ContractMap> {
    return await this.deploymentManager.contracts();
  }

  async getComet(): Promise<CometInterface> {
    return await this.deploymentManager.contract('comet') as CometInterface;
  }

  async getCometImplemenation(): Promise<Comet> {
    return await this.deploymentManager.contract('comet:implementation') as Comet;
  }

  async getCometAdmin(): Promise<CometProxyAdmin> {
    return await this.deploymentManager.contract('cometAdmin') as CometProxyAdmin;
  }

  async getConfigurator(): Promise<Configurator> {
    return await this.deploymentManager.contract('configurator') as Configurator;
  }

  async getTimelock(): Promise<SimpleTimelock> {
    return await this.deploymentManager.contract('timelock') as SimpleTimelock;
  }

  async getGovernor(): Promise<GovernorSimple> {
    return await this.deploymentManager.contract('governor') as GovernorSimple;
  }

  async getConfiguration(): Promise<ProtocolConfiguration> {
    const comet = await this.getComet();
    const configurator = await this.getConfigurator();
    return configurator.getConfiguration(comet.address);
  }

  async upgrade(configOverrides: ProtocolConfiguration): Promise<CometContext> {
    debug('Upgrading to modern...');
    const oldComet = await this.getComet();
    const timelock = await this.getTimelock();
    const cometConfig = { governor: timelock.address, ...configOverrides } // Use old timelock as governor
    const { comet: newComet } = await deployComet(
      this.deploymentManager,
      // Deploy a new configurator proxy to set the proper CometConfiguration storage values
      {
        configuratorProxy: true,
        configurator: true,
        comet: true,
        cometExt: true,
        cometFactory: true
      },
      cometConfig,
      null,
      this.actors['signer'].signer
    );

    let initializer: string | undefined;
    if (!oldComet.totalsBasic || (await oldComet.totalsBasic()).lastAccrualTime === 0) {
      initializer = (await newComet.populateTransaction.initializeStorage()).data;
    }

    await this.upgradeTo(newComet, initializer);
    await this.setAssets();
    await this.spider();
    debug('Upgraded to modern...');
    return this;
}

  async upgradeTo(newComet: Comet, data?: string) {
    const { world } = this;

    let comet = await this.getComet();
    let proxyAdmin = await this.getCometAdmin();

    // Set the admin and pause guardian addresses again since these may have changed.
    let adminAddress = await comet.governor();
    let pauseGuardianAddress = await comet.pauseGuardian();
    let adminSigner = await world.impersonateAddress(adminAddress);
    let pauseGuardianSigner = await world.impersonateAddress(pauseGuardianAddress);

    // Set gas fee to 0 in case admin is a contract address (e.g. Timelock)
    await this.setNextBaseFeeToZero();
    if (data) {
      await (await proxyAdmin.connect(adminSigner).upgradeAndCall(comet.address, newComet.address, data, { gasPrice: 0 })).wait();
    } else {
      await (await proxyAdmin.connect(adminSigner).upgrade(comet.address, newComet.address, { gasPrice: 0 })).wait();
    }
    this.actors['admin'] = await buildActor('admin', adminSigner, this);
    this.actors['pauseGuardian'] = await buildActor('pauseGuardian', pauseGuardianSigner, this);
  }

  async spider() {
    await this.deploymentManager.spider();
  }

  primaryActor(): CometActor {
    return this.actors['signer'];
  }

  async allocateActor(name: string, info: object = {}): Promise<CometActor> {
    const { world } = this;

    let actorAddress = getAddressFromNumber(Object.keys(this.actors).length + 1);
    let signer = await world.impersonateAddress(actorAddress);
    let actor: CometActor = new CometActor(name, signer, actorAddress, this, info);
    this.actors[name] = actor;

    // For now, send some Eth from the first actor. Pay attention in the future
    let primaryActor = this.primaryActor();
    let nativeTokenAmount = world.base.allocation ?? 1.0;
    // When we allocate a new actor, how much eth should we warm the account with?
    // This seems to really vary by which network we're looking at, esp. since EIP-1559,
    // which makes the base fee for transactions variable by the network itself.
    await primaryActor.sendEth(actor, nativeTokenAmount);

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

    if (fauceteerBalance > amount) {
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
      if (actorBalance > amount) {
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
      hre: this.deploymentManager.hre,
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

  // Instantly executes some actions through the governance proposal process
  // Note: `governor` must be connected to an `admin` signer
  async fastGovernanceExecute(targets: string[], values: BigNumberish[], signatures: string[], calldatas: string[]) {
    const admin = this.actors['admin'];
    const governor = (await this.getGovernor()).connect(admin.signer);
    const tx = await (await governor.propose(targets, values, signatures, calldatas, 'FastExecuteProposal')).wait();
    const event = tx.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    await governor.queue(proposalId);
    await governor.execute(proposalId);
  }
}

async function buildActor(name: string, signer: SignerWithAddress, context: CometContext): Promise<CometActor> {
  return new CometActor(name, signer, await signer.getAddress(), context);
}

export async function getActors(context: CometContext): Promise<{ [name: string]: CometActor }> {
  const { world, deploymentManager } = context;

  let comet = await context.getComet();

  let [
    localAdminSigner,
    localPauseGuardianSigner,
    albertSigner,
    bettySigner,
    charlesSigner
  ] = await deploymentManager.getSigners();
  let adminSigner, pauseGuardianSigner;

  let adminAddress = await comet.governor();
  let pauseGuardianAddress = await comet.pauseGuardian();
  let useLocalAdminSigner = adminAddress === await localAdminSigner.getAddress();
  let useLocalPauseGuardianSigner = pauseGuardianAddress === await localPauseGuardianSigner.getAddress();
  adminSigner = useLocalAdminSigner ? localAdminSigner : await world.impersonateAddress(adminAddress);
  pauseGuardianSigner = useLocalPauseGuardianSigner ? localPauseGuardianSigner : await world.impersonateAddress(pauseGuardianAddress);
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
  let signer = (await deploymentManager.hre.ethers.getSigners())[1]; // dunno?
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

async function getInitialContext (world: World): Promise<CometContext> {
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
