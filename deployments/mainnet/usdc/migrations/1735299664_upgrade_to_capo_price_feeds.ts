import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { Numeric } from '../../../../test/helpers';
import { IWstETH, AggregatorV3Interface, IRateProvider } from '../../../../build/types';
import { constants } from 'ethers';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETH_USD_SVR_PRICE_FEED = '0xc0053f3FBcCD593758258334Dfce24C2A9A673aD';

const WBTC_ADDRESS = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const WBTC_BTC_PRICE_FEED_ADDRESS = '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23';
const BTC_USD_SVR_PRICE_FEED_ADDRESS = '0x91D32e6f01d6473b596f54c6E304e06d774f86b2';

const LINK_ADDRESS = '0x514910771af9ca656af840dff83e8264ecf986ca';
const LINK_USD_SVR_PRICE_FEED_ADDRESS = '0x83B34662f65532e611A87EBed38063Dec889D5A7';

const RSETH_ADDRESS = '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7';
const RSETH_TO_ETH_PRICE_FEED = '0x9d2F2f96B24C444ee32E57c04F7d944bcb8c8549';

const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';

const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

const COMP_ADDRESS = '0xc00e94Cb662C3520282E6f5717214004A7f26888';
const COMP_USD_SVR_PRICE_FEED = '0x69B50fF403E995d9c4441a303438D9049dAC8cCD';

const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;

let newWstETHPriceFeed: string;
let oldWstETHPriceFeed: string;

let newWbtcPriceFeed: string;
let oldWbtcPriceFeed: string;

let newRsEthPriceFeed: string;
let oldRsEthPriceFeed: string;

let oldWETHPriceFeed: string;
let oldLinkPriceFeed: string;

let newWeEthPriceFeed: string;
let oldWeEthPriceFeed: string;

let oldCOMPPriceFeed: string;

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
        ETH_USD_SVR_PRICE_FEED,
        wstETH.address,
        constantPriceFeed.address,
        'wstETH / USD CAPO SVR Price Feed',
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
        BTC_USD_SVR_PRICE_FEED_ADDRESS,
        8
      ],
      true
    );

    const rsEthRateProvider = await deploymentManager.existing('rsETH:_priceFeed', RSETH_TO_ETH_PRICE_FEED, 'mainnet', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioRsEth] = await rsEthRateProvider.latestRoundData();
    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_SVR_PRICE_FEED,
        rsEthRateProvider.address,
        'rsETH / USD CAPO SVR Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRsEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0554, 4)
        }
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
        ETH_USD_SVR_PRICE_FEED,
        WEETH_ADDRESS,
        constants.AddressZero,
        'weETH / USD CAPO SVR Price Feed',
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

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      wbtcPriceFeedAddress: wbtcScalingPriceFeed.address,
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address,
      weEthPriceFeedAddress: weETHCapoPriceFeed.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    wstEthCapoPriceFeedAddress,
    wbtcPriceFeedAddress,
    rsEthCapoPriceFeedAddress,
    weEthPriceFeedAddress
  }) {

    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWbtcPriceFeed = wbtcPriceFeedAddress;
    newRsEthPriceFeed = rsEthCapoPriceFeedAddress;
    newWeEthPriceFeed = weEthPriceFeedAddress;

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
    [,, oldWeEthPriceFeed] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    [,, oldCOMPPriceFeed] = await comet.getAssetInfoByAddress(COMP_ADDRESS);
    oldRsEthPriceFeed = '0x92014e7f331dFaB2848A5872AA8b2E7b6f3cE8B4'; // not yet added, pending execution

    const mainnetActions = [
      // 1. Update wstETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WSTETH_ADDRESS, wstEthCapoPriceFeedAddress],
      },
      // 2. Update WBTC price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WBTC_ADDRESS, wbtcPriceFeedAddress],
      },
      // 3. Update WETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WETH_ADDRESS, ETH_USD_SVR_PRICE_FEED],
      },
      // 4. Update LINK price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, LINK_ADDRESS, LINK_USD_SVR_PRICE_FEED_ADDRESS],
      },
      // 5. Update rSETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, RSETH_ADDRESS, rsEthCapoPriceFeedAddress],
      },
      // 6. Update weETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WEETH_ADDRESS, weEthPriceFeedAddress],
      },
      // 7. Update COMP price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, COMP_ADDRESS, COMP_USD_SVR_PRICE_FEED],
      },
      // 8. Deploy and upgrade Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Update wstETH, wBTC, WETH, rsETH, LINK, weETH and COMP price feeds in cUSDCv3 on Mainnet with CAPO and SVR implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH, wBTC, WETH, rsETH, LINK, weETH and COMP on the USDC market on Mainnet implementing CAPO and SVR.
CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes.
SVR utilizes Chainlink's SVR oracle solution that allows to recapture the non-toxic Maximal Extractable Value (MEV) derived from their use of Chainlink Price Feeds.
Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1015),  [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

## CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631).

## SVR fee recipient

Compound DAO fee recipient is 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates wstETH price feed to CAPO + SVR.
The second action updates WBTC price feed to SVR.
The third action updates WETH price feed to SVR.
The fourth action updates LINK price feed to SVR.
The fifth action updates rSETH price feed to CAPO + SVR.
The sixth action updates weETH price feed to SVR.
The seventh action updates COMP price feed to SVR.
The eighth action deploys and upgrades Comet to a new version.
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

    expect(wETHInCometInfo.priceFeed).to.eq(ETH_USD_SVR_PRICE_FEED);
    expect(wETHInConfiguratorInfoWETHComet.priceFeed).to.eq(ETH_USD_SVR_PRICE_FEED);
    expect(await comet.getPrice(ETH_USD_SVR_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 18e8);

    const linkIndexInComet = await configurator.getAssetIndex(
      comet.address,
      LINK_ADDRESS
    );
    const linkInCometInfo = await comet.getAssetInfoByAddress(LINK_ADDRESS);
    const linkInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[linkIndexInComet]; 

    expect(linkInCometInfo.priceFeed).to.eq(LINK_USD_SVR_PRICE_FEED_ADDRESS);
    expect(linkInConfiguratorInfoWETHComet.priceFeed).to.eq(LINK_USD_SVR_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(LINK_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldLinkPriceFeed), 3e7);

    const rsEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      RSETH_ADDRESS
    );
    const rsEthInCometInfo = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    const rsEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rsEthIndexInComet];

    expect(rsEthInCometInfo.priceFeed).to.eq(newRsEthPriceFeed);
    expect(rsEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newRsEthPriceFeed);
    expect(await comet.getPrice(newRsEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldRsEthPriceFeed), 18e8);

    const weETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );
    const weETHInCometInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    const weETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(newWeEthPriceFeed);
    expect(weETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthPriceFeed);
    expect(await comet.getPrice(newWeEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldWeEthPriceFeed), 18e8);

    const compIndexInComet = await configurator.getAssetIndex(
      comet.address,
      COMP_ADDRESS
    );
    const compInCometInfo = await comet.getAssetInfoByAddress(COMP_ADDRESS);
    const compInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[compIndexInComet];

    expect(compInCometInfo.priceFeed).to.eq(COMP_USD_SVR_PRICE_FEED);
    expect(compInConfiguratorInfoWETHComet.priceFeed).to.eq(COMP_USD_SVR_PRICE_FEED);
    expect(await comet.getPrice(COMP_USD_SVR_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldCOMPPriceFeed), 1e8);
  },
});
