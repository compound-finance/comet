import { BytesLike, Signer, Contract } from 'ethers';
import { ForkSpec, World, buildScenarioFn } from '../../plugins/scenario';
import { ContractMap, DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  BalanceConstraint,
  ModernConstraint,
  PauseConstraint,
  RemoteTokenConstraint,
  UtilizationConstraint,
} from '../constraints';
import CometActor from './CometActor';
import CometAsset from './CometAsset';
import { Comet, deployComet } from '../../src/deploy';
import { ProxyAdmin, ERC20 } from '../../build/types';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { sourceTokens } from '../../plugins/scenario/utils/TokenSourcer';
import { AddressLike, getAddressFromNumber, resolveAddress } from './Address';

export class CometContext {
  deploymentManager: DeploymentManager;
  actors: { [name: string]: CometActor };
  assets: { [name: string]: CometAsset };
  remoteToken: Contract | undefined;
  comet: Comet;
  proxyAdmin: ProxyAdmin;

  constructor(
    deploymentManager: DeploymentManager,
    comet: Comet,
    proxyAdmin: ProxyAdmin
  ) {
    this.deploymentManager = deploymentManager;
    this.comet = comet;
    this.proxyAdmin = proxyAdmin;
  }

  private debug(...args: any[]) {
    if (true) { // debug if?
      if (typeof args[0] === 'function') {
        console.log(...args[0]());
      } else {
        console.log(...args);
      }
    }
  }

  contracts(): ContractMap {
    return this.deploymentManager.contracts;
  }

  async upgradeTo(newComet: Comet, data?: string) {
    if (data) {
      await this.proxyAdmin.upgradeAndCall(this.comet.address, newComet.address, data);
    } else {
      await this.proxyAdmin.upgrade(this.comet.address, newComet.address);
    }

    this.comet = new this.deploymentManager.hre.ethers.Contract(this.comet.address, newComet.interface, this.comet.signer) as Comet;
  }

  async allocateActor(world: World, name: string, info: object = {}): Promise<CometActor> {
    let actorAddress = getAddressFromNumber(Object.keys(this.actors).length + 1);
    let signer = await world.impersonateAddress(actorAddress);
    let actor: CometActor = new CometActor(name, signer, actorAddress, this, info);
    this.actors[name] = actor;

    // For now, send some Eth from the first actor. Pay attention in the future
    let [_name, admin] = Object.entries(this.actors)[0];
    await admin.sendEth(actor, 0.1);

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

  async sourceTokens(world: World, amount: number | bigint, asset: CometAsset | string, recipient: AddressLike) {
    let recipientAddress = resolveAddress(recipient);
    let cometAsset = typeof(asset) === 'string' ? this.getAssetByAddress(asset) : asset;

    // First, try to steal from a known actor
    for (let [name, actor] of Object.entries(this.actors)) {
      let actorBalance = await cometAsset.balanceOf(actor);
      if (actorBalance > amount) {
        this.debug(`Source Tokens: stealing from actor ${name}`);
        await cometAsset.transfer(actor, amount, recipientAddress);
        return;
      }
    }

    if (world.isDevelopment()) {
      throw new Error('Tokens cannot be sourced from Etherscan for development. Actors did not have sufficient assets.');
    } else {
      this.debug("Source Tokens: sourcing from Etherscan...");
      // TODO: Note, this never gets called right now since all tokens are faucet tokens we've created.
      await sourceTokens({hre: this.deploymentManager.hre, amount, asset: cometAsset.address, address: recipientAddress});
    }
  }
}

async function buildActor(name: string, signer: SignerWithAddress, context: CometContext) {
  return new CometActor(name, signer, await signer.getAddress(), context);
}

const getInitialContext = async (world: World): Promise<CometContext> => {
  let deploymentManager = new DeploymentManager(world.base.name, world.hre, { debug: true });

  function getContract<T extends Contract>(name: string): T {
    let contract: T = deploymentManager.contracts[name] as T;
    if (!contract) {
      throw new Error(`No such contract ${name} for base ${world.base.name}`);
    }
    return contract;
  }

  if (world.isDevelopment()) {
    await deployComet(deploymentManager);
  }

  await deploymentManager.spider();

  let comet = getContract<Comet>('comet');
  let signers = await world.hre.ethers.getSigners();

  let [localAdminSigner, localPauseGuardianSigner, albertSigner, bettySigner, charlesSigner] =
    signers;
  let adminSigner, pauseGuardianSigner;

  if (world.isDevelopment()) {
    adminSigner = localAdminSigner;
    pauseGuardianSigner = localPauseGuardianSigner;
  } else {
    let governorAddress = await comet.governor();
    let pauseGuardianAddress = await comet.pauseGuardian();

    adminSigner = await world.impersonateAddress(governorAddress);
    pauseGuardianSigner = await world.impersonateAddress(pauseGuardianAddress);
  }

  let proxyAdmin = getContract<ProxyAdmin>('ProxyAdmin').connect(adminSigner);

  let context = new CometContext(deploymentManager, comet, proxyAdmin);

  context.actors = {
    admin: await buildActor("admin", adminSigner, context),
    pauseGuardian: await buildActor("pauseGuardian", pauseGuardianSigner, context),
    albert: await buildActor("albert", albertSigner, context),
    betty: await buildActor("betty", bettySigner, context),
    charles: await buildActor("charles", charlesSigner, context),
    signer: await buildActor("signer", localAdminSigner, context),
  };

  context.assets = {
    DAI: new CometAsset(getContract<ERC20>('DAI')),
    GOLD: new CometAsset(getContract<ERC20>('GOLD')),
    SILVER: new CometAsset(getContract<ERC20>('SILVER')),
  };

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
];

export const scenario = buildScenarioFn<CometContext>(getInitialContext, forkContext, constraints);
