import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const METH_ADDRESS = '0xd5F7838F5C461fefF7FE49ea5ebaF7728bB0ADfa';
const METH_EXCHANGE_RATE_PROVIDER_ADDRESS = '0xe3cBd06D7dadB3F4e6557bAb7EdD924CD1489E8f';
let newPriceFeedAddress: string;

export default migration('1726138937_add_meth_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _mETHToETHPriceFeed = await deploymentManager.deploy(
      'mETH:priceFeedToETH',
      'pricefeeds/METHExchangeRatePriceFeed.sol',
      [
        METH_EXCHANGE_RATE_PROVIDER_ADDRESS, // mETH / ETH price feed
        8,                                   // decimals
        'mETH/ETH exchange rate',            // description
      ],
      true
    );
    const ethToUSDPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'usdt');

    const _mETHPriceFeed = await deploymentManager.deploy(
      'mETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        _mETHToETHPriceFeed.address,  // mETH / ETH price feed
        ethToUSDPriceFeed.address,    // ETH / USD price feed
        8,                            // decimals
        'mETH / USD price feed'     // description
      ],
      true
    );
    return { mETHPriceFeedAddress: _mETHPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { mETHPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const mETH = await deploymentManager.existing(
      'mETH',
      METH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const mEthPriceFeed = await deploymentManager.existing(
      'mETH:priceFeed',
      mETHPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedAddress = mEthPriceFeed.address;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const mETHAssetConfig = {
      asset: mETH.address,
      priceFeed: mEthPriceFeed.address,
      decimals: await mETH.decimals(),
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(4000, 18),
    };

    const mainnetActions = [
      // 1. Add mETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, mETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = '# Add mETH as collateral into cUSDTv3 on Mainnet\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add mETH into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-meth-market-on-ethereum/5647/5).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/918) and [forum discussion](https://www.comp.xyz/t/add-meth-market-on-ethereum/5647).\n\n\n## Proposal Actions\n\nThe first action adds mETH asset as collateral with corresponding configurations.\n\nThe second action deploys and upgrades Comet to a new version.';
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

    const mETHAssetIndex = Number(await comet.numAssets()) - 1;

    const mETH = await deploymentManager.existing(
      'mETH',
      METH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const mETHAssetConfig = {
      asset: mETH.address,
      priceFeed: newPriceFeedAddress,
      decimals: await mETH.decimals(),
      borrowCollateralFactor: exp(0.8, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(4000, 18),
    };

    // 1. Compare mETH asset config with Comet and Configurator asset info
    const cometMETHAssetInfo = await comet.getAssetInfoByAddress(METH_ADDRESS);
    expect(mETHAssetIndex).to.be.equal(cometMETHAssetInfo.offset);
    expect(mETHAssetConfig.asset).to.be.equal(cometMETHAssetInfo.asset);
    expect(mETHAssetConfig.priceFeed).to.be.equal(cometMETHAssetInfo.priceFeed);
    expect(exp(1, mETHAssetConfig.decimals)).to.be.equal(cometMETHAssetInfo.scale);
    expect(mETHAssetConfig.borrowCollateralFactor).to.be.equal(cometMETHAssetInfo.borrowCollateralFactor);
    expect(mETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometMETHAssetInfo.liquidateCollateralFactor);
    expect(mETHAssetConfig.liquidationFactor).to.be.equal(cometMETHAssetInfo.liquidationFactor);
    expect(mETHAssetConfig.supplyCap).to.be.equal(cometMETHAssetInfo.supplyCap);

    const configuratorMETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[mETHAssetIndex];
    expect(mETHAssetConfig.asset).to.be.equal(configuratorMETHAssetConfig.asset);
    expect(mETHAssetConfig.priceFeed).to.be.equal(configuratorMETHAssetConfig.priceFeed);
    expect(mETHAssetConfig.decimals).to.be.equal(configuratorMETHAssetConfig.decimals);
    expect(mETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorMETHAssetConfig.borrowCollateralFactor);
    expect(mETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorMETHAssetConfig.liquidateCollateralFactor);
    expect(mETHAssetConfig.liquidationFactor).to.be.equal(configuratorMETHAssetConfig.liquidationFactor);
    expect(mETHAssetConfig.supplyCap).to.be.equal(configuratorMETHAssetConfig.supplyCap);
  },
});
