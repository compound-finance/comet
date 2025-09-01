import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { Numeric } from '../../../../test/helpers';
import { IWstETH, IRateProvider, AggregatorV3Interface } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETH_USD_OEV_PRICE_FEED = '0x7c7FdFCa295a787ded12Bb5c1A49A8D2cC20E3F8';

const WBTC_ADDRESS = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const WBTC_BTC_PRICE_FEED = '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23';
const BTC_USD_OEV_PRICE_FEED = '0xdc715c751f1cc129A6b47fEDC87D9918a4580502';

const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';

const SFRAX_ADDRESS = '0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32';
const FRAX_TO_USD_PRICE_FEED = '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD';

const LINK_ADDRESS = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
const LINK_USD_OEV_PRICE_FEED = '0x64c67984A458513C6BAb23a815916B1b1075cf3a';

const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

const METH_ADDRESS = '0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa';
const METH_TO_ETH_PRICE_FEED = '0x5Bd3E64F6702F55e744e70e27281a7cAABf7de46';

const USDT_USD_OEV_PRICE_FEED = '0x9df238BE059572d7211F1a1a5fEe609F979AAD2d';

const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;

let newWstETHPriceFeed: string;
let newSFraxPriceFeed: string;

let oldWstETHPriceFeed: string;
let oldSFraxPriceFeed: string;

let newWbtcPriceFeed: string;
let oldWbtcPriceFeed: string;

let oldWETHPriceFeed: string;

let newWeEthPriceFeed: string;
let oldWeEthPriceFeed: string;

let newMETHPriceFeed: string;
let oldMETHPriceFeed: string;

let oldLINKPriceFeed: string;

let oldUSDTPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    const wstETH = await deploymentManager.existing('wstETH', WSTETH_ADDRESS, 'mainnet', 'contracts/IWstETH.sol:IWstETH') as IWstETH;
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'weth');
    const currentRatioWstEth = await wstETH.stEthPerToken();
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/WstETHCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_OEV_PRICE_FEED,
        wstETH.address,
        constantPriceFeed.address,
        'wstETH / USD capo price feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4) // 4.04%
        }
      ],
      true
    );

    const sFraxCapoPriceFeed = await deploymentManager.deploy(
      'sFRAX:priceFeed',
      'capo/contracts/ERC4626CorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        FRAX_TO_USD_PRICE_FEED,
        SFRAX_ADDRESS,
        'sFRAX / USD capo price feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0495, 4) // 4.95%
        }
      ],
      true
    );

    const wbtcScalingPriceFeed = await deploymentManager.deploy(
      'WBTC:priceFeed',
      'pricefeeds/WBTCPriceFeed.sol',
      [
        WBTC_BTC_PRICE_FEED,
        BTC_USD_OEV_PRICE_FEED,
        8
      ],
      true
    );
    
    const rateProviderWeETH = await deploymentManager.existing('weETH:_rateProvider', WEETH_ADDRESS, 'mainnet', 'contracts/capo/contracts/interfaces/IRateProvider.sol:IRateProvider') as IRateProvider;

    const currentRatioWeETH = await rateProviderWeETH.getRate();
    const weETHCapoPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'capo/contracts/RateBasedCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        WEETH_ADDRESS,
        ETH_USD_OEV_PRICE_FEED,
        'weETH / ETH capo price feed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioWeETH,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0323, 4) // 3.23%
        }
      ],
      true
    );

    const rateProviderMEth = await deploymentManager.existing('mETH:_rateProvider', METH_TO_ETH_PRICE_FEED, 'mainnet', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioMEth] = await rateProviderMEth.latestRoundData();
    const mEthCapoPriceFeed = await deploymentManager.deploy(
      'mETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_OEV_PRICE_FEED,
        METH_TO_ETH_PRICE_FEED,
        'mETH / USD capo price feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioMEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0391, 4)
        }
      ],
      true
    );

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      sFraxCapoPriceFeedAddress: sFraxCapoPriceFeed.address,
      WBTCPriceFeedAddress: wbtcScalingPriceFeed.address,
      weETHCapoPriceFeedAddress: weETHCapoPriceFeed.address,
      mEthCapoPriceFeedAddress: mEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    wstEthCapoPriceFeedAddress,
    sFraxCapoPriceFeedAddress,
    WBTCPriceFeedAddress,
    weETHCapoPriceFeedAddress,
    mEthCapoPriceFeedAddress,
  }) {
    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newSFraxPriceFeed = sFraxCapoPriceFeedAddress;
    newWbtcPriceFeed = WBTCPriceFeedAddress;
    newWeEthPriceFeed = weETHCapoPriceFeedAddress;
    newMETHPriceFeed = mEthCapoPriceFeedAddress;

    const trace = deploymentManager.tracer();
 
    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldSFraxPriceFeed] = await comet.getAssetInfoByAddress(SFRAX_ADDRESS);
    [,, oldWbtcPriceFeed] = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    [,, oldLINKPriceFeed] = await comet.getAssetInfoByAddress(LINK_ADDRESS);
    [,, oldWeEthPriceFeed] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    [,, oldMETHPriceFeed] = await comet.getAssetInfoByAddress(METH_ADDRESS);
    oldUSDTPriceFeed = await comet.baseTokenPriceFeed();

    const mainnetActions = [
      // 1. Update wstETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WSTETH_ADDRESS, wstEthCapoPriceFeedAddress],
      },
      // 2. Update sFRAX price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, SFRAX_ADDRESS, sFraxCapoPriceFeedAddress],
      },
      // 3. Update WBTC price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WBTC_ADDRESS, WBTCPriceFeedAddress],
      },
      // 4. Update WETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WETH_ADDRESS, ETH_USD_OEV_PRICE_FEED],
      },
      // 5. Update LINK price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, LINK_ADDRESS, LINK_USD_OEV_PRICE_FEED],
      },
      // 6. Update USDT price feed
      {
        contract: configurator,
        signature: 'setBaseTokenPriceFeed(address,address)',
        args: [comet.address, USDT_USD_OEV_PRICE_FEED],
      },
      // 7. Update weETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WEETH_ADDRESS, weETHCapoPriceFeedAddress],
      },
      // 8. Update mETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, METH_ADDRESS, mEthCapoPriceFeedAddress],
      },
      // 9. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Update wstETH, sFRAX, wBTC, WETH, mETH, LINK and USDT price feeds in cUSDTv3 on Mainnet with CAPO and OEV implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH, sFRAX, wBTC, WETH, mETH, LINK and USDT on the USDT market on Mainnet implementing CAPO and OEV.
CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes.
OEV utilizes Chainlink's SVR oracle solution that allows to recapture the non-toxic Maximal Extractable Value (MEV) derived from their use of Chainlink Price Feeds.
Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1015),  [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for OEV](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).


## Proposal actions

The first action updates wstETH price feed.
The second action updates sFRAX price feed.
The third action updates WBTC price feed.
The fourth action updates WETH price feed.
The fifth action updates LINK price feed.
The sixth action updates USDT price feed.
The seventh action updates weETH price feed.
The eighth action updates mETH price feed.
The ninth action deploys and upgrades Comet to a new version.
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
    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 40e8); // 30$ deviation


    const sFraxIndexInComet = await configurator.getAssetIndex(
      comet.address,
      SFRAX_ADDRESS
    ); 

    const sFraxInCometInfo = await comet.getAssetInfoByAddress(
      SFRAX_ADDRESS
    );

    const sFraxInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[sFraxIndexInComet];

    expect(sFraxInCometInfo.priceFeed).to.eq(newSFraxPriceFeed);
    expect(sFraxInConfiguratorInfoWETHComet.priceFeed).to.eq(newSFraxPriceFeed);

    expect(await comet.getPrice(newSFraxPriceFeed)).to.be.closeTo(await comet.getPrice(oldSFraxPriceFeed), 1e6);


    const WBTCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WBTC_ADDRESS
    );
    const WBTCInCometInfo = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    const WBTCInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WBTCIndexInComet];
    expect(WBTCInCometInfo.priceFeed).to.eq(newWbtcPriceFeed);
    expect(WBTCInConfiguratorInfoWETHComet.priceFeed).to.eq(newWbtcPriceFeed);

    expect(await comet.getPrice(newWbtcPriceFeed)).to.be.closeTo(await comet.getPrice(oldWbtcPriceFeed), 5e10);


    const WETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH_ADDRESS
    );
    const WETHInCometInfo = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    const WETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WETHIndexInComet];
    expect(WETHInCometInfo.priceFeed).to.eq(ETH_USD_OEV_PRICE_FEED);
    expect(WETHInConfiguratorInfoWETHComet.priceFeed).to.eq(ETH_USD_OEV_PRICE_FEED);

    expect(await comet.getPrice(ETH_USD_OEV_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 20e8); // 6$

    const LINKIndexInComet = await configurator.getAssetIndex(
      comet.address,
      LINK_ADDRESS
    );
    const LINKInCometInfo = await comet.getAssetInfoByAddress(LINK_ADDRESS);
    const LINKInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[LINKIndexInComet];
    expect(LINKInCometInfo.priceFeed).to.eq(LINK_USD_OEV_PRICE_FEED);
    expect(LINKInConfiguratorInfoWETHComet.priceFeed).to.eq(LINK_USD_OEV_PRICE_FEED);

    expect(await comet.getPrice(LINK_USD_OEV_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldLINKPriceFeed), 1e8);

    expect(await comet.baseTokenPriceFeed()).to.eq(USDT_USD_OEV_PRICE_FEED);
    expect(await comet.getPrice(USDT_USD_OEV_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldUSDTPriceFeed), 3e7);

    const weETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );

    const weETHInCometInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );

    const weETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(newWeEthPriceFeed);
    expect(weETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthPriceFeed);

    expect(await comet.getPrice(newWeEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldWeEthPriceFeed), 40e8);

    const mETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      METH_ADDRESS
    );

    const mETHInCometInfo = await comet.getAssetInfoByAddress(
      METH_ADDRESS
    );

    const mETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[mETHIndexInComet];

    expect(mETHInCometInfo.priceFeed).to.eq(newMETHPriceFeed);
    expect(mETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newMETHPriceFeed);

    expect(await comet.getPrice(newMETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldMETHPriceFeed), 40e8);
  }
});
