import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { cloneGov, wait } from '../../../src/deploy';


export default async function deploy(deploymentManager: DeploymentManager, deploySpec: any): Promise<Deployed> {
  console.log('Deploying infrastructure components...');

  // Set verification strategy to none to skip contract verification
  deploymentManager.setVerificationStrategy('none');

  // Deploy governance contracts
  const { COMP, governor, timelock } = await cloneGov(deploymentManager);

  // Deploy shared admin and governance contracts
  const trace = deploymentManager.tracer();
  const admin = await deploymentManager.getSigner();

  // Deploy CometProxyAdmin (shared across all Comet instances)
  const cometAdmin = await deploymentManager.deploy(
    'cometAdmin',
    'CometProxyAdmin.sol',
    [],
    deploySpec.all
  );

  // Deploy Configurator implementation
  const configuratorImpl = await deploymentManager.deploy(
    'configurator:implementation',
    'Configurator.sol',
    [],
    deploySpec.all
  );

  // Deploy Configurator proxy
  const configurator = await deploymentManager.deploy(
    'configurator',
    'ConfiguratorProxy.sol',
    [
      configuratorImpl.address, 
      cometAdmin.address, 
      (await configuratorImpl.populateTransaction.initialize(timelock.address)).data
    ],
    deploySpec.all
  );


  // Deploy CometFactory (shared across all Comet instances)
  const cometFactory = await deploymentManager.deploy(
    'cometFactory',
    'CometFactory.sol',
    [],
    deploySpec.all
  );

  // Deploy CometRewards (shared across all Comet instances)
  const rewards = await deploymentManager.deploy(
    'rewards',
    'CometRewards.sol',
    [timelock.address],
    deploySpec.all
  );

  // Transfer cometAdmin ownership to timelock
  await deploymentManager.idempotent(
    async () => (await cometAdmin.owner()) !== timelock.address,
    async () => {
      trace(`Transferring ownership of CometProxyAdmin to ${timelock.address}`);
      trace(await wait(cometAdmin.connect(admin).transferOwnership(timelock.address)));
    }
  );

  trace(`Attempting to mint tokens to fauceteer as ${admin.address}...`);


  console.log('Infrastructure deployment complete!');

  return {
    // Governance
    governor,
    timelock,
    COMP,
    
    // Shared Admin & Governance
    cometAdmin,
    cometFactory,
    configurator,
    rewards
  };
} 