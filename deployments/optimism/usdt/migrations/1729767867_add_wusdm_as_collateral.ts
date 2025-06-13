import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const USDM_USD_PRICE_FEED_ADDRESS = '0xA45881b63ff9BE3F9a3439CA0c002686e65a8ED5';
let newPriceFeedAddress: string;

export default migration('1729767867_add_wusdm_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _wUSDMPriceFeed = await deploymentManager.deploy(
      'wUSDM:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        WUSDM_ADDRESS,                // wUSDM / USDM price feed
        USDM_USD_PRICE_FEED_ADDRESS,  // USDM / USD price feed
        8,                            // decimals
        'wUSDM / USD price feed'      // description
      ],
      true
    );
    return { wUSDMPriceFeedAddress: _wUSDMPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { wUSDMPriceFeedAddress }
  ) => {
    const trace = deploymentManager.tracer();

    const wUSDM = await deploymentManager.existing(
      'wUSDM',
      WUSDM_ADDRESS,
      'optimism',
      'contracts/ERC20.sol:ERC20'
    );
    const wUSDMPricefeed = await deploymentManager.existing(
      'wUSDM:priceFeed',
      wUSDMPriceFeedAddress,
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
      asset: wUSDM.address,
      priceFeed: wUSDMPricefeed.address,
      decimals: await wUSDM.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.9, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1_400_000, 18),
    };

    newPriceFeedAddress = wUSDMPricefeed.address;

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

    const description = '# Add wUSDM as collateral into cUSDTv3 on Optimism\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add wUSDM into cUSDTv3 on Optimism network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-wusdm-as-a-collateral-on-usdc-usdt-markets-on-optimism/5664/4).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/945) and [forum discussion](https://www.comp.xyz/t/add-wusdm-as-a-collateral-on-usdc-usdt-markets-on-optimism/5664).\n\n\n## Proposal Actions\n\nThe first proposal action adds wUSDM to the USDT Comet on Optimism. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Optimism.';
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
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const wUSDMAssetIndex = Number(await comet.numAssets()) - 1;

    const wUSDMAssetConfig = {
      asset: WUSDM_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.9, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1_400_000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const wUSDMAssetInfo = await comet.getAssetInfoByAddress(WUSDM_ADDRESS);
    expect(wUSDMAssetIndex).to.be.equal(wUSDMAssetInfo.offset);
    expect(wUSDMAssetConfig.asset).to.be.equal(wUSDMAssetInfo.asset);
    expect(wUSDMAssetConfig.priceFeed).to.be.equal(wUSDMAssetInfo.priceFeed);
    expect(exp(1, wUSDMAssetConfig.decimals)).to.be.equal(wUSDMAssetInfo.scale);
    expect(wUSDMAssetConfig.borrowCollateralFactor).to.be.equal(wUSDMAssetInfo.borrowCollateralFactor);
    expect(wUSDMAssetConfig.liquidateCollateralFactor).to.be.equal(wUSDMAssetInfo.liquidateCollateralFactor);
    expect(wUSDMAssetConfig.liquidationFactor).to.be.equal(wUSDMAssetInfo.liquidationFactor);
    expect(wUSDMAssetConfig.supplyCap).to.be.equal(wUSDMAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWUSDMAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wUSDMAssetIndex];
    expect(wUSDMAssetConfig.asset).to.be.equal(configuratorWUSDMAssetConfig.asset);
    expect(wUSDMAssetConfig.priceFeed).to.be.equal(configuratorWUSDMAssetConfig.priceFeed);
    expect(wUSDMAssetConfig.decimals).to.be.equal(configuratorWUSDMAssetConfig.decimals);
    expect(wUSDMAssetConfig.borrowCollateralFactor).to.be.equal(configuratorWUSDMAssetConfig.borrowCollateralFactor);
    expect(wUSDMAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorWUSDMAssetConfig.liquidateCollateralFactor);
    expect(wUSDMAssetConfig.liquidationFactor).to.be.equal(configuratorWUSDMAssetConfig.liquidationFactor);
    expect(wUSDMAssetConfig.supplyCap).to.be.equal(configuratorWUSDMAssetConfig.supplyCap);
  },
});
