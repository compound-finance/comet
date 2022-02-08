import { BytesLike, Signer, Contract } from 'ethers';
import { ForkSpec, World, buildScenarioFn } from '../../plugins/scenario';
import { ContractMap } from '../../plugins/deployment_manager/ContractMap';
import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  BalanceConstraint,
  ModernConstraint,
  PauseConstraint,
  RemoteTokenConstraint,
  UtilizationConstraint,
  BaseTokenProtocolBalanceConstraint,
} from '../constraints';
import CometActor from './CometActor';
import CometAsset from './CometAsset';
import { deployComet } from '../../src/deploy';
import { Comet, ProxyAdmin, CometProxyAdmin, ERC20, ERC20__factory, TransparentUpgradeableFactoryProxy } from '../../build/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { sourceTokens } from '../../plugins/scenario/utils/TokenSourcer';
import { AddressLike, getAddressFromNumber, resolveAddress } from './Address';

export class CometContext {
  deploymentManager: DeploymentManager;
  actors: { [name: string]: CometActor };
  assets: { [name: string]: CometAsset };
  remoteToken: Contract | undefined;
  comet: Comet;
  proxyAdmin: CometProxyAdmin;

  constructor(deploymentManager: DeploymentManager, comet: Comet, proxyAdmin: CometProxyAdmin) {
    this.deploymentManager = deploymentManager;
    this.comet = comet;
    this.proxyAdmin = proxyAdmin;
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

  async upgradeTo(newComet: Comet, world: World, data?: string) {
    if (data) {
      await this.proxyAdmin.upgradeAndCall(this.comet.address, newComet.address, data);
    } else {
      await this.proxyAdmin.upgrade(this.comet.address, newComet.address);
    }

    this.comet = new this.deploymentManager.hre.ethers.Contract(this.comet.address, newComet.interface, this.comet.signer) as Comet;

    // Set the admin and pause guardian addresses again since these may have changed.
    let governorAddress = await this.comet.governor();
    let pauseGuardianAddress = await this.comet.pauseGuardian();
    let adminSigner = await world.impersonateAddress(governorAddress);
    let pauseGuardianSigner = await world.impersonateAddress(pauseGuardianAddress);

    this.actors['admin'] = await buildActor('admin', adminSigner, this);
    this.actors['pauseGuardian'] = await buildActor('pauseGuardian', pauseGuardianSigner, this);
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

    if (world.isForked()) {
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

  // <!--
  async setAssets() {
    let signer = (await this.deploymentManager.hre.ethers.getSigners())[1]; // dunno?
    let numAssets = await this.comet.numAssets();
    let assetAddresses = [
      await this.comet.baseToken(),
      ...await Promise.all(Array(numAssets).fill(0).map(async (_, i) => {
        return (await this.comet.getAssetInfo(i)).asset;
      })),
    ];

    this.assets = Object.fromEntries(await Promise.all(assetAddresses.map(async (address) => {
      let erc20 = ERC20__factory.connect(address, signer);
      return [await erc20.symbol(), new CometAsset(erc20)];
    })));
  }
}

async function buildActor(name: string, signer: SignerWithAddress, context: CometContext) {
  return new CometActor(name, signer, await signer.getAddress(), context);
}

const getInitialContext = async (world: World): Promise<CometContext> => {
  let deploymentManager = new DeploymentManager(world.base.name, world.hre, { debug: true });

  async function getContract<T extends Contract>(name: string): Promise<T> {
    let contracts = await deploymentManager.contracts();
    let contract: T = contracts.get(name) as T;
    if (!contract) {
      throw new Error(`No such contract ${name} for base ${world.base.name}, found: ${JSON.stringify([...contracts.keys()])}`);
    }
    return contract;
  }

  if (world.isForked()) {
    await deployComet(deploymentManager);
  }

  await deploymentManager.spider();

  let comet = await getContract<Comet>('comet');
  let signers = await world.hre.ethers.getSigners();

  let [localAdminSigner, localPauseGuardianSigner, albertSigner, bettySigner, charlesSigner] =
    signers;
  let adminSigner, pauseGuardianSigner;

  let governorAddress = await comet.governor();
  let pauseGuardianAddress = await comet.pauseGuardian();
  adminSigner = await world.impersonateAddress(governorAddress);
  pauseGuardianSigner = await world.impersonateAddress(pauseGuardianAddress);

  let proxyAdmin = (await getContract<CometProxyAdmin>('cometAdmin')).connect(adminSigner);

  let context = new CometContext(deploymentManager, comet, proxyAdmin);

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
  return c;
}

export const constraints = [
  new ModernConstraint(),
  new PauseConstraint(),
  new BalanceConstraint(),
  new RemoteTokenConstraint(),
  new UtilizationConstraint(),
  new BaseTokenProtocolBalanceConstraint(),
];

export const scenario = buildScenarioFn<CometContext>(getInitialContext, forkContext, constraints);
