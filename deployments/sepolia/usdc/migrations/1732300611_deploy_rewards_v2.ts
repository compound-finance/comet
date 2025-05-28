import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp } from '../../../../src/deploy';

const MULTISIG_ADDRESS = '0x05ED81814BE2D9731c8906133236FFE9C62B013E';
const FAUCETEER_ADDRESS = '0x68793eA49297eB75DFB4610B68e076D2A5c7646C';
const startRoot = '0xfe5afcdf35280c0e5d1a39bf61914e64324193ecb705a44da7bd7f57ce2365bb';
const duration = 60 * 60 * 24 * 30 * 3; // 3 months

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

export default migration('1732300611_deploy_rewards_v2', {
  async prepare(deploymentManager: DeploymentManager) {
    const cometRewardsV2 = await deploymentManager.deploy(
      'CometRewardsV2',
      'CometRewardsV2.sol',
      [
        MULTISIG_ADDRESS,   // The governor who will control the contract
      ]
    );

    const faucetToken1 = await deploymentManager.deploy(
      'testnet:tUSDC',
      'test/StandardToken.sol',
      tokenArgsUSDC
    );

    const faucetToken2 = await deploymentManager.deploy(
      'testnet:tWBTC',
      'test/StandardToken.sol',
      tokenArgsWBTC
    );

    const faucetToken3 = await deploymentManager.deploy(
      'testnet:tCOMP',
      'test/StandardToken.sol',
      tokenArgsCOMP
    );

    await faucetToken1.transfer(FAUCETEER_ADDRESS, config.fauceteerUSDC);
    await faucetToken2.transfer(FAUCETEER_ADDRESS, config.fauceteerWBTC);
    await faucetToken3.transfer(FAUCETEER_ADDRESS, config.fauceteerCOMP);

    return {
      cometRewardsV2Address: cometRewardsV2.address,
      faucetToken1Address: faucetToken1.address,
      faucetToken2Address: faucetToken2.address,
      faucetToken3Address: faucetToken3.address
    };
  },

  async enact(
    deploymentManager: DeploymentManager,
    _,
    {
      cometRewardsV2Address,
      faucetToken1Address,
      faucetToken2Address,
      faucetToken3Address
    }
  ) {
    const { comet } = await deploymentManager.getContracts();
    const cometRewardsV2 = await deploymentManager.existing(
      'rewardsV2',
      cometRewardsV2Address,
      'sepolia',
      'usdc'
    );
    expect((await deploymentManager.contract('rewardsV2'))?.address).to.be.equal(cometRewardsV2Address);

    await deploymentManager.putAlias('cometRewards', cometRewardsV2);
    const adminSigner = await deploymentManager.getSigner(MULTISIG_ADDRESS);
    const tx = await cometRewardsV2.connect(adminSigner).setNewCampaign(
      comet.address,
      startRoot,
      [
        faucetToken1Address,
        faucetToken2Address,
        faucetToken3Address
      ],
      duration
    );
    await tx.wait();
  },

  async enacted(): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const cometRewardsV2 = await deploymentManager.fromDep('rewardsV2', 'sepolia', 'usdc');
    expect(MULTISIG_ADDRESS.toLowerCase()).to.be.equal((await cometRewardsV2.governor()).toLowerCase());
  },
});
