import { DeploymentManager } from '../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../plugins/deployment_manager/Migration';
import { CometInterface } from '../../../build/types';

interface Vars {
  liquidator: string;
};

const swapRouter = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const uniswapv3factory = "0x1F98431c8aD98523631AE4a59f267346ea31F984";
const weth9 = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

migration<Vars>('1657124918_deploy_liquidator', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const comet = await deploymentManager.contract('comet') as CometInterface;

    const liquidator = await deploymentManager.deploy(
      'liquidator/Liquidator.sol',
      [
        swapRouter,
        comet.address,
        uniswapv3factory,
        weth9,
        [], // XXX add assets
        []  // XXX add poolFees
      ]
    );

    return {
      liquidator: liquidator.address
    };
  },
  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    console.log("You should append to roots.json to:");
    console.log("");
    console.log("");
    console.log(JSON.stringify(vars, null, 4));
    console.log("");
  },
  enacted: async (deploymentManager: DeploymentManager) => {
    return false;
  },
});
