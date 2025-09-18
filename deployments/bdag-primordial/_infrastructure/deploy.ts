import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { FaucetToken } from '../../../build/types';
import { cloneGov, exp, wait } from '../../../src/deploy';

// Helper function to create tokens (same pattern as other deployment scripts)
async function getExistingOrMakeToken(
  deploymentManager: DeploymentManager,
  symbol: string,
  name: string,
  decimals: number,
  address: string
): Promise<FaucetToken> {
  if (address && address !== '') {
    const existing = await deploymentManager.existing(symbol, address, 'bdag-primordial', 'contracts/test/FaucetToken.sol:FaucetToken');
    if (existing) {
      return existing as FaucetToken;
    }
  }
  const mint = (BigInt(1000000) * 10n ** BigInt(decimals)).toString();
  return deploymentManager.deploy(symbol, 'test/FaucetToken.sol', [mint, name, decimals, symbol]);
}

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

  // Deploy test tokens (use existing deployed addresses)
  const DAI = await getExistingOrMakeToken(deploymentManager, 'DAI', 'DAI', 18, '0xeF4555a8ee300250DeFa1f929FEfa2A3a9af628a');
  const WETH = await getExistingOrMakeToken(deploymentManager, 'WETH', 'Wrapped Ether', 18, '0xf5aD60F3B4F86D1Ef076fB4e26b4A4FeDbE7a93b');
  const WBTC = await getExistingOrMakeToken(deploymentManager, 'WBTC', 'Wrapped Bitcoin', 8, '0x7c9Dfdc92A707937C4CfD1C21B3BBA5220D4f3A2');
  const LINK = await getExistingOrMakeToken(deploymentManager, 'LINK', 'Chainlink', 18, '0x4686A8C76a095584112AC3Fd0362Cb65f7C11b8B');
  const UNI = await getExistingOrMakeToken(deploymentManager, 'UNI', 'Uniswap', 18, '0xc1031Cfd04d0c68505B0Fc3dFdfC41DF391Cf6A6');
  const USDC = await getExistingOrMakeToken(deploymentManager, 'USDC', 'USD Coin', 6, '0x27E8e32f076e1B4cc45bdcA4dbA5D9D8505Bab43');

  trace(`Attempting to mint tokens to fauceteer as ${admin.address}...`);

  // Mint tokens to fauceteer
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
    rewards,
    
    // Tokens
    DAI,
    WETH,
    WBTC,
    LINK,
    UNI,
    USDC,
  };
} 