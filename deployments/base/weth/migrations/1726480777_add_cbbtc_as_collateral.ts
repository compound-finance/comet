import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, proposal } from '../../../../src/deploy';
import { utils } from 'ethers';

const CBBTC_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf';
const CBBTC_USD_PRICE_FEED_ADDRESS = '0x07DA0E54543a844a80ABE69c8A12F22B3aA59f9D';
const ETH_USD_PRICE_FEED_ADDRESS = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
let newPriceFeedAddress: string;

export default migration('1726480777_add_cbbtc_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _cbBTCPriceFeed = await deploymentManager.deploy(
      'cbBTC:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        CBBTC_USD_PRICE_FEED_ADDRESS,  // cbBTC / USD price feed
        ETH_USD_PRICE_FEED_ADDRESS,    // USD / ETH price feed 
        8,                             // decimals
        'cbBTC / ETH price feed',      // description
      ]
    );
      
    return { cbBTCPriceFeedAddress: _cbBTCPriceFeed.address };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    { cbBTCPriceFeedAddress }
  ) => {
    const trace = deploymentManager.tracer();

    const cbBTC = await deploymentManager.existing(
      'cbBTC',
      CBBTC_ADDRESS,
      'base',
      'contracts/ERC20.sol:ERC20'
    );
    const cbBTCPriceFeed = await deploymentManager.existing(
      'cbBTC:priceFeed',
      cbBTCPriceFeedAddress,
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
      asset: cbBTC.address,
      priceFeed: cbBTCPriceFeed.address,
      decimals: await cbBTC.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(45, 8),
    };

    newPriceFeedAddress = cbBTCPriceFeed.address;

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

    const description = '# Add cbBTC as collateral into cWETHv3 on Base\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add cbBTC into cWETHv3 on Base network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Base. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-cbbtc-to-weth-market-on-base-and-mainnet/5689/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/926) and [forum discussion](https://www.comp.xyz/t/add-collateral-cbbtc-to-weth-market-on-base-and-mainnet/5689).\n\n\n## Proposal Actions\n\nThe first proposal action adds cbBTC to the WETH Comet on Base. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Base.';
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

    const cbBTCAssetIndex = Number(await comet.numAssets()) - 1;

    const cbBTCAssetConfig = {
      asset: CBBTC_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 8,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(45, 8),
    };

    // 1. Compare proposed asset config with Comet asset info
    const cbBTCAssetInfo = await comet.getAssetInfoByAddress(CBBTC_ADDRESS);
    expect(cbBTCAssetIndex).to.be.equal(cbBTCAssetInfo.offset);
    expect(cbBTCAssetConfig.asset).to.be.equal(cbBTCAssetInfo.asset);
    expect(cbBTCAssetConfig.priceFeed).to.be.equal(cbBTCAssetInfo.priceFeed);
    expect(exp(1, cbBTCAssetConfig.decimals)).to.be.equal(cbBTCAssetInfo.scale);
    expect(cbBTCAssetConfig.borrowCollateralFactor).to.be.equal(cbBTCAssetInfo.borrowCollateralFactor);
    expect(cbBTCAssetConfig.liquidateCollateralFactor).to.be.equal(cbBTCAssetInfo.liquidateCollateralFactor);
    expect(cbBTCAssetConfig.liquidationFactor).to.be.equal(cbBTCAssetInfo.liquidationFactor);
    expect(cbBTCAssetConfig.supplyCap).to.be.equal(cbBTCAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorCbBTCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[cbBTCAssetIndex];
    expect(cbBTCAssetConfig.asset).to.be.equal(configuratorCbBTCAssetConfig.asset);
    expect(cbBTCAssetConfig.priceFeed).to.be.equal(configuratorCbBTCAssetConfig.priceFeed);
    expect(cbBTCAssetConfig.decimals).to.be.equal(configuratorCbBTCAssetConfig.decimals);
    expect(cbBTCAssetConfig.borrowCollateralFactor).to.be.equal(configuratorCbBTCAssetConfig.borrowCollateralFactor);
    expect(cbBTCAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorCbBTCAssetConfig.liquidateCollateralFactor);
    expect(cbBTCAssetConfig.liquidationFactor).to.be.equal(configuratorCbBTCAssetConfig.liquidationFactor);
    expect(cbBTCAssetConfig.supplyCap).to.be.equal(configuratorCbBTCAssetConfig.supplyCap);
  },
});
