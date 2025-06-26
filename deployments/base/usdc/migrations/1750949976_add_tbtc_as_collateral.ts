import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const TBTC_ADDRESS = '0x236aa50979D5f3De3Bd1Eeb40E81137F22ab794b';
const TBTC_USD_PRICE_FEED_ADDRESS = '0x6D75BFB5A5885f841b132198C9f0bE8c872057BF';

export default migration('1750949976_add_tbtc_as_collateral', {
  async prepare() {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();

    const tBTC = await deploymentManager.existing(
      'tBTC',
      TBTC_ADDRESS,
      'base',
      'contracts/ERC20.sol:ERC20'
    );
    const tBTCPriceFeed = await deploymentManager.existing(
      'tBTC:priceFeed',
      TBTC_USD_PRICE_FEED_ADDRESS,
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
      asset: tBTC.address,
      priceFeed: tBTCPriceFeed.address,
      decimals: await tBTC.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(75, 18),
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

    const mainnetActions = [
      // Send the proposal to the L2 bridge
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = '# Add tBTC as collateral into cUSDCv3 on Base\n\n## Proposal summary\n\nWOOF! proposes to add tBTC into cUSDCv3 on Base network. This proposal takes the governance steps recommended and necessary to update a Compound III USDC market on Base. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-tbtc-to-compound-base-market/6368/7).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/998) and [forum discussion](https://www.comp.xyz/t/add-collateral-tbtc-to-compound-base-market/6368).\n\n\n## Proposal Actions\n\nThe first proposal action adds tBTC to the USDC Comet on Base. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Base.';
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

    const tBTCAssetIndex = Number(await comet.numAssets()) - 1;

    const tBTCAssetConfig = {
      asset: TBTC_ADDRESS,
      priceFeed: TBTC_USD_PRICE_FEED_ADDRESS,
      decimals: 18,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(75, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const tBTCAssetInfo = await comet.getAssetInfoByAddress(TBTC_ADDRESS);
    expect(tBTCAssetIndex).to.be.equal(tBTCAssetInfo.offset);
    expect(tBTCAssetConfig.asset).to.be.equal(tBTCAssetInfo.asset);
    expect(tBTCAssetConfig.priceFeed).to.be.equal(tBTCAssetInfo.priceFeed);
    expect(exp(1, tBTCAssetConfig.decimals)).to.be.equal(tBTCAssetInfo.scale);
    expect(tBTCAssetConfig.borrowCollateralFactor).to.be.equal(tBTCAssetInfo.borrowCollateralFactor);
    expect(tBTCAssetConfig.liquidateCollateralFactor).to.be.equal(tBTCAssetInfo.liquidateCollateralFactor);
    expect(tBTCAssetConfig.liquidationFactor).to.be.equal(tBTCAssetInfo.liquidationFactor);
    expect(tBTCAssetConfig.supplyCap).to.be.equal(tBTCAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorTBTCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[tBTCAssetIndex];
    expect(tBTCAssetConfig.asset).to.be.equal(configuratorTBTCAssetConfig.asset);
    expect(tBTCAssetConfig.priceFeed).to.be.equal(configuratorTBTCAssetConfig.priceFeed);
    expect(tBTCAssetConfig.decimals).to.be.equal(configuratorTBTCAssetConfig.decimals);
    expect(tBTCAssetConfig.borrowCollateralFactor).to.be.equal(configuratorTBTCAssetConfig.borrowCollateralFactor);
    expect(tBTCAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorTBTCAssetConfig.liquidateCollateralFactor);
    expect(tBTCAssetConfig.liquidationFactor).to.be.equal(configuratorTBTCAssetConfig.liquidationFactor);
    expect(tBTCAssetConfig.supplyCap).to.be.equal(configuratorTBTCAssetConfig.supplyCap);
  },
});
