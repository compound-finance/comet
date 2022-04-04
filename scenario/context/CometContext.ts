import { BytesLike, Signer, Contract, utils, BigNumberish } from 'ethers';
import { ForkSpec, World, buildScenarioFn } from '../../plugins/scenario';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  TokenBalanceConstraint,
  ModernConstraint,
  PauseConstraint,
  RemoteTokenConstraint,
  UtilizationConstraint,
  CometBalanceConstraint
} from '../constraints';
import CometActor from './CometActor';
import CometAsset from './CometAsset';
import { deployComet } from '../../src/deploy';
import { Comet, CometInterface, ProxyAdmin, ERC20, ERC20__factory, Configurator, SimpleTimelock, CometProxyAdmin, GovernorSimple } from '../../build/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { sourceTokens } from '../../plugins/scenario/utils/TokenSourcer';
import { AddressLike, getAddressFromNumber, resolveAddress } from './Address';
import { Requirements } from '../constraints/Requirements';

type ActorMap = { [name: string]: CometActor };
type AssetMap = { [name: string]: CometAsset };

export interface CometProperties {
  deploymentManager: DeploymentManager;
  actors: ActorMap;
  assets: AssetMap;
  remoteToken?: Contract;
  comet: CometInterface;
  configurator: Configurator;
  proxyAdmin: ProxyAdmin;
  timelock: SimpleTimelock;
  governor: GovernorSimple;
}

export class CometContext {
  deploymentManager: DeploymentManager;
  actors: ActorMap;
  assets: AssetMap;
  remoteToken?: Contract;

  constructor(deploymentManager: DeploymentManager, remoteToken: Contract | undefined) {
    this.deploymentManager = deploymentManager;
    this.actors = {};
    this.assets = {};
    this.remoteToken = remoteToken;
  }

