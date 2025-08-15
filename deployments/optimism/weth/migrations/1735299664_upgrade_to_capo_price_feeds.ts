import { config, expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface, ILRTOracle, IRateProvider, IWstETH } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
    return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WSTETH_ADDRESS = '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xe59EBa0D492cA53C6f46015EEa00517F2707dc77';
const STETH_ETH_PRICE_FEED_ADDRESS = '0x14d2d3a82AeD4019FddDfe07E8bdc485fb0d2249';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_ETH_RATE_PROVIDER = '0xFAD40C0e2BeF93c6a822015863045CAAeAAde4d3';

const WRSETH_ADDRESS ='0x87eEE96D50Fb761AD85B1c982d28A042169d61b1'
const WRSETH_ETH_RATE_PROVIDER = '0x73b8BE3b653c5896BC34fC87cEBC8AcF4Fb7A545';

const WEETH_ADDRESS = '0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF'
const WEETH_TO_ETH_RATE_PROVIDER = '0x72EC6bF88effEd88290C66DCF1bE2321d80502f5';

const FEED_DECIMALS = 8;

let newWstETHToETHPriceFeed: string;
let newEzETHToETHPriceFeed: string;
let newWrsETHToETHPriceFeed: string;
let newWeETHToETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();

    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    
    const constantPriceFeed = await deploymentManager.deploy(
        'ETH:priceFeed',
        'pricefeeds/ConstantPriceFeed.sol',
        [
            8,
            exp(1, 8)
        ],
        true
    );

    const _wstETHToETHPriceFeed = await deploymentManager.deploy(
      'wstETH:_priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / stETH price feed
        STETH_ETH_PRICE_FEED_ADDRESS,    // stETH / ETH price feed
        8,                               // decimals
        'wstETH / ETH price feed'        // description
      ],
      true
    );
     
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
        'wstETH:priceFeed',
        'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
            [
                governor.address,
                constantPriceFeed.address,
                _wstETHToETHPriceFeed.address, // wstETH / ETH price feed
                "wstETH:priceFeed",
                FEED_DECIMALS,
                3600,
                {
                    snapshotRatio: currentRatioWstEth,
                    snapshotTimestamp: now - 3600,
                    maxYearlyRatioGrowthPercent: exp(0.01, 4)
                }
            ],
            true
        );
    
    const rateProviderEzEth = await deploymentManager.existing('ezETH:_priceFeed', EZETH_ETH_RATE_PROVIDER, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [,currentRatioEzEth] = await rateProviderEzEth.latestRoundData();
    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        rateProviderEzEth.address,
        'ezETH:priceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
      true
    );

    const wrsethRateProvider = await deploymentManager.existing('wrsETH:_priceFeed', WRSETH_ETH_RATE_PROVIDER, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWrseth] = await wrsethRateProvider.latestRoundData();
    const wrsethCapoPriceFeed = await deploymentManager.deploy(
      'wrsETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        wrsethRateProvider.address,
        'wrsETH:priceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWrseth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
      true
    );

    const weethRateProvider = await deploymentManager.existing('weETH:_priceFeed', WEETH_TO_ETH_RATE_PROVIDER, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWeeth] = await weethRateProvider.latestRoundData();
    const weethCapoPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        weethRateProvider.address,
        'weETH:priceFeed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWeeth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
      true
    );

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      wrsethCapoPriceFeedAddress: wrsethCapoPriceFeed.address,
      weethCapoPriceFeedAddress: weethCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    wstEthCapoPriceFeedAddress,
    wrsethCapoPriceFeedAddress,
    weethCapoPriceFeedAddress,
    ezEthCapoPriceFeedAddress
  }) {
    const trace = deploymentManager.tracer();
    
    // Get existing contracts for verification
    const wstETH = await deploymentManager.existing(
      'wstETH',
      WSTETH_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    
    const wrsETH = await deploymentManager.existing(
      'wrsETH',
      WRSETH_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    
    const weETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    
    const ezETH = await deploymentManager.existing(
      'ezETH',
      EZETH_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    
    const wstETHPricefeed = await deploymentManager.existing(
      'wstETH:priceFeed',
      wstEthCapoPriceFeedAddress,
      'optimism'
    );
    
    const wrsETHPricefeed = await deploymentManager.existing(
      'wrsETH:priceFeed',
      wrsethCapoPriceFeedAddress,
      'optimism'
    );
    
    const weETHPricefeed = await deploymentManager.existing(
      'weETH:priceFeed',
      weethCapoPriceFeedAddress,
      'optimism'
    );
    
    const ezETHPricefeed = await deploymentManager.existing(
      'ezETH:priceFeed',
      ezEthCapoPriceFeedAddress,
      'optimism'
    );
    
    newWstETHToETHPriceFeed = wstETHPricefeed.address;
    newWrsETHToETHPriceFeed = wrsETHPricefeed.address;
    newWeETHToETHPriceFeed = weETHPricefeed.address;
    newEzETHToETHPriceFeed = ezETHPricefeed.address;
    
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();
    
    const { 
      governor, 
      opL1CrossDomainMessenger 
    } = await govDeploymentManager.getContracts();
    
    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthCapoPriceFeedAddress
      )
    );
    
    const updateWrsethPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WRSETH_ADDRESS,
        wrsethCapoPriceFeedAddress
      )
    );
    
    const updateWeethPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WEETH_ADDRESS,
        weethCapoPriceFeedAddress
      )
    );
    
    const updateEzEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        EZETH_ADDRESS,
        ezEthCapoPriceFeedAddress
      )
    );
    
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          cometAdmin.address
        ],
        [0, 0, 0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateWstEthPriceFeedCalldata,
          updateWrsethPriceFeedCalldata,
          updateWeethPriceFeedCalldata,
          updateEzEthPriceFeedCalldata,
          deployAndUpgradeToCalldata
        ],
      ]
    );

    const mainnetActions = [
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];
    
    const description = 'tmp'

    const txn = await govDeploymentManager.retry(async () =>
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
    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToETHPriceFeed);
    
    const ezETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      EZETH_ADDRESS
    );
    const ezETHInCometInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );
    const ezETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezETHIndexInComet];
    expect(ezETHInCometInfo.priceFeed).to.eq(newEzETHToETHPriceFeed);
    expect(ezETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzETHToETHPriceFeed);
    
    const wrsEthIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WRSETH_ADDRESS
    );
    const wrsEthInCometInfo = await comet.getAssetInfoByAddress(
      WRSETH_ADDRESS
    );
    const wrsEthInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wrsEthIndexInComet];
    expect(wrsEthInCometInfo.priceFeed).to.eq(newWrsETHToETHPriceFeed);
    expect(wrsEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newWrsETHToETHPriceFeed);
    
    const weethIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );
    const weethInCometInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );
    const weethInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weethIndexInComet];
    expect(weethInCometInfo.priceFeed).to.eq(newWeETHToETHPriceFeed);
    expect(weethInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeETHToETHPriceFeed);
  },
});
