import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction } from '../../../../scenario/utils/arbitrumUtils';

const WSTETH_ADDRESS = '0x5979D7b546E38E414F7E9822514be443A4800529';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB1552C5e96B312d0Bf8b554186F846C40614a540';
const STETH_ETH_PRICE_FEED_ADDRESS = '0xded2c52b75B24732e9107377B7Ba93eC1fFa4BAf';
const ETH_USD_PRICE_FEED_ADDRESS = '0x639Fe6ab55C921f74e7fac1ee960C0B6293ba612';

let newPriceFeedAddress: string;
let existingPriceFeedAddress: string;

export default migration('1720603419_add_wsteth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wstETHToEthScalingPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / stETH price feed
        STETH_ETH_PRICE_FEED_ADDRESS,    // stETH / ETH price feed
        8,                               // decimals
        'wstETH / ETH price feed'        // description
      ]
    );

    const _wstETHToUsdScalingPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        _wstETHToEthScalingPriceFeed.address, // wstETH / stETH / ETH price feed
        ETH_USD_PRICE_FEED_ADDRESS,           // ETH / USD price feed
        8,                                    // decimals
        'wstETH / USD price feed'             // description
      ],
      true
    );

    return { wstETHToUsdScalingPriceFeed: _wstETHToUsdScalingPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { wstETHToUsdScalingPriceFeed }
  ) => {
    const trace = deploymentManager.tracer();

    const wstETH = await deploymentManager.existing(
      'wstETH',
      WSTETH_ADDRESS,
      'arbitrum',
      'contracts/ERC20.sol:ERC20'
    );

    const wstETHPricefeed = await deploymentManager.existing(
      'wstETH:priceFeed',
      wstETHToUsdScalingPriceFeed,
      'arbitrum'
    );

    newPriceFeedAddress = wstETHToUsdScalingPriceFeed;
    existingPriceFeedAddress = wstETHPricefeed.address;

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      timelock: l2Timelock,
    } = await deploymentManager.getContracts();

    const { governor,
      arbitrumInbox,
      timelock,
    } = await govDeploymentManager.getContracts();

    const refundAddress = l2Timelock.address;

    const newAssetConfig = {
      asset: wstETH.address,
      priceFeed: wstETHPricefeed.address,
      decimals: await wstETH.decimals(),
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(1_500, 18),
    };

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
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

    const description = '# Add wstETH as collateral into cUSDCv3 on Arbitrum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wstETH into cUSDCv3 on Arbitrum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Arbitrum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/883) and [forum discussion](https://www.comp.xyz/t/temp-check-add-wsteth-as-a-collateral-on-base-eth-market-usdc-market-on-arbitrum-and-ethereum-mainnet/4867/).\n\n\n## Proposal Actions\n\nThe first proposal action adds wstETH to the USDC Comet on Arbitrum. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum.';
    const txn = await govDeploymentManager.retry(async () =>
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const wstETHAssetIndex = Number(await comet.numAssets()) - 1;

    const wstETHAssetConfig = {
      asset: WSTETH_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(1_500, 18),
    };

    // check that we set up correct new deployed price feed
    expect(newPriceFeedAddress).to.be.equal(existingPriceFeedAddress)

    // 1. Compare proposed asset config with Comet asset info
    const wstETHAssetInfo = await comet.getAssetInfoByAddress(
      WSTETH_ADDRESS
    );
    expect(wstETHAssetIndex).to.be.equal(wstETHAssetInfo.offset);
    expect(wstETHAssetConfig.asset).to.be.equal(wstETHAssetInfo.asset);
    expect(wstETHAssetConfig.priceFeed).to.be.equal(
      wstETHAssetInfo.priceFeed
    );
    expect(exp(1, wstETHAssetConfig.decimals)).to.be.equal(
      wstETHAssetInfo.scale
    );
    expect(wstETHAssetConfig.borrowCollateralFactor).to.be.equal(
      wstETHAssetInfo.borrowCollateralFactor
    );
    expect(wstETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      wstETHAssetInfo.liquidateCollateralFactor
    );
    expect(wstETHAssetConfig.liquidationFactor).to.be.equal(
      wstETHAssetInfo.liquidationFactor
    );
    expect(wstETHAssetConfig.supplyCap).to.be.equal(
      wstETHAssetInfo.supplyCap
    );

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWstETHAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[wstETHAssetIndex];
    expect(wstETHAssetConfig.asset).to.be.equal(
      configuratorWstETHAssetConfig.asset
    );
    expect(wstETHAssetConfig.priceFeed).to.be.equal(
      configuratorWstETHAssetConfig.priceFeed
    );
    expect(wstETHAssetConfig.decimals).to.be.equal(
      configuratorWstETHAssetConfig.decimals
    );
    expect(wstETHAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorWstETHAssetConfig.borrowCollateralFactor
    );
    expect(wstETHAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorWstETHAssetConfig.liquidateCollateralFactor
    );
    expect(wstETHAssetConfig.liquidationFactor).to.be.equal(
      configuratorWstETHAssetConfig.liquidationFactor
    );
    expect(wstETHAssetConfig.supplyCap).to.be.equal(
      configuratorWstETHAssetConfig.supplyCap
    );
  },
});
