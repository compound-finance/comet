import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const cETHAddress = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5';
const COMPAddress = '0xc00e94cb662c3520282e6f5717214004a7f26888';

export default migration('1666906928_raise_supply_caps_and_seed_reserves_and_rewards', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comptrollerV2,
      comet,
      configurator,
      cometAdmin,
      rewards,
      WETH,
      wstETH,
      cbETH,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Set v2 cETH speeds to 0
      {
        contract: comptrollerV2,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        args: [[cETHAddress], [0], [0]],
      },

      // 2. Increase v3 supply reward speed
      {
        contract: configurator,
        signature: 'setBaseTrackingSupplySpeed(address,uint64)',
        args: [comet.address, exp(38.7 / 86400, 15, 18)], // ~ 38.7 COMP / day cut from v2
      },

      // 3. Increase supply caps for each of the assets
      {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, wstETH.address, exp(80_000, 18)], // ~ $100M / $1225
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, cbETH.address, exp(9_000, 18)], // ~ $10M / $1091
      },

      // 4. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 5. Set the rewards configuration to COMP
      {
        contract: rewards,
        signature: "setRewardConfig(address,address)",
        args: [comet.address, COMPAddress],
      },

      // 6. Wrap ETH as WETH and send from Timelock to Comet to seed reserves
      {
        contract: WETH,
        signature: "deposit()",
        args: [],
        value: exp(1_000, 18)
      }, {
        contract: WETH,
        signature: "transfer(address,uint256)",
        args: [comet.address, exp(1_000, 18)],
      },
    ];
    const description = "# Initialize cWETHv3 on Ethereum" // XXX
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },


  async verify(deploymentManager: DeploymentManager) {
    const {
      comptrollerV2,
      comet,
      rewards,
      WETH,
      wstETH,
      cbETH,
    } = await deploymentManager.getContracts();

    // 1.
    expect(await comptrollerV2.compSupplySpeeds(cETHAddress)).to.be.equal(0);
    expect(await comptrollerV2.compBorrowSpeeds(cETHAddress)).to.be.equal(0);

    // 2. & 4.
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(447916666666n);
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(0);

    // 3. & 4.
    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);
    expect(wstETHInfo.supplyCap).to.be.equal(exp(80_000, 18));

    const cbETHInfo = await comet.getAssetInfoByAddress(cbETH.address);
    expect(cbETHInfo.supplyCap).to.be.equal(exp(9_000, 18));

    // 5.
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token.toLowerCase()).to.be.equal(COMPAddress);
    expect(config.rescaleFactor).to.be.equal(1000000000000n);
    expect(config.shouldUpscale).to.be.equal(true);

    // 6.
    expect(await WETH.balanceOf(comet.address)).to.be.equal(exp(1_000, 18));
  },
});
