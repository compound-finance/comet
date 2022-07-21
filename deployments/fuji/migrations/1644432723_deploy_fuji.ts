import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { deployNetworkComet } from '../../../src/deploy/Network';
import { exp, wait } from '../../../test/helpers';
import {
  Fauceteer,
  Fauceteer__factory,
  ProxyAdmin,
  ProxyAdmin__factory
} from '../../../build/types';
import { Contract } from 'ethers';

let cloneNetwork = 'avalanche';
let cloneAddr = {
  usdcImplementation: '0xa3fa3d254bf6af295b5b22cc6730b04144314890',
  usdcProxy: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e',
  wbtc: '0x50b7545627a5162f82a992c33b87adc75187b218',
  wavax: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
};

migration('1644432723_deploy_fuji', {
  prepare: async (deploymentManager: DeploymentManager) => {
    deploymentManager.shouldLazilyVerifyContracts(true);

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

    await wait(await usdcProxy.changeAdmin(usdcProxyAdmin.address));
    usdc = usdcImplementation.attach(usdcProxy.address);
    await wait(
      usdc.initialize(
        'USD Coin',
        'USDC',
        'USD',
        6,
        signerAddress,
        signerAddress,
        signerAddress,
        signerAddress
      )
    );

    let wbtc = await deploymentManager.clone(cloneAddr.wbtc, [], cloneNetwork);

    let wavax = await deploymentManager.clone(cloneAddr.wavax, [], cloneNetwork);
    // Give admin 0.01 WAVAX tokens [this is a precious resource here!]
    await wait(wavax.deposit({ value: exp(0.01, 18) }));

    // Contracts referenced in `configuration.json`.
    let contracts = new Map<string, Contract>([
      ['USDC', usdc],
      ['WBTC.e', wbtc],
      ['WAVAX', wavax],
    ]);

    let { cometProxy, configuratorProxy } = await deployNetworkComet(
      deploymentManager,
      { all: true },
      {},
      contracts
    );

    // Verify contracts after all contracts have been deployed
    await deploymentManager.verifyContracts();

    return {
      comet: cometProxy.address,
      configurator: configuratorProxy.address,
      fauceteer: fauceteer.address,
      usdc: usdc.address,
      wbtc: wbtc.address,
      wavax: wavax.address,
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts) => {
    deploymentManager.putRoots(new Map(Object.entries(contracts)));

    console.log("You should set roots.json to:");
    console.log("");
    console.log("");
    console.log(JSON.stringify(contracts, null, 4));
    console.log("");
  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false; // XXX
  }
});
