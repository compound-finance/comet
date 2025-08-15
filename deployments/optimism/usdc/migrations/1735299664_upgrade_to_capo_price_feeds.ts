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

const ETH_USD_PRICE_FEED = '0x13e3Ee699D1909E989722E753853AE30b17e08c5';
const WSTETH_ADDRESS = '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb';
const FEED_DECIMALS = 8;

const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xe59EBa0D492cA53C6f46015EEa00517F2707dc77';
const STETH_ETH_PRICE_FEED_ADDRESS = '0x14d2d3a82AeD4019FddDfe07E8bdc485fb0d2249';

let newWstETHToUSDPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const rateProviderWstEth = await deploymentManager.existing('wstEth:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'optimism', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    
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
     
    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    wstEthCapoPriceFeedAddress
  }) {
    const trace = deploymentManager.tracer();
     
    const wstETH = await deploymentManager.existing(
      'wstETH',
      WSTETH_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    
    const wstETHPricefeed = await deploymentManager.existing(
      'wstETH:priceFeed',
      wstEthCapoPriceFeedAddress,
      'optimism'
    );
    
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
    
    newWstETHToUSDPriceFeed = wstETHPricefeed.address;
    
    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthCapoPriceFeedAddress
      )
    );
    
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [updateWstEthPriceFeedCalldata, deployAndUpgradeToCalldata],
      ]
    );
    
    const mainnetActions = [
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];
    
    const description = '# Upgrade wstETH to CAPO price feed on Optimism\n\n## Proposal summary\n\nThis proposal upgrades the wstETH price feed to use the new CAPO (Chainlink Correlated Assets Price Oracle) implementation on Optimism. This upgrade enhances the security and reliability of the wstETH price feed by implementing additional safeguards against price manipulation and ensuring more robust price discovery.\n\n## Proposal Actions\n\nThe proposal action updates the wstETH price feed in the USDC Comet on Optimism and deploys the updated configuration.';
    
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
      
      expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToUSDPriceFeed);
      expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    },
});
