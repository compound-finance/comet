import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal, exp } from '../../../../src/deploy';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';

let newPriceFeedAddress;

export default migration('1755167158_deprecate_wusdm_collateral', {
  async prepare(
    deploymentManager: DeploymentManager
  ) {
    const _wUSDMPriceFeed = await deploymentManager.deploy(
      'WETH:priceFeed',
      'pricefeeds/ConstantPriceFeed.sol',
      [
        8, // decimals
        1  // constantPrice
      ],
      true
    );
    return { wUSDMPriceFeedAddress: _wUSDMPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, _, { wUSDMPriceFeedAddress }) => {
    const trace = deploymentManager.tracer();

    const wUSDM = await deploymentManager.existing(
      'wUSDM',
      WUSDM_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );

    newPriceFeedAddress = wUSDMPriceFeedAddress;

    const newAssetConfig = {
      asset: wUSDM.address,
      priceFeed: wUSDMPriceFeedAddress,
      decimals: await wUSDM.decimals(),
      borrowCollateralFactor: 0,
      liquidateCollateralFactor: exp(0.0001, 18),
      liquidationFactor: exp(1, 18),
      supplyCap: 0,
    };

    const {
      governor,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const mainnetActions = [
      // 1. Update wUSDM price feed to return the smallest possible price
      {
        contract: configurator,
        signature: 'updateAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, newAssetConfig],
      },
      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Deprecate wUSDM from cUSDTv3 on Ethereum

## Proposal summary

WOOF! proposes to deprecate wUSDM from cUSDTv3 on Ethereum network, since deprecation of USDM itself and its Chainlink oracle.

In order to achieve this price feed will be updated to a new one, which will return the smallest acceptable price - 0.00000001 (1e-8), and the supply cup will be set to 0 to prevent further deposits. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1013).


## Proposal Actions

The first proposal action updates wUSDM config to a deprecated state.

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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    // 1. Compare proposed asset config with Comet asset info
    const wUSDMAssetInfo = await comet.getAssetInfoByAddress(WUSDM_ADDRESS);
    const wUSDMAssetIndex = wUSDMAssetInfo.offset;
    expect(0).to.be.equal(wUSDMAssetInfo.supplyCap);
    expect(newPriceFeedAddress).to.be.equal(wUSDMAssetInfo.priceFeed);
    expect(1).to.be.equal(await comet.getPrice(wUSDMAssetInfo.priceFeed));
    expect(0).to.be.equal(wUSDMAssetInfo.borrowCollateralFactor);
    expect(exp(0.0001, 18)).to.be.equal(wUSDMAssetInfo.liquidateCollateralFactor);
    expect(exp(1, 18)).to.be.equal(wUSDMAssetInfo.liquidationFactor);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWUSDMAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wUSDMAssetIndex];
    expect(0).to.be.equal(configuratorWUSDMAssetConfig.supplyCap);
    expect(newPriceFeedAddress).to.be.equal(configuratorWUSDMAssetConfig.priceFeed);
    expect(1).to.be.equal(await comet.getPrice(configuratorWUSDMAssetConfig.priceFeed));
    expect(0).to.be.equal(configuratorWUSDMAssetConfig.borrowCollateralFactor);
    expect(exp(0.0001, 18)).to.be.equal(configuratorWUSDMAssetConfig.liquidateCollateralFactor);
    expect(exp(1, 18)).to.be.equal(configuratorWUSDMAssetConfig.liquidationFactor);
  },
});
