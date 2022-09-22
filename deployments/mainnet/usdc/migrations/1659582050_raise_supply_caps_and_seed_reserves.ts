import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

export default migration('1659582050_raise_supply_caps_and_seed_reserves', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
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
        args: [comet.address, COMP.address, exp(200_000, 18)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, WBTC.address, exp(2_100, 8)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, WETH.address, exp(27_000, 18)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, UNI.address, exp(1_250_000, 18)],
      }, {
        contract: configurator,
        signature: "updateAssetSupplyCap(address,address,uint128)",
        args: [comet.address, LINK.address, exp(1_250_000, 18)],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 3. Send USDC from Timelock to Comet
      // XXX assert that funds have been transferred by diffing the balances before and after
      {
        contract: USDC,
        signature: "transfer(address,uint256)",
        args: [comet.address, exp(500_000, 6)],
      },
    ];
    const description = "The first proposed Compound III market is USDC on Ethereum; the contracts have been tested, audited, and deployed to production, with help and input from OpenZeppelin, Chainsecurity, Certora, Gauntlet, Chainlink, and many members of the community.\n\nThis initialization proposal creates supply caps for five collateral assets, and transfers 500,000 USDC controlled by Compound Governance into the market as initial reserves. Upon execution of this proposal, you can begin using the USDC market on Ethereum.\n\n[Market parameters](https://www.comp.xyz/t/compound-iii/3351/18)\n\n[Full proposal and forum discussion](https://www.comp.xyz/t/initialize-compound-iii-usdc-on-ethereum/3499)\n"
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },
});
