import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WRSETH_ADDRESS = '0x87eEE96D50Fb761AD85B1c982d28A042169d61b1';
const WRSETH_ETH_PRICE_FEED_ADDRESS = '0x73b8BE3b653c5896BC34fC87cEBC8AcF4Fb7A545';
let newPriceFeedAddress: string;

export default migration('1724837643_add_wrseth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wrsETHPriceFeed = await deploymentManager.deploy(
      'wrsETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        WRSETH_ETH_PRICE_FEED_ADDRESS, // wrsETH / ETH price feed
        8                              // decimals
      ],
      true
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
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    const wrsETHPriceFeed = await deploymentManager.existing(
      'wrsETH:priceFeed',
      wrsETHPriceFeedAddress,
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
      asset: wrsETH.address,
      priceFeed: wrsETHPriceFeed.address,
      decimals: await wrsETH.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(220, 18),
    };

    newPriceFeedAddress = wrsETHPriceFeed.address;

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

    const description = '# Add wrsETH as collateral into cWETHv3 on Optimism\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wrsETH into cWETHv3 on Optimism network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-rseth-as-collateral-on-arbitrum-and-wrseth-as-collateral-on-optimism-base-and-scroll/5445/5).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/913) and [forum discussion](https://www.comp.xyz/t/add-rseth-as-collateral-on-arbitrum-and-wrseth-as-collateral-on-optimism-base-and-scroll/5445).\n\n\n## Proposal Actions\n\nThe first proposal action adds wrsETH to the WETH Comet on Optimism. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism.';
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

  async enacted(): Promise<boolean> {
    return false;
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
      supplyCap: exp(220, 18),
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
