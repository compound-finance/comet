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
    const description = '# Upgrade WBTC Price Feed for Ethereum v3 USDC Market\n\nThe [Compound v3 USDC Ethereum market](https://app.compound.finance/markets?market=usdc-mainnet) currently prices WBTC using the Chainlink [BTC / USD price feed](https://etherscan.io/address/0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c). Compound Labs proposes to upgrade the price feed for WBTC to a [custom price feed](https://etherscan.io/address/0x45939657d1ca34a8fa39a924b71d28fe8431e581) that factors in the exchange rate between WBTC and BTC to protect against potential depegging events. This [custom price feed](https://github.com/compound-finance/comet/blob/main/contracts/pricefeeds/WBTCPriceFeed.sol) is implemented by Compound Labs and has been [audited](https://gist.github.com/kacperrams/7242067e60392e4c96f9a01ba81a7026) by OpenZeppelin. The price feed was [deployed on mainnet](https://etherscan.io/tx/0xd516d4e3cc9f7540984829f4f365f417d12a1da974b3741e356365c526c6d731) 5 months ago and has soaked for some time to allow for backtesting of its price history. To ensure correctness, Gauntlet has [backtested](https://www.comp.xyz/t/upgrade-wbtc-price-feed-for-ethereum-usdc-market/4668/5) the prices returned by the custom price feed against other existing price feeds and found no problematic discrepancies.\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/766) and [forum discussion](https://www.comp.xyz/t/upgrade-wbtc-price-feed-for-ethereum-usdc-market/4668).\n\n\n## Proposal Actions\n\nThe first proposal action sets the price feed for WBTC in the Ethereum cUSDCv3 market to be the custom WBTC price feed.\n\nThe second action deploys an instance of the newly configured Comet implementation and upgrades the Comet instance to use that implementation.'
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
