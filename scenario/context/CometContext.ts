import { Contract } from 'ethers';
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
    admin: new CometActor(adminSigner, await adminSigner.getAddress()),
    albert: new CometActor(albertSigner, await albertSigner.getAddress()),
    betty: new CometActor(bettySigner, await bettySigner.getAddress()),
    charles: new CometActor(charlesSigner, await charlesSigner.getAddress()),
  };

  return new CometContext(deploymentManager, comet, actors);
};

async function forkContext(c: CometContext): Promise<CometContext> {
  return c;
}

export const constraints = [new BalanceConstraint(), new RemoteTokenConstraint()];

export const scenario = buildScenarioFn<CometContext>(getInitialContext, forkContext, constraints);
