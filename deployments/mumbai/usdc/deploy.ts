import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

const clone = {
  usdcImpl: '0xa2327a938Febf5FEC13baCFb16Ae10EcBc4cbDCF',
  usdcProxy: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  wbtc: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  wmatic: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  dai: '0x6b175474e89094c44da98b954eedeac495271d0f'
};

const FX_CHILD = "0xCf73231F28B7331BBe3124B907840A94851f9f11";
const GOERLI_TIMELOCK = "0x8Fa336EB4bF58Cfc508dEA1B0aeC7336f55B1399";

const secondsPerDay = 24 * 60 * 60;

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  await mintTokens(deploymentManager);
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer()
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  const fxChild = await deploymentManager.existing('fxChild', FX_CHILD, 'mumbai');

  // Deploy PolygonBridgeReceiver
  const bridgeReceiver = await deploymentManager.deploy(
    'bridgeReceiver',
    'bridges/polygon/PolygonBridgeReceiver.sol',
    [fxChild?.address]  // fxChild
  );

  // Deploy Local Timelock
  const localTimelock = await deploymentManager.deploy(
    'timelock',
    'vendor/Timelock.sol',
    [
      bridgeReceiver.address, // admin
      10 * 60,                // delay
      14 * secondsPerDay,     // grace period
      10 * 60,                // minimum delay
      30 * secondsPerDay      // maxiumum delay
    ]
  );

  await deploymentManager.idempotent(
    async () => !(await bridgeReceiver.initialized()),
    async () => {
      trace(`Initializing BridgeReceiver`);
      await bridgeReceiver.initialize(
        GOERLI_TIMELOCK,       // govTimelock
        localTimelock.address  // localTimelock
      );
      trace(`BridgeReceiver initialized`);
    }
  );

  // USDC
  const usdcProxyAdmin = await deploymentManager.deploy('USDC:admin', 'vendor/proxy/transparent/ProxyAdmin.sol', []);
  const usdcImpl = await deploymentManager.clone('USDC:implementation', clone.usdcImpl, []);
  const usdcProxy = await deploymentManager.clone('USDC', clone.usdcProxy, [usdcImpl.address]);
  const usdcProxyAdminSlot = '0x10d6a54a4754c8869d6886b5f5d7fbfa5b4522237ea5c60d11bc4e7a1ff9390b';
  const USDC = usdcImpl.attach(usdcProxy.address);

  await deploymentManager.idempotent(
    async () => !sameAddress(await ethers.provider.getStorageAt(usdcProxy.address, usdcProxyAdminSlot), usdcProxyAdmin.address),
    async () => {
      trace(`Changing admin of USDC proxy to ${usdcProxyAdmin.address}`);
      trace(await wait(usdcProxy.connect(signer).changeAdmin(usdcProxyAdmin.address)));

      trace(`Initializing USDC`);
      trace(await wait(USDC.connect(signer).initialize(
        'USD Coin',     // name
        'USDC',         // symbol
        'USD',          // currency
        6,              // decimals
        signer.address, // Master Minter
        signer.address, // Pauser
        signer.address, // Blacklister
        signer.address  // Owner
      )));
    }
  );

  const WBTC = await deploymentManager.clone('WBTC', clone.wbtc, []);
  const WETH = await deploymentManager.clone(
    'WETH',
    clone.weth,
    [signer.address],
    'polygon' // NOTE: cloned from Polygon, not mainnet
  );
  const WMATIC = await deploymentManager.clone(
    'WMATIC',
    clone.wmatic,
    [],
    'polygon' // NOTE: cloned from Polygon, not mainnet
  );
  const DAI = await deploymentManager.clone('DAI', clone.dai,
    [80001] // chain id
  );

  // Deploy Comet
  const deployed = await deployComet(
    deploymentManager,
    deploySpec,
    {
      governor: localTimelock.address,
      pauseGuardian: localTimelock.address
    }
  );

  // Deploy Bulker
  const bulker = await deploymentManager.deploy('bulker', 'bulkers/BaseBulker.sol', [
    localTimelock.address,
    WMATIC.address
  ]);

  // Deploy fauceteer
  const fauceteer = await deploymentManager.deploy('fauceteer', 'test/Fauceteer.sol', []);

  return {
    bridgeReceiver,
    bulker,
    fauceteer,
    fxChild,
    ...deployed
  };
}

async function mintTokens(deploymentManager: DeploymentManager) {
  const trace = deploymentManager.tracer();
  const signer = await deploymentManager.getSigner();
  const fauceteer = await deploymentManager.getContractOrThrow('fauceteer');

  trace(`Attempting to mint as ${signer.address}...`);

  const WMATIC = await deploymentManager.getContractOrThrow('WMATIC');
  await deploymentManager.idempotent(
    async () => (await WMATIC.balanceOf(signer.address)).lt(exp(0.01, 18)),
    async () => {
      trace(`Minting 0.01 WMATIC for signer (this is a precious resource!)`);
      trace(await wait(WMATIC.connect(signer).deposit({ value: exp(0.01, 18) })));
      trace(`WMATIC.balanceOf(${signer.address}): ${await WMATIC.balanceOf(signer.address)}`);
    }
  );

  const WETH = await deploymentManager.getContractOrThrow('WETH');
  await deploymentManager.idempotent(
    async () => (await WETH.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 10_000 WETH to fauceteer`);
      const amount = ethers.utils.defaultAbiCoder.encode(
        ['uint256'],
        [exp(10_000, await WETH.decimals())]
      );
      trace(await wait(WETH.connect(signer).deposit(fauceteer.address, amount)));
      trace(`WETH.balanceOf(${fauceteer.address}): ${await WETH.balanceOf(fauceteer.address)}`);
    }
  );

  // If we haven't spidered new contracts (which we could before minting, but its slow),
  //  then the proxy contract won't have the impl functions yet, so just do it explicitly
  const usdcProxy = await deploymentManager.getContractOrThrow('USDC');
  const usdcImpl = await deploymentManager.getContractOrThrow('USDC:implementation');
  const USDC = usdcImpl.attach(usdcProxy.address);
  await deploymentManager.idempotent(
    async () => (await USDC.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 100M USDC to fauceteer`);
      const amount = exp(100_000_000, await USDC.decimals());
      trace(await wait(USDC.connect(signer).configureMinter(signer.address, amount)));
      trace(await wait(USDC.connect(signer).mint(fauceteer.address, amount)));
      trace(`USDC.balanceOf(${fauceteer.address}): ${await USDC.balanceOf(fauceteer.address)}`);
    }
  );

  const WBTC = await deploymentManager.getContractOrThrow('WBTC');
  await deploymentManager.idempotent(
    async () => (await WBTC.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 20 WBTC to fauceteer`);
      const amount = exp(20, await WBTC.decimals());
      trace(await wait(WBTC.connect(signer).mint(fauceteer.address, amount)));
      trace(`WBTC.balanceOf(${fauceteer.address}): ${await WBTC.balanceOf(fauceteer.address)}`);
    }
  );

  const DAI = await deploymentManager.getContractOrThrow('DAI');
  await deploymentManager.idempotent(
    async () => (await DAI.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 100M DAI to fauceteer`);
      const amount = exp(100_000_000, await DAI.decimals());
      trace(await wait(DAI.connect(signer).mint(fauceteer.address, amount)));
      trace(`DAI.balanceOf(${fauceteer.address}): ${await DAI.balanceOf(fauceteer.address)}`);
    }
  );
}