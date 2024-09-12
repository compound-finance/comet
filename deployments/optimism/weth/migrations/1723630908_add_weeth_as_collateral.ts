import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WEETH_ADDRESS = '0x5A7fACB970D094B6C7FF1df0eA68D99E6e73CBFF';
const WEETH_STETH_PRICE_FEED_ADDRESS = '0x72EC6bF88effEd88290C66DCF1bE2321d80502f5';

let newPriceFeedAddress: string;

export default migration('1723630908_add_weeth_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _weETHPriceFeed = await deploymentManager.deploy(
      'weETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        WEETH_STETH_PRICE_FEED_ADDRESS, // weETH / ETH price feed
        8                               // decimals
      ]
    );
    return { weETHPriceFeedAddress: _weETHPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { weETHPriceFeedAddress }
  ) => {
    const trace = deploymentManager.tracer();

    const weETH = await deploymentManager.existing(
      'weETH',
      WEETH_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    const weETHPricefeed = await deploymentManager.existing(
      'weETH:priceFeed',
      weETHPriceFeedAddress,
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
      asset: weETH.address,
      priceFeed: weETHPricefeed.address,
      decimals: await weETH.decimals(),
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(400, 18),
    };

    newPriceFeedAddress = weETHPricefeed.address;

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

    const description = '# Add weETH as collateral into cWETHv3 on Optimism\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add weETH into cWETHv3 on Optimism network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-weeth-as-collateral-to-eth-markets-on-optimism-and-base/5520/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/909) and [forum discussion](https://www.comp.xyz/t/add-weeth-as-collateral-to-eth-markets-on-optimism-and-base/5520).\n\n\n## Proposal Actions\n\nThe first proposal action adds weETH to the WETH Comet on Optimism. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism.';
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

    const weETHAssetIndex = Number(await comet.numAssets()) - 1;

    const weETHAssetConfig = {
      asset: WEETH_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.90, 18),
      liquidateCollateralFactor: exp(0.93, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(400, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const weETHAssetInfo = await comet.getAssetInfoByAddress(WEETH_ADDRESS);
    expect(weETHAssetIndex).to.be.equal(weETHAssetInfo.offset);
    expect(weETHAssetConfig.asset).to.be.equal(weETHAssetInfo.asset);
    expect(weETHAssetConfig.priceFeed).to.be.equal(weETHAssetInfo.priceFeed);
    expect(exp(1, weETHAssetConfig.decimals)).to.be.equal(weETHAssetInfo.scale);
    expect(weETHAssetConfig.borrowCollateralFactor).to.be.equal(weETHAssetInfo.borrowCollateralFactor);
    expect(weETHAssetConfig.liquidateCollateralFactor).to.be.equal(weETHAssetInfo.liquidateCollateralFactor);
    expect(weETHAssetConfig.liquidationFactor).to.be.equal(weETHAssetInfo.liquidationFactor);
    expect(weETHAssetConfig.supplyCap).to.be.equal(weETHAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWeETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[weETHAssetIndex];
    expect(weETHAssetConfig.asset).to.be.equal(configuratorWeETHAssetConfig.asset);
    expect(weETHAssetConfig.priceFeed).to.be.equal(configuratorWeETHAssetConfig.priceFeed);
    expect(weETHAssetConfig.decimals).to.be.equal(configuratorWeETHAssetConfig.decimals);
    expect(weETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWeETHAssetConfig.borrowCollateralFactor);
    expect(weETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWeETHAssetConfig.liquidateCollateralFactor);
    expect(weETHAssetConfig.liquidationFactor).to.be.equal(configuratorWeETHAssetConfig.liquidationFactor);
    expect(weETHAssetConfig.supplyCap).to.be.equal(configuratorWeETHAssetConfig.supplyCap);
  },
});
