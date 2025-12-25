import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const USDC_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xe4c892BE702F8e0771122CCaAA0E50BF9639e2Fd';
const USDT_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x6AA147E11E423F529BEDAed75F3128D5fbE67939';
const ETH_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xe4dF63Bf89fD868A899F2422B030709FD79Be921';

let newPriceFeedUSDCAddress: string;
let newPriceFeedUSDTAddress: string;

let oldUSDCPriceFeed: string;
let oldUSDTPriceFeed: string;

export default migration('1766663003_change_price_feeds_to_svr', {
  async prepare(deploymentManager: DeploymentManager) {
    const _usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        USDC_TO_USD_SVR_PRICE_FEED_ADDRESS, // USDC / USD price feed
        ETH_TO_USD_SVR_PRICE_FEED_ADDRESS,  // USD / ETH price feed 
        8,                                  // decimals
        'USDC / ETH SVR Price Feed',        // description
      ],
      true
    );

    const _usdtPriceFeed = await deploymentManager.deploy(
      'USDT:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        USDT_TO_USD_SVR_PRICE_FEED_ADDRESS, // USDT / USD price feed
        ETH_TO_USD_SVR_PRICE_FEED_ADDRESS,  // USD / ETH price feed 
        8,                                  // decimals
        'USDT / ETH SVR Price Feed',        // description
      ],
      true
    );

    return {
      USDCPriceFeedAddress: _usdcPriceFeed.address,
      USDTPriceFeedAddress: _usdtPriceFeed.address,
    };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { 
      USDCPriceFeedAddress,
      USDTPriceFeedAddress,
    }
  ) => {
    const trace = deploymentManager.tracer();
    newPriceFeedUSDCAddress = USDCPriceFeedAddress;
    newPriceFeedUSDTAddress = USDTPriceFeedAddress;

    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator,
      USDC,
      'USD₮0':USDT
    } = await deploymentManager.getContracts();

    const { governor, timelock, arbitrumInbox } = await govDeploymentManager.getContracts();

    const updateUSDCPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        USDC.address,
        newPriceFeedUSDCAddress
      )
    );

    const updateUSDTPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        USDT.address,
        newPriceFeedUSDTAddress
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
        [0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateUSDCPriceFeedCalldata,
          updateUSDTPriceFeedCalldata,
          deployAndUpgradeToCalldata],
      ]
    );

    [,, oldUSDCPriceFeed] = await comet.getAssetInfoByAddress(USDC.address);
    [,, oldUSDTPriceFeed] = await comet.getAssetInfoByAddress(USDT.address);
    
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

    const description = `# Update price feeds in cWETHv3 on Arbitrum with SVR price feeds.

## Proposal summary

This proposal updates existing price feeds for USDC and USDT assets on the WETH market on Arbitrum.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1080) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### SVR fee recipient

SVR generates revenue from liquidators and Compound DAO will receive that revenue as part of the protocol fee. The fee recipient for SVR is set to Compound DAO multisig: 0xd9496F2A3fd2a97d8A4531D92742F3C8F53183cB.

## Proposal actions

The first action updates USDC and USDT price feeds to the SVR implementation. This sends the encoded 'updateAssetPriceFeed' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.
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
      USDC,      
      'USD₮0':USDT
    } = await deploymentManager.getContracts();

    // 1. USDC
    const USDCIndexInComet = await configurator.getAssetIndex(
      comet.address,
      USDC.address
    );
    const USDCInCometInfo = await comet.getAssetInfoByAddress(USDC.address);
    const USDCInConfiguratorInfoUSDCComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[USDCIndexInComet];

    expect(USDCInCometInfo.priceFeed).to.eq(newPriceFeedUSDCAddress);
    expect(USDCInConfiguratorInfoUSDCComet.priceFeed).to.eq(newPriceFeedUSDCAddress);

    expect(await comet.getPrice(newPriceFeedUSDCAddress)).to.be.closeTo(await comet.getPrice(oldUSDCPriceFeed), 1e6);

    // 2. USDT
    const USDTIndexInComet = await configurator.getAssetIndex(
      comet.address,
      USDT.address
    );
    const USDTInCometInfo = await comet.getAssetInfoByAddress(USDT.address);
    const USDTInConfiguratorInfoUSDTComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[USDTIndexInComet];

    expect(USDTInCometInfo.priceFeed).to.eq(newPriceFeedUSDTAddress);
    expect(USDTInConfiguratorInfoUSDTComet.priceFeed).to.eq(newPriceFeedUSDTAddress);
    expect(await comet.getPrice(newPriceFeedUSDTAddress)).to.be.closeTo(await comet.getPrice(oldUSDTPriceFeed), 1e6);
  },
});
