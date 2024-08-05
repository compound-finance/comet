import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WSTETH_ADDRESS = '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452';
const WSTETH_STETH_PRICE_FEED_ADDRESS = '0xB88BAc61a4Ca37C43a3725912B1f472c9A5bc061';
const STETH_ETH_PRICE_FEED_ADDRESS = '0xf586d0728a47229e747d824a939000Cf21dEF5A0';
let newPriceFeedAddress: string;

export default migration('1720603419_add_wsteth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wstETHScalingPriceFeed = await deploymentManager.deploy(
      'wstETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        WSTETH_STETH_PRICE_FEED_ADDRESS, // wstETH / stETH price feed
        STETH_ETH_PRICE_FEED_ADDRESS,    // stETH / ETH price feed
        8,                               // decimals
        'wstETH / ETH price feed'        // description
      ]
    );
    return { wstETHScalingPriceFeed: _wstETHScalingPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { wstETHScalingPriceFeed }
  ) => {
    const trace = deploymentManager.tracer();

    const wstETH = await deploymentManager.existing(
      'wstETH',
      WSTETH_ADDRESS,
      'base',
      'contracts/ERC20.sol:ERC20'
    );
    const wstETHPricefeed = await deploymentManager.existing(
      'wstETH:priceFeed',
      wstETHScalingPriceFeed,
      'base'
    );

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { governor, baseL1CrossDomainMessenger } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: wstETH.address,
      priceFeed: wstETHPricefeed.address,
      decimals: await wstETH.decimals(),
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.975, 18),
      supplyCap: exp(1200, 18),
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
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = '# Add wstETH as collateral into cWETHv3 on Base\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wstETH into cWETHv3 on Base network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Base. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/887) and [forum discussion](https://www.comp.xyz/t/gauntlet-wsteth-and-ezeth-asset-listing/5404).\n\n\n## Proposal Actions\n\nThe first proposal action adds wstETH to the WETH Comet on Base. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Base.';
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
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.975, 18),
      supplyCap: exp(1200, 18),
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
