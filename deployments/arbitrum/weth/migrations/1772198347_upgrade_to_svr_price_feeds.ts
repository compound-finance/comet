import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal, exp } from '../../../../src/deploy';
import { Contract, utils } from 'ethers';
import { AggregatorV3Interface } from '../../../../build/types';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const ETH_USD_SVR_PRICE_FEED = '0xe4dF63Bf89fD868A899F2422B030709FD79Be921';
const BTC_USD_SVR_PRICE_FEED = '0x06047dD6f43552831BB51319917DC0C99c29A44c';
const RSETH_ETH_PRICE_FEED = '0x3A917e6B5732dFCc4A45257e3930979fAE6a3737';

const FEED_DECIMALS = 8;
const blockToFetch = 420000000;

let newRsETHPriceFeed: string;
let newWbtcPriceFeed: string;

let oldRsETHPriceFeed: string;
let oldWbtcPriceFeed: string;

export default migration('1772198347_upgrade_to_svr_price_feeds', {
  async prepare(deploymentManager: DeploymentManager) {

    //1. WBTC
    const _wbtcScalingPriceFeed = await deploymentManager.deploy(
      'WBTC:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        BTC_USD_SVR_PRICE_FEED,      // WBTC / USD price feed
        ETH_USD_SVR_PRICE_FEED,      // ETH / USD price feed 
        FEED_DECIMALS,               // decimals
        'WBTC / ETH SVR Price Feed', // description
      ],
      true
    );

    const { timelock } = await deploymentManager.getContracts();
    const blockToFetchTimestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))!.timestamp;

    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'arbitrum', 'weth');
    const rateProviderRsEth = await deploymentManager.existing('rsETH:_rateProvider', RSETH_ETH_PRICE_FEED, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioRsEth] = await rateProviderRsEth.latestRoundData({blockTag: blockToFetch});
    const rsEthCapoPriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        constantPriceFeed.address,
        RSETH_ETH_PRICE_FEED,
        'rsETH / ETH CAPO Price Feed',
        FEED_DECIMALS,
        3600,
        {
          snapshotRatio: currentRatioRsEth,
          snapshotTimestamp: blockToFetchTimestamp,
          maxYearlyRatioGrowthPercent: exp(0.0554, 4)
        }
      ],
      true
    );

    return {
      wbtcPriceFeedAddress: _wbtcScalingPriceFeed.address,
      rsEthCapoPriceFeedAddress: rsEthCapoPriceFeed.address
    };
  },

  async enact(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, {
    wbtcPriceFeedAddress,
    rsEthCapoPriceFeedAddress
  }) {
    newRsETHPriceFeed = rsEthCapoPriceFeedAddress;
    newWbtcPriceFeed = wbtcPriceFeedAddress;

    const trace = deploymentManager.tracer();
    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      rsETH,
      WBTC,
      configurator
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    const updateRsEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        rsETH.address,
        rsEthCapoPriceFeedAddress
      )
    );

    const updateWbtcPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WBTC.address,
        wbtcPriceFeedAddress
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
        [configurator.address, configurator.address, cometAdmin.address],
        [0, 0, 0],
        ['updateAssetPriceFeed(address,address,address)', 'updateAssetPriceFeed(address,address,address)', 'deployAndUpgradeTo(address,address)'],
        [updateRsEthPriceFeedCalldata, updateWbtcPriceFeedCalldata, deployAndUpgradeToCalldata],
      ]
    );

    [,, oldRsETHPriceFeed] = await comet.getAssetInfoByAddress(rsETH.address);
    [,, oldWbtcPriceFeed] = await comet.getAssetInfoByAddress(WBTC.address);

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
      // 1. Set Comet configuration and deployAndUpgradeTo WETH Comet on Arbitrum.
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

    const description = `# Update rsETH and WBTC price feeds in cWETHv3 on Arbitrum with SVR and CAPO price feeds.

## Proposal summary

This proposal updates existing price feeds for rsETH and WBTC assets on the WETH market on Arbitrum.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1092), [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### rsETH price feed change

Previously the rsETH price feed had a wrsETH / rsETH oracle, this proposal will change it to rsETH / ETH CAPO price feed.

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. rsETH price feed is updated to its CAPO implementation.

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631), as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

### SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xb3E79c7CaC540CA833015E63d96D3032Ba0C4129.

## Proposal actions

The first action updates rsETH price feed to the CAPO implementation and WBTC price feed to the SVR implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.
`;

    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
    );
    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator, rsETH, WBTC } = await deploymentManager.getContracts();

    const rsETHIndexInComet = await configurator.getAssetIndex(comet.address, rsETH.address);
    const WBTCIndexInComet = await configurator.getAssetIndex(comet.address, WBTC.address);

    // rsETH
    const rsETHInCometInfo = await comet.getAssetInfoByAddress(rsETH.address);
    const rsETHInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[rsETHIndexInComet];

    expect(rsETHInCometInfo.priceFeed).to.eq(newRsETHPriceFeed);
    expect(rsETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newRsETHPriceFeed);
    expect(await comet.getPrice(newRsETHPriceFeed)).to.be.closeTo(await comet.getPrice(oldRsETHPriceFeed), 1e5);

    const rsETHPriceFeed = new Contract(
      rsETHInCometInfo.priceFeed,
      [
        'function ratioProvider() view returns (address)',
        'function maxYearlyRatioGrowthPercent() view returns (uint32)',
      ],
      await deploymentManager.getSigner()
    );
    expect(await rsETHPriceFeed.ratioProvider()).to.eq(RSETH_ETH_PRICE_FEED);
    expect(await rsETHPriceFeed.maxYearlyRatioGrowthPercent()).to.eq(554);

    // WBTC
    const WBTCInCometInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const WBTCInConfiguratorInfoWETHComet = (await configurator.getConfiguration(comet.address)).assetConfigs[WBTCIndexInComet];

    expect(WBTCInCometInfo.priceFeed).to.eq(newWbtcPriceFeed);
    expect(WBTCInConfiguratorInfoWETHComet.priceFeed).to.eq(newWbtcPriceFeed);
    expect(await comet.getPrice(newWbtcPriceFeed)).to.be.closeTo(await comet.getPrice(oldWbtcPriceFeed), 2e7);

    const wbtcPriceFeed = new Contract(WBTCInCometInfo.priceFeed,
      [
        'function priceFeedA() view returns (address)',
        'function priceFeedB() view returns (address)',
      ],
      await deploymentManager.getSigner()
    );
    expect(await wbtcPriceFeed.priceFeedA()).to.eq(BTC_USD_SVR_PRICE_FEED);
    expect(await wbtcPriceFeed.priceFeedB()).to.eq(ETH_USD_SVR_PRICE_FEED);
  },
});
