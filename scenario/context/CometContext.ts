import { Signer, Contract } from 'ethers';
import { ForkSpec, World, buildScenarioFn } from '../../plugins/scenario';
import { ContractMap, DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import {
  BalanceConstraint,
  ModernConstraint,
  PauseConstraint,
  RemoteTokenConstraint,
  BaseTokenProtocolBalanceConstraint
} from '../constraints';
import CometActor from './CometActor';
import CometAsset from './CometAsset';
import { Comet, deployComet } from '../../src/deploy';
import { ProxyAdmin, Token, FaucetToken } from '../../build/types';

export class CometContext {
  deploymentManager: DeploymentManager;
  actors: { [name: string]: CometActor };
  assets: { [name: string]: CometAsset };
  remoteToken: Contract | undefined;
  comet: Comet;
  proxyAdmin: ProxyAdmin;
  baseToken: FaucetToken;

  constructor(
    deploymentManager: DeploymentManager,
    comet: Comet,
    proxyAdmin: ProxyAdmin,
    actors: { [name: string]: CometActor },
    assets: { [name: string]: CometAsset },
    baseToken: FaucetToken
  ) {
    this.deploymentManager = deploymentManager;
    this.comet = comet;
    this.proxyAdmin = proxyAdmin;
    this.actors = actors;
    this.assets = assets;
    this.baseToken = baseToken;
  }

  contracts(): ContractMap {
    return this.deploymentManager.contracts;
  }

  async upgradeTo(newComet: Comet) {
    await this.proxyAdmin.upgrade(this.comet.address, newComet.address);
    this.comet = new this.deploymentManager.hre.ethers.Contract(this.comet.address, newComet.interface, this.comet.signer) as Comet;
  }
}

async function buildActor(signer: Signer, cometContract: Comet) {
  return new CometActor(signer, await signer.getAddress(), cometContract);
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

  let actors = {
    admin: await buildActor(adminSigner, comet),
    pauseGuardian: await buildActor(pauseGuardianSigner, comet),
    albert: await buildActor(albertSigner, comet),
    betty: await buildActor(bettySigner, comet),
    charles: await buildActor(charlesSigner, comet),
  };

  let assets = {
    GOLD: new CometAsset(getContract<Token>('GOLD')),
    SILVER: new CometAsset(getContract<Token>('SILVER')),
  };

  let baseToken = getContract<FaucetToken>('DAI');
  let proxyAdmin = getContract<ProxyAdmin>('ProxyAdmin').connect(adminSigner);

  return new CometContext(deploymentManager, comet, proxyAdmin, actors, assets, baseToken);
};

async function forkContext(c: CometContext): Promise<CometContext> {
  return c;
}

export const constraints = [
  new ModernConstraint(),
  new PauseConstraint(),
  new BalanceConstraint(),
  new RemoteTokenConstraint(),
  new BaseTokenProtocolBalanceConstraint(),
];

export const scenario = buildScenarioFn<CometContext>(getInitialContext, forkContext, constraints);
