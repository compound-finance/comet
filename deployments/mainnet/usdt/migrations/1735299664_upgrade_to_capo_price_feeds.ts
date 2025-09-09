import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { Numeric } from '../../../../test/helpers';
import { IWstETH, IRateProvider, AggregatorV3Interface } from '../../../../build/types';
import { constants } from 'ethers';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WETH_ADDRESS = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const ETH_USD_SVR_PRICE_FEED = '0xc0053f3FBcCD593758258334Dfce24C2A9A673aD';

const WBTC_ADDRESS = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const WBTC_BTC_PRICE_FEED = '0xfdFD9C85aD200c506Cf9e21F1FD8dd01932FBB23';
const BTC_USD_SVR_PRICE_FEED = '0x91D32e6f01d6473b596f54c6E304e06d774f86b2';

const WSTETH_ADDRESS = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';

const SFRAX_ADDRESS = '0xA663B02CF0a4b149d2aD41910CB81e23e1c41c32';
const FRAX_TO_USD_PRICE_FEED = '0xB9E1E3A9feFf48998E45Fa90847ed4D467E8BcfD';

const LINK_ADDRESS = '0x514910771AF9Ca656af840dff83E8264EcF986CA';
const LINK_USD_SVR_PRICE_FEED = '0x83B34662f65532e611A87EBed38063Dec889D5A7';

const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

const COMP_ADDRESS = '0xc00e94Cb662C3520282E6f5717214004A7f26888';
const COMP_USD_SVR_PRICE_FEED = '0x69B50fF403E995d9c4441a303438D9049dAC8cCD';

const METH_ADDRESS = '0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa';
const METH_TO_ETH_PRICE_FEED = '0x5Bd3E64F6702F55e744e70e27281a7cAABf7de46';

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

let oldCOMPPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    const wstETH = await deploymentManager.existing('wstETH', WSTETH_ADDRESS, 'mainnet', 'contracts/IWstETH.sol:IWstETH') as IWstETH;
    const currentRatioWstEth = await wstETH.stEthPerToken();
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/WstETHCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_SVR_PRICE_FEED,
        wstETH.address,
        constants.AddressZero,
        'wstETH / USD CAPO SVR Price Feed',
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
        'sFRAX / USD CAPO Price Feed',
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
        BTC_USD_SVR_PRICE_FEED,
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

    const rateProviderMEth = await deploymentManager.existing('mETH:_rateProvider', METH_TO_ETH_PRICE_FEED, 'mainnet', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioMEth] = await rateProviderMEth.latestRoundData();
    const mEthCapoPriceFeed = await deploymentManager.deploy(
      'mETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_SVR_PRICE_FEED,
        METH_TO_ETH_PRICE_FEED,
        'mETH / USD CAPO SVR Price Feed',
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
    [,, oldCOMPPriceFeed] = await comet.getAssetInfoByAddress(COMP_ADDRESS);

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
        args: [comet.address, WETH_ADDRESS, ETH_USD_SVR_PRICE_FEED],
      },
      // 5. Update LINK price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, LINK_ADDRESS, LINK_USD_SVR_PRICE_FEED],
      },
      // 6. Update weETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WEETH_ADDRESS, weETHCapoPriceFeedAddress],
      },
      // 7. Update mETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, METH_ADDRESS, mEthCapoPriceFeedAddress],
      },
      // 8. Update COMP price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, COMP_ADDRESS, COMP_USD_SVR_PRICE_FEED],
      },
      // 9. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Update price feeds in cUSDTv3 on Mainnet with CAPO and Chainlink SVR implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH, sFRAX, weETH, WBTC, WETH, mETH, COMP, and LINK on the USDT market on Mainnet. 

SVR summery

[RFP process](https://www.comp.xyz/t/oev-rfp-process-update-july-2025/6945) and community [vote](https://snapshot.box/#/s:comp-vote.eth/proposal/0x98a3873319cdb5a4c66b6f862752bdcfb40d443a5b9c2f9472188d7ed5f9f2e0) passed and decided to implement Chainlink's SVR solution for Mainnet markets, this proposal updates wstETH, WBTC, WETH, LINK, weETH, mETH, COMP price feeds to support SVR implementations.

CAPO summery

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH, sFRAX, weETH, mETH price feeds are updated to their CAPO implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1015),  [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

## CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631), as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates wstETH price feed.
The second action updates sFRAX price feed.
The third action updates WBTC price feed.
The fourth action updates WETH price feed.
The fifth action updates LINK price feed.
The sixth action updates weETH price feed.
The seventh action updates mETH price feed.
The eighth action updates COMP price feed.
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
    expect(WETHInCometInfo.priceFeed).to.eq(ETH_USD_SVR_PRICE_FEED);
    expect(WETHInConfiguratorInfoWETHComet.priceFeed).to.eq(ETH_USD_SVR_PRICE_FEED);

    expect(await comet.getPrice(ETH_USD_SVR_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 20e8); // 6$

    const LINKIndexInComet = await configurator.getAssetIndex(
      comet.address,
      LINK_ADDRESS
    );
    const LINKInCometInfo = await comet.getAssetInfoByAddress(LINK_ADDRESS);
    const LINKInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[LINKIndexInComet];
    expect(LINKInCometInfo.priceFeed).to.eq(LINK_USD_SVR_PRICE_FEED);
    expect(LINKInConfiguratorInfoWETHComet.priceFeed).to.eq(LINK_USD_SVR_PRICE_FEED);

    expect(await comet.getPrice(LINK_USD_SVR_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldLINKPriceFeed), 1e8);

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

    const COMPIndexInComet = await configurator.getAssetIndex(
      comet.address,
      COMP_ADDRESS
    );

    const COMPInCometInfo = await comet.getAssetInfoByAddress(
      COMP_ADDRESS
    );

    const COMPInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[COMPIndexInComet];

    expect(COMPInCometInfo.priceFeed).to.eq(COMP_USD_SVR_PRICE_FEED);
    expect(COMPInConfiguratorInfoWETHComet.priceFeed).to.eq(COMP_USD_SVR_PRICE_FEED);

    expect(await comet.getPrice(COMP_USD_SVR_PRICE_FEED)).to.be.closeTo(await comet.getPrice(oldCOMPPriceFeed), 1e8);
  }
});
