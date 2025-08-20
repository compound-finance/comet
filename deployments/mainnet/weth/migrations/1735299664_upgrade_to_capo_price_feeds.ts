import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { constants } from 'ethers';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface, ILRTOracle, IRateProvider, IWstETH } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

//1. wstETH
const WSTETH_ADDRESS = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';

//2. rsETH
const RSETH_ADDRESS = '0xa1290d69c65a6fe4df752f95823fae25cb99e5a7';
const RSETH_ORACLE = '0x349A73444b1a310BAe67ef67973022020d70020d';

//3. weETH
const WEETH_ADDRESS = '0xCd5fE23C85820F7B72D0926FC9b05b43E359b7ee';

//4. osETH
const OSETH_ADDRESS = '0xf1c9acdc66974dfb6decb12aa385b9cd01190e38';
const OSETH_PRICE_FEED_ADDRESS = '0x8023518b2192FB5384DAdc596765B3dD1cdFe471';

//5. rswETH
const RSWETH_ADDRESS = '0xFAe103DC9cf190eD75350761e95403b7b8aFa6c0';

//6. ETHx
const ETHX_ADDRESS = '0xA35b1B31Ce002FBF2058D22F30f95D405200A15b';
const ETHX_PRICE_FEED_ADDRESS = '0xdd487947c579af433AeeF038Bf1573FdBB68d2d3';

//7. cbETh
// const CBETH_ADDRESS = '0xBe9895146f7AF43049ca1c1AE358B0541Ea49704';
// const CBETH_ETH_PRICE_FEED = '0xF017fcB346A1885194689bA23Eff2fE6fA5C483b';

//8. ezETH
const EZETH_ADDRESS = '0xbf5495Efe5DB9ce00f80364C8B423567e58d2110';
const EZETH_RATE_PROVIDER = '0x387dBc0fB00b26fb085aa658527D5BE98302c84C';

const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;

let newWstETHPriceFeed: string;
let newRsEthPriceFeed: string;
let newWeEthPriceFeed: string;
let newOsEthPriceFeed: string;
let newRswEthPriceFeed: string;
let newEthXPriceFeed: string;
//let newCbEthPriceFeed: string;
let newEzEthPriceFeed: string;

