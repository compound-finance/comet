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

const WETH_ADDRESS = '0x82af49447d8a07e3bd95bd0d56f35241523fbab1';
const ETH_USD_PRICE_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';

const WSTETH_ADDRESS = '0x5979D7b546E38E414F7E9822514be443A4800529';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB1552C5e96B312d0Bf8b554186F846C40614a540';

const WBTC_ADDRESS = '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f';
const WBTC_USD_PRICE_FEED_ADDRESS = '0xdc715c751f1cc129A6b47fEDC87D9918a4580502';

const FEED_DECIMALS = 8;

let newWstETHPriceFeed: string;
let oldWstETHPriceFeed: string;

let newWbtcPriceFeed: string;
let oldWbtcPriceFeed: string;

let newWETHPriceFeed: string;
let oldWETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { governor } = await deploymentManager.getContracts();

    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData();
    const now = (await deploymentManager.hre.ethers.provider.getBlock('latest'))!.timestamp;

    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        governor.address,
        ETH_USD_PRICE_FEED,
        WSTETH_STETH_PRICE_FEED_ADDRESS,
        'wstETH:priceFeed',
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

    const wBTCPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        WBTC_USD_PRICE_FEED_ADDRESS,
        8
      ],
      true
    );

    const wETHPriceFeed = await deploymentManager.deploy(
      'wETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        ETH_USD_PRICE_FEED,
        8
      ],
      true
    );

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      wBTCPriceFeedAddress: wBTCPriceFeed.address,
      wETHPriceFeedAddress: wETHPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    wstEthCapoPriceFeedAddress,
    wBTCPriceFeedAddress,
    wETHPriceFeedAddress
  }) {
 
    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;
    newWbtcPriceFeed = wBTCPriceFeedAddress;
    newWETHPriceFeed = wETHPriceFeedAddress;

    const trace = deploymentManager.tracer();

    const {
      configurator,
      comet,
      bridgeReceiver,
      timelock: l2Timelock,
      cometAdmin
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldWbtcPriceFeed] = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH_ADDRESS);

    const updateWstEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WSTETH_ADDRESS,
        wstEthCapoPriceFeedAddress
      )
    );

    const updateWbtcPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WBTC_ADDRESS,
        wBTCPriceFeedAddress
      )
    );

    const updateWETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WETH_ADDRESS,
        wETHPriceFeedAddress
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
          updateWbtcPriceFeedCalldata,
          updateWETHPriceFeedCalldata,
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
    
    // 1. & 2. & 3. Check if the price feeds are set correctly.
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    );
    
    const wstETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHPriceFeed);

    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 1e6);

    const wBTCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WBTC_ADDRESS
    );
    const wBTCInCometInfo = await comet.getAssetInfoByAddress(WBTC_ADDRESS);
    const wBTCInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wBTCIndexInComet]; 
    expect(wBTCInCometInfo.priceFeed).to.eq(newWbtcPriceFeed);
    expect(wBTCInConfiguratorInfoWETHComet.priceFeed).to.eq(newWbtcPriceFeed);

    expect(await comet.getPrice(newWbtcPriceFeed)).to.be.closeTo(await comet.getPrice(oldWbtcPriceFeed), 1e7);

    const wETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH_ADDRESS
    );
    const wETHInCometInfo = await comet.getAssetInfoByAddress(WETH_ADDRESS);
    const wETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wETHIndexInComet];

    expect(wETHInCometInfo.priceFeed).to.eq(newWETHPriceFeed);
    expect(wETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWETHPriceFeed);

    expect(await comet.getPrice(newWETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 1e6);
  },
});
