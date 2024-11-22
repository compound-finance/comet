import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp } from '../../../../src/deploy';

const MULTISIG_ADDRESS = "0xD0DD789BcF66b36046b0424EfE8b2D83be36FE89";
const FAUCETEER_ADDRESS = "0x68793eA49297eB75DFB4610B68e076D2A5c7646C";

const config = {
  adminUSDC: exp(100_000, 6),
  adminWBTC: exp(2_000, 8),
  adminCOMP: exp(500_000, 18),
  fauceteerUSDC: exp(600_000, 6),
  fauceteerWBTC: exp(20_000, 8),
  fauceteerCOMP: exp(3_000_000, 18),
};

const tokenArgsUSDC: [bigint, string, number, string] = [config.adminUSDC + config.fauceteerUSDC, 'Test Token RewardsV2 USDC', 6, 'TEST_REWARDS_V2_USDC'];
const tokenArgsWBTC: [bigint, string, number, string] = [config.adminWBTC + config.fauceteerWBTC, 'Test Token RewardsV2 WBTC', 8, 'TEST_REWARDS_V2_WBTC'];
const tokenArgsCOMP: [bigint, string, number, string] = [config.adminCOMP + config.fauceteerCOMP, 'Test Token RewardsV2 COMP', 18, 'TEST_REWARDS_V2_COMP'];

export default migration('1730291787_add_rewards_v2', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometRewardsV2 = await deploymentManager.deploy(
      'CometRewardsV2',
      'CometRewardsV2.sol',
      [
        MULTISIG_ADDRESS,   // The governor who will control the contract
      ]
    );

    const faucetToken1 = await deploymentManager.deploy(
      'testnet:USDC',
      'test/StandardToken.sol',
      tokenArgsUSDC
    );

    const faucetToken2 = await deploymentManager.deploy(
      'testnet:WBTC',
      'test/StandardToken.sol',
      tokenArgsWBTC
    );

    const faucetToken3 = await deploymentManager.deploy(
      'testnet:COMP',
      'test/StandardToken.sol',
      tokenArgsCOMP
    );

    await faucetToken1.transfer(FAUCETEER_ADDRESS, config.fauceteerUSDC);
    await faucetToken2.transfer(FAUCETEER_ADDRESS, config.fauceteerWBTC);
    await faucetToken3.transfer(FAUCETEER_ADDRESS, config.fauceteerCOMP);

    return { cometRewardsV2Address: cometRewardsV2.address };
  },

  enact: async (deploymentManager: DeploymentManager, _, { cometRewardsV2Address }) => {
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const cometRewardsV2 = await deploymentManager.fromDep('CometRewardsV2', 'mainnet', 'usdc');

    const faucetToken1 = await deploymentManager.fromDep('testnet:USDC', 'mainnet', 'usdc');
    const faucetToken2 = await deploymentManager.fromDep('testnet:WBTC', 'mainnet', 'usdc');
    const faucetToken3 = await deploymentManager.fromDep('testnet:COMP', 'mainnet', 'usdc');

    expect(config.fauceteerUSDC).to.be.equal(await faucetToken1.balanceOf(FAUCETEER_ADDRESS));
    expect(config.fauceteerWBTC).to.be.equal(await faucetToken2.balanceOf(FAUCETEER_ADDRESS));
    expect(config.fauceteerCOMP).to.be.equal(await faucetToken3.balanceOf(FAUCETEER_ADDRESS));
    
    expect(MULTISIG_ADDRESS).to.be.equal(await cometRewardsV2.governor());
  },
});
