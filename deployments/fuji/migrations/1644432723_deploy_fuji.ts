import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { deployNetworkComet } from '../../../src/deploy/Network';
import { exp, wait } from '../../../test/helpers';
import { ProxyAdmin, ProxyAdmin__factory } from '../../../build/types';
import { loadNetworkConfiguration } from '../../../src/deploy/NetworkConfiguration';
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
    let [signer] = await deploymentManager.hre.ethers.getSigners();
    let signerAddress = await signer.getAddress();
    const { governor } = await loadNetworkConfiguration("fuji");

    let usdcProxyAdminArgs: [] = [];
    let usdcProxyAdmin = await deploymentManager.deploy<ProxyAdmin, ProxyAdmin__factory, []>(
      'vendor/proxy/transparent/ProxyAdmin.sol',
      usdcProxyAdminArgs
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
    // Give signer 10,000 USDC
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
    await wait(usdc.configureMinter(signerAddress, exp(10000, 6)));
    await wait(usdc.mint(signerAddress, exp(10000, 6)));

    let wbtc = await deploymentManager.clone(cloneAddr.wbtc, [], cloneNetwork);
    // Give signer 1000 WBTC
    await wait(
      wbtc.mint(
        signerAddress,
        exp(10000, 8),
        '0x0000000000000000000000000000000000000000',
        0,
        '0x0000000000000000000000000000000000000000000000000000000000000000'
      )
    );

    let wavax = await deploymentManager.clone(cloneAddr.wavax, [], cloneNetwork);
    // Give admin 0.01 WAVAX tokens [this is a precious resource here!]
    await wait(wavax.deposit({ value: exp(0.01, 18) }));

    // Contracts referenced in `configuration.json`.
    let contracts = new Map<string, Contract>([
      ['USDC', usdc],
      ['WBTC.e', wbtc],
      ['WAVAX', wavax],
    ]);

    if (signerAddress !== governor) {
      for (const [contractName, contract] of contracts) {
        console.log(`transferring ${await contract.balanceOf(signerAddress)} ${contractName} to governor`);

        await contract.connect(signer).transfer(
          governor,
          await contract.balanceOf(signerAddress)
        );

        console.log(`transfer complete; ${contractName}.balanceOf(governor): ${await contract.balanceOf(governor)}`);
      }
    }

    let { cometProxy, configuratorProxy } = await deployNetworkComet(deploymentManager, true, {}, contracts);

    return {
      comet: cometProxy.address,
      configurator: configuratorProxy.address,
      usdc: usdc.address,
      wbtc: wbtc.address,
      wavax: wavax.address,
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts) => {
    console.log("You should set roots.json to:");
    console.log("");
    console.log("");
    console.log(JSON.stringify(contracts, null, 4));
    console.log("");
  },
});
