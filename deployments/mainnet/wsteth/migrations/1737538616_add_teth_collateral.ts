import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const TETH_ADDRESS = '0xD11c452fc99cF405034ee446803b6F6c1F6d5ED8';
const TETH_TO_WSTETH_PRICE_FEED = '0x7B2Fb2c667af80Bccc0B2556378352dFDE2be914';

let newPriceFeedAddress: string;

export default migration('1737538616_add_teth_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const tETHPriceFeed = await deploymentManager.deploy(
      'tETH:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        TETH_TO_WSTETH_PRICE_FEED,     // tETH / wstETH price feed
        8,                             // decimals
      ]
    );
    return { tETHPriceFeedAddress: tETHPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { tETHPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const tETH = await deploymentManager.existing(
      'tETH',
      TETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const tETHPriceFeed = await deploymentManager.existing(
      'tETH:priceFeed',
      tETHPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedAddress = tETHPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const tETHAssetConfig = {
      asset: tETH.address,
      priceFeed: tETHPriceFeed.address,
      decimals: await tETH.decimals(),
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(5000, 18),
    };

    const mainnetActions = [
      // 1. Add tETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, tETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add tETH as collateral into cWstETHv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add tETH into cWstETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III wstETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/listing-teth-on-compound/5925/4).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/955) and [forum discussion](https://www.comp.xyz/t/listing-teth-on-compound/5925).\n\n\n## Proposal Actions\n\nThe first action adds tETH asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
    // impersonate the proposer
    await deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: ['0x7e959eab54932f5cfd10239160a7fd6474171318'],
    });
    const signer = await deploymentManager.getSigner('0x7e959eab54932f5cfd10239160a7fd6474171318');
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.connect(signer).propose(...(await proposal(mainnetActions, description)))
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

    const tETHAssetIndex = Number(await comet.numAssets()) - 1;

    const tETH = await deploymentManager.existing(
      'tETH',
      TETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const tETHAssetConfig = {
      asset: tETH.address,
      priceFeed: newPriceFeedAddress,
      decimals: 18n,
      borrowCollateralFactor: exp(0.88, 18),
      liquidateCollateralFactor: exp(0.91, 18),
      liquidationFactor: exp(0.96, 18),
      supplyCap: exp(5000, 18),
    };

    // 1. Compare tETH asset config with Comet and Configurator asset info
    const cometTETHAssetInfo = await comet.getAssetInfoByAddress(TETH_ADDRESS);
    expect(tETHAssetIndex).to.be.equal(cometTETHAssetInfo.offset);
    expect(tETHAssetConfig.asset).to.be.equal(cometTETHAssetInfo.asset);
    expect(tETHAssetConfig.priceFeed).to.be.equal(cometTETHAssetInfo.priceFeed);
    expect(exp(1, tETHAssetConfig.decimals)).to.be.equal(cometTETHAssetInfo.scale);
    expect(tETHAssetConfig.borrowCollateralFactor).to.be.equal(cometTETHAssetInfo.borrowCollateralFactor);
    expect(tETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometTETHAssetInfo.liquidateCollateralFactor);
    expect(tETHAssetConfig.liquidationFactor).to.be.equal(cometTETHAssetInfo.liquidationFactor);
    expect(tETHAssetConfig.supplyCap).to.be.equal(cometTETHAssetInfo.supplyCap);

    const configuratorTETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[tETHAssetIndex];
    expect(tETHAssetConfig.asset).to.be.equal(configuratorTETHAssetConfig.asset);
    expect(tETHAssetConfig.priceFeed).to.be.equal(configuratorTETHAssetConfig.priceFeed);
    expect(tETHAssetConfig.decimals).to.be.equal(configuratorTETHAssetConfig.decimals);
    expect(tETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorTETHAssetConfig.borrowCollateralFactor);
    expect(tETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorTETHAssetConfig.liquidateCollateralFactor);
    expect(tETHAssetConfig.liquidationFactor).to.be.equal(configuratorTETHAssetConfig.liquidationFactor);
    expect(tETHAssetConfig.supplyCap).to.be.equal(configuratorTETHAssetConfig.supplyCap);
  },
});
