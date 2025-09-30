import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';
import { DeploymentTokenInfraHelper } from '../deployment-token-infra-helper';
import { ConfiguratorModifierHelper } from '../configurator-modificator-helper';
import { exp, wait } from '../../../src/deploy';

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  // Set verification strategy to none to skip contract verification
  deploymentManager.setVerificationStrategy('none');

  const tokenInfra = await deployTokenInfra(deploymentManager);

  // Load infrastructure contracts from the _infrastructure deployment
  const infrastructureSpider = await deploymentManager.spiderOther(deploymentManager.network, '_infrastructure');
  const infrastructureContracts = {};
  // Add infrastructure contracts to the current deployment's contract map
  for (const [alias, contract] of infrastructureSpider.contracts) {
    await deploymentManager.putAlias(alias, contract);
    infrastructureContracts[alias] = contract;
  }
  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);


  return { ...tokenInfra,...deployed , ...infrastructureContracts };
}

async function deployTokenInfra(deploymentManager: DeploymentManager){

  // Deploy shared admin and governance contracts
  const trace = deploymentManager.tracer();
  const admin = await deploymentManager.getSigner();

  // Create helper with useCache = false (deploy fresh contracts)
  const helper = new DeploymentTokenInfraHelper(deploymentManager);

  // Deploy fauceteer with idempotency check
  const fauceteer = await helper.makeFauceteer();

  // Deploy test tokens
  const DAI = await helper.makeToken('DAI', 'DAI', 18);
  const USDC = await helper.makeToken('USDC', 'USDC', 6);
  const WETH = await helper.makeToken('WETH', 'Wrapped Ether', 18);
  const WBTC = await helper.makeToken('WBTC', 'Wrapped Bitcoin', 8);
  const LINK = await helper.makeToken('LINK', 'Chainlink', 18);
  const UNI = await helper.makeToken('UNI', 'Uniswap', 18);

  // Deploy price feeds using helper
  const daiPriceFeed = await helper.makePriceFeed('daiPriceFeed', 1, 8); // $1.00 price
  const usdcPriceFeed = await helper.makePriceFeed('usdcPriceFeed', 1, 8); // $1.00 price
  const wethPriceFeed = await helper.makePriceFeed('wethPriceFeed', 2000, 8); // $2000 price
  const wbtcPriceFeed = await helper.makePriceFeed('wbtcPriceFeed', 40000, 8); // $40000 price
  const compPriceFeed = await helper.makePriceFeed('compPriceFeed', 50, 8); // $50 price
  const linkPriceFeed = await helper.makePriceFeed('linkPriceFeed', 15, 8); // $15 price
  const uniPriceFeed = await helper.makePriceFeed('uniPriceFeed', 10, 8); // $10 price

  // Update configuration.json with the deployed price feed addresses
  const configHelper = new ConfiguratorModifierHelper(deploymentManager);
  await configHelper.updateAllPriceFeeds();

  trace(`Attempting to mint tokens to fauceteer as ${admin.address}...`);

  // Mint tokens to fauceteer
  const tokenConfigs = [
    { token: DAI, units: 1e8, name: 'DAI' },
    { token: USDC, units: 1e6, name: 'USDC' },
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

  return {
    fauceteer,
    // Tokens
    DAI,
    USDC,
    WETH,
    WBTC,
    LINK,
    UNI,
    
    // Price Feeds
    daiPriceFeed,
    usdcPriceFeed,
    wethPriceFeed,
    wbtcPriceFeed,
    compPriceFeed,
    linkPriceFeed,
    uniPriceFeed,
  }
}