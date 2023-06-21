import { expect } from 'chai';
import { diffState } from '../../../../plugins/deployment_manager';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';

interface Vars {
  newWBTCPriceFeed: string
};

export default migration('1686950699_update_wbtc_price_feed', {
  prepare: async (deploymentManager: DeploymentManager) => {
    // Deploy custom WBTC price feed
    const WBTCPriceFeed = await deploymentManager.deploy(
      'newWBTCPriceFeed',
      'pricefeeds/WBTCPriceFeed.sol',
      [
        '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23', // WBTCToBTCPriceFeed
        '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c', // BTCToUSDPriceFeed
        8                                             // decimals
      ]
    );
    return { newWBTCPriceFeed: WBTCPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      WBTC,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Update WBTC price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WBTC.address, vars.newWBTCPriceFeed],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];
    const description = 'TODO'
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number, vars: Vars) {
    const {
      comet,
    } = await deploymentManager.getContracts();

    // 1. & 2.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      WBTC: {
        priceFeed: vars.newWBTCPriceFeed
      }
    })
  }
});
