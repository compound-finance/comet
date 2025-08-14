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


const EZETH_ADDRESS = '0xE95A203B1a91a908F9B9CE46459d101078c2c3cb';
const EZETH_ETH_RATE_PROVIDER = '0xFAD40C0e2BeF93c6a822015863045CAAeAAde4d3';

const WRSETH_ADDRESS ='0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF'
const WRSETH_ETH_RATE_PROVIDER = '0x73b8BE3b653c5896BC34fC87cEBC8AcF4Fb7A545';

const WEETH_ADDRESS = '0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF'
const WEETH_TO_ETH_RATE_PROVIDER = '0x72EC6bF88effEd88290C66DCF1bE2321d80502f5';

const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;

let newWstETHToETHPriceFeed: string;
let newEzETHToETHPriceFeed: string;
let newWrsETHToETHPriceFeed: string;
let newWeETHToETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();

    const rateProviderWstEth = await deploymentManager.existing('wstEth:priceFeed', WSTETH_STETH_PRICE_FEED_ADDRESS, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    console.log(`wstETH address: ${rateProviderWstEth.address}`);
    
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    
     const constantPriceFeed = await deploymentManager.deploy(
        'eth:constantPriceFeed',
        'pricefeeds/ConstantPriceFeed.sol',
        [
            8,
            exp(1, 8)
        ]
    );

    const _wstETHToETHPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / stETH price feed
        STETH_ETH_PRICE_FEED_ADDRESS,    // stETH / ETH price feed
        8,                               // decimals
        'wstETH / ETH price feed'        // description
      ]
    );
     
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
        'wstETH:capoPriceFeed',
        'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
            [
                governor.address,
                constantPriceFeed.address,
                _wstETHToETHPriceFeed.address, // wstETH / ETH price feed
                "wstETH:capoPriceFeed",
                FEED_DECIMALS,
                3600,
                {
                    snapshotRatio: currentRatioWstEth,
                    snapshotTimestamp: now - 3600,
                    maxYearlyRatioGrowthPercent: exp(0.01, 4)
                }
            ]
        );
    
    const rateProviderEzEth = await deploymentManager.existing('ezEth:priceFeed', EZETH_ETH_RATE_PROVIDER, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:capoPriceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        rateProviderEzEth.address,
        'ezETH:capoPriceFeed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
    );
    console.log(`Deployed wstETH capo price feed at ${wstEthCapoPriceFeed.address}`);

    const wrsethRateProvider = await deploymentManager.existing('wrsEth:priceFeed', WRSETH_ETH_RATE_PROVIDER, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWrseth] = await wrsethRateProvider.latestRoundData();
    const wrsethCapoPriceFeed = await deploymentManager.deploy(
      'wrseth:capoPriceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        wrsethRateProvider.address,
        'wrseth:capoPriceFeed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioWrseth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
    );
    console.log(`Deployed wrseth capo price feed at ${wrsethCapoPriceFeed.address}`);

    const weethRateProvider = await ethers.getContractAt('contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface', WEETH_TO_ETH_RATE_PROVIDER) as AggregatorV3Interface;
    const [, currentRatioWeeth] = await weethRateProvider.latestRoundData();
    const weethCapoPriceFeed = await deploymentManager.deploy(
      'weeth:capoPriceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        weethRateProvider.address,
        'weeth:capoPriceFeed',
        FEED_DECIMALS,
        3600,
        RATE_DECIMALS,
        {
          snapshotRatio: currentRatioWeeth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.01, 4)
        }
      ],
    );
    console.log(`Deployed weeth capo price feed at ${weethCapoPriceFeed.address}`);
     
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


    newWstETHToETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWrsETHToETHPriceFeed = wrsethCapoPriceFeedAddress;
    newWeETHToETHPriceFeed = weethCapoPriceFeedAddress;
    newEzETHToETHPriceFeed = ezEthCapoPriceFeedAddress; 

    const trace = deploymentManager.tracer();
    const { configurator, comet, bridgeReceiver, l2Timelock } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor,
      cometAdmin
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

    const deployAndUpgradeToCalldata = await calldata(
      cometAdmin.populateTransaction.deployAndUpgradeTo(
        configurator.address,
        comet.address
      )
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
        [
          0,
          0,
          0,
          0,
          0
        ],
        [
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'deployAndUpgradeTo'
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

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );
    const refundAddress = l2Timelock.address;

    const mainnetActions = [
      // 1. Sends the proposal to the L2
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress,                                    // address excessFeeRefundAddress,
          refundAddress,                                    // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
      },
    ];

    const description = 'tmp';
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
