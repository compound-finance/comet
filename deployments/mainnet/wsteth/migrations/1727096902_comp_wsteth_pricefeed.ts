import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';

const COMP_ETH_PRICE_FEED_ADDRESS = '0x1B39Ee86Ec5979ba5C322b826B3ECb8C79991699';

export default migration('1727096902_comp_wsteth_pricefeed', {
  async prepare(deploymentManager: DeploymentManager) {
    const wstETHToETHPriceFeed = await deploymentManager.fromDep('wstETH:priceFeed', 'mainnet', 'weth', true);
    const _compPriceFeed = await deploymentManager.deploy(
      'COMP:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        COMP_ETH_PRICE_FEED_ADDRESS,   // COMP / ETH price feed
        wstETHToETHPriceFeed.address,  // wstETH / ETH price feed (reversed)
        8,                             // decimals
        'COMP / wstETH price feed'     // description
      ]
    );
    return { compPriceFeedAddress: _compPriceFeed.address };
  },

  async enact() {},

  async enacted(): Promise<boolean> {
    return true;
  },

  async verify() {}
});
