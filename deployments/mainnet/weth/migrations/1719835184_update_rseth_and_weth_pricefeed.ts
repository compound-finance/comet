import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const RSETH_ADDRESS = '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7';
const RSETH_PRICEFEED_ADDRESS = '0x349A73444b1a310BAe67ef67973022020d70020d';
const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';
const WEETH_PRICEFEED_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

export default migration('1719835184_update_rseth_and_weth_pricefeed', {
  async prepare(deploymentManager: DeploymentManager) {
    // const _wbtcScalingPriceFeed = await deploymentManager.deploy(
    //   'WBTC:priceFeed',
    //   'pricefeeds/WBTCPriceFeed.sol',
    //   [
    //     WBTC_BTC_PRICE_FEED_ADDRESS,  // WBTC / BTC price feed
    //     BTC_ETH_PRICE_FEED_ADDRESS,   // BTC / ETH price feed 
    //     8,                            // decimals
    //   ]
    // );
    const _rsETHPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'pricefeeds/RsETHScalingPriceFeed.sol',
      [RSETH_PRICEFEED_ADDRESS, 8, 'rsETH / ETH exchange rate']
    );
    
    const _weETHPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'pricefeeds/RateBasedScalingPriceFeed.sol',
      [WEETH_PRICEFEED_ADDRESS, 8, 18, 'weETH / ETH exchange rate']
    );
    return { rsETHPriceFeed: _rsETHPriceFeed.address, weETHPriceFeed: _weETHPriceFeed.address};
  },

  async enact(deploymentManager: DeploymentManager, _, { rsETHPriceFeed, weETHPriceFeed }) {
    const trace = deploymentManager.tracer();

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Update the price feed for rsETH
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, RSETH_ADDRESS, rsETHPriceFeed],
      },
      // 2. Update the price feed for weETH
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WEETH_ADDRESS, weETHPriceFeed],
      },
      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];
    const description = 'DESCRIPTION';
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

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      configurator
    } = await deploymentManager.getContracts();

    const rsETH = new deploymentManager.hre.ethers.Contract(RSETH_ADDRESS, [
      'function symbol() view returns (string)',
    ]);

    const weETH = new deploymentManager.hre.ethers.Contract(WEETH_ADDRESS, [
      'function symbol() view returns (string)',
    ]);

    expect(await rsETH.symbol()).to.eq('rsETH');
    expect(await weETH.symbol()).to.eq('weETH');
    const configuration = await configurator.getConfiguration(comet.address);
    expect(configuration.priceFeed.assetConfigs[RSETH_ADDRESS]).to.eq(RSETH_PRICEFEED_ADDRESS);
    expect(configuration.priceFeed.assetConfigs[WEETH_ADDRESS]).to.eq(WEETH_PRICEFEED_ADDRESS);
  },
});
