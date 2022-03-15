import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { deployNetworkComet } from '../../../src/deploy/Network';
import { DeployedContracts } from '../../../src/deploy/index';
import { exp, wait } from '../../../test/helpers';
import {
  deployUSDC,
  deployWBTC,
  deployWETH,
  deployCOMP,
  deployUNI,
  deployLINK,
} from '../../../src/deploy/mainnet/CloneTokens';

migration('1644388553_deploy_kovan', {
  prepare: async (deploymentManager: DeploymentManager) => {
    let [signer] = await deploymentManager.hre.ethers.getSigners();
    let signerAddress = await signer.getAddress();

    let usdc = await deployUSDC(deploymentManager, signerAddress);
    let wbtc = await deployWBTC(deploymentManager, signerAddress);
    let weth = await deployWETH(deploymentManager, signerAddress);
    let comp = await deployCOMP(deploymentManager, signerAddress);
    let uni = await deployUNI(deploymentManager, signerAddress);
    let link = await deployLINK(deploymentManager, signerAddress);

    // Contracts referenced in `configuration.json`.
    let contracts = new Map([
      ['USDC', usdc],
      ['WBTC', wbtc],
      ['WETH', weth],
      ['COMP', comp],
      ['UNI', uni],
      ['LINK', link],
    ]);

    let { comet, proxy } = await deployNetworkComet(deploymentManager, true, {}, contracts);

    return {
      comet: proxy.address,
      usdc: usdc.address,
      wbtc: wbtc.address,
      weth: weth.address,
      comp: comp.address,
      uni: uni.address,
      link: link.address,
    };
  },
  enact: async (deploymentManager: DeploymentManager, contracts) => {
    console.log('You should set roots.json to:');
    console.log('');
    console.log('');
    console.log(JSON.stringify(contracts, null, 4));
    console.log('');
  },
});
