import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { utils } from 'ethers';
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

const WEETH_ADDRESS = '0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF'
const WEETH_TO_ETH_RATE_PROVIDER = '0x72EC6bF88effEd88290C66DCF1bE2321d80502f5';

// Note: WRSETH_ADDRESS is referenced in enact but not defined in constants
// You'll need to add this constant if wrseth is actually being used
// const WRSETH_ADDRESS = '0x...'; // Add the actual address

const FEED_DECIMALS = 8;
const RATE_DECIMALS = 18;

let newWstETHToETHPriceFeed: string;
let newWeEthToETHPriceFeed: string;
let newEzEthToETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();

    const rateProviderWstEth = await deploymentManager.existing('wstEth:priceFeed', WSTETH_STETH_PRICE_FEED_ADDRESS, 'unichain', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    console.log(`wstETH rate provider address: ${rateProviderWstEth.address}`);
    
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
      

    console.log(`Deployed wstETH capo price feed at ${wstEthCapoPriceFeed.address}`);
    newWstETHToETHPriceFeed = wstEthCapoPriceFeed.address;

    const rateProviderEzEth = await deploymentManager.existing('ezEth:priceFeed', EZETH_ETH_RATE_PROVIDER, 'unichain', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioEzEth] = await rateProviderEzEth.latestRoundData();

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

    console.log(`Deployed ezETH capo price feed at ${ezEthCapoPriceFeed.address}`);
    newEzEthToETHPriceFeed = ezEthCapoPriceFeed.address;

    const weethRateProvider = await deploymentManager.existing('weeth:priceFeed', WEETH_TO_ETH_RATE_PROVIDER, 'unichain', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
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
    
    console.log(`Deployed weETH capo price feed at ${weethCapoPriceFeed.address}`);
    newWeEthToETHPriceFeed = weethCapoPriceFeed.address;
     
    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      weethCapoPriceFeedAddress: weethCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    wstEthCapoPriceFeedAddress,
    weethCapoPriceFeedAddress,
    ezEthCapoPriceFeedAddress
  }) {
    const trace = deploymentManager.tracer();
    const { utils } = ethers;

    const { 
      configurator, 
      comet, 
      bridgeReceiver, 
      cometAdmin 
    } = await deploymentManager.getContracts();

    const {
      unichainL1CrossDomainMessenger,
      governor
    } = await govDeploymentManager.getContracts();

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthCapoPriceFeedAddress
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
          cometAdmin.address
        ],
        [
          0,
          0,
          0,
          0
        ],
        [
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'updateAssetPriceFeed',
          'deployAndUpgradeTo'
        ],
        [
          updateWstEthPriceFeedCalldata,
          updateWeethPriceFeedCalldata,
          updateEzEthPriceFeedCalldata,
          deployAndUpgradeToCalldata
        ],
      ]
    );

    const mainnetActions = [
      {
        contract: unichainL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [
          bridgeReceiver.address, // target address on L2
          l2ProposalData,        // calldata
          3_000_000              // gas limit for L2 execution
        ],
      },
    ];

    const description = 'tmp';
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
      expect(weEthInCometInfo.priceFeed).to.eq(newWeEthToETHPriceFeed);
      expect(weEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeEthToETHPriceFeed);
  
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
  
      expect(ezEthInCometInfo.priceFeed).to.eq(newEzEthToETHPriceFeed);
      expect(ezEthInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzEthToETHPriceFeed);
    },
});