let oldWstETHPriceFeed: string;
let oldRsEthPriceFeed: string;
let oldWeEthPriceFeed: string;
let oldOsEthPriceFeed: string;
let oldRswEthPriceFeed: string;
let oldEthXPriceFeed: string;
//let oldCbEthPriceFeed: string;
let oldEzEthPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'weth');

    //1. wstEth
    const wstETH = await deploymentManager.existing('wstETH', WSTETH_ADDRESS, 'mainnet', 'contracts/IWstETH.sol:IWstETH') as IWstETH;
    const currentRatioWstEth = await wstETH.stEthPerToken();

    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/WstETHCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        wstETH.address,
        constants.AddressZero,
        'wstETH:capoPriceFeed',
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

    //2. rsEth
    const rateProivderRsEth = await deploymentManager.existing('rsETH', RSETH_ORACLE, 'mainnet', 'contracts/capo/contracts/interfaces/ILRTOracle.sol:ILRTOracle') as ILRTOracle;
    const currentRatioRsEth = await rateProivderRsEth.rsETHPrice();
    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'capo/contracts/RsETHCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        RSETH_ORACLE,
        'rsETH:priceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRsEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0554, 4) // 5.54%
        }
      ],
      true
    );

    //3. weEth
    const weETH = await deploymentManager.existing('weETH', WEETH_ADDRESS, 'mainnet', 'contracts/IRateProvider.sol:IRateProvider') as IRateProvider;

    const currentRatioWeEth = await weETH.getRate();
    const weEthCapoPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'capo/contracts/RateBasedCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        WEETH_ADDRESS,
        constants.AddressZero,
        'weETH:priceFeed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioWeEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0323, 4) // 3.23%
        }
      ],
      true
    );

    //4. osEth
    const rateProviderOsEth = await deploymentManager.existing('osETH:_priceFeed', OSETH_PRICE_FEED_ADDRESS, 'mainnet', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioOsEth] = await rateProviderOsEth.latestRoundData();
    const osEthCapoPriceFeed = await deploymentManager.deploy(
      'oETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        OSETH_PRICE_FEED_ADDRESS,
        'oETH:priceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioOsEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.031, 4) // 3.1%
        }
      ],
      true
    );

    //5. rswETH
    const rateProviderRswEth = await deploymentManager.existing('rswETH:_rateProvider', RSWETH_ADDRESS, 'mainnet', 'contracts/capo/contracts/interfaces/IRateProvider.sol:IRateProvider') as IRateProvider;
  
    const currentRatioRswEth = await rateProviderRswEth.getRate();
    const rswETHCapoPriceFeed = await deploymentManager.deploy(
      'rswETH:priceFeed',
      'capo/contracts/RateBasedCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        RSWETH_ADDRESS,
        constants.AddressZero,
        'rswETH:priceFeed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioRswEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.049, 4) // 4.9%
        }
      ],
      true
    );

    //6. ETHx
    const rateProviderEthx = await deploymentManager.existing('ETHx:_priceFeed', ETHX_PRICE_FEED_ADDRESS, 'mainnet', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
  
    const [, currentRatioEthx] = await rateProviderEthx.latestRoundData();
    const ethXCapoPriceFeed = await deploymentManager.deploy(
      'ETHx:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        ETHX_PRICE_FEED_ADDRESS,
        'ETHx:priceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioEthx,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.034, 4) // 3.4%
        }
      ],
      true
    );

    //7. cbEth
    // const rateProviderCbEth = await deploymentManager.existing('cbETH:_priceFeed', CBETH_ETH_PRICE_FEED, 'mainnet', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    // const [, currentRatioCbEth] = await rateProviderCbEth.latestRoundData();
    // const cbEthCapoPriceFeed = await deploymentManager.deploy(
    //   'cbETH:priceFeed',
    //   'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
    //   [
    //     governor.address,
    //     constantPriceFeed.address,
    //     rateProviderCbEth.address,
    //     'ezETH:priceFeed',
    //     FEED_DECIMALS,
    //     3600,
    //     {
    //       snapshotRatio: currentRatioCbEth,
    //       snapshotTimestamp: now - 3600,
    //       maxYearlyRatioGrowthPercent: exp(0.01, 4) // TODO
    //     }
    //   ],
    //   true
    // );

    //8. ezEth
    const rateProviderEzEth = await deploymentManager.existing('ezETH:_priceFeed', EZETH_RATE_PROVIDER, 'mainnet', 'contracts/capo/contracts/interfaces/IRateProvider.sol:IRateProvider') as IRateProvider;
    const currentRatioEzEth = await rateProviderEzEth.getRate();
    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'capo/contracts/RateBasedCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        rateProviderEzEth.address,
        constants.AddressZero,
        'ezETH:priceFeed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0707, 4) // 7.07%
        }
      ],
      true
    );

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address,
      weEthCapoPriceFeedAddress: weEthCapoPriceFeed.address,
      osEthCapoPriceFeedAddress: osEthCapoPriceFeed.address,
      rswEthCapoPriceFeedAddress: rswETHCapoPriceFeed.address,
      ethXCapoPriceFeedAddress: ethXCapoPriceFeed.address,
      //cbEthCapoPriceFeedAddress: cbEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _, {
    wstEthCapoPriceFeedAddress,
    rsEthCapoPriceFeedAddress,
    weEthCapoPriceFeedAddress,
    osEthCapoPriceFeedAddress,
    rswEthCapoPriceFeedAddress,
    ethXCapoPriceFeedAddress,
    //cbEthCapoPriceFeedAddress,
    ezEthCapoPriceFeedAddress
  }) {

    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newRsEthPriceFeed = rsEthCapoPriceFeedAddress;
    newWeEthPriceFeed = weEthCapoPriceFeedAddress;
    newOsEthPriceFeed = osEthCapoPriceFeedAddress;
    newRswEthPriceFeed = rswEthCapoPriceFeedAddress;
    newEthXPriceFeed = ethXCapoPriceFeedAddress;
    //newCbEthPriceFeed = cbEthCapoPriceFeedAddress;
    newEzEthPriceFeed = ezEthCapoPriceFeedAddress;
    
    const trace = deploymentManager.tracer();

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldRsEthPriceFeed] = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    [,, oldWeEthPriceFeed] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    [,, oldOsEthPriceFeed] = await comet.getAssetInfoByAddress(OSETH_ADDRESS);
    [,, oldRswEthPriceFeed] = await comet.getAssetInfoByAddress(RSWETH_ADDRESS);
    [,, oldEthXPriceFeed] = await comet.getAssetInfoByAddress(ETHX_ADDRESS);
    //[,, oldCbEthPriceFeed] = await comet.getAssetInfoByAddress(CBETH_ADDRESS);
    [,, oldEzEthPriceFeed] = await comet.getAssetInfoByAddress(EZETH_ADDRESS);

    const mainnetActions = [
      // 1. Update wstETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WSTETH_ADDRESS, wstEthCapoPriceFeedAddress],
      },
      // 2. Update rsETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, RSETH_ADDRESS, rsEthCapoPriceFeedAddress],
      },
      // 3. Update weETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, WEETH_ADDRESS, weEthCapoPriceFeedAddress],
      },
      // 4. Update osETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, OSETH_ADDRESS, osEthCapoPriceFeedAddress],
      },
      // 5. Update rswETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, RSWETH_ADDRESS, rswEthCapoPriceFeedAddress],
      },
      // 6. Update ETHx price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, ETHX_ADDRESS, ethXCapoPriceFeedAddress],
      },
      // 7. Update cbETH price feed
      // {
      //   contract: configurator,
      //   signature: 'updateAssetPriceFeed(address,address,address)',
      //   args: [comet.address, CBETH_ADDRESS, cbEthCapoPriceFeedAddress],
      // },
      // 8. Update ezETH price feed
      {
        contract: configurator,
        signature: 'updateAssetPriceFeed(address,address,address)',
        args: [comet.address, EZETH_ADDRESS, ezEthCapoPriceFeedAddress],
      },
      // 9. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '';

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

    const rsEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      RSETH_ADDRESS
    );
    const rsEthInCometInfo = await comet.getAssetInfoByAddress(
      RSETH_ADDRESS
    );
    const rsEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rsEthIndexInComet];

    expect(rsEthInCometInfo.priceFeed).to.eq(newRsEthPriceFeed);
    expect(rsEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newRsEthPriceFeed);

    const weEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );

    const weEthInCometInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );
    const weEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weEthIndexInComet];    
    expect(weEthInCometInfo.priceFeed).to.eq(newWeEthPriceFeed);
    expect(weEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthPriceFeed);

    const osEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      OSETH_ADDRESS
    );

    const osEthInCometInfo = await comet.getAssetInfoByAddress(
      OSETH_ADDRESS
    );
    const osEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[osEthIndexInComet];

    expect(osEthInCometInfo.priceFeed).to.eq(newOsEthPriceFeed);
    expect(osEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newOsEthPriceFeed);

    const rswEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      RSWETH_ADDRESS
    );

    const rswEthInCometInfo = await comet.getAssetInfoByAddress(
      RSWETH_ADDRESS
    );
    const rswEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rswEthIndexInComet]; 

    expect(rswEthInCometInfo.priceFeed).to.eq(newRswEthPriceFeed);
    expect(rswEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newRswEthPriceFeed);
    const ethXIndexInComet = await configurator.getAssetIndex(
      comet.address,
      ETHX_ADDRESS
    );

    const ethXInCometInfo = await comet.getAssetInfoByAddress(
      ETHX_ADDRESS
    );
    const ethXInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ethXIndexInComet];

    expect(ethXInCometInfo.priceFeed).to.eq(newEthXPriceFeed);
    expect(ethXInConfiguratorInfoWETHComet.priceFeed).to.eq(newEthXPriceFeed); 

    // const cbEthIndexInComet = await configurator.getAssetIndex(
    //   comet.address,
    //   CBETH_ADDRESS
    // );

    // const cbEthInCometInfo = await comet.getAssetInfoByAddress(
    //   CBETH_ADDRESS
    // );
    // const cbEthInConfiguratorInfoWETHComet = (
    //   await configurator.getConfiguration(comet.address)
    // ).assetConfigs[cbEthIndexInComet];

    // expect(cbEthInCometInfo.priceFeed).to.eq(newCbEthPriceFeed);
    // expect(cbEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newCbEthPriceFeed);

    const ezEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      EZETH_ADDRESS
    );
    const ezEthInCometInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );
    const ezEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezEthIndexInComet];  

    expect(ezEthInCometInfo.priceFeed).to.eq(newEzEthPriceFeed);
    expect(ezEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzEthPriceFeed);

    // Verify old price feeds
    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 1e8);
    expect(await comet.getPrice(newRsEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldRsEthPriceFeed), 1e8);
    expect(await comet.getPrice(newWeEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldWeEthPriceFeed), 1e8);
    expect(await comet.getPrice(newOsEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldOsEthPriceFeed), 1e8);
    expect(await comet.getPrice(newRswEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldRswEthPriceFeed), 1e8);
    expect(await comet.getPrice(newEthXPriceFeed)).to.be.closeTo(await comet.getPrice(oldEthXPriceFeed), 1e8);
    // expect(await comet.getPrice(newCbEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldCbEthPriceFeed), 1e8);
    expect(await comet.getPrice(newEzEthPriceFeed)).to.be.closeTo(await comet.getPrice(oldEzEthPriceFeed), 1e8);  
  },
});
