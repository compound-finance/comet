import { Signer, Contract } from 'ethers';
import { ForkSpec, World, buildScenarioFn } from '../../plugins/scenario';
import { ContractMap, DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { BalanceConstraint, RemoteTokenConstraint } from '../constraints';
import CometActor from './CometActor';
import CometAsset from './CometAsset';
import { Comet, deployComet } from '../../src/deploy';

export class CometContext {
  deploymentManager: DeploymentManager;
  actors: { [name: string]: CometActor };
  assets: { [name: string]: CometAsset }; // XXX
  remoteToken: Contract | undefined;
  comet: Comet;

  constructor(
    deploymentManager: DeploymentManager,
    comet: Comet,
    actors: { [name: string]: CometActor }
  ) {
    this.deploymentManager = deploymentManager;
    this.comet = comet;
    this.actors = actors;
  }

  contracts(): ContractMap {
    return this.deploymentManager.contracts;
  }
}

async function buildActor(signer: Signer, cometContract: Comet) {
  return new CometActor(signer, await signer.getAddress(), cometContract);
}

const getInitialContext = async (world: World): Promise<CometContext> => {
  let deploymentManager = new DeploymentManager(world.base.name, world.hre);

  if (world.isDevelopment()) {
    await deployComet(deploymentManager, false);
  }

  await deploymentManager.spider();

  let comet: Comet = (await deploymentManager.contracts['Comet']) as Comet;
  if (!comet) {
    throw new Error(`No such contract Comet for base ${world.base.name}`);
  }

  let signers = await world.hre.ethers.getSigners();

  const [localAdminSigner, albertSigner, bettySigner, charlesSigner] = signers;
  let adminSigner;

  if (world.isDevelopment()) {
    adminSigner = localAdminSigner;
  } else {
    const governorAddress = await comet.governor();
    adminSigner = await world.impersonateAddress(governorAddress);
  }

  const actors = {
    admin: await buildActor(adminSigner, deploymentManager.contracts.Comet),
    albert: await buildActor(albertSigner, deploymentManager.contracts.Comet),
    betty: await buildActor(bettySigner, deploymentManager.contracts.Comet),
    charles: await buildActor(charlesSigner, deploymentManager.contracts.Comet),
  };

  return new CometContext(deploymentManager, comet, actors);
};

async function forkContext(c: CometContext): Promise<CometContext> {
  return c;
}

export const constraints = [new BalanceConstraint(), new RemoteTokenConstraint()];

export const scenario = buildScenarioFn<CometContext>(getInitialContext, forkContext, constraints);
