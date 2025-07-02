import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const EIGEN_ADDRESS = '0xec53bF9167f50cDEB3Ae105f56099aaaB9061F83';
const EIGEN_TO_USD_PRICE_FEED = '0xf2917e602C2dCa458937fad715bb1E465305A4A1';
const USD_TO_ETH_PRICE_FEED = '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419';

let newPiceFeedAddress: string;

export default migration('1750958707_add_eigen_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const EIGENToETHScalingPriceFeed = await deploymentManager.deploy(
      'EIGEN:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        EIGEN_TO_USD_PRICE_FEED, // EIGEN / USD price feed
        USD_TO_ETH_PRICE_FEED, // ETH / USD price feed (reversed)
        8, // decimals
        'EIGEN / ETH price feed', // description
      ]
    );
    return { EIGENPriceFeedAddress: EIGENToETHScalingPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { EIGENPriceFeedAddress } ) {
    const trace = deploymentManager.tracer();

    const EIGEN = await deploymentManager.existing(
      'EIGEN',
      EIGEN_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const EIGENPriceFeed = await deploymentManager.existing(
      'EIGEN:priceFeed',
      EIGENPriceFeedAddress,
      'mainnet'
    );

    newPiceFeedAddress = EIGENPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const EIGENAssetConfig = {
      asset: EIGEN.address,
      priceFeed: EIGENPriceFeed.address,
      decimals: await EIGEN.decimals(),
      borrowCollateralFactor: exp(0.83, 18),
      liquidateCollateralFactor: exp(0.88, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(1_100_000, 18),
    };

    const mainnetActions = [
      // 1. Add EIGEN as asset
      {
        contract: configurator,
        signature:
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, EIGENAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add EIGEN as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nWOOF! proposes to add EIGEN into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-collateral-eigen-to-usdc-market-on-mainnet/5866/3).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1000) and [forum discussion](https://www.comp.xyz/t/add-collateral-eigen-to-usdc-market-on-mainnet/5866).\n\n\n## Proposal Actions\n\nThe first action adds EIGEN asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
    
    const txn = await deploymentManager.retry(async () =>
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

    const EIGENAssetIndex = Number(await comet.numAssets()) - 1;

    const EIGEN = await deploymentManager.existing(
      'EIGEN',
      EIGEN_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const EIGENAssetConfig = {
      asset: EIGEN.address,
      priceFeed: newPiceFeedAddress,
      decimals: 18,
      borrowCollateralFactor: exp(0.83, 18),
      liquidateCollateralFactor: exp(0.88, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(1_100_000, 18),
    };

    // 1. Compare EIGEN asset config with Comet and Configurator asset info
    const cometEIGENAssetInfo = await comet.getAssetInfoByAddress(EIGEN_ADDRESS);
    expect(EIGENAssetIndex).to.be.equal(cometEIGENAssetInfo.offset);
    expect(EIGENAssetConfig.asset).to.be.equal(cometEIGENAssetInfo.asset);
    expect(EIGENAssetConfig.priceFeed).to.be.equal(cometEIGENAssetInfo.priceFeed);
    expect(exp(1, EIGENAssetConfig.decimals)).to.be.equal(cometEIGENAssetInfo.scale);
    expect(EIGENAssetConfig.borrowCollateralFactor).to.be.equal(cometEIGENAssetInfo.borrowCollateralFactor);
    expect(EIGENAssetConfig.liquidateCollateralFactor).to.be.equal(cometEIGENAssetInfo.liquidateCollateralFactor);
    expect(EIGENAssetConfig.liquidationFactor).to.be.equal(cometEIGENAssetInfo.liquidationFactor);
    expect(EIGENAssetConfig.supplyCap).to.be.equal(cometEIGENAssetInfo.supplyCap);

    const configuratorEIGENAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[EIGENAssetIndex];
    expect(EIGENAssetConfig.asset).to.be.equal(configuratorEIGENAssetConfig.asset);
    expect(EIGENAssetConfig.priceFeed).to.be.equal(configuratorEIGENAssetConfig.priceFeed);
    expect(EIGENAssetConfig.decimals).to.be.equal(configuratorEIGENAssetConfig.decimals);
    expect(EIGENAssetConfig.borrowCollateralFactor).to.be.equal(configuratorEIGENAssetConfig.borrowCollateralFactor);
    expect(EIGENAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorEIGENAssetConfig.liquidateCollateralFactor);
    expect(EIGENAssetConfig.liquidationFactor).to.be.equal(configuratorEIGENAssetConfig.liquidationFactor);
    expect(EIGENAssetConfig.supplyCap).to.be.equal(configuratorEIGENAssetConfig.supplyCap);
  },
});
