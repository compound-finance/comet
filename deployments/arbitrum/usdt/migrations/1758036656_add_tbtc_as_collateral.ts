import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import {
  applyL1ToL2Alias,
  estimateL2Transaction,
} from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const TBTC_ADDRESS = '0x6c84a8f1c29108F47a79964b5Fe888D4f4D0dE40';
const TBTC_TO_USD_PRICE_FEED_ADDRESS = '0xE808488e8627F6531bA79a13A9E0271B39abEb1C';

export default migration('1758036656_add_tbtc_as_collateral', {
  async prepare() {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();
    const {
      bridgeReceiver,
      timelock: l2Timelock,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { arbitrumInbox, timelock, governor } = await govDeploymentManager.getContracts();

    const tBTC = await deploymentManager.existing(
      'tBTC',
      TBTC_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const tBTCPriceFeed = await deploymentManager.existing(
      'tBTC:priceFeed',
      TBTC_TO_USD_PRICE_FEED_ADDRESS,
      'arbitrum'
    );

    const tBTCAssetConfig = {
      asset: tBTC.address,
      priceFeed: tBTCPriceFeed.address,
      decimals: await tBTC.decimals(),
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(80, 18),
    };

    const addAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [
        comet.address,
        [
          tBTCAssetConfig.asset,
          tBTCAssetConfig.priceFeed,
          tBTCAssetConfig.decimals,
          tBTCAssetConfig.borrowCollateralFactor,
          tBTCAssetConfig.liquidateCollateralFactor,
          tBTCAssetConfig.liquidationFactor,
          tBTCAssetConfig.supplyCap,
        ],
      ]
    );

    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [addAssetCalldata, deployAndUpgradeToCalldata],
      ]
    );

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData,
      },
      deploymentManager
    );
    const refundAddress = l2Timelock.address;

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo USDT Comet on Arbitrum.
      {
        contract: arbitrumInbox,
        signature:
          'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address, // address to,
          0, // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          refundAddress, // address excessFeeRefundAddress,
          refundAddress, // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit, // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas, // uint256 maxFeePerGas,
          l2ProposalData, // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit,
      },
    ];

    const description = `# Add tBTC as collateral into cUSDTv3 on Arbitrum

## Proposal summary

WOOF! proposes to add tBTC into cUSDTv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-tbtc-recommendations-across-comets-12-6-24/6036).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1028) and [forum discussion](https://www.comp.xyz/t/gauntlet-tbtc-recommendations-across-comets-12-6-24/6036).

## Proposal Actions

The first proposal action adds tBTC to the USDT Comet on Arbitrum. This sends the encoded 'addAsset' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.`;

    const txn = await govDeploymentManager.retry(async () =>
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

    const tBTCAssetIndex = Number(await comet.numAssets()) - 1;

    const tBTC = await deploymentManager.existing(
      'tBTC',
      TBTC_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const tBTCAssetConfig = {
      asset: tBTC.address,
      priceFeed: TBTC_TO_USD_PRICE_FEED_ADDRESS,
      decimals: 18n,
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(80, 18),
    };

    // 1. & 2. Compare tBTC asset config with Comet and Configurator asset info
    const cometTBTCAssetInfo = await comet.getAssetInfoByAddress(TBTC_ADDRESS);
    expect(tBTCAssetIndex).to.be.equal(cometTBTCAssetInfo.offset);
    expect(tBTCAssetConfig.asset).to.be.equal(cometTBTCAssetInfo.asset);
    expect(exp(1, tBTCAssetConfig.decimals)).to.be.equal(cometTBTCAssetInfo.scale);
    expect(tBTCAssetConfig.borrowCollateralFactor).to.be.equal(cometTBTCAssetInfo.borrowCollateralFactor);
    expect(tBTCAssetConfig.liquidateCollateralFactor).to.be.equal(cometTBTCAssetInfo.liquidateCollateralFactor);
    expect(tBTCAssetConfig.liquidationFactor).to.be.equal(cometTBTCAssetInfo.liquidationFactor);
    expect(tBTCAssetConfig.supplyCap).to.be.equal(cometTBTCAssetInfo.supplyCap);

    const configuratorTBTCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[tBTCAssetIndex];
    expect(tBTCAssetConfig.asset).to.be.equal(configuratorTBTCAssetConfig.asset);
    expect(tBTCAssetConfig.decimals).to.be.equal(configuratorTBTCAssetConfig.decimals);
    expect(tBTCAssetConfig.borrowCollateralFactor).to.be.equal(configuratorTBTCAssetConfig.borrowCollateralFactor);
    expect(tBTCAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorTBTCAssetConfig.liquidateCollateralFactor);
    expect(tBTCAssetConfig.liquidationFactor).to.be.equal(configuratorTBTCAssetConfig.liquidationFactor);
    expect(tBTCAssetConfig.supplyCap).to.be.equal(configuratorTBTCAssetConfig.supplyCap);
  },
});
