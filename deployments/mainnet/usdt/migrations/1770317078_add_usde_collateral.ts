import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const USDe_ADDRESS = '0x4c9EDD5852cd905f086C759E8383e09bff1E68B3';
const USDe_TO_USD_PRICE_FEED = '0xa569d910839Ae8865Da8F8e70FfFb0cBA869F961';

export default migration('1770317078_add_usde_collateral', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const USDe = await deploymentManager.existing(
      'USDe',
      USDe_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const USDePriceFeed = await deploymentManager.existing(
      'USDe:priceFeed',
      USDe_TO_USD_PRICE_FEED,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const USDeAssetConfig = {
      asset: USDe.address,
      priceFeed: USDePriceFeed.address,
      decimals: await USDe.decimals(),
      borrowCollateralFactor: exp(0.89, 18),
      liquidateCollateralFactor: exp(0.94, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(30_000_000, 18),
    };

    const mainnetActions = [
      // 1. Add USDe as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, USDeAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Add USDe as collateral into cUSDTv3 on Mainnet

## Proposal summary

WOOF! proposes to add USDe into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-parameter-recommendations-for-usde-on-mainnet-usdc-usdt-comets/7580/1).
Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1090) and [forum discussion](https://www.comp.xyz/t/gauntlet-parameter-recommendations-for-usde-on-mainnet-usdc-usdt-comets/7580).


## Proposal Actions

The first action adds USDe asset as collateral with corresponding configurations.

The second action deploys and upgrades Comet to a new version.`;

    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const USDeAssetIndex = Number(await comet.numAssets()) - 1;

    const USDe = await deploymentManager.existing(
      'USDe',
      USDe_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const USDeAssetConfig = {
      asset: USDe.address,
      priceFeed: USDe_TO_USD_PRICE_FEED,
      decimals: 18n,
      borrowCollateralFactor: exp(0.89, 18),
      liquidateCollateralFactor: exp(0.94, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(30_000_000, 18),
    };

    // 1. Compare USDe asset config with Comet and Configurator asset info
    const cometUSDeAssetInfo = await comet.getAssetInfoByAddress(USDe_ADDRESS);
    expect(USDeAssetIndex).to.be.equal(cometUSDeAssetInfo.offset);
    expect(USDeAssetConfig.asset).to.be.equal(cometUSDeAssetInfo.asset);
    expect(USDeAssetConfig.priceFeed).to.be.equal(cometUSDeAssetInfo.priceFeed);
    expect(exp(1, USDeAssetConfig.decimals)).to.be.equal(cometUSDeAssetInfo.scale);
    expect(USDeAssetConfig.borrowCollateralFactor).to.be.equal(cometUSDeAssetInfo.borrowCollateralFactor);
    expect(USDeAssetConfig.liquidateCollateralFactor).to.be.equal(cometUSDeAssetInfo.liquidateCollateralFactor);
    expect(USDeAssetConfig.liquidationFactor).to.be.equal(cometUSDeAssetInfo.liquidationFactor);
    expect(USDeAssetConfig.supplyCap).to.be.equal(cometUSDeAssetInfo.supplyCap);

    const configuratorUSDeAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[USDeAssetIndex];
    expect(USDeAssetConfig.asset).to.be.equal(configuratorUSDeAssetConfig.asset);
    expect(USDeAssetConfig.priceFeed).to.be.equal(configuratorUSDeAssetConfig.priceFeed);
    expect(USDeAssetConfig.decimals).to.be.equal(configuratorUSDeAssetConfig.decimals);
    expect(USDeAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUSDeAssetConfig.borrowCollateralFactor);
    expect(USDeAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUSDeAssetConfig.liquidateCollateralFactor);
    expect(USDeAssetConfig.liquidationFactor).to.be.equal(configuratorUSDeAssetConfig.liquidationFactor);
    expect(USDeAssetConfig.supplyCap).to.be.equal(configuratorUSDeAssetConfig.supplyCap);
  },
});
