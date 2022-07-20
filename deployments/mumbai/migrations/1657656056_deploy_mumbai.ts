import { Contract } from 'ethers';

import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { deployNetworkComet } from '../../../src/deploy/Network';
import { exp, wait } from '../../../test/helpers';
import {
  Fauceteer,
  Fauceteer__factory,
} from '../../../build/types';

import goerliRoots from '../../goerli/roots.json'

let cloneNetwork = 'polygon';
let cloneAddr = {
  usdcImplementation: '0xdd9185db084f5c4fff3b4f70e7ba62123b812226',
  usdcProxy: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  wbtcImplementation: '0x7ffb3d637014488b63fb9858e279385685afc1e2',
  wbtc: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6',
  weth: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
  wmatic: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
};

migration('1657656056_deploy_mumbai', {
  prepare: async (deploymentManager: DeploymentManager) => {
    let signer = await deploymentManager.getSigner();
    let signerAddress = signer.address;

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

    usdc = usdcImplementation.attach(usdcProxy.address);
    await wait(usdc.initialize('USD Coin', 'USDC', 6, signerAddress));

    let wbtcImplementation = await deploymentManager.clone(
      cloneAddr.wbtcImplementation,
      [],
      cloneNetwork
    );

    let wbtc = await deploymentManager.clone(cloneAddr.wbtc, [wbtcImplementation.address], cloneNetwork);
    wbtc = wbtcImplementation.attach(wbtc.address);
    await wait(wbtc.initialize('Wrapped Bitcoin', 'WBTC', 8, signerAddress));

    let weth = await deploymentManager.clone(cloneAddr.weth, [signerAddress], cloneNetwork);

    let wmatic = await deploymentManager.clone(cloneAddr.wmatic, [], cloneNetwork);
    // Give admin 0.01 WMATIC tokens [this is a precious resource here!]
    await wait(wmatic.deposit({ value: exp(0.01, 18) }));

    // Contracts referenced in `configuration.json`.
    let contracts = new Map<string, Contract>([
      ['USDC', usdc],
      ['WBTC', wbtc],
      ['WETH', weth],
      ['WMATIC', wmatic],
    ]);

    let { cometProxy, configuratorProxy } = await deployNetworkComet(
      deploymentManager,
      { deployCometProxy: true, deployConfiguratorProxy: true },
      {
        governor: goerliRoots.timelock,
      },
      contracts
    );

    return {
      comet: cometProxy.address,
      configurator: configuratorProxy.address,
      fauceteer: fauceteer.address,
      usdc: usdc.address,
      wbtc: wbtc.address,
      weth: weth.address,
      wmatic: wmatic.address,
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
