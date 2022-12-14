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

  // Existing contracts
  const cometAdmin = await deploymentManager.existing('cometAdmin', '0xdaff430Ef11f9dE7Fef5C017D040ff3f00a44831', 'goerli');
  const tempCometImpl = await deploymentManager.existing('comet:implementation', '0x0745E16777172E7062b082C8899ABc1a1F8417f9', 'goerli');
  const timelock = await deploymentManager.existing('timelock', '0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399', 'goerli');
  const fauceteer = await deploymentManager.existing('fauceteer', '0x75442Ac771a7243433e033F3F8EaB2631e22938f', 'goerli');
  const WETH = await deploymentManager.existing('WETH', '0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6', 'goerli');
  const wstETH = await deploymentManager.existing('wstETH', '0x4942BBAf745f235e525BAff49D31450810EDed5b', 'goerli');
  const fxRoot = await deploymentManager.existing('fxRoot', '0x3d1d3e34f7fb6d26245e6640e1c50710efff15ba', 'goerli');
  const configurator = await deploymentManager.existing('configurator', '0xB28495db3eC65A0e3558F040BC4f98A0d588Ae60', 'goerli');
  const configuratorImpl = await deploymentManager.existing('configurator:implementation', '0x4d2909A575AEFd5ABAb0B9EF19647EbD297fDbB8', 'goerli');
  const rewards = await deploymentManager.existing('rewards', '0xef9e070044d62C38D2e316146dDe92AD02CF2c2c', 'goerli');

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
    'WstETHPriceFeed.sol',
    [
      stETHtoETHPriceFeed.address,                  // stETH / ETH price feed
      wstETH.address,                               // wstETH
      8                                             // decimals
    ]
  );

  // Deploy constant price feed for WETH
  const wethConstantPriceFeed = await deploymentManager.deploy(
    'WETH:priceFeed',
    'ConstantPriceFeed.sol',
    [
      8,                                             // decimals
      exp(1, 8)                                      // constantPrice
    ]
  );

  // Deploy scaling price feed for cbETH
  const cbETHScalingPriceFeed = await deploymentManager.deploy(
    'cbETH:priceFeed',
    'ScalingPriceFeed.sol',
    [
      cbETHtoETHPriceFeed.address,                  // cbETH / ETH price feed
      8                                             // decimals
    ]
  );

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, { ...deploySpec, isNotInitialMarket: true });

  // Deploy Bulker
  const bulker = await deploymentManager.deploy(
    'bulker',
    'bulkers/MainnetBulker.sol',
    [
      timelock.address,        // admin_
      WETH.address,            // weth_
      wstETH.address           // wsteth_
    ]
  );

  return { ...deployed, bulker, fauceteer, timelock, fxRoot, configurator, rewards };
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
      debug(`Minting 10K cbETH to fauceteer`);
      const amount = exp(10_000, await cbETH.decimals());
      await wait(cbETH.connect(signer).configureMinter(signer.address, amount));
      await wait(cbETH.connect(signer).mint(fauceteer.address, amount));
      debug(`cbETH.balanceOf(${fauceteer.address}): ${await cbETH.balanceOf(fauceteer.address)}`);
    }
  );
}