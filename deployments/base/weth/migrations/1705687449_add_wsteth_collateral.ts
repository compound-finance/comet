import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { utils } from "ethers";

import { expect } from 'chai';

interface Vars { };

// https://docs.lido.fi/deployed-contracts/#base
const WSTETH_BASE_ADDRESS: string = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452';

// wstETH:stETH exchange rate feed
// https://data.chain.link/base/base/crypto-eth/wsteth-steth%20exchangerate
const WSTETH_STETH_EXCHANGE_RATE: string = '0xb88bac61a4ca37c43a3725912b1f472c9a5bc061';

// Gauntlet Initial Parameter Recommendations
// https://www.comp.xyz/t/temp-check-add-wsteth-as-a-collateral-on-base-eth-market-usdc-market-on-arbitrum-and-ethereum-mainnet/4867/12
const BORROW_COLLATERAL_FACTOR = exp(0.90, 18);
const LIQUIDATE_COLLATERAL_FACTOR = exp(0.93, 18);
const LIQUIDATION_FACTOR = exp(0.975, 18);
const SUPPLY_CAP = exp(100, 18);

export default migration('1705687449_add_wsteth_collateral', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();

    // wstETH token address
    const wstETH = await deploymentManager.existing('wstETH', WSTETH_BASE_ADDRESS, "base", "contracts/ERC20.sol:ERC20");
    const wstETHStETHRateFeed = await deploymentManager.existing('wstETH:priceFeed', WSTETH_STETH_EXCHANGE_RATE, "base");

    const {
      bridgeReceiver,
      timelock: l2TimeLock,
      comet,
      cometAdmin,
      configurator,
      rewards,
      WETH
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      baseL1StandardBridge,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: wstETH.address,
      priceFeed: wstETHStETHRateFeed.address,
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

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Arbitrum.
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [
          bridgeReceiver.address,                           // address to,
          l2ProposalData,
          3_000_000
        ],
      },
    ];

    const description = '# Add wstETH as Collateral to cWETHv3 on Base\nSee the proposal and parameter recommendations here: https://www.comp.xyz/t/temp-check-add-wsteth-as-a-collateral-on-base-eth-market-usdc-market-on-arbitrum-and-ethereum-mainnet/4867';

    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
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
      'wstETH:priceFeed': wstETHRateFeed
    } = await deploymentManager.getContracts();

    const wstETHInfo = await comet.getAssetInfoByAddress(wstETH.address);

    // check pricefeed
    expect(await wstETHInfo.priceFeed).to.be.eq(wstETHRateFeed.address);
    expect(await wstETHRateFeed.decimals()).to.be.eq(8);

    // check config
    expect(await wstETHInfo.borrowCollateralFactor).to.be.eq(BORROW_COLLATERAL_FACTOR);
    expect(await wstETHInfo.liquidateCollateralFactor).to.be.eq(LIQUIDATE_COLLATERAL_FACTOR);
    expect(await wstETHInfo.liquidationFactor).to.be.eq(LIQUIDATION_FACTOR);
    expect(await wstETHInfo.supplyCap).to.be.eq(SUPPLY_CAP);
  },
});
