import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { Numeric } from '../../../../test/helpers';
import { IWstETH } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETH_USD_OEV_PRICE_FEED = '0x7c7FdFCa295a787ded12Bb5c1A49A8D2cC20E3F8';

const WBTC_ADDRESS = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const WBTC_BTC_PRICE_FEED_ADDRESS = '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23';
const BTC_USD_OEV_PRICE_FEED_ADDRESS = '0xdc715c751f1cc129A6b47fEDC87D9918a4580502';

const LINK_ADDRESS = '0x514910771af9ca656af840dff83e8264ecf986ca';
const LINK_USD_OEV_PRICE_FEED_ADDRESS = '0x64c67984A458513C6BAb23a815916B1b1075cf3a';

const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';

const USDC_USD_OEV_PRICE_FEED = '0xe13fafe4FB769e0f4a1cB69D35D21EF99188EFf7';

const FEED_DECIMALS = 8;

let newWstETHPriceFeed: string;
let oldWstETHPriceFeed: string;

let newWbtcPriceFeed: string;
let oldWbtcPriceFeed: string;

let oldWETHPriceFeed: string;
let oldLinkPriceFeed: string;


export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    const wstETH = await deploymentManager.existing('wstETH', WSTETH_ADDRESS, 'mainnet', 'contracts/IWstETH.sol:IWstETH') as IWstETH;
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'weth');
    const currentRatioWstEth = await wstETH.stEthPerToken();
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/WstETHCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        ETH_USD_OEV_PRICE_FEED,
        wstETH.address,
        constantPriceFeed.address,
        'wstETH:capoPriceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4)
        }
      ],
      true
    );

    const wbtcScalingPriceFeed = await deploymentManager.deploy(
      'WBTC:priceFeed',
      'pricefeeds/WBTCPriceFeed.sol',
      [
        WBTC_BTC_PRICE_FEED_ADDRESS,
        BTC_USD_OEV_PRICE_FEED_ADDRESS,
        8
      ],
      true
    );


    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      wbtcPriceFeedAddress: wbtcScalingPriceFeed.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    wstEthCapoPriceFeedAddress,
    wbtcPriceFeedAddress,
  }) {

    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWbtcPriceFeed = wbtcPriceFeedAddress;

    const trace = deploymentManager.tracer();
 
    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldWbtcPriceFeed] = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    [,, oldLinkPriceFeed] = await comet.getAssetInfoByAddress(LINK_ADDRESS);

    const mainnetActions = [
      // 1. Update wstETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WSTETH_ADDRESS, wstEthCapoPriceFeedAddress],
      },
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WBTC_ADDRESS, wbtcPriceFeedAddress],
      },
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WETH_ADDRESS, ETH_USD_OEV_PRICE_FEED],
      },
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, LINK_ADDRESS, LINK_USD_OEV_PRICE_FEED_ADDRESS],
      },
      {
        contract: configurator,
        signature: 'setBaseTokenPriceFeed(address,address)',
        args: [comet.address, USDC_USD_OEV_PRICE_FEED],
      },
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];
 
    const description = `# Update wstETH, wBTC, WETH, LINK and USDC price feeds in cUSDCv3 on Mainnet with CAPO and OEV implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH, wBTC, WETH, LINK and USDC on the USDC market on Mainnet implementing CAPO and OEV.
CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes.
OEV utilizes Chainlink's SVR oracle solution that allows to recapture the non-toxic Maximal Extractable Value (MEV) derived from their use of Chainlink Price Feeds.
Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1015),  [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for OEV](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).


## Proposal actions

The first action updates wstETH price feed.
The third action updates WBTC price feed.
The fourth action updates WETH price feed.
The fifth action updates LINK price feed.
The sixth action updates USDC price feed.
The seventh action deploys and upgrades Comet to a new version.
`;

 
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );
 
    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();
              
    const wstETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WSTETH_ADDRESS
    );
  
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    ); 
  
    const wstETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];
  
    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHPriceFeed);

    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 40e8);


    const wBTCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WBTC_ADDRESS
    );
    const wBTCInCometInfo = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    const wBTCInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wBTCIndexInComet]; 

    expect(wBTCInCometInfo.priceFeed).to.eq(newWbtcPriceFeed);
    expect(wBTCInConfiguratorInfoWETHComet.priceFeed).to.eq(newWbtcPriceFeed);

    expect(await comet.getPrice(newWbtcPriceFeed)).to.be.closeTo(await comet.getPrice(oldWbtcPriceFeed), 5e10);

    const wETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH_ADDRESS
    );
    const wETHInCometInfo = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    const wETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wETHIndexInComet]; 

    expect(wETHInCometInfo.priceFeed).to.eq(ETH_USD_OEV_PRICE_FEED);
    expect(wETHInConfiguratorInfoWETHComet.priceFeed).to.eq(ETH_USD_OEV_PRICE_FEED);
    expect(await comet.getPrice(ETH_USD_OEV_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 12e8);

    const linkIndexInComet = await configurator.getAssetIndex(
      comet.address,
      LINK_ADDRESS
    );
    const linkInCometInfo = await comet.getAssetInfoByAddress(LINK_ADDRESS);
    const linkInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[linkIndexInComet]; 

    expect(linkInCometInfo.priceFeed).to.eq(LINK_USD_OEV_PRICE_FEED_ADDRESS);
    expect(linkInConfiguratorInfoWETHComet.priceFeed).to.eq(LINK_USD_OEV_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(LINK_USD_OEV_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldLinkPriceFeed), 3e7);
  },
});
