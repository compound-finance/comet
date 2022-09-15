import { Deployed, DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { Fauceteer, ProxyAdmin } from '../../../build/types';
import { DeploySpec, cloneGov, deployComet, exp, sameAddress, wait } from '../../../src/deploy';

const cloneNetwork = 'avalanche';
const clone = {
  usdcImpl: '0xa3fa3d254bf6af295b5b22cc6730b04144314890',
  usdcProxy: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  wbtc: '0x50b7545627a5162f82a992c33b87adc75187b218',
  wavax: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
};

export default async function deploy(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  await mintTokens(deploymentManager);
  return deployed;
}

async function deployContracts(deploymentManager: DeploymentManager, deploySpec: DeploySpec): Promise<Deployed> {
  const trace = deploymentManager.tracer();
  const ethers = deploymentManager.hre.ethers;
  const signer = await deploymentManager.getSigner();

  // Deploy governance contracts
  const { fauceteer, governor, timelock } = await cloneGov(deploymentManager);

  const usdcProxyAdmin = await deploymentManager.deploy('USDC:admin', 'vendor/proxy/transparent/ProxyAdmin.sol', []);
  const usdcImpl = await deploymentManager.clone('USDC:implementation', clone.usdcImpl, [], cloneNetwork);
  const usdcProxy = await deploymentManager.clone('USDC', clone.usdcProxy, [usdcImpl.address], cloneNetwork);
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

  const WBTC = await deploymentManager.clone('WBTC.e', clone.wbtc, [], cloneNetwork);
  const WAVAX = await deploymentManager.clone('WAVAX', clone.wavax, [], cloneNetwork);

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec);

  // TODO: Bulker for Avalanche

  return { ...deployed, fauceteer };
}

async function mintTokens(deploymentManager: DeploymentManager) {
  const trace = deploymentManager.tracer();
  const signer = await deploymentManager.getSigner();
  const contracts = await deploymentManager.contracts();
  const timelock = contracts.get('timelock');
  const fauceteer = contracts.get('fauceteer');

  trace(`Attempting to mint as ${signer.address}...`);

  const WAVAX = contracts.get('WAVAX');
  await deploymentManager.idempotent(
    async () => (await WAVAX.balanceOf(signer.address)).lt(exp(0.01, 18)),
    async () => {
      trace(`Minting 0.01 WAVAX for signer (this is a precious resource!)`);
      trace(await wait(WAVAX.connect(signer).deposit({ value: exp(0.01, 18) })));
      trace(`WAVAX.balanceOf(${signer.address}): ${await WAVAX.balanceOf(signer.address)}`);
    }
  );

  // If we haven't spidered new contracts (which we could before minting, but its slow),
  //  then the proxy contract won't have the impl functions yet, so just do it explicitly
  const usdcProxy = contracts.get('USDC'), usdcImpl = contracts.get('USDC:implementation');
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

  const WBTC = contracts.get('WBTC.e');
  await deploymentManager.idempotent(
    async () => (await WBTC.balanceOf(fauceteer.address)).eq(0),
    async () => {
      trace(`Minting 10000 WBTC to fauceteer`);
      const amount = exp(10000, await WBTC.decimals());
      const feeAddress = '0x0000000000000000000000000000000000000000';
      const feeAmount = 0;
      const originTxId = '0x0000000000000000000000000000000000000000000000000000000000000000';
      trace(await wait(WBTC.connect(signer).mint(fauceteer.address, amount, feeAddress, feeAmount, originTxId)));
      trace(`WBTC.balanceOf(${fauceteer.address}): ${await WBTC.balanceOf(fauceteer.address)}`);
    }
  );
}
