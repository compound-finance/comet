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
import { debug } from '../../../plugins/deployment_manager/Utils';

let cloneNetwork = 'mainnet';
let cloneAddr = {
  usdcImplementation: '0xa2327a938Febf5FEC13baCFb16Ae10EcBc4cbDCF',
  usdcProxy: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  wbtc: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
  weth: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  comp: '0xc00e94cb662c3520282e6f5717214004a7f26888',
  uni: '0x1f9840a85d5af5bf1d1762f925bdaddc4201f984',
  link: '0x514910771af9ca656af840dff83e8264ecf986ca',
};

interface Vars {
  comet: string,
  configurator: string,
  fauceteer: string,
};

migration<Vars>('1644388553_deploy_kovan', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const { ethers } = deploymentManager.hre;
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

    let wbtc = await deploymentManager.clone(
      cloneAddr.wbtc,
      [],
      cloneNetwork
    );

    let weth = await deploymentManager.clone(
      cloneAddr.weth,
      [],
      cloneNetwork
    );
    // Give admin 0.01 WETH tokens [this is a precious resource here!]
    debug(`Minting some WETH`);
    await deploymentManager.asyncCallWithRetry(
      (signer_) => wait(weth.connect(signer_).deposit({ value: exp(0.01, 18) }))
    );

    let comp = await deploymentManager.clone(
      cloneAddr.comp,
      [signerAddress],
      cloneNetwork
    );

    const blockNumber = await ethers.provider.getBlockNumber();
    const blockTimestamp = (await ethers.provider.getBlock(blockNumber)).timestamp;

    let uni = await deploymentManager.clone(
      cloneAddr.uni,
      [signerAddress, signerAddress, blockTimestamp + 100],
      cloneNetwork
    );

    let link = await deploymentManager.clone(
      cloneAddr.link,
      [],
      cloneNetwork
    );

    // Contracts referenced in `configuration.json`.
    let contracts = new Map<string, Contract>([
      ['USDC', usdc],
      ['WBTC', wbtc],
      ['WETH', weth],
      ['COMP', comp],
      ['UNI', uni],
      ['LINK', link],
    ]);

    let { cometProxy, configuratorProxy } = await deployNetworkComet(
      deploymentManager,
      { all: true },
      {},
      contracts
    );

    let newRoots = {
      comet: cometProxy.address,
      configurator: configuratorProxy.address,
      fauceteer: fauceteer.address,
    };

    deploymentManager.putRoots(new Map(Object.entries(newRoots)));

    console.log("Roots.json have been set to:");
    console.log("");
    console.log("");
    console.log(JSON.stringify(newRoots, null, 4));
    console.log("");

    return newRoots;
  },
  enact: async (deploymentManager: DeploymentManager, contracts: Vars) => {
  },
});
