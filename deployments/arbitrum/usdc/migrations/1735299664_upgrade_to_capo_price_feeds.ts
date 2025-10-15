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

const ETH_USD_PRICE_FEED = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';

const WSTETH_ADDRESS = '0x5979D7b546E38E414F7E9822514be443A4800529';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB1552C5e96B312d0Bf8b554186F846C40614a540';

const EZETH_ADDRESS = '0x2416092f143378750bb29b79eD961ab195CcEea5';
const EZETH_TO_ETH_PRICE_FEED_ADDRESS = '0x989a480b6054389075CBCdC385C18CfB6FC08186';

const FEED_DECIMALS = 8;

const blockToFetch = 389430000;

let newWstETHPriceFeed: string;
let newEzETHPriceFeed: string;

let oldWstETHPriceFeed: string;
let oldEzETHPriceFeed: string;

export default migration('1735299664_upgrade_to_capo_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();

    // 1. wstEth
    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_PRICE_FEED_ADDRESS, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData({ blockTag: blockToFetch });
    const timestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))?.timestamp;

    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_PRICE_FEED,
        WSTETH_STETH_PRICE_FEED_ADDRESS,
        'wstETH / USD CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: timestamp,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4) // 4.04%
        }
      ],
      true
    );

    // 2. ezEth
    const rateProviderEzEth = await deploymentManager.existing('ezETH:_priceFeed', EZETH_TO_ETH_PRICE_FEED_ADDRESS, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioEzEth] = await rateProviderEzEth.latestRoundData({ blockTag: blockToFetch });
    const ezEthCapoPriceFeed = await deploymentManager.deploy(
      'ezETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_USD_PRICE_FEED,
        EZETH_TO_ETH_PRICE_FEED_ADDRESS,
        'ezETH / USD CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioEzEth,
          snapshotTimestamp: timestamp,
          maxYearlyRatioGrowthPercent: exp(0.0707, 4) // 7.07%
        }
      ],
      true
    );

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address,
      ezEthCapoPriceFeedAddress: ezEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager, {
    ezEthCapoPriceFeedAddress,
    wstEthCapoPriceFeedAddress
  }) {

    newEzETHPriceFeed = ezEthCapoPriceFeedAddress;
    newWstETHPriceFeed = wstEthCapoPriceFeedAddress;

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
      governor,
    } = await govDeploymentManager.getContracts();

    [,, oldWstETHPriceFeed ] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldEzETHPriceFeed ] = await comet.getAssetInfoByAddress(EZETH_ADDRESS);

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
          cometAdmin.address
        ],
        [
          0,
          0,
          0,
        ],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateEzEthPriceFeedCalldata,
          updateWstEthPriceFeedCalldata,
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

    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    [,, oldEzETHPriceFeed] = await comet.getAssetInfoByAddress(EZETH_ADDRESS);

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

    const description = `# Update price feeds in cUSDCv3 on Arbitrum with CAPO implementation.

## Proposal summary

This proposal updates existing price feeds for wstETH and ezETH on the USDC market on Arbitrum.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH and ezETH price feeds are updated to their CAPO implementations.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1035) and [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245).

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631), as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

## Proposal actions

The first action updates wstETH and ezETH price feeds to the CAPO implementation, This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.
`;
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find((event: { event: string }) => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();
  
    // 1. wstETH
    const wstETHIndexInComet = await configurator.getAssetIndex(comet.address, WSTETH_ADDRESS);
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(WSTETH_ADDRESS);
    const wstETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newWstETHPriceFeed);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newWstETHPriceFeed);
    expect(await comet.getPrice(newWstETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 15e8);

    // 2. ezETH
    const ezETHIndexInComet = await configurator.getAssetIndex(comet.address, EZETH_ADDRESS);
    const ezETHInWETHCometInfo = await comet.getAssetInfoByAddress(EZETH_ADDRESS);  
    const ezETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[ezETHIndexInComet];

    expect(ezETHInWETHCometInfo.priceFeed).to.eq(newEzETHPriceFeed);
    expect(ezETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newEzETHPriceFeed);
    expect(await comet.getPrice(newEzETHPriceFeed)).to.equal(await comet.getPrice(oldEzETHPriceFeed));
  },
});
