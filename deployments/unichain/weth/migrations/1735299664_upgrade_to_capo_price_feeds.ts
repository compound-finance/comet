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

const WSTETH_ADDRESS = '0xc02fe7317d4eb8753a02c35fe019786854a92001';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0x24c8964338Deb5204B096039147B8e8C3AEa42Cc';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79ed961ab195cceea5';
const EZETH_ETH_RATE_PROVIDER = '0xa0f2EF6ceC437a4e5F6127d6C51E1B0d3A746911';

const WEETH_ADDRESS = '0x7dcc39b4d1c53cb31e1abc0e358b43987fef80f7'
const WEETH_TO_ETH_RATE_PROVIDER = '0xBf3bA2b090188B40eF83145Be0e9F30C6ca63689';

const FEED_DECIMALS = 8;

let newWstETHToETHPriceFeed: string;
let newWeEthToETHPriceFeed: string;
let newEzEthToETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;

    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'unichain', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const constantPriceFeed = await deploymentManager.deploy(
        'ETH:priceFeed',
        'pricefeeds/ConstantPriceFeed.sol',
        [
            8,
            exp(1, 8)
        ],
        true
    );
     
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
        'wstETH:priceFeed',
        'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
            [
                governor.address,
                constantPriceFeed.address,
                WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / ETH price feed
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

    const rateProviderEzEth = await deploymentManager.existing('ezEth:_priceFeed', EZETH_ETH_RATE_PROVIDER, 'unichain', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioEzEth] = await rateProviderEzEth.latestRoundData();
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


    const weethRateProvider = await deploymentManager.existing('weETH:_priceFeed', WEETH_TO_ETH_RATE_PROVIDER, 'unichain', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWeeth] = await weethRateProvider.latestRoundData();
    const weethCapoPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        constantPriceFeed.address,
        weethRateProvider.address,
        'weeth:priceFeed',
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
      weethCapoPriceFeedAddress: weethCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    wstEthCapoPriceFeedAddress,
    weethCapoPriceFeedAddress,
    ezEthCapoPriceFeedAddress
  }) {

    newEzEthToETHPriceFeed = ezEthCapoPriceFeedAddress;
    newWeEthToETHPriceFeed = weethCapoPriceFeedAddress;
    newWstETHToETHPriceFeed = wstEthCapoPriceFeedAddress;

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
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
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
        value: exp(0.1, 18)
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