import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { proposal } from '../../../../src/deploy';

import { expect } from 'chai';
import { ethers } from 'ethers';

const RSETH_ADDRESS = '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7';
const RSETH_PRICEFEED_ADDRESS = '0x349A73444b1a310BAe67ef67973022020d70020d';
const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';
const WEETH_PRICEFEED_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

let newRsETHPriceFeed: string;
let newWeETHPriceFeed: string;

export default migration('1719835184_update_rseth_and_weth_pricefeed', {
  async prepare(deploymentManager: DeploymentManager) {
    const _rsETHPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'pricefeeds/RsETHScalingPriceFeed.sol',
      [RSETH_PRICEFEED_ADDRESS, 8, 'rsETH / ETH exchange rate'],
      true
    );

    const _weETHPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'pricefeeds/RateBasedScalingPriceFeed.sol',
      [WEETH_PRICEFEED_ADDRESS, 8, 18, 'weETH / ETH exchange rate'],
      true
    );
    return { rsETHPriceFeed: _rsETHPriceFeed.address, weETHPriceFeed: _weETHPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { rsETHPriceFeed, weETHPriceFeed }) {
    const trace = deploymentManager.tracer();

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
    } = await deploymentManager.getContracts();

    newRsETHPriceFeed = rsETHPriceFeed;
    newWeETHPriceFeed = weETHPriceFeed;
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
    const description = '# Update rsETH and weETH price feeds in cWETHv3 on Mainnet\n\n## Proposal summary\n\nThis proposal updates existing price feeds for rsETH and weETH collaterals in the WETH market on Mainnet from market rates to exchange rates. If exchange rate oracles are implemented, Gauntlet can recommend more capital efficient parameters as the asset remains insulated from market movements, although this exposes it to tail-end risks. The exchange rate based risk parameters could facilitate higher caps and Liquidation Factors along with more conservative Liquidation Penalties.\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/878),  [forum discussion for rsETH](https://www.comp.xyz/t/add-rseth-market-on-ethereum-mainnet/5118) and [forum discussion for weETH](https://www.comp.xyz/t/add-weeth-market-on-ethereum/5179).\n\n\n## Proposal Actions\n\nThe first proposal action updates rsETH price feed from market rate to exchange rate.\n\nThe second proposal action updates weETH price feed from market rate to exchange rate.\n\nThe third action deploys and upgrades Comet to a new version.';
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      configurator
    } = await deploymentManager.getContracts();

    const rsETH = new ethers.Contract(RSETH_ADDRESS, [
      'function symbol() view returns (string)',
    ], deploymentManager.hre.ethers.provider);

    const weETH = new ethers.Contract(WEETH_ADDRESS, [
      'function symbol() view returns (string)',
    ], deploymentManager.hre.ethers.provider);

    expect(await rsETH.symbol()).to.eq('rsETH');
    const rsETHId = await configurator.getAssetIndex(comet.address, RSETH_ADDRESS);
    expect(await weETH.symbol()).to.eq('weETH');
    const weETHId = await configurator.getAssetIndex(comet.address, WEETH_ADDRESS);
    const configuration = await configurator.getConfiguration(comet.address);
    expect(configuration.assetConfigs[rsETHId].priceFeed).to.eq(newRsETHPriceFeed);
    expect(configuration.assetConfigs[weETHId].priceFeed).to.eq(newWeETHPriceFeed);
  },
});
