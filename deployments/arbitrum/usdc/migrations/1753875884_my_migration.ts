import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';
import { ethers } from 'ethers';

const SUSDX_ADDRESS = '0x7788A3538C5fc7F9c7C8A74EAC4c898fC8d87d92';

let newPriceFeed: string;

export default migration('1753875884_add_susdx_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const constantPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'arbitrum', 'weth');
    const sUSDXPriceFeed = await deploymentManager.deploy(
      'sUSDX:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        SUSDX_ADDRESS,             // sUSDX / USD price feed
        constantPriceFeed.address, // USDX / USD price feed (we consider USDX to USD as 1:1)
        8,                         // decimals
        'sUSDX / USD price feed',  // description
      ],
      true
    );
  
    return { sUSDXPriceFeedAddress: sUSDXPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { sUSDXPriceFeedAddress }) => {
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

    newPriceFeed = sUSDXPriceFeedAddress;

    const sUSDX = await deploymentManager.existing(
      'sUSDX',
      SUSDX_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const sUSDXPriceFeed = await deploymentManager.existing(
      'sUSDX:priceFeed',
      sUSDXPriceFeedAddress,
      'arbitrum'
    );

    const sUSDXAssetConfig = {
      asset: sUSDX.address,
      priceFeed: sUSDXPriceFeed.address,
      decimals: await sUSDX.decimals(),
      borrowCollateralFactor: exp(0.86, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1_250_000, 18),
    };

    const addAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          sUSDXAssetConfig.asset,
          sUSDXAssetConfig.priceFeed,
          sUSDXAssetConfig.decimals,
          sUSDXAssetConfig.borrowCollateralFactor,
          sUSDXAssetConfig.liquidateCollateralFactor,
          sUSDXAssetConfig.liquidationFactor,
          sUSDXAssetConfig.supplyCap
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

    const description = `# Add sUSDX as collateral into cUSDCv3 on Arbitrum

## Proposal summary

Compound Growth Program [AlphaGrowth] proposes to add sUSDX into cUSDCv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-susdx-on-usdc-and-usdt-markets-on-arbitrum/6823/4).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1008) and [forum discussion](https://www.comp.xyz/t/add-susdx-on-usdc-and-usdt-markets-on-arbitrum/6823).


## Proposal Actions

The first proposal action adds sUSDX to the USDC Comet on Arbitrum. This sends the encoded 'addAsset' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Arbitrum.`;
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

    const sUSDXAssetIndex = Number(await comet.numAssets()) - 1;

    const sUSDX = await deploymentManager.existing(
      'sUSDX',
      SUSDX_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const sUSDXAssetConfig = {
      asset: sUSDX.address,
      priceFeed: newPriceFeed,
      decimals: 18n,
      borrowCollateralFactor: exp(0.86, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1_250_000, 18),
    };

    // 1. & 2. Compare sUSDX asset config with Comet and Configurator asset info
    const cometSUSDXAssetInfo = await comet.getAssetInfoByAddress(SUSDX_ADDRESS);
    expect(sUSDXAssetIndex).to.be.equal(cometSUSDXAssetInfo.offset);
    expect(sUSDXAssetConfig.asset).to.be.equal(cometSUSDXAssetInfo.asset);
    expect(exp(1, sUSDXAssetConfig.decimals)).to.be.equal(cometSUSDXAssetInfo.scale);
    expect(sUSDXAssetConfig.borrowCollateralFactor).to.be.equal(cometSUSDXAssetInfo.borrowCollateralFactor);
    expect(sUSDXAssetConfig.liquidateCollateralFactor).to.be.equal(cometSUSDXAssetInfo.liquidateCollateralFactor);
    expect(sUSDXAssetConfig.liquidationFactor).to.be.equal(cometSUSDXAssetInfo.liquidationFactor);
    expect(sUSDXAssetConfig.supplyCap).to.be.equal(cometSUSDXAssetInfo.supplyCap);

    const configuratorSUSDXAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[sUSDXAssetIndex];
    expect(sUSDXAssetConfig.asset).to.be.equal(configuratorSUSDXAssetConfig.asset);
    expect(sUSDXAssetConfig.decimals).to.be.equal(configuratorSUSDXAssetConfig.decimals);
    expect(sUSDXAssetConfig.borrowCollateralFactor).to.be.equal(configuratorSUSDXAssetConfig.borrowCollateralFactor);
    expect(sUSDXAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorSUSDXAssetConfig.liquidateCollateralFactor);
    expect(sUSDXAssetConfig.liquidationFactor).to.be.equal(configuratorSUSDXAssetConfig.liquidationFactor);
    expect(sUSDXAssetConfig.supplyCap).to.be.equal(configuratorSUSDXAssetConfig.supplyCap);
  },
});
