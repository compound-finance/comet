import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WRSETH_ADDRESS = '0xEDfa23602D0EC14714057867A78d01e94176BEA0';
const WRSETHETH_ETH_PRICE_FEED_ADDRESS = '0xe8dD07CCf5BC4922424140E44Eb970F5950725ef';
let newPriceFeedAddress: string;

export default migration('1724852274_add_wrseth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wrsETHPriceFeed = await deploymentManager.deploy(
      'wrsETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        WRSETHETH_ETH_PRICE_FEED_ADDRESS, // wrsETH / ETH price feed
        8,                                // decimals
      ]
    );
    return { wrsETHPriceFeedAddress: _wrsETHPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { wrsETHPriceFeedAddress }
  ) => {
    const trace = deploymentManager.tracer();

    const wrsETH = await deploymentManager.existing(
      'wrsETH',
      WRSETH_ADDRESS,
      'base',
      'contracts/ERC20.sol:ERC20'
    );
    const wrsETHPricefeed = await deploymentManager.existing(
      'wrsETH:priceFeed',
      wrsETHPriceFeedAddress,
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
      asset: wrsETH.address,
      priceFeed: wrsETHPricefeed.address,
      decimals: await wrsETH.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(230, 18),
    };

    newPriceFeedAddress = wrsETHPricefeed.address;

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

    const description = '# Add wrsETH as collateral into cWETHv3 on Base\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wrsETH into cWETHv3 on Base network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Base. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-rseth-as-collateral-on-arbitrum-and-wrseth-as-collateral-on-optimism-base-and-scroll/5445/5).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/914) and [forum discussion](https://www.comp.xyz/t/add-rseth-as-collateral-on-arbitrum-and-wrseth-as-collateral-on-optimism-base-and-scroll/5445).\n\n\n## Proposal Actions\n\nThe first proposal action adds wrsETH to the WETH Comet on Base. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Base.';
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

    const wrsETHAssetIndex = Number(await comet.numAssets()) - 1;

    const wrsETHAssetConfig = {
      asset: WRSETH_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(230, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const wrsETHAssetInfo = await comet.getAssetInfoByAddress(WRSETH_ADDRESS);
    expect(wrsETHAssetIndex).to.be.equal(wrsETHAssetInfo.offset);
    expect(wrsETHAssetConfig.asset).to.be.equal(wrsETHAssetInfo.asset);
    expect(wrsETHAssetConfig.priceFeed).to.be.equal(wrsETHAssetInfo.priceFeed);
    expect(exp(1, wrsETHAssetConfig.decimals)).to.be.equal(wrsETHAssetInfo.scale);
    expect(wrsETHAssetConfig.borrowCollateralFactor).to.be.equal(wrsETHAssetInfo.borrowCollateralFactor);
    expect(wrsETHAssetConfig.liquidateCollateralFactor).to.be.equal(wrsETHAssetInfo.liquidateCollateralFactor);
    expect(wrsETHAssetConfig.liquidationFactor).to.be.equal(wrsETHAssetInfo.liquidationFactor);
    expect(wrsETHAssetConfig.supplyCap).to.be.equal(wrsETHAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWrsETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wrsETHAssetIndex];
    expect(wrsETHAssetConfig.asset).to.be.equal(configuratorWrsETHAssetConfig.asset);
    expect(wrsETHAssetConfig.priceFeed).to.be.equal(configuratorWrsETHAssetConfig.priceFeed);
    expect(wrsETHAssetConfig.decimals).to.be.equal(configuratorWrsETHAssetConfig.decimals);
    expect(wrsETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWrsETHAssetConfig.borrowCollateralFactor);
    expect(wrsETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWrsETHAssetConfig.liquidateCollateralFactor);
    expect(wrsETHAssetConfig.liquidationFactor).to.be.equal(configuratorWrsETHAssetConfig.liquidationFactor);
    expect(wrsETHAssetConfig.supplyCap).to.be.equal(configuratorWrsETHAssetConfig.supplyCap);
  },
});
