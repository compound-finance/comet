import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { Numeric } from '../../../../test/helpers';
import { AggregatorV3Interface } from '../../../../build/types';

export function exp(i: number, d: Numeric = 0, r: Numeric = 6): bigint {
  return (BigInt(Math.floor(i * 10 ** Number(r))) * 10n ** BigInt(d)) / 10n ** BigInt(r);
}

const WSTETH_ADDRESS = '0x5979D7b546E38E414F7E9822514be443A4800529';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB1552C5e96B312d0Bf8b554186F846C40614a540'; 

const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_TO_ETH_PRICE_FEED_ADDRESS = '0x989a480b6054389075CBCdC385C18CfB6FC08186';

const RSETH_ADDRESS = '0x4186bfc76e2e237523cbc30fd220fe055156b41f';
const RSETH_ORACLE = '0x8f1dF6D7F2db73eECE86a18b4381F4707b918FB1';

const WEETH_ADDRESS = '0x35751007a407ca6FEFfE80b3cB397736D2cf4dbe';
const WEETH_RATE_PROVIDER = '0x20bAe7e1De9c596f5F7615aeaa1342Ba99294e12';

const RETH = '0xEC70Dcb4A1EFa46b8F2D97C310C9c4790ba5ffA8';
const RETH_RATE_PROVIDER = '0xD6aB2298946840262FcC278fF31516D39fF611eF';

const FEED_DECIMALS = 8;

let newWstETHPriceFeed: string;
let newEzETHPriceFeed: string;
let newRsETHPriceFeed: string;
let newWeETHPriceFeed: string;
let newRETHPriceFeed: string;

