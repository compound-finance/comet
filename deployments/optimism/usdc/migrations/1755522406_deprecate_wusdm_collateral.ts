import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal, exp } from '../../../../src/deploy';
import { utils } from 'ethers';
// import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const OPTIMISM_CONSTANT_PRICE_FEED = '0x8671d5e3a10639a573bACffEF448CA076b2d5cD7';

const OPTIMISM_USDC_COMET = '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB';
const OPTIMISM_USDT_COMET = '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214';
const OPTIMISM_BRIDGE_RECEIVER = '0xC3a73A70d1577CD5B02da0bA91C0Afc8fA434DAF';
const OPTIMISM_COMET_ADMIN = '0x24D86Da09C4Dd64e50dB7501b0f695d030f397aF';
const OPTIMISM_CONFIGURATOR = '0x84E93EC6170ED630f5ebD89A1AAE72d4F63f2713';
// let newPriceFeedAddress;

export default migration('1755522406_deprecate_wusdm_collateral', {
  async prepare(
    deploymentManager: DeploymentManager
  ) {
    const _wUSDMPriceFeed = await deploymentManager.deploy(
      'WETH:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );
    return { wUSDMPriceFeedAddress: _wUSDMPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { wUSDMPriceFeedAddress }) => {
    const trace = deploymentManager.tracer();

    const wUSDM = await deploymentManager.existing(
      'wUSDM',
      WUSDM_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    // newPriceFeedAddress = wUSDMPriceFeedAddress;

    const newAssetConfig = {
      asset: wUSDM.address,
      priceFeed: wUSDMPriceFeedAddress,
      decimals: await wUSDM.decimals(),
      borrowCollateralFactor: 0,
      liquidateCollateralFactor: exp(0.0001, 18),
      liquidationFactor: exp(1, 18),
      supplyCap: 0,
    };

    // const {
    //   comet,
    //   cometAdmin,
    //   configurator,
    //   timelock: l2Timelock,
    //   bridgeReceiver
    // } = await deploymentManager.getContracts();

    const {
      governor,
      // timelock,
      // arbitrumInbox,
      opL1CrossDomainMessenger
    } = await govDeploymentManager.getContracts();

    // const updateArbitrumUSDCAssetCalldata = utils.defaultAbiCoder.encode(
    //   ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
    //   [comet.address,
    //     [
    //       newAssetConfig.asset,
    //       newAssetConfig.priceFeed,
    //       newAssetConfig.decimals,
    //       newAssetConfig.borrowCollateralFactor,
    //       newAssetConfig.liquidateCollateralFactor,
    //       newAssetConfig.liquidationFactor,
    //       newAssetConfig.supplyCap
    //     ]
    //   ]
    // );

    // const deployAndUpgradeToArbitrumUSDCCalldata = utils.defaultAbiCoder.encode(
    //   ['address', 'address'],
    //   [configurator.address, comet.address]
    // );

    // const arbitrumProposalData = utils.defaultAbiCoder.encode(
    //   ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
    //   [
    //     [
    //       configurator.address,
    //       cometAdmin.address
    //     ],
    //     [
    //       0,
    //       0
    //     ],
    //     [
    //       'updateAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
    //       'deployAndUpgradeTo(address,address)',
    //     ],
    //     [
    //       updateArbitrumUSDCAssetCalldata,
    //       deployAndUpgradeToArbitrumUSDCCalldata,
    //     ]
    //   ]
    // );

    const updateAssetOptimismUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [
        OPTIMISM_USDC_COMET,
        [
          newAssetConfig.asset,
          OPTIMISM_CONSTANT_PRICE_FEED,
          newAssetConfig.decimals,
          newAssetConfig.borrowCollateralFactor,
          newAssetConfig.liquidateCollateralFactor,
          newAssetConfig.liquidationFactor,
          newAssetConfig.supplyCap
        ]
      ]
    );

    const updateAssetOptimismUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [
        OPTIMISM_USDT_COMET,
        [
          newAssetConfig.asset,
          OPTIMISM_CONSTANT_PRICE_FEED,
          newAssetConfig.decimals,
          newAssetConfig.borrowCollateralFactor,
          newAssetConfig.liquidateCollateralFactor,
          newAssetConfig.liquidationFactor,
          newAssetConfig.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToOptimismUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [OPTIMISM_CONFIGURATOR, OPTIMISM_USDC_COMET]
    );

    const deployAndUpgradeToOptimismUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [OPTIMISM_CONFIGURATOR, OPTIMISM_USDT_COMET]
    );

    const optimismProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          OPTIMISM_CONFIGURATOR,
          OPTIMISM_COMET_ADMIN,
          OPTIMISM_CONFIGURATOR,
          OPTIMISM_COMET_ADMIN
        ],
        [
          0,
          0,
          0,
          0
        ],
        [
          'updateAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
          'updateAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          updateAssetOptimismUSDCCalldata,
          deployAndUpgradeToOptimismUSDCCalldata,
          updateAssetOptimismUSDTCalldata,
          deployAndUpgradeToOptimismUSDTCalldata,
        ]
      ]
    );

    // const createRetryableTicketGasParams = await estimateL2Transaction(
    //   {
    //     from: applyL1ToL2Alias(timelock.address),
    //     to: bridgeReceiver.address,
    //     data: arbitrumProposalData
    //   },
    //   deploymentManager
    // );
    // const refundAddress = l2Timelock.address;

    const mainnetActions = [
      // // 1. Set Comet configuration and deployAndUpgradeTo USDC Comet on Arbitrum.
      // {
      //   contract: arbitrumInbox,
      //   signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
      //   args: [
      //     bridgeReceiver.address,                           // address to,
      //     0,                                                // uint256 l2CallValue,
      //     createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
      //     refundAddress,                                    // address excessFeeRefundAddress,
      //     refundAddress,                                    // address callValueRefundAddress,
      //     createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
      //     createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
      //     arbitrumProposalData,                                   // bytes calldata data
      //   ],
      //   value: createRetryableTicketGasParams.deposit
      // },
      // 2. 
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [OPTIMISM_BRIDGE_RECEIVER, optimismProposalData, 5_000_000]
      },
    ];

    const description = `# Deprecate wUSDM from Arbitrum and Optimism markets

## Proposal summary

WOOF! proposes to deprecate wUSDM from cUSDCv3 on Arbitrum network, and cUSDCv3 and cUSDTv3 on Optimism, since deprecation of USDM itself and its Chainlink oracle.
In order to achieve this price feed on both networks will be updated to a new one, which will return the smallest acceptable price - 0.00000001 (1e-8), and the supply cup will be set to 0 to prevent further deposits. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Arbitrum, and a Compound III USDC and USDT market on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).
Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1014).


## Proposal Actions

The first proposal action updates wUSDM's configuration to deprecate it from cUSDCv3 on Arbitrum. This sends the encoded 'updateAsset' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.

The second proposal action updates wUSDM's configuration to deprecate it from cUSDCv3 and cUSDTv3 on Optimism. This sends the encoded 'updateAsset' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Optimism.`;

    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    // 1. Compare proposed asset config with Comet asset info
    const wUSDMAssetInfo = await comet.getAssetInfoByAddress(WUSDM_ADDRESS);
    const wUSDMAssetIndex = wUSDMAssetInfo.offset;
    expect(0).to.be.equal(wUSDMAssetInfo.supplyCap);
    expect(OPTIMISM_CONSTANT_PRICE_FEED).to.be.equal(wUSDMAssetInfo.priceFeed);
    expect(1).to.be.equal(await comet.getPrice(wUSDMAssetInfo.priceFeed));
    expect(0).to.be.equal(wUSDMAssetInfo.borrowCollateralFactor);
    expect(exp(0.0001, 18)).to.be.equal(wUSDMAssetInfo.liquidateCollateralFactor);
    expect(exp(1, 18)).to.be.equal(wUSDMAssetInfo.liquidationFactor);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWUSDMAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wUSDMAssetIndex];
    expect(0).to.be.equal(configuratorWUSDMAssetConfig.supplyCap);
    expect(OPTIMISM_CONSTANT_PRICE_FEED).to.be.equal(configuratorWUSDMAssetConfig.priceFeed);
    expect(1).to.be.equal(await comet.getPrice(configuratorWUSDMAssetConfig.priceFeed));
    expect(0).to.be.equal(configuratorWUSDMAssetConfig.borrowCollateralFactor);
    expect(exp(0.0001, 18)).to.be.equal(configuratorWUSDMAssetConfig.liquidateCollateralFactor);
    expect(exp(1, 18)).to.be.equal(configuratorWUSDMAssetConfig.liquidationFactor);
  },
});
