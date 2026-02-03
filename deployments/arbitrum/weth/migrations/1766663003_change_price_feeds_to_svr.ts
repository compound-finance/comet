import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const USDC_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xe4c892BE702F8e0771122CCaAA0E50BF9639e2Fd';
const USDT_TO_USD_SVR_PRICE_FEED_ADDRESS = '0x6AA147E11E423F529BEDAed75F3128D5fbE67939';
const ETH_TO_USD_SVR_PRICE_FEED_ADDRESS = '0xe4dF63Bf89fD868A899F2422B030709FD79Be921';

const WSTETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS = '0x311930889C61E141E15a61D11BE974D749390E7A';
const ETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS = '0xA2699232B341881B1Ed85d91592b7c259E029aCf';
const RSETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS = '0xA4F2e977CAb3177D61E2e7eAEcd257Bf09F2f915';
const WETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS = '0x4F12633d511dC3049DE1ea923b7047fBeD0070D2';
const RETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS = '0x60F2058379716A64a7A5d29219397e79bC552194';

let newPriceFeedUSDCAddress: string;
let newPriceFeedUSDTAddress: string;

let oldUSDCPriceFeed: string;
let oldUSDTPriceFeed: string;

let oldWstETHPriceFeed: string;
let oldEzETHPriceFeed: string;
let oldRsETHPriceFeed: string;
let oldWeETHPriceFeed: string;
let oldRETHPriceFeed: string;

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
      'USD₮0':USDT,
      wstETH,
      ezETH,
      rsETH,
      weETH,
      rETH
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

    const updateWstETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        wstETH.address,
        WSTETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS
      )
    );

    const updateEzETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        ezETH.address,
        ETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS
      )
    );

    const updateRsETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        rsETH.address,
        RSETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS
      )
    );

    const updateWeETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        weETH.address,
        WETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS
      )
    );

    const updateRETHPriceFeedCalldata = await calldata(
      configurator.populateTransaction.updateAssetPriceFeed(
        comet.address,
        rETH.address,
        RETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS
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
          configurator.address,
          configurator.address,
          cometAdmin.address
        ],
        [0, 0, 0, 0, 0, 0, 0, 0],
        [
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'updateAssetPriceFeed(address,address,address)',
          'deployAndUpgradeTo(address,address)'
        ],
        [
          updateUSDCPriceFeedCalldata,
          updateUSDTPriceFeedCalldata,
          updateWstETHPriceFeedCalldata,
          updateEzETHPriceFeedCalldata,
          updateRsETHPriceFeedCalldata,
          updateWeETHPriceFeedCalldata,
          updateRETHPriceFeedCalldata,
          deployAndUpgradeToCalldata],
      ]
    );

    [,, oldUSDCPriceFeed] = await comet.getAssetInfoByAddress(USDC.address);
    [,, oldUSDTPriceFeed] = await comet.getAssetInfoByAddress(USDT.address);
    [,, oldWstETHPriceFeed] = await comet.getAssetInfoByAddress(wstETH.address);
    [,, oldEzETHPriceFeed] = await comet.getAssetInfoByAddress(ezETH.address);
    [,, oldRsETHPriceFeed] = await comet.getAssetInfoByAddress(rsETH.address);
    [,, oldWeETHPriceFeed] = await comet.getAssetInfoByAddress(weETH.address);
    [,, oldRETHPriceFeed] = await comet.getAssetInfoByAddress(rETH.address);
    
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

    const description = `# Update price feeds in cWETHv3 on Arbitrum with SVR and CAPO price feeds.

## Proposal summary

This proposal updates existing price feeds for USDC, USDT, wstETH, ezETH, rsETH, weETH, and rETH assets on the WETH market on Arbitrum.

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1080), [forum discussion for CAPO](https://www.comp.xyz/t/woof-correlated-assets-price-oracle-capo/6245) and [forum discussion for SVR](https://www.comp.xyz/t/request-for-proposal-rfp-oracle-extractable-value-oev-solution-for-compound-protocol/6786).

### CAPO summary

CAPO is a price oracle adapter designed to support assets that grow gradually relative to a base asset - such as liquid staking tokens that accumulate yield over time. It provides a mechanism to track this expected growth while protecting downstream protocol from sudden or manipulated price spikes. wstETH, ezETH, rsETH, weETH, and rETH price feeds are updated to their CAPO implementations.

### CAPO audit

CAPO has been audited by [OpenZeppelin](https://www.comp.xyz/t/capo-price-feed-audit/6631, as well as the LST / LRT implementation [here](https://www.comp.xyz/t/capo-lst-lrt-audit/7118).


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
      'USD₮0':USDT,
      wstETH,
      ezETH,
      rsETH,
      weETH,
      rETH,
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
    
    // 3. wstETH
    const wstETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      wstETH.address
    );
    const wstETHInCometInfo = await comet.getAssetInfoByAddress(wstETH.address);
    const wstETHInConfiguratorInfoUSDTComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHIndexInComet];

    expect(wstETHInCometInfo.priceFeed).to.eq(WSTETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(wstETHInConfiguratorInfoUSDTComet.priceFeed).to.eq(WSTETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(WSTETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldWstETHPriceFeed), 1e6);

    // 4. ezETH
    const ezETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      ezETH.address
    );
    const ezETHInCometInfo = await comet.getAssetInfoByAddress(ezETH.address);
    const ezETHInConfiguratorInfoUSDTComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[ezETHIndexInComet];

    expect(ezETHInCometInfo.priceFeed).to.eq(ETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(ezETHInConfiguratorInfoUSDTComet.priceFeed).to.eq(ETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(ETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldEzETHPriceFeed), 1e6);

    // 5. rsETH
    const rsETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      rsETH.address
    );
    const rsETHInCometInfo = await comet.getAssetInfoByAddress(rsETH.address);
    const rsETHInConfiguratorInfoUSDTComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rsETHIndexInComet];

    expect(rsETHInCometInfo.priceFeed).to.eq(RSETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(rsETHInConfiguratorInfoUSDTComet.priceFeed).to.eq(RSETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(RSETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldRsETHPriceFeed), 1e6);

    // 6. weETH
    const weETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      weETH.address
    );
    const weETHInCometInfo = await comet.getAssetInfoByAddress(weETH.address);
    const weETHInConfiguratorInfoUSDTComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[weETHIndexInComet];

    expect(weETHInCometInfo.priceFeed).to.eq(WETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(weETHInConfiguratorInfoUSDTComet.priceFeed).to.eq(WETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(WETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldWeETHPriceFeed), 1e6);

    // 7. rETH
    const rETHIndexInComet = await configurator.getAssetIndex(
      comet.address,
      rETH.address
    );
    const rETHInCometInfo = await comet.getAssetInfoByAddress(rETH.address);
    const rETHInConfiguratorInfoUSDTComet = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[rETHIndexInComet];

    expect(rETHInCometInfo.priceFeed).to.eq(RETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(rETHInConfiguratorInfoUSDTComet.priceFeed).to.eq(RETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS);
    expect(await comet.getPrice(RETH_TO_ETH_CAPO_PRICE_FEED_ADDRESS)).to.be.closeTo(await comet.getPrice(oldRETHPriceFeed), 1e6);
  }
});
