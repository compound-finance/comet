import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const PUFETH_ADDRESS = '0xD9A442856C234a39a81a089C06451EBAa4306a72';

let newPriceFeedAddress: string;

export default migration('1749822568_add_pufeth_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const wethPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'weth');
    const pufETHPriceFeed = await deploymentManager.deploy(
      'pufETH:priceFeed',
      'pricefeeds/PriceFeedWith4626Support.sol',
      [
        PUFETH_ADDRESS,             // pufETH / ETH price feed
        wethPriceFeed.address,      // constant price feed
        8,                          // decimals
        'pufETH / ETH price feed'   // description
      ]
    );
    return { pufETHPriceFeedAddress: pufETHPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { pufETHPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const pufETH = await deploymentManager.existing(
      'pufETH',
      PUFETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    const pufETHPriceFeed = await deploymentManager.existing(
      'pufETH:priceFeed',
      pufETHPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedAddress = pufETHPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const pufETHAssetConfig = {
      asset: pufETH.address,
      priceFeed: pufETHPriceFeed.address,
      decimals: await pufETH.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(4500, 18),
    };

    const mainnetActions = [
      // 1. Add pufETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, pufETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add pufETH as collateral into cWETHv3 on Mainnet\n\n## Proposal summary\n\nWOOF! proposes to add pufETH into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/compound-listing-proposal-for-pufeth-from-puffer-finance/5725/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/943) and [forum discussion](https://www.comp.xyz/t/compound-listing-proposal-for-pufeth-from-puffer-finance/5725).\n\n\n## Proposal Actions\n\nThe first action adds pufETH asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const pufETHAssetIndex = Number(await comet.numAssets()) - 1;

    const pufETH = await deploymentManager.existing(
      'pufETH',
      PUFETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const pufETHAssetConfig = {
      asset: pufETH.address,
      priceFeed: newPriceFeedAddress,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(4500, 18),
    };

    // 1. Compare pufETH asset config with Comet and Configurator asset info
    const cometPufETHAssetInfo = await comet.getAssetInfoByAddress(PUFETH_ADDRESS);
    expect(pufETHAssetIndex).to.be.equal(cometPufETHAssetInfo.offset);
    expect(pufETHAssetConfig.asset).to.be.equal(cometPufETHAssetInfo.asset);
    expect(pufETHAssetConfig.priceFeed).to.be.equal(cometPufETHAssetInfo.priceFeed);
    expect(exp(1, pufETHAssetConfig.decimals)).to.be.equal(cometPufETHAssetInfo.scale);
    expect(pufETHAssetConfig.borrowCollateralFactor).to.be.equal(cometPufETHAssetInfo.borrowCollateralFactor);
    expect(pufETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometPufETHAssetInfo.liquidateCollateralFactor);
    expect(pufETHAssetConfig.liquidationFactor).to.be.equal(cometPufETHAssetInfo.liquidationFactor);
    expect(pufETHAssetConfig.supplyCap).to.be.equal(cometPufETHAssetInfo.supplyCap);

    const configuratorPufETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[pufETHAssetIndex];
    expect(pufETHAssetConfig.asset).to.be.equal(configuratorPufETHAssetConfig.asset);
    expect(pufETHAssetConfig.priceFeed).to.be.equal(configuratorPufETHAssetConfig.priceFeed);
    expect(pufETHAssetConfig.decimals).to.be.equal(configuratorPufETHAssetConfig.decimals);
    expect(pufETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorPufETHAssetConfig.borrowCollateralFactor);
    expect(pufETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorPufETHAssetConfig.liquidateCollateralFactor);
    expect(pufETHAssetConfig.liquidationFactor).to.be.equal(configuratorPufETHAssetConfig.liquidationFactor);
    expect(pufETHAssetConfig.supplyCap).to.be.equal(configuratorPufETHAssetConfig.supplyCap);
  },
});
