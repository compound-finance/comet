import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { cloneGov, exp, wait } from '../../../src/deploy';
import { getExistingTokens } from '../helpers';


export default async function deploy(deploymentManager: DeploymentManager, deploySpec: any): Promise<Deployed> {
  console.log('Deploying infrastructure components...');

  // Set verification strategy to none to skip contract verification
  deploymentManager.setVerificationStrategy('none');

  // Deploy governance contracts
  const { COMP, fauceteer, governor, timelock } = await cloneGov(deploymentManager);

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

  // Get existing test tokens using helper function
  const { DAI, WETH, WBTC, LINK, UNI, USDC } = await getExistingTokens(deploymentManager);

  trace(`Attempting to mint tokens to fauceteer as ${admin.address}...`);

  const tokenConfigs = [
    { token: DAI, units: 1e8, name: 'DAI' },
    { token: WETH, units: 1e6, name: 'WETH' },
    { token: WBTC, units: 1e4, name: 'WBTC' },
    { token: LINK, units: 1e7, name: 'LINK' },
    { token: UNI, units: 1e7, name: 'UNI' },
    { token: USDC, units: 1e6, name: 'USDC' },
  ];

  await Promise.all(
    tokenConfigs.map(({ token, units, name }) => {
      return deploymentManager.idempotent(
        async () => (await token.balanceOf(fauceteer.address)).eq(0),
        async () => {
          trace(`Minting ${units} ${name} to fauceteer`);
          const amount = exp(units, await token.decimals());
          trace(await wait(token.connect(admin).allocateTo(fauceteer.address, amount)));
          trace(`token.balanceOf(${fauceteer.address}): ${await token.balanceOf(fauceteer.address)}`);
        }
      );
    })
  );

  console.log('Infrastructure deployment complete!');

  return {
    // Governance
    fauceteer,
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