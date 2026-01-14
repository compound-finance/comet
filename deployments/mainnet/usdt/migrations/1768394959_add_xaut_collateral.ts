import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const XAUT_ADDRESS = '0x68749665FF8D2d112Fa859AA293F07A622782F38';
const XAU_TO_USD_PRICE_FEED_ADDRESS = '0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6';

export default migration('1768394959_add_xaut_collateral', {
  async prepare() {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    const XAUt = await deploymentManager.existing(
      'XAUt',
      XAUT_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const XAUtPriceFeed = await deploymentManager.existing(
      'XAUt:priceFeed',
      XAU_TO_USD_PRICE_FEED_ADDRESS,
      'mainnet'
    );

    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: XAUt.address,
      priceFeed: XAUtPriceFeed.address,
      decimals: await XAUt.decimals(),
      borrowCollateralFactor: exp(0.70, 18),
      liquidateCollateralFactor: exp(0.75, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(200, 6),
    };

    const mainnetActions = [
      // 1. Add XAUt as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, newAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Add XAUt as collateral into cUSDTv3 on Ethereum

## Proposal summary

WOOF! proposes to add XAUt into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum.
Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-xaut-risk-recommendations-for-mainnet-usdt/7539/1).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1085) and [forum discussion](https://www.comp.xyz/t/gauntlet-xaut-risk-recommendations-for-mainnet-usdt/7539).


## Proposal Actions

The first proposal action adds XAUt asset as collateral with corresponding configurations.

The second action deploys and upgrades Comet to a new version.`;
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const XAUtAssetIndex = Number(await comet.numAssets()) - 1;

    const XAUtAssetConfig = {
      asset: XAUT_ADDRESS,
      priceFeed: XAU_TO_USD_PRICE_FEED_ADDRESS,
      decimals: 6,
      borrowCollateralFactor: exp(0.70, 18),
      liquidateCollateralFactor: exp(0.75, 18),
      liquidationFactor: exp(0.90, 18),
      supplyCap: exp(200, 6),
    };

    // 1. Compare proposed asset config with Comet asset info
    const XAUtAssetInfo = await comet.getAssetInfoByAddress(XAUT_ADDRESS);
    expect(XAUtAssetIndex).to.be.equal(XAUtAssetInfo.offset);
    expect(XAUtAssetConfig.asset).to.be.equal(XAUtAssetInfo.asset);
    expect(XAUtAssetConfig.priceFeed).to.be.equal(XAUtAssetInfo.priceFeed);
    expect(exp(1, XAUtAssetConfig.decimals)).to.be.equal(XAUtAssetInfo.scale);
    expect(XAUtAssetConfig.borrowCollateralFactor).to.be.equal(XAUtAssetInfo.borrowCollateralFactor);
    expect(XAUtAssetConfig.liquidateCollateralFactor).to.be.equal(XAUtAssetInfo.liquidateCollateralFactor);
    expect(XAUtAssetConfig.liquidationFactor).to.be.equal(XAUtAssetInfo.liquidationFactor);
    expect(XAUtAssetConfig.supplyCap).to.be.equal(XAUtAssetInfo.supplyCap);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorXAUTAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[XAUtAssetIndex];
    expect(XAUtAssetConfig.asset).to.be.equal(configuratorXAUTAssetConfig.asset);
    expect(XAUtAssetConfig.priceFeed).to.be.equal(configuratorXAUTAssetConfig.priceFeed);
    expect(XAUtAssetConfig.decimals).to.be.equal(configuratorXAUTAssetConfig.decimals);
    expect(XAUtAssetConfig.borrowCollateralFactor).to.be.equal(configuratorXAUTAssetConfig.borrowCollateralFactor);
    expect(XAUtAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorXAUTAssetConfig.liquidateCollateralFactor);
    expect(XAUtAssetConfig.liquidationFactor).to.be.equal(configuratorXAUTAssetConfig.liquidationFactor);
    expect(XAUtAssetConfig.supplyCap).to.be.equal(configuratorXAUTAssetConfig.supplyCap);
  },
});
