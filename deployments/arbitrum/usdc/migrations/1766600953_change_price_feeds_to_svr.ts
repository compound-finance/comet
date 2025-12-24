import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const WETH_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xe4dF63Bf89fD868A899F2422B030709FD79Be921';
const USDC_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xe4c892BE702F8e0771122CCaAA0E50BF9639e2Fd';
const ARB_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x54a82Bc6C6540F95C0b84690773635aCC97A92ff';
const WBTC_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x06047dD6f43552831BB51319917DC0C99c29A44c';


let newPriceFeedWETHAddress: string;
let newPriceFeedUSDCAddress: string;
let newPriceFeedARBAddress: string;
let newPriceFeedWBTCAddress: string;

let oldWETHPriceFeed: string;
let oldUSDCPriceFeed: string;
let oldARBPriceFeed: string;
let oldWBTCPriceFeed: string;

export default migration('1766600953_change_price_feeds_to_svr', {
  async prepare(deploymentManager: DeploymentManager) {
    const _WETHPriceFeed = await deploymentManager.deploy(
      'WETH:priceFeed',
      'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
      [
        WETH_TO_USD_SVR_PRICE_FEED_ADDRESS, // WETH / USD price feed
        8,                                  // decimals
        'ETH / USD SVR Price Feed'          // custom description
      ],
      true
    );

    const _USDCPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
      [
        USDC_TO_USD_SVR_PRICE_FEED_ADDRESS, // USDC / USD price feed
        8,                                  // decimals
        'USDC / USD SVR Price Feed'         // custom description
      ],
      true
    );

    const _ARBPriceFeed = await deploymentManager.deploy(
      'ARB:priceFeed',
      'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
      [
        ARB_TO_USD_SVR_PRICE_FEED_ADDRESS, // ARB / USD price feed
        8,                                 // decimals
        'ARB / USD SVR Price Feed'         // custom description
      ],
      true
    );

    const _WBTCPriceFeed = await deploymentManager.deploy(
      'WBTC:priceFeed',
      'pricefeeds/ScalingPriceFeedWithCustomDescription.sol',
      [
        WBTC_TO_USD_SVR_PRICE_FEED_ADDRESS, // WBTC / USD price feed
        8,                                  // decimals
        'BTC / USD SVR Price Feed'         // custom description
      ],
      true
    );

    return {
      WETHPriceFeedAddress: _WETHPriceFeed.address,
      USDCPriceFeedAddress: _USDCPriceFeed.address,
      ARBPriceFeedAddress: _ARBPriceFeed.address,
      WBTCPriceFeedAddress: _WBTCPriceFeed.address
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { 
      WETHPriceFeedAddress,
      USDCPriceFeedAddress,
      ARBPriceFeedAddress,
      WBTCPriceFeedAddress
    }
  ) => {
    const trace = deploymentManager.tracer();
    newPriceFeedWETHAddress = WETHPriceFeedAddress;
    newPriceFeedUSDCAddress = USDCPriceFeedAddress;
    newPriceFeedARBAddress = ARBPriceFeedAddress;
    newPriceFeedWBTCAddress = WBTCPriceFeedAddress;

    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator,
      WETH,
      ARB,
      WBTC
    } = await deploymentManager.getContracts();

    const { governor, timelock, arbitrumInbox } = await govDeploymentManager.getContracts();

    const updateWEthPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WETH.address,
        newPriceFeedWETHAddress
      )
    );
    const updateUSDCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.setBaseTokenPriceFeed(
        comet.address,
        newPriceFeedUSDCAddress
      )
    );

    const updateARBPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        ARB.address,
        newPriceFeedARBAddress
      )
    );

    const updateWBTCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        WBTC.address,
        newPriceFeedWBTCAddress
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
          cometAdmin.address
        ],
        [0, 0, 0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'setBaseTokenPriceFeed(address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateWEthPriceFeedCalldata,
          updateUSDCPriceFeedCalldata,
          updateARBPriceFeedCalldata,
          updateWBTCPriceFeedCalldata,
          deployAndUpgradeToCalldata],
      ]
    );

    [,, oldWETHPriceFeed] = await comet.getAssetInfoByAddress(WETH.address);
    oldUSDCPriceFeed = await comet.baseTokenPriceFeed();
    [,, oldARBPriceFeed] = await comet.getAssetInfoByAddress(ARB.address);
    [,, oldWBTCPriceFeed] = await comet.getAssetInfoByAddress(WBTC.address);
    
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
      // 1. Set Comet configuration and deployAndUpgradeTo USDC Comet on Arbitrum.
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

    const description = `# Update price feeds in cUSDCv3 on Arbitrum with SVR price feeds.

## Proposal summary

This proposal updates existing price feeds for WETH, ARB, WBTC and USDC assets on the USDC market on Arbitrum.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1077) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates WETH, ARB, WBTC and USDC price feeds to the SVR implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.
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

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      comet,
      configurator,
      WETH,
      ARB,
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

    expect(WETHInCometInfo.priceFeed).to.eq(newPriceFeedWETHAddress);
    expect(WETHInConfiguratorInfoWETHComet.priceFeed).to.eq(newPriceFeedWETHAddress);

    expect(await comet.getPrice(newPriceFeedWETHAddress)).to.be.closeTo(await comet.getPrice(oldWETHPriceFeed), 5e8); // 5$

    // 2. USDC
    const USDCPriceFeedFromComet = await comet.baseTokenPriceFeed();
    const USDCPriceFeedFromConfigurator = (
      await configurator.getConfiguration(comet.address)
    ).baseTokenPriceFeed;

    expect(USDCPriceFeedFromComet).to.eq(newPriceFeedUSDCAddress);
    expect(USDCPriceFeedFromConfigurator).to.eq(newPriceFeedUSDCAddress);

    expect(await comet.getPrice(newPriceFeedUSDCAddress)).to.be.closeTo(await comet.getPrice(oldUSDCPriceFeed), 1e8); // 1$

    // 3. ARB
    const ARBIndexInComet = await configurator.getAssetIndex(
      comet.address,
      ARB.address
    );
    const ARBInCometInfo = await comet.getAssetInfoByAddress(ARB.address);
    const ARBInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ARBIndexInComet];

    expect(ARBInCometInfo.priceFeed).to.eq(newPriceFeedARBAddress);
    expect(ARBInConfiguratorInfoWETHComet.priceFeed).to.eq(newPriceFeedARBAddress);

    expect(await comet.getPrice(newPriceFeedARBAddress)).to.be.closeTo(await comet.getPrice(oldARBPriceFeed), 5e6); // 0.05$

    // 4. WBTC
    const WBTCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      WBTC.address
    );
    const WBTCInCometInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const WBTCInConfiguratorInfoWETHComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[WBTCIndexInComet];

    expect(WBTCInCometInfo.priceFeed).to.eq(newPriceFeedWBTCAddress);
    expect(WBTCInConfiguratorInfoWETHComet.priceFeed).to.eq(newPriceFeedWBTCAddress);

    expect(await comet.getPrice(newPriceFeedWBTCAddress)).to.be.closeTo(await comet.getPrice(oldWBTCPriceFeed), 250e8); // 250$
  },
});