  private debug(...args: any[]) {
    if (true) {
      // debug if?
      if (typeof args[0] === 'function') {
        console.log(...args[0]());
      } else {
        console.log(...args);
      }
    }
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

  async getCometAdmin(): Promise<ProxyAdmin> {
    return await this.deploymentManager.contract('cometAdmin') as ProxyAdmin;
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

  async upgradeTo(newComet: Comet, world: World, data?: string) {
    let comet = await this.getComet();
    let proxyAdmin = await this.getCometAdmin();
    let governor = await this.getGovernor();

    // Set the admin and pause guardian addresses again since these may have changed.
    let adminAddress = await governor.admins(0); // any admin will do
    let pauseGuardianAddress = await comet.pauseGuardian();
    let adminSigner = await world.impersonateAddress(adminAddress);
    let pauseGuardianSigner = await world.impersonateAddress(pauseGuardianAddress);

    if (data) {
      let calldata = utils.defaultAbiCoder.encode(["address", "address", "bytes"], [comet.address, newComet.address, data]);
      await this.fastGovernanceExecute(
        [proxyAdmin.address],
        [0],
        ["upgradeAndCall(address,address,bytes)"],
        [calldata]
      );
    } else {
      let calldata = utils.defaultAbiCoder.encode(["address", "address"], [comet.address, newComet.address]);
      await this.fastGovernanceExecute(
        [proxyAdmin.address],
        [0],
        ["upgrade(address,address)"],
        [calldata]
      );
    }
    this.actors['admin'] = await buildActor('admin', adminSigner, this);
    this.actors['pauseGuardian'] = await buildActor('pauseGuardian', pauseGuardianSigner, this);
  }

  async spider() {
    await this.deploymentManager.spider();
  }

  primaryActor(): CometActor {
    return Object.values(this.actors)[0];
  }

  async allocateActor(world: World, name: string, info: object = {}): Promise<CometActor> {
    let actorAddress = getAddressFromNumber(Object.keys(this.actors).length + 1);
    let signer = await world.impersonateAddress(actorAddress);
    let actor: CometActor = new CometActor(name, signer, actorAddress, this, info);
    this.actors[name] = actor;

    // For now, send some Eth from the first actor. Pay attention in the future
    let admin = this.primaryActor();
    let nativeTokenAmount = world.base.allocation ?? 1.0;
    // When we allocate a new actor, how much eth should we warm the account with?
    // This seems to really vary by which network we're looking at, esp. since EIP-1559,
    // which makes the base fee for transactions variable by the network itself.
    await admin.sendEth(actor, nativeTokenAmount);

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

  async sourceTokens(
    world: World,
    amount: number | bigint,
    asset: CometAsset | string,
    recipient: AddressLike
  ) {
    let recipientAddress = resolveAddress(recipient);
    let cometAsset = typeof asset === 'string' ? this.getAssetByAddress(asset) : asset;

    // First, try to steal from a known actor
    for (let [name, actor] of Object.entries(this.actors)) {
      let actorBalance = await cometAsset.balanceOf(actor);
      if (actorBalance > amount) {
        this.debug(`Source Tokens: stealing from actor ${name}`);
        await cometAsset.transfer(actor, amount, recipientAddress);
        return;
      }
    }

    if (!world.isRemoteFork()) {
      throw new Error('Tokens cannot be sourced from Etherscan for development. Actors did not have sufficient assets.');
    } else {
      this.debug('Source Tokens: sourcing from Etherscan...');
      // TODO: Note, this never gets called right now since all tokens are faucet tokens we've created.
      await sourceTokens({
        hre: this.deploymentManager.hre,
        amount,
        asset: cometAsset.address,
        address: recipientAddress,
      });
    }
  }

  async setAssets() {
    let comet = await this.getComet();
    let signer = (await this.deploymentManager.hre.ethers.getSigners())[1]; // dunno?
    let numAssets = await comet.numAssets();
    let assetAddresses = [
      await comet.baseToken(),
      ...await Promise.all(Array(numAssets).fill(0).map(async (_, i) => {
        return (await comet.getAssetInfo(i)).asset;
      })),
    ];

    this.assets = Object.fromEntries(await Promise.all(assetAddresses.map(async (address) => {
      let erc20 = ERC20__factory.connect(address, signer);
      return [await erc20.symbol(), new CometAsset(erc20)];
    })));
  }

  // Instantly executes some actions through the governance proposal process
  async fastGovernanceExecute(targets: string[], values: BigNumberish[], signatures: string[], calldatas: string[]) {
    let admin = this.actors['admin'];
    let governor = (await this.getGovernor()).connect(admin.signer);

    let tx = await (await governor.propose(targets, values, signatures, calldatas, 'FastExecuteProposal')).wait();
    let event = tx.events.find(event => event.event === 'ProposalCreated');
    let [ proposalId ] = event.args;

    await governor.queue(proposalId);
    await governor.execute(proposalId);
  }
}

async function getContextProperties(context: CometContext): Promise<CometProperties> {
  return {
    deploymentManager: context.deploymentManager,
    actors: context.actors,
    assets: context.assets,
    remoteToken: context.remoteToken,
    comet: await context.getComet(),
    configurator: await context.getConfigurator(),
    proxyAdmin: await context.getCometAdmin(),
    timelock: await context.getTimelock(),
    governor: await context.getGovernor(),
  }
}

async function buildActor(name: string, signer: SignerWithAddress, context: CometContext) {
  return new CometActor(name, signer, await signer.getAddress(), context);
}

const getInitialContext = async (world: World): Promise<CometContext> => {
  let deploymentManager = new DeploymentManager(world.base.name, world.hre, { debug: true });

  // TODO: `thing` allows loading the named contract using a particular ABI
  //  we use it for now to supply a full interface across delegates
  //  we can replace with an automatic union proxy interface that can recover the full interface through spider
  async function getContract<T extends Contract>(name: string, thing?: string): Promise<T> {
    let contracts = await deploymentManager.contracts();
    let contract: T = contracts.get(name) as T;
    if (!contract) {
      throw new Error(`No such contract ${name} for base ${world.base.name}, found: ${JSON.stringify([...contracts.keys()])}`);
    }
    if (thing) {
      return await deploymentManager.hre.ethers.getContractAt(thing, contract.address) as T;
    } else {
      return contract;
    }
    return contract;
  }

  if (!world.isRemoteFork()) {
    await deployComet(deploymentManager);
  }

  await deploymentManager.spider();

  let context = new CometContext(deploymentManager, undefined);
  let comet = await context.getComet();
  let governor = await context.getGovernor();

  let signers = await world.hre.ethers.getSigners();

  let [localAdminSigner, localPauseGuardianSigner, albertSigner, bettySigner, charlesSigner] =
    signers;
  let adminSigner, pauseGuardianSigner;

  let adminAddress = await governor.admins(0); // any admin will do
  let pauseGuardianAddress = await comet.pauseGuardian();
  adminSigner = await world.impersonateAddress(adminAddress);
  pauseGuardianSigner = await world.impersonateAddress(pauseGuardianAddress);

  context.actors = {
    admin: await buildActor('admin', adminSigner, context),
    pauseGuardian: await buildActor('pauseGuardian', pauseGuardianSigner, context),
    albert: await buildActor('albert', albertSigner, context),
    betty: await buildActor('betty', bettySigner, context),
    charles: await buildActor('charles', charlesSigner, context),
    signer: await buildActor('signer', localAdminSigner, context),
  };

  await context.setAssets();

  return context;
};

async function forkContext(c: CometContext): Promise<CometContext> {
  let context = new CometContext(DeploymentManager.fork(c.deploymentManager), c.remoteToken);
  context.actors = Object.fromEntries(Object.entries(c.actors).map(([name, actor]) => [name, CometActor.fork(actor, context)]));
  context.assets = Object.fromEntries(Object.entries(c.assets).map(([name, asset]) => [name, CometAsset.fork(asset)]));

  return context;
}

export const constraints = [
  new ModernConstraint(),
  new PauseConstraint(),
  new CometBalanceConstraint(),
  new TokenBalanceConstraint(),
  new RemoteTokenConstraint(),
  new UtilizationConstraint(),
];

export const scenario = buildScenarioFn<CometContext, CometProperties, Requirements>(getInitialContext, getContextProperties, forkContext, constraints);
