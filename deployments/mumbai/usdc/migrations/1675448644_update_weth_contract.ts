import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, wait } from '../../../../test/helpers';

interface Vars {}

export default migration('1675448644_update_weth_contract', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const signer = await deploymentManager.getSigner();

    // Deploy new WETH
    const WETH = await deploymentManager.clone(
      'WETH',
      '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619',
      [signer.address],
      'polygon',
      true // force deploy to replace existing WETH contract
    );

    const fauceteer = await deploymentManager.getContractOrThrow('fauceteer');

    trace(`Attempting to mint as ${signer.address}...`);

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

    return {};
  },

  enact: async (governanceDeploymentManager: DeploymentManager, vars: Vars) => {
    // No governance changes
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },
});
