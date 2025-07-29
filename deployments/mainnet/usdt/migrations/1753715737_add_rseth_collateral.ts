import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const RSETH_ADDRESS = '0xA1290d69c65A6Fe4DF752f95823fae25cB99e5A7';
const RSETH_TO_ETH_PRICE_FEED = '0x9d2F2f96B24C444ee32E57c04F7d944bcb8c8549';

let newPriceFeedAddress: string;

export default migration('1753715737_add_rseth_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const WETHPriceFeed = await deploymentManager.fromDep('WETH:priceFeed', 'mainnet', 'usdt');
    const rsETHMultiplicativePriceFeed = await deploymentManager.deploy(
      'rsETH:priceFeed',
      'pricefeeds/MultiplicativePriceFeed.sol',
      [
        RSETH_TO_ETH_PRICE_FEED,  // rsETH / ETH price feed
        WETHPriceFeed.address,    // ETH / USD price feed
        8,                        // decimals
        'rsETH / USD price feed'  // description
      ]
    );
    return { rsETHPriceFeedAddress: rsETHMultiplicativePriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { rsETHPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const rsETH = await deploymentManager.existing(
      'rsETH',
      RSETH_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const rsETHPriceFeed = await deploymentManager.existing(
      'rsETH:priceFeed',
      rsETHPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedAddress = rsETHPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const rsETHAssetConfig = {
      asset: rsETH.address,
      priceFeed: rsETHPriceFeed.address,
      decimals: await rsETH.decimals(),
      borrowCollateralFactor: exp(0.85, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1500, 18),
    };

    const mainnetActions = [
      // 1. Add rsETH as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, rsETHAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Add rsETH as collateral into cUSDTv3 on Mainnet

## Proposal summary

Compound Growth Program [AlphaGrowth] proposes to add rsETH into cUSDTv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/alphagrowth-add-market-eth-on-unichain/6712/9).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1005) and [forum discussion](https://www.comp.xyz/t/alphagrowth-add-market-eth-on-unichain/6712).


## Proposal Actions

The first action adds rsETH asset as collateral with corresponding configurations.

The second action deploys and upgrades Comet to a new version.`;
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

    const rsETHAssetIndex = Number(await comet.numAssets()) - 1;

    const rsETHAssetConfig = {
      asset: RSETH_ADDRESS,
      priceFeed: newPriceFeedAddress,
      decimals: 18n,
      borrowCollateralFactor: exp(0.85, 18),
      liquidateCollateralFactor: exp(0.90, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(1500, 18),
    };

    // 1. Compare rsETH asset config with Comet and Configurator asset info
    const cometRSETHAssetInfo = await comet.getAssetInfoByAddress(RSETH_ADDRESS);
    expect(rsETHAssetIndex).to.be.equal(cometRSETHAssetInfo.offset);
    expect(rsETHAssetConfig.asset).to.be.equal(cometRSETHAssetInfo.asset);
    expect(rsETHAssetConfig.priceFeed).to.be.equal(cometRSETHAssetInfo.priceFeed);
    expect(exp(1, rsETHAssetConfig.decimals)).to.be.equal(cometRSETHAssetInfo.scale);
    expect(rsETHAssetConfig.borrowCollateralFactor).to.be.equal(cometRSETHAssetInfo.borrowCollateralFactor);
    expect(rsETHAssetConfig.liquidateCollateralFactor).to.be.equal(cometRSETHAssetInfo.liquidateCollateralFactor);
    expect(rsETHAssetConfig.liquidationFactor).to.be.equal(cometRSETHAssetInfo.liquidationFactor);
    expect(rsETHAssetConfig.supplyCap).to.be.equal(cometRSETHAssetInfo.supplyCap);

    const configuratorRSETHAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[rsETHAssetIndex];
    expect(rsETHAssetConfig.asset).to.be.equal(configuratorRSETHAssetConfig.asset);
    expect(rsETHAssetConfig.priceFeed).to.be.equal(configuratorRSETHAssetConfig.priceFeed);
    expect(rsETHAssetConfig.decimals).to.be.equal(configuratorRSETHAssetConfig.decimals);
    expect(rsETHAssetConfig.borrowCollateralFactor).to.be.equal(configuratorRSETHAssetConfig.borrowCollateralFactor);
    expect(rsETHAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorRSETHAssetConfig.liquidateCollateralFactor);
    expect(rsETHAssetConfig.liquidationFactor).to.be.equal(configuratorRSETHAssetConfig.liquidationFactor);
    expect(rsETHAssetConfig.supplyCap).to.be.equal(configuratorRSETHAssetConfig.supplyCap);
  },
});
