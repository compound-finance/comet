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

const ETH_USD_PRICE_FEED = '0x6bF14CB0A831078629D993FDeBcB182b21A8774C';
const WSTETH_ADDRESS = '0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32';
const FEED_DECIMALS = 8;

const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xe428fbdbd61CC1be6C273dC0E27a1F43124a86F3';

let newWstETHToUSDPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();
    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'scroll', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
  
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
     
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
        'wstETH:priceFeed',
        'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
            [
                governor.address,
                ETH_USD_PRICE_FEED,
                WSTETH_STETH_PRICE_FEED_ADDRESS,
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
      'scroll',
      'contracts/ERC20.sol:ERC20'
    );
    
    const wstETHPricefeed = await deploymentManager.existing(
      'wstETH:priceFeed',
      wstEthCapoPriceFeedAddress,
      'scroll'
    );
    
    newWstETHToUSDPriceFeed = wstETHPricefeed.address;
    
    const {
      comet,
      cometAdmin,
      configurator,
      bridgeReceiver,
    } = await deploymentManager.getContracts();
    
    const { 
      governor, 
      scrollMessenger 
    } = await govDeploymentManager.getContracts();
    
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
        [
          configurator.address,
          cometAdmin.address
        ],
        [0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateWstEthPriceFeedCalldata,
          deployAndUpgradeToCalldata
        ],
      ],
    );
    
    const mainnetActions = [
      {
        contract: scrollMessenger,
        signature: 'sendMessage(address,uint256,bytes,uint256)',
        args: [
          bridgeReceiver.address, 
          0, 
          l2ProposalData, 
          1_000_000
        ],
        value: exp(0.1, 18)
      },
    ];
    
    const description = 'tmp'

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
          
      expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHToUSDPriceFeed);
      expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHToUSDPriceFeed);
    }
});
