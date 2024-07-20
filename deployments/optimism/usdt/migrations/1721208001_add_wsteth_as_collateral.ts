import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WSTETH_ADDRESS = '0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xe59EBa0D492cA53C6f46015EEa00517F2707dc77';
const STETH_ETH_PRICE_FEED_ADDRESS = '0x14d2d3a82AeD4019FddDfe07E8bdc485fb0d2249';
const ETH_USD_PRICE_FEED_ADDRESS = '0x13e3Ee699D1909E989722E753853AE30b17e08c5';
let newPriceFeedAddress: string;

export default migration('1721208001_add_wsteth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wstETHToETHPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeedToETH',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / stETH price feed
        STETH_ETH_PRICE_FEED_ADDRESS,    // stETH / ETH price feed
        8,                               // decimals
        'wstETH / ETH price feed'        // description
      ]
    );

    const _wstETHPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        _wstETHToETHPriceFeed.address, // wstETH / ETH price feed
        ETH_USD_PRICE_FEED_ADDRESS,    // ETH / USD price feed
        8,                             // decimals
        'wstETH / USD price feed'      // description
      ]
    );
    return { wstETHPriceFeed: _wstETHPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { wstETHPriceFeed }
  ) => {
    const trace = deploymentManager.tracer();

    const wstETH = await deploymentManager.existing(
      'wstETH',
      WSTETH_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    const wstETHPricefeed = await deploymentManager.existing(
      'wstETH:priceFeed',
      wstETHPriceFeed,
      'optimism'
    );

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { governor, opL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: wstETH.address,
      priceFeed: wstETHPricefeed.address,
      decimals: await wstETH.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(400, 18),
    };

    newPriceFeedAddress = wstETHPricefeed.address;

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

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = '# Add wstETH as collateral into cUSDTv3 on Optimism\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wstETH into cUSDTv3 on Optimism network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-wsteth-listing-for-usdc-and-usdt-comet-on-optimism/5441/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/891) and [forum discussion](https://www.comp.xyz/t/gauntlet-wsteth-listing-for-usdc-and-usdt-comet-on-optimism/5441).\n\n\n## Proposal Actions\n\nThe first proposal action adds wstETH to the USDT Comet on Optimism. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism.';
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
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(400, 18),
    };

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
