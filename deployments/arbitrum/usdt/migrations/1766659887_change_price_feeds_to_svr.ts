import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal, exp } from '../../../../src/deploy';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { AggregatorV3Interface } from '../../../../build/types';

// scaling price feeds
const USDT_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xedfB5fD27B0259B0A696364b183223B5ca3CBE62';
const WETH_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xb2988bDAdc45c43e3fE1A728F715E94bee4DB406';
const ARB_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x5998a5C516bD5E479E0B6aa6F243d372730B68d2';
const WBTC_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xcc392d2c3b37520e01712320bE331D41F7661013';

// chainlink oracles
const ETH_TO_USD_ORACLE_ADDRESS = '0xe4dF63Bf89fD868A899F2422B030709FD79Be921';
const WSTETH_STETH_ORACLE_ADDRESS = '0xB1552C5e96B312d0Bf8b554186F846C40614a540';

let newPriceFeedWstETHAddress: string;

let oldWETHPriceFeed: string;
let oldUSDTPriceFeed: string;
let oldARBPriceFeed: string;
let oldWBTCPriceFeed: string;
let oldWstETHPriceFeed: string;

const blockToFetch = 425000000;

export default migration('1766659887_change_price_feeds_to_svr', {
  async prepare(deploymentManager: DeploymentManager) {
    const { timelock } = await deploymentManager.getContracts();

    const rateProviderWstEth = await deploymentManager.existing('wstETH:_rateProvider', WSTETH_STETH_ORACLE_ADDRESS, 'arbitrum', 'contracts/capo/contracts/interfaces/AggregatorV3Interface.sol:AggregatorV3Interface') as AggregatorV3Interface;
    const [, currentRatioWstEth] = await rateProviderWstEth.latestRoundData({ blockTag: blockToFetch });
    const timestamp = (await deploymentManager.hre.ethers.provider.getBlock(blockToFetch))?.timestamp;

    const wstEthCapoPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'capo/contracts/ChainlinkCorrelatedAssetsPriceOracle.sol',
      [
        timelock.address,
        ETH_TO_USD_ORACLE_ADDRESS,
        WSTETH_STETH_ORACLE_ADDRESS,
        'wstETH / USD CAPO SVR Price Feed',
        8,
        3600,
        {
          snapshotRatio: currentRatioWstEth,
          snapshotTimestamp: timestamp,
          maxYearlyRatioGrowthPercent: exp(0.0404, 4) // 4.04%
        }
      ],
      true
    );

    return {
      wstEthCapoPriceFeedAddress: wstEthCapoPriceFeed.address
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { 
      wstEthCapoPriceFeedAddress,
    }
  ) => {
    const trace = deploymentManager.tracer();
    newPriceFeedWstETHAddress = wstEthCapoPriceFeedAddress;

    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator,
      WETH,
      ARB,
      wstETH,
      WBTC
    } = await deploymentManager.getContracts();

    const { governor, timelock, arbitrumInbox } = await govDeploymentManager.getContracts();

    const updateWEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WETH.address,
        WETH_TO_USD_SVR_PRICE_FEED_ADDRESS
      )
    );
    const updateUSDTPriceFeedCalldata = await calldata(
      configurator.populateTransaction.setBaseTokenPriceFeed(
        comet.address,
        USDT_TO_USD_SVR_PRICE_FEED_ADDRESS
      )
    );

    const updateWstETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        wstETH.address,
        wstEthCapoPriceFeedAddress
      )
    );

    const updateARBPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        ARB.address,
        ARB_TO_USD_SVR_PRICE_FEED_ADDRESS
      )
    );

    const updateWBTCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WBTC.address,
        WBTC_TO_USD_SVR_PRICE_FEED_ADDRESS
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
        [0, 0, 0, 0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'setBaseTokenPriceFeed(address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateWEthPriceFeedCalldata,
          updateUSDTPriceFeedCalldata,
          updateARBPriceFeedCalldata,
          updateWBTCPriceFeedCalldata,
          updateWstETHPriceFeedCalldata,
          deployAndUpgradeToCalldata],
      ]
    );

    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH.address);
    oldUSDTPriceFeed = await comet.baseTokenPriceFeed();
    [,, oldARBPriceFeed] = await comet.getAssetInfoByAddress(ARB.address);
    [,, oldWBTCPriceFeed] = await comet.getAssetInfoByAddress(WBTC.address);
    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(wstETH.address);
    
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
      // 1. Set Comet configuration and deployAndUpgradeTo USDT Comet on Arbitrum.
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

    const description = `# Update price feeds in cUSDTv3 on Arbitrum with CAPO and SVR price feeds.

## Proposal summary

This proposal updates existing price feeds for WETH, ARB, WBTC, wstETH and USDT assets on the USDT market on Arbitrum.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1079), [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH price feed are updated to their CAPO implementations.

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).

### SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates WETH, ARB, WBTC, wstETH  and USDT price feeds to the SVR implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.
`;
    const txn = await govDeploymentManager.retry(async () =>
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      configurator,
      WETH,
      ARB,
      wstETH,
      WBTC
    } = await deploymentManager.getContracts();

    // 1. WETH
    const WETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WETH.address
    );
    const WETHInCometInfo = await comet.getAssetInfoByAddress(WETH.address);
    const WETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WETHIndexInComet];

    expect(WETHInCometInfo.priceFeed).to.eq(WETH_TO_USD_SVR_PRICE_FEED_ADDRESS);
    expect(WETHInConfiguratorInfoWETHComet.priceFeed).to.eq(WETH_TO_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(WETH_TO_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 5e8); // 5$

    // 2. USDT
    const USDTPriceFeedFromComet = await comet.baseTokenPriceFeed();
    const USDTPriceFeedFromConfigurator = (
      await configurator.getConfiguration(comet.address)
    ).baseTokenPriceFeed;

    expect(USDTPriceFeedFromComet).to.eq(USDT_TO_USD_SVR_PRICE_FEED_ADDRESS);
    expect(USDTPriceFeedFromConfigurator).to.eq(USDT_TO_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(USDT_TO_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldUSDTPriceFeed), 1e8); // 1$

    // 3. ARB
    const ARBIndexInComet = await configurator.getAssetIndex(
      comet.address,
      ARB.address
    );
    const ARBInCometInfo = await comet.getAssetInfoByAddress(ARB.address);
    const ARBInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ARBIndexInComet];

    expect(ARBInCometInfo.priceFeed).to.eq(ARB_TO_USD_SVR_PRICE_FEED_ADDRESS);
    expect(ARBInConfiguratorInfoWETHComet.priceFeed).to.eq(ARB_TO_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(ARB_TO_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldARBPriceFeed), 5e6); // 0.05$

    // 4. WBTC
    const WBTCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WBTC.address
    );
    const WBTCInCometInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const WBTCInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WBTCIndexInComet];

    expect(WBTCInCometInfo.priceFeed).to.eq(WBTC_TO_USD_SVR_PRICE_FEED_ADDRESS);
    expect(WBTCInConfiguratorInfoWETHComet.priceFeed).to.eq(WBTC_TO_USD_SVR_PRICE_FEED_ADDRESS);

    expect(await comet.getPrice(WBTC_TO_USD_SVR_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldWBTCPriceFeed), 250e8); // 250$

    // 5. wstETH
    const wstETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      wstETH.address
    );
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(wstETH.address);
    const wstETHInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(newPriceFeedWstETHAddress);
    expect(wstETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newPriceFeedWstETHAddress);

    expect(await comet.getPrice(newPriceFeedWstETHAddress)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 5e8); // 5$
  },
});