let oldWstETHPriceFeed: string;
let oldEzETHPriceFeed: string;
let oldRsETHPriceFeed: string;
let oldWeETHPriceFeed: string;
let oldRETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {

    const { timelock } = await deploymentManager.getContracts();
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'arbitrum', 'weth');

    
    //1. wstETH
    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;
     
    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        WSTETH_STETH_PRICE_FEED_ADDRESS,
        'wstETH / ETH CAPO Price Feed',
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

    //2. ezETH
    const rateProviderEzEth = await deploymentManager.existing('ezETH:_rateProvider', EZETH_TO_ETH_PRICE_FEED_ADDRESS, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioEzEth] = await rateProviderEzEth.latestRoundData();

    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        EZETH_TO_ETH_PRICE_FEED_ADDRESS,
        'ezETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0707, 4) // 7.07%
        },
      ],
      true
    );
 
    //3. rsETH
    const rsEthRateProvider = await deploymentManager.existing('rsETH:_rateProvider', RSETH_ORACLE, 'arbitrum','contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface; 
    const [, currentRatioRsEth] = await rsEthRateProvider.latestRoundData();
    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        RSETH_ORACLE,
        'rsETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRsEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0554, 4) // 5.54%
        },
      ],
      true
    );
  
    //4. weEth
    const rateProviderWeEth = await deploymentManager.existing('weETH:_rateProvider', WEETH_RATE_PROVIDER, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWeEth] = await rateProviderWeEth.latestRoundData();
    const weEthCapoPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        WEETH_RATE_PROVIDER,
        'weETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWeEth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.0323, 4) // 3.23%
        },
      ],
      true
    );
    
    //5. rETH
    const rateProviderREth = await deploymentManager.existing('rETH:_rateProvider', RETH_RATE_PROVIDER, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioREth] = await rateProviderREth.latestRoundData();
    const rEthCapoPriceFeed = await deploymentManager.deploy(
      'rETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        RETH_RATE_PROVIDER,
        'rETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioREth,
          snapshotTimestamp: now - 3600,
          maxYearlyRatioGrowthPercent: exp(0.029, 4) // 2.9%
        }
      ],
      true
    );
    
    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address,
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address,
      weEthCapoPriceFeedAddress: weEthCapoPriceFeed.address,
      rEthCapoPriceFeedAddress: rEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    ezEthCapoPriceFeedAddress,
    wstEthCapoPriceFeedAddress,
    rsEthCapoPriceFeedAddress,
    weEthCapoPriceFeedAddress,
    rEthCapoPriceFeedAddress
  }) {

    newEzETHPriceFeed = ezEthCapoPriceFeedAddress;
    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newRsETHPriceFeed = rsEthCapoPriceFeedAddress;
    newWeETHPriceFeed = weEthCapoPriceFeedAddress;
    newRETHPriceFeed = rEthCapoPriceFeedAddress;
    
    const trace = deploymentManager.tracer();

    const {
      configurator,
      comet,
      bridgeReceiver,
      timelock: l2Timelock,
      cometAdmin
    } = await deploymentManager.getContracts();

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldEzETHPriceFeed] = await comet.getAssetInfoByAddress(EZETH_ADDRESS);
    [,, oldRsETHPriceFeed] = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    [,, oldWeETHPriceFeed] = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    [,, oldRETHPriceFeed] = await comet.getAssetInfoByAddress(RETH);

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();


    const updateEzEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        EZETH_ADDRESS,
        ezEthCapoPriceFeedAddress
      )
    );

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthCapoPriceFeedAddress
      )
    );

    const updateRsEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        RSETH_ADDRESS,
        rsEthCapoPriceFeedAddress
      )
    );

    const updateWeEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WEETH_ADDRESS,
        weEthCapoPriceFeedAddress
      )
    );

    const updateREthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        RETH,
        rEthCapoPriceFeedAddress
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
          configurator.address,
          cometAdmin.address
        ],
        [
          0,
          0,
          0,
          0,
          0,
          0
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateEzEthPriceFeedCalldata,
          updateWstEthPriceFeedCalldata,
          updateRsEthPriceFeedCalldata,
          updateWeEthPriceFeedCalldata,
          updateREthPriceFeedCalldata,
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
    
    const ezETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      EZETH_ADDRESS
    );

    const rsETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      RSETH_ADDRESS
    );

    const weETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WEETH_ADDRESS
    );

    const rETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      RETH
    );
    
    // 1. & 2. & 3. Check if the price feeds are set correctly.
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    );
    
    const wstETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];
      
    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHPriceFeed);
        
    const ezETHInWETHCometInfo = await comet.getAssetInfoByAddress(
      EZETH_ADDRESS
    );  
    const ezETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezETHIndexInComet];
  
    expect(ezETHInWETHCometInfo.priceFeed).to.eq(newEzETHPriceFeed);
    expect(ezETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzETHPriceFeed);

    const rsETHInWETHCometInfo = await comet.getAssetInfoByAddress(
      RSETH_ADDRESS
    );
    const rsETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rsETHIndexInComet];
    expect(rsETHInWETHCometInfo.priceFeed).to.eq(newRsETHPriceFeed);
    expect(rsETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newRsETHPriceFeed);

    const weETHInWETHCometInfo = await comet.getAssetInfoByAddress(
      WEETH_ADDRESS
    );
    const weETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHIndexInComet];
    expect(weETHInWETHCometInfo.priceFeed).to.eq(newWeETHPriceFeed);
    expect(weETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWeETHPriceFeed); 

    const rETHInWETHCometInfo = await comet.getAssetInfoByAddress(RETH);
    const rETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rETHIndexInComet];
    expect(rETHInWETHCometInfo.priceFeed).to.eq(newRETHPriceFeed);
    expect(rETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newRETHPriceFeed);

    expect(await comet.getPrice(newEzETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldEzETHPriceFeed), 1e6);
    expect(await comet.getPrice(newRsETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldRsETHPriceFeed), 1e6);
    expect(await comet.getPrice(newWeETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWeETHPriceFeed), 1e6);
    expect(await comet.getPrice(newRETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldRETHPriceFeed), 1e6);
    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 1e6);
  },
});
