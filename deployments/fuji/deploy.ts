import { DeploymentManager } from '../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../plugins/deployment_manager/Migration';
import { deployComet } from '../../src/deploy';
import { exp, wait } from '../../test/helpers';
import {
  Fauceteer,
  Fauceteer__factory,
  ProxyAdmin,
  ProxyAdmin__factory
} from '../../build/types';
import { Contract } from 'ethers';
import { debug } from '../../plugins/deployment_manager/Utils';

let cloneNetwork = 'avalanche';
let cloneAddr = {
  usdcImplementation: '0xa3fa3d254bf6af295b5b22cc6730b04144314890',
  usdcProxy: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  wbtc: '0x50b7545627a5162f82a992c33b87adc75187b218',
  wavax: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
};

interface Vars {
  comet: string,
  configurator: string,
  fauceteer: string,
  rewards: string,
  // XXX deploy bulker once that is implemented for Avalanche
  bulker?: string
};

export default async function deploy(deploymentManager: DeploymentManager) {
  deploymentManager.shouldLazilyVerifyContracts(true);

  const newRoots = await deployContracts(deploymentManager);
  deploymentManager.putRoots(new Map(Object.entries(newRoots)));

  debug("Roots.json have been set to:");
  debug("");
  debug("");
  debug(JSON.stringify(newRoots, null, 4));
  debug("");

  // We have to re-spider to get the new deployments
  await deploymentManager.spider();

  await mintToFauceteer(deploymentManager);

  // Verify contracts after all contracts have been deployed
  await deploymentManager.verifyContracts();

  return newRoots;
}


async function deployContracts(deploymentManager: DeploymentManager): Promise<Vars> {
  let signer = await deploymentManager.getSigner();
  let signerAddress = signer.address;

  let usdcProxyAdminArgs: [] = [];
  let usdcProxyAdmin = await deploymentManager.deploy<ProxyAdmin, ProxyAdmin__factory, []>(
    'vendor/proxy/transparent/ProxyAdmin.sol',
    usdcProxyAdminArgs
  );

  let fauceteer = await deploymentManager.deploy<Fauceteer, Fauceteer__factory, []>(
    'test/Fauceteer.sol',
    []
  );

  let usdcImplementation = await deploymentManager.clone(
    cloneAddr.usdcImplementation,
    [],
    cloneNetwork
  );

  let usdc;
  let usdcProxy = await deploymentManager.clone(
    cloneAddr.usdcProxy,
    [usdcImplementation.address],
    cloneNetwork
  );

  debug(`Changing admin of USDC proxy to ${usdcProxyAdmin.address}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(usdcProxy.connect(signer_).changeAdmin(usdcProxyAdmin.address))
  )
  usdc = usdcImplementation.attach(usdcProxy.address);
  // Give signer 10,000 USDC
  debug(`Initializing USDC`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(
      usdc.connect(signer_).initialize(
        'USD Coin',
        'USDC',
        'USD',
        6,
        signerAddress,
        signerAddress,
        signerAddress,
        signerAddress
      )
    )
  );

  let wbtc = await deploymentManager.clone(cloneAddr.wbtc, [], cloneNetwork);

  let wavax = await deploymentManager.clone(cloneAddr.wavax, [], cloneNetwork);
  // Give admin 0.01 WAVAX tokens [this is a precious resource here!]
  debug(`Minting some WAVAX`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(wavax.connect(signer_).deposit({ value: exp(0.01, 18) }))
  );

  // Contracts referenced in `configuration.json`.
  let contracts = new Map<string, Contract>([
    ['USDC', usdc],
    ['WBTC.e', wbtc],
    ['WAVAX', wavax],
  ]);

  // Deploy all Comet-related contracts
  let { cometProxy, configuratorProxy, rewards } = await deployComet(
    deploymentManager,
    { all: true },
    {},
    contracts
  );

  return {
    comet: cometProxy.address,
    configurator: configuratorProxy.address,
    fauceteer: fauceteer.address,
    rewards: rewards.address,
  };
}

async function mintToFauceteer(deploymentManager: DeploymentManager) {
  const signer = await deploymentManager.getSigner();
  const signerAddress = signer.address;

  debug(`Minting as signer: ${signerAddress}`);

  const contracts = await deploymentManager.contracts();
  const fauceteer = contracts.get('fauceteer');
  const fauceteerAddress = fauceteer.address;

  // USDC
  const USDC = contracts.get('USDC');
  const usdcDecimals = await USDC.decimals();
  debug(`minting USDC@${USDC.address} to fauceteer@${fauceteerAddress}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(USDC.connect(signer_).configureMinter(signerAddress, exp(100_000_000, usdcDecimals))) // mint 100M USDC
  );
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(USDC.connect(signer_).mint(fauceteerAddress, exp(100_000_000, usdcDecimals)))
  );
  debug(`USDC.balanceOf(fauceteerAddress): ${await USDC.balanceOf(fauceteerAddress)}`);

  // WBTC
  const WBTC = contracts.get('WBTC.e');
  const wbtcDecimals = await WBTC.decimals();
  debug(`minting WBTC@${WBTC.address} to fauceteer@${fauceteerAddress}`);
  await deploymentManager.asyncCallWithRetry(
    (signer_) => wait(WBTC.connect(signer_).mint(
      fauceteer.address,
      exp(20, wbtcDecimals), // mint 20 WBTC
      '0x0000000000000000000000000000000000000000',
      0,
      '0x0000000000000000000000000000000000000000000000000000000000000000')
    )
  );
  debug(`WBTC.balanceOf(fauceteerAddress): ${await WBTC.balanceOf(fauceteerAddress)}`);
}
