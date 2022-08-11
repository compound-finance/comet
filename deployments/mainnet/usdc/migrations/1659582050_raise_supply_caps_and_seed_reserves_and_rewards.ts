import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, debug, exp, proposal } from '../../../../src/deploy';

const comptrollerAddress = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';

export default migration('1659582050_raise_supply_caps_and_seed_reserves_and_rewards', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
      USDC,
      COMP,
      WBTC,
      WETH,
      UNI,
      LINK
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Increase supply caps for each of the assets
      {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, COMP.address, exp(150_000, 18)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, WBTC.address, exp(2_000, 8)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, WETH.address, exp(25_000, 18)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, UNI.address, exp(250_000, 18)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, LINK.address, exp(1_000_000, 18)],
      },

      // 2. Increase borrow reward speed
      // XXX set minimal supply speed for tracking?
      {
        contract: configurator,
        signature: "setBaseTrackingBorrowSpeed(address,uint64)",
        args: [comet.address, exp(50 / 86400, 15)], // 50 COMP / day
      },

      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 4. Send USDC from Timelock to Comet
      // XXX assert that funds have been transferred by diffing the balances before and after
      {
        contract: USDC,
        signature: "transfer(address,uint256)",
        args: [comet.address, exp(500_000, 6)],
      },

      // 5. Stream COMP
      {
        target: comptrollerAddress,
        signature: "_setContributorCompSpeed(address,uint256)",
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint'],
          [rewards.address, exp(50 / 86400 * 13.5, 18)], // 50 COMP / day * avg block time
        )
      },
    ];
    const description = "Increase supply caps and borrow speed, seed Comet USDC reserves from Timelock, and stream COMP to CometRewards";
    const txn = await deploymentManager.retry(
      async () => (await governor.propose(...await proposal(actions, description))).wait()
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    debug(`Created proposal ${proposalId}.`);
  }
});
