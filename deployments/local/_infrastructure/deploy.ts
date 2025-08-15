import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { FaucetToken, SimplePriceFeed } from '../../../build/types';
import { cloneGov, exp, wait } from '../../../src/deploy';

// Helper function to create tokens (same pattern as other deployment scripts)
async function makeToken(
  deploymentManager: DeploymentManager,
  symbol: string,
  name: string,
  decimals: number
): Promise<FaucetToken> {
  const mint = (BigInt(1000000) * 10n ** BigInt(decimals)).toString();
  return deploymentManager.deploy(symbol, 'test/FaucetToken.sol', [mint, name, decimals, symbol]);
}

async function makePriceFeed(
  deploymentManager: DeploymentManager,
  alias: string,
  initialPrice: number,
  decimals: number
): Promise<SimplePriceFeed> {
  return deploymentManager.deploy(alias, 'test/SimplePriceFeed.sol', [initialPrice * 1e8, decimals]);
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
  const proxyAdmin = await deploymentManager.deploy(
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
  const configuratorProxy = await deploymentManager.deploy(
    'configurator',
    'ConfiguratorProxy.sol',
    [
      configuratorImpl.address, 
      timelock.address, 
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

  // Transfer proxyAdmin ownership to timelock
  await deploymentManager.idempotent(
    async () => (await proxyAdmin.owner()) !== timelock.address,
    async () => {
      trace(`Transferring ownership of CometProxyAdmin to ${timelock.address}`);
      trace(await wait(proxyAdmin.connect(admin).transferOwnership(timelock.address)));
    }
  );

  // Deploy test tokens
  const DAI = await makeToken(deploymentManager, 'DAI', 'DAI', 18);
  const WETH = await makeToken(deploymentManager, 'WETH', 'Wrapped Ether', 18);
  const WBTC = await makeToken(deploymentManager, 'WBTC', 'Wrapped Bitcoin', 8);
  const LINK = await makeToken(deploymentManager, 'LINK', 'Chainlink', 18);
  const UNI = await makeToken(deploymentManager, 'UNI', 'Uniswap', 18);

  // Deploy price feeds using makePriceFeed function
  const daiPriceFeed = await makePriceFeed(deploymentManager, 'daiPriceFeed', 1, 8); // $1.00 price
  const wethPriceFeed = await makePriceFeed(deploymentManager, 'wethPriceFeed', 2000, 8); // $2000 price
  const wbtcPriceFeed = await makePriceFeed(deploymentManager, 'wbtcPriceFeed', 40000, 8); // $40000 price
  const compPriceFeed = await makePriceFeed(deploymentManager, 'compPriceFeed', 50, 8); // $50 price
  const linkPriceFeed = await makePriceFeed(deploymentManager, 'linkPriceFeed', 15, 8); // $15 price
  const uniPriceFeed = await makePriceFeed(deploymentManager, 'uniPriceFeed', 10, 8); // $10 price

  trace(`Attempting to mint tokens to fauceteer as ${admin.address}...`);

  // Mint tokens to fauceteer
  const tokenConfigs = [
    { token: DAI, units: 1e8, name: 'DAI' },
    { token: WETH, units: 1e6, name: 'WETH' },
    { token: WBTC, units: 1e4, name: 'WBTC' },
    { token: LINK, units: 1e7, name: 'LINK' },
    { token: UNI, units: 1e7, name: 'UNI' },
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
    cometAdmin: proxyAdmin,
    configuratorImpl,
    configuratorProxy,
    cometFactory,
    rewards,
    
    // Tokens
    DAI,
    WETH,
    WBTC,
    LINK,
    UNI,
    
    // Price Feeds
    daiPriceFeed,
    wethPriceFeed,
    wbtcPriceFeed,
    compPriceFeed,
    linkPriceFeed,
    uniPriceFeed,
  };
} 