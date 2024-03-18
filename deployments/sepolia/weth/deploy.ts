import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { debug, DeploySpec, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

const clone = {
  cbETHImpl: '0x31724cA0C982A31fbb5C57f4217AB585271fc9a5',
  cbETHProxy: '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704',
};

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  await mintTokens(deploymentManager);
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Declare existing assets as aliases
  const WETH = await deploymentManager.existing('WETH', '0x2D5ee574e710219a521449679A4A7f2B43f046ad', 'sepolia');
  const wstETH = await deploymentManager.existing('wstETH', '0xB82381A3fBD3FaFA77B3a7bE693342618240067b', 'sepolia');

  // Import shared contracts from cUSDCv3
  const cometAdmin = await deploymentManager.fromDep('cometAdmin', 'sepolia', 'usdc');
  const cometFactory = await deploymentManager.fromDep('cometFactory', 'sepolia', 'usdc');
  const $configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'sepolia', 'usdc');
  const configurator = await deploymentManager.fromDep('configurator', 'sepolia', 'usdc');
  const rewards = await deploymentManager.fromDep('rewards', 'sepolia', 'usdc');
  const fauceteer = await deploymentManager.fromDep('fauceteer', 'sepolia', 'usdc');

  // Clone cbETH
  const cbETHProxyAdmin = await deploymentManager.deploy('cbETH:admin', 'vendor/proxy/transparent/ProxyAdmin.sol', []);
  const cbETHImpl = await deploymentManager.clone('cbETH:implementation', clone.cbETHImpl, []);
  const cbETHProxy = await deploymentManager.clone('cbETH', clone.cbETHProxy, [cbETHImpl.address]);
  const cbETHProxyAdminSlot = '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b';
  const cbETH = cbETHImpl.attach(cbETHProxy.address);
  await deploymentManager.idempotent(
    async () => !sameAddress(await ethers.provider.getStorageAt(cbETHProxy.address, cbETHProxyAdminSlot), cbETHProxyAdmin.address),
    async () => {
      debug(`Changing admin of cbETH proxy to ${cbETHProxyAdmin.address}`);
      await wait(cbETHProxy.connect(signer).changeAdmin(cbETHProxyAdmin.address));

      debug(`Initializing cbETH`);
      await wait(cbETH.connect(signer).initialize(
        'Coinbase Wrapped Staked ETH',     // name
        'cbETH',                           // symbol
        '',                                // currency
        18,                                // decimals
        signer.address,                    // Master Minter
        signer.address,                    // Pauser
        signer.address,                    // Blacklister
        signer.address                     // Owner
      ));
    }
  );

  // Deploy stETH / ETH SimplePriceFeed
  const stETHtoETHPriceFeed = await deploymentManager.deploy(
    'stETHToETH:simplePriceFeed',
    'test/SimplePriceFeed.sol',
    [
      exp(0.98882408, 18), // Latest answer on mainnet at block 16170924
      18
    ]
  );

  // Deploy cbETH / ETH SimplePriceFeed
  const cbETHtoETHPriceFeed = await deploymentManager.deploy(
    'cbETHToETH:simplePriceFeed',
    'test/SimplePriceFeed.sol',
    [
      exp(0.97, 18),
      18
    ]
  );

  // Deploy WstETHPriceFeed
  const wstETHPriceFeed = await deploymentManager.deploy(
    'wstETH:priceFeed',
    'pricefeeds/WstETHPriceFeed.sol',
    [
      stETHtoETHPriceFeed.address,                  // stETH / ETH price feed
      wstETH.address,                               // wstETH
      8                                             // decimals
    ]
  );

  // Deploy constant price feed for WETH
  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'pricefeeds/ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  // Deploy scaling price feed for cbETH
  const cbETHScalingPriceFeed = await deploymentManager.deploy(
    'cbETH:priceFeed',
    'pricefeeds/ScalingPriceFeed.sol',
    [
      cbETHtoETHPriceFeed.address,                  // cbETH / ETH price feed
      8                                             // decimals
    ]
  );

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);
  const { comet } = deployed;

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/MainnetBulker.sol',
    [
      await comet.governor(),        // admin_
      WETH.address,                  // weth_
      wstETH.address                 // wsteth_
    ]
  );

  return { ...deployed, bulker, fauceteer };
}

async function mintTokens(deploymentManager: DeploymentManager) {
  const signer = await deploymentManager.getSigner();
  const contracts = await deploymentManager.contracts();
  const fauceteer = contracts.get('fauceteer')!;

  debug(`Attempting to mint as ${signer.address}...`);

  // If we haven't spidered new contracts (which we could before minting, but its slow),
  //  then the proxy contract won't have the impl functions yet, so just do it explicitly
  const cbETHProxy = contracts.get('cbETH')!, cbETHImpl = contracts.get('cbETH:implementation')!;
  const cbETH = cbETHImpl.attach(cbETHProxy.address);
  await deploymentManager.idempotent(
    async () => (await cbETH.balanceOf(fauceteer.address)).eq(0),
    async () => {
      debug(`Minting 1M cbETH to fauceteer`);
      const amount = exp(1_000_000, await cbETH.decimals());
      await wait(cbETH.connect(signer).configureMinter(signer.address, amount));
      await wait(cbETH.connect(signer).mint(fauceteer.address, amount));
      debug(`cbETH.balanceOf(${fauceteer.address}): ${await cbETH.balanceOf(fauceteer.address)}`);
    }
  );
}
