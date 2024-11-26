import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const WUSDM_TO_USDM_PRICE_FEED_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const USDM_TO_USD_PRICE_FEED_ADDRESS = '0x24EA2671671c33D66e9854eC06e42E5D3ac1f764';

let newPriceFeedAddress: string;

export default migration('1727427904_add_wusdm_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wUSDMPriceFeed = await deploymentManager.deploy(
      'wUSDM:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        WUSDM_TO_USDM_PRICE_FEED_ADDRESS, // wUSDM / USDM price feed
        USDM_TO_USD_PRICE_FEED_ADDRESS,   // USDM / USD price feed
        8,                                // decimals
        'wUSDM/USD price feed'            // description
      ],
      true
    );
    return { wUSDMPriceFeedAddress: _wUSDMPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { wUSDMPriceFeedAddress }) => {
    const trace = deploymentManager.tracer();
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

    newPriceFeedAddress = wUSDMPriceFeedAddress;

    const wUSDM = await deploymentManager.existing(
      'wUSDM',
      WUSDM_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const wUSDMPriceFeed = await deploymentManager.existing(
      'wUSDM:priceFeed',
      wUSDMPriceFeedAddress,
      'arbitrum'
    );

    const wUSDMAssetConfig = {
      asset: wUSDM.address,
      priceFeed: wUSDMPriceFeed.address,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(4_500_000, 18),
    };

    const addAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          wUSDMAssetConfig.asset,
          wUSDMAssetConfig.priceFeed,
          wUSDMAssetConfig.decimals,
          wUSDMAssetConfig.borrowCollateralFactor,
          wUSDMAssetConfig.liquidateCollateralFactor,
          wUSDMAssetConfig.liquidationFactor,
          wUSDMAssetConfig.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address
        ],
        [
          0,
          0
        ],
        [
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          addAssetCalldata,
          deployAndUpgradeToCalldata,
        ]
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

    const description = '# Add wUSDM as collateral into cUSDCv3 on Arbitrum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wUSDM into cUSDCv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/list-wusdm-as-a-collateral-on-usdc-usdt-markets-on-arbitrum-and-ethereum/5590/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/931) and [forum discussion](https://www.comp.xyz/t/list-wusdm-as-a-collateral-on-usdc-usdt-markets-on-arbitrum-and-ethereum/5590).\n\n\n## Proposal Actions\n\nThe first proposal action adds wUSDM to the USDC Comet on Arbitrum. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const wUSDMAssetIndex = Number(await comet.numAssets()) - 1;

    const wUSDM = await deploymentManager.existing(
      'wUSDM',
      WUSDM_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const wUSDMAssetConfig = {
      asset: wUSDM.address,
      priceFeed: newPriceFeedAddress,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(4_500_000, 18),
    };

    // 1. & 2. Compare wUSDM asset config with Comet and Configurator asset info
    const cometWUSDMAssetInfo = await comet.getAssetInfoByAddress(WUSDM_ADDRESS);
    expect(wUSDMAssetIndex).to.be.equal(cometWUSDMAssetInfo.offset);
    expect(wUSDMAssetConfig.asset).to.be.equal(cometWUSDMAssetInfo.asset);
    expect(exp(1, wUSDMAssetConfig.decimals)).to.be.equal(cometWUSDMAssetInfo.scale);
    expect(wUSDMAssetConfig.borrowCollateralFactor).to.be.equal(cometWUSDMAssetInfo.borrowCollateralFactor);
    expect(wUSDMAssetConfig.liquidateCollateralFactor).to.be.equal(cometWUSDMAssetInfo.liquidateCollateralFactor);
    expect(wUSDMAssetConfig.liquidationFactor).to.be.equal(cometWUSDMAssetInfo.liquidationFactor);
    expect(wUSDMAssetConfig.supplyCap).to.be.equal(cometWUSDMAssetInfo.supplyCap);

    const configuratorWUSDMAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wUSDMAssetIndex];
    expect(wUSDMAssetConfig.asset).to.be.equal(configuratorWUSDMAssetConfig.asset);
    expect(wUSDMAssetConfig.decimals).to.be.equal(configuratorWUSDMAssetConfig.decimals);
    expect(wUSDMAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWUSDMAssetConfig.borrowCollateralFactor);
    expect(wUSDMAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWUSDMAssetConfig.liquidateCollateralFactor);
    expect(wUSDMAssetConfig.liquidationFactor).to.be.equal(configuratorWUSDMAssetConfig.liquidationFactor);
    expect(wUSDMAssetConfig.supplyCap).to.be.equal(configuratorWUSDMAssetConfig.supplyCap);
  },
});
