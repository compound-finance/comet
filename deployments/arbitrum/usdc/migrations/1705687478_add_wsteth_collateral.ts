import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { utils } from "ethers";

import { expect } from 'chai';

interface Vars { wstETHUSDPriceFeedAddress: string };

// https://docs.lido.fi/deployed-contracts/#arbitrum
const WSTETH_ARBITRUM_ADDRESS: string = '0x5979D7b546E38E414F7E9822514be443A4800529';

// ETH/USD Arbitrum price feed
// https://data.chain.link/arbitrum/mainnet/crypto-usd/eth-usd
const ETH_USD_PRICEFEED: string = '0x639fe6ab55c921f74e7fac1ee960c0b6293ba612';

// wstETH/stETH exchange rate feed
// https://data.chain.link/arbitrum/mainnet/crypto-eth/wsteth-steth%20exchangerate
const WSTETH_STETH_EXCHANGE_RATE: string = '0xb1552c5e96b312d0bf8b554186f846c40614a540';

// Gauntlet Initial Parameter Recommendations
// https://www.comp.xyz/t/temp-check-add-wsteth-as-a-collateral-on-base-eth-market-usdc-market-on-arbitrum-and-ethereum-mainnet/4867/12
const BORROW_COLLATERAL_FACTOR = exp(0.78, 18);
const LIQUIDATE_COLLATERAL_FACTOR = exp(0.83, 18);
const LIQUIDATION_FACTOR = exp(0.90, 18);
const SUPPLY_CAP = exp(2000, 18);

export default migration('1705687478_add_wsteth_collateral', {
  prepare: async (deploymentManager: DeploymentManager) => {
    // Deploy a composed price feed for wstETH
    // wstETH/USDC = wstETH/stETH exchange rate + ETH/USD
    //
    //! invariant: presumes 1:1 stETH/ETH
    //! as the Lido on Ethereum protocol has primary market for withdrawal redemptions
    //
    // similar to AAVE v3 approach:
    // https://governance.aave.com/t/bgd-operational-oracles-update/13213/9
    //
    // - https://arbiscan.io/address/0x945fD405773973d286De54E44649cc0d9e264F78
    // - https://github.com/bgd-labs/aave-address-book/blob/main/src/AaveV3Arbitrum.sol#L313
    // can't be re-used here diverging by interface (latestAnswer vs latestRoundData)
    //
    const wstETHUSDPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_EXCHANGE_RATE,
        ETH_USD_PRICEFEED,
        8,
        'wstETH/ETH/USD'
      ]
    );
    return { wstETHUSDPriceFeedAddress: wstETHUSDPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();

    // wstETH token address
    // https://etherscan.io/address/0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0
    const wstETH = await deploymentManager.existing('wstETH', WSTETH_ARBITRUM_ADDRESS, "arbitrum", "contracts/ERC20.sol:ERC20");
    const wstETHUSDPriceFeed = await deploymentManager.existing('wstETH:priceFeed', vars.wstETHUSDPriceFeedAddress, "arbitrum");

    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();
    const refundAddress = l2Timelock.address;

    const newAssetConfig = {
      asset: wstETH.address,
      priceFeed: wstETHUSDPriceFeed.address,
      decimals: await wstETH.decimals(),
      borrowCollateralFactor: BORROW_COLLATERAL_FACTOR,
      liquidateCollateralFactor: LIQUIDATE_COLLATERAL_FACTOR,
      liquidationFactor: LIQUIDATION_FACTOR,
      supplyCap: SUPPLY_CAP,
    };

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ["address", "address"],
      [configurator.address, comet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "string[]", "bytes[]"],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          "addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))",
          "deployAndUpgradeTo(address,address)",
        ],
        [addAssetCalldata, deployAndUpgradeToCalldata],
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

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Arbitrum.
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

    const description = '# Add wstETH as Collateral to cUSDCv3 Arbitrum\nSee the proposal and parameter recommendations here: https://www.comp.xyz/t/temp-check-add-wsteth-as-a-collateral-on-base-eth-market-usdc-market-on-arbitrum-and-ethereum-mainnet/4867';

    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === "ProposalCreated"
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
      wstETH,
      'wstETH:priceFeed': wstETHUSDPriceFeed
    } = await deploymentManager.getContracts();

    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);

    // check pricefeed
    expect(await wstETHInfo.priceFeed).to.be.eq(wstETHUSDPriceFeed.address);
    expect(await wstETHUSDPriceFeed.decimals()).to.be.eq(8);

    // check price composition
    const ethUSDPriceFeed = await deploymentManager.existing('ETHUSDPriceFeed', ETH_USD_PRICEFEED);
    const wstETHstETHRateFeed = await deploymentManager.existing('wstETHstETHRateFeed', WSTETH_STETH_EXCHANGE_RATE);

    const { r_, ethUSDPrice, s_, u_, a_ } = await ethUSDPriceFeed.latestRoundData();
    const { r__, wstETHstETHRate, s__, u__, a__ } = await wstETHstETHRateFeed.latestRoundData();
    const { r___, wstETHUSDPrice, s___, u___, a___ } = await wstETHUSDPriceFeed.latestRoundData();

    expect(BigInt(wstETHUSDPrice)).to.be.eq(BigInt(ethUSDPrice) * BigInt(wstETHstETHRate) / exp(10, 18));

    // check config
    expect(await wstETHInfo.borrowCollateralFactor).to.be.eq(BORROW_COLLATERAL_FACTOR);
    expect(await wstETHInfo.liquidateCollateralFactor).to.be.eq(LIQUIDATE_COLLATERAL_FACTOR);
    expect(await wstETHInfo.liquidationFactor).to.be.eq(LIQUIDATION_FACTOR);
    expect(await wstETHInfo.supplyCap).to.be.eq(SUPPLY_CAP);
  },
});
