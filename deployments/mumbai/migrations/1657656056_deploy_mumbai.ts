import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { deployNetworkComet } from '../../../src/deploy/Network';
import { exp, wait } from '../../../test/helpers';
import {
  Fauceteer,
  Fauceteer__factory,
  ProxyAdmin,
  ProxyAdmin__factory,
} from '../../../build/types';
import { Contract } from 'ethers';

let cloneNetwork = 'polygon';
let cloneAddr = {
  usdcImplementation: '0xdd9185db084f5c4fff3b4f70e7ba62123b812226',
  usdcProxy: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  wbtc: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  wmatic: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
  comp: '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c',
};

migration('1657656056_deploy_mumbai', {
  prepare: async (deploymentManager: DeploymentManager) => {
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
    let comp = await deploymentManager.clone(cloneAddr.comp, [], cloneNetwork);

    let wmatic = await deploymentManager.clone(cloneAddr.wmatic, [], cloneNetwork);
    // Give admin 0.01 WMATIC tokens [this is a precious resource here!]
    await wait(wmatic.deposit({ value: exp(0.01, 18) }));

    // Contracts referenced in `configuration.json`.
    let contracts = new Map<string, Contract>([
      ['USDC', usdc],
      ['WBTC', wbtc],
      ['WMATIC', wmatic],
      ['COMP', comp],
    ]);

    let { cometProxy, configuratorProxy } = await deployNetworkComet(
      deploymentManager,
      { deployCometProxy: true, deployConfiguratorProxy: true },
      {},
      contracts
    );

    return {
      comet: cometProxy.address,
      configurator: configuratorProxy.address,
      fauceteer: fauceteer.address,
      usdc: usdc.address,
      wbtc: wbtc.address,
      wmatic: wmatic.address,
      comp: comp.address,
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts) => {
    deploymentManager.putRoots(new Map(Object.entries(contracts)));

    console.log('You should set roots.json to:');
    console.log('');
    console.log('');
    console.log(JSON.stringify(contracts, null, 4));
    console.log('');
  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false;
  },
});
