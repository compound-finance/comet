import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { ethers } from 'hardhat';
import { Contract } from 'ethers';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface, ILRTOracle, IWstETH } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
    return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const ETH_USD_PRICE_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

const WSTETH_ADDRESS = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061'; 
const STETH_ETH_PRICE_FEED_ADDRESS = '0xf586d0728a47229e747d824a939000Cf21dEF5A0';

const CBETH_ADDRESS = '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22';
const CBETH_ETH_PRICE_FEED = '0x806b4Ac04501c29769051e42783cF04dCE41440b';

const FEED_DECIMALS = 8;

let newCbEthToUsdPriceFeed: string;
let newWstETHToUSDCPriceFeed: string;
export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    //1. wstEth
    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
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
                ETH_USD_PRICE_FEED,
                _wstETHToETHPriceFeed.address,
                "wstETH:priceFeed",
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
   

    //2. cbEth
    const rateProviderCbEth = await deploymentManager.existing('cbETH:_priceFeed', CBETH_ETH_PRICE_FEED, 'base', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;  
    const [, currentRatioCbEth] = await rateProviderCbEth.latestRoundData()
    const cbEthCapoPriceFeed = await deploymentManager.deploy(
        'cbETH:priceFeed',
        'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
           [
             governor.address,
             ETH_USD_PRICE_FEED,
             rateProviderCbEth.address,
             'cbETH:priceFeed',
             FEED_DECIMALS,
             3600,
             {
               snapshotRatio: currentRatioCbEth,
               snapshotTimestamp: now - 3600,
               maxYearlyRatioGrowthPercent: exp(0.01, 4)
             }
           ],
           true
        )

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      cbEthCapoPriceFeedAddress: cbEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    wstEthCapoPriceFeedAddress,
    cbEthCapoPriceFeedAddress
  }) {

    newWstETHToUSDCPriceFeed = wstEthCapoPriceFeedAddress;
    newCbEthToUsdPriceFeed = cbEthCapoPriceFeedAddress;

    const trace = deploymentManager.tracer();

    const { 
      configurator, 
      comet, 
      bridgeReceiver, 
      cometAdmin 
    } = await deploymentManager.getContracts();

    const {
      governor, 
      baseL1CrossDomainMessenger 
    } = await govDeploymentManager.getContracts();

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthCapoPriceFeedAddress
      )
    );

    const updateCbEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        CBETH_ADDRESS,
        cbEthCapoPriceFeedAddress
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
          cometAdmin.address
        ],
        [0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateWstEthPriceFeedCalldata,
          updateCbEthPriceFeedCalldata,
          deployAndUpgradeToCalldata
        ],
      ]
    );

    const mainnetActions = [
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [
          bridgeReceiver.address, 
          l2ProposalData, 
          3_000_000
        ]
      },
    ];

    const description = 'Upgrade to CAPO price feeds for wstETH and cbETH on Base';
    
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
          
      const cbETHIndexInComet = await configurator.getAssetIndex(
        comet.address,
        CBETH_ADDRESS
      );

      const wstETHIndexInComet = await configurator.getAssetIndex(
        comet.address,
        WSTETH_ADDRESS
      );

          
      // 1. & 2. & 3. Check if the price feeds are set correctly.
      const cbETHInCometInfo = await comet.getAssetInfoByAddress(
        CBETH_ADDRESS
        );
          
      const cbETHInConfiguratorInfoWETHComet = (
          await configurator.getConfiguration(comet.address)
      ).assetConfigs[cbETHIndexInComet];
            
      expect(cbETHInCometInfo.priceFeed).to.eq(newCbEthToUsdPriceFeed);
      expect(cbETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newCbEthToUsdPriceFeed);


      const wstETHInCometInfo = await comet.getAssetInfoByAddress(
        WSTETH_ADDRESS
        );

      const wstETHInConfiguratorInfoWETHComet = (
          await configurator.getConfiguration(comet.address)
        ).assetConfigs[wstETHIndexInComet];

      expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToUSDCPriceFeed);
      expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToUSDCPriceFeed);
    },
});
