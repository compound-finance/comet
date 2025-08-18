import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal, exp } from '../../../../src/deploy';
import { utils } from 'ethers';

const WUSDM_ADDRESS = '0x57F5E098CaD7A3D1Eed53991D4d66C45C9AF7812';
const CONSTANT_PRICE_FEED = '0x8671d5e3a10639a573bACffEF448CA076b2d5cD7';

export default migration('1755522410_deprecate_wusdm_collateral', {
  async prepare() {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    const wUSDM = await deploymentManager.existing(
      'wUSDM',
      WUSDM_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );


    const newAssetConfig = {
      asset: wUSDM.address,
      priceFeed: CONSTANT_PRICE_FEED,
      decimals: await wUSDM.decimals(),
      borrowCollateralFactor: 0,
      liquidateCollateralFactor: exp(0.0001, 18),
      liquidationFactor: exp(1, 18),
      supplyCap: 0,
    };

    const {
      comet,
      cometAdmin,
      configurator,
      bridgeReceiver
    } = await deploymentManager.getContracts();

    const {
      governor,
      opL1CrossDomainMessenger
    } = await govDeploymentManager.getContracts();

    const addAssetCalldata = utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          newAssetConfig.asset,
          newAssetConfig.priceFeed,
          newAssetConfig.decimals,
          newAssetConfig.borrowCollateralFactor,
          newAssetConfig.liquidateCollateralFactor,
          newAssetConfig.liquidationFactor,
          newAssetConfig.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address
        ],
        [
          0,
          0
        ],
        [
          'updateAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          addAssetCalldata,
          deployAndUpgradeToCalldata,
        ]
      ]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo USDT Comet on Optimism.
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = `# Deprecate wUSDM from cUSDTv3 on Optimism
## Proposal summary
WOOF! proposes to deprecate wUSDM from cUSDTv3 on Optimism network, since deprecation of USDM itself and its Chainlink oracle.
In order to achieve this price feed will be updated to a new one, which will return the smallest acceptable price - 0.00000001 (1e-8), and the supply cup will be set to 0 to prevent further deposits. This proposal takes the governance steps recommended and necessary to update a Compound III USDT market on Optimism. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario).
Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1014).
## Proposal Actions
The first proposal action updates wUSDM's configuration to deprecate it from cUSDTv3 on Optimism. This sends the encoded 'updateAsset' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Optimism.`;

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

    // 1. Compare proposed asset config with Comet asset info
    const wUSDMAssetInfo = await comet.getAssetInfoByAddress(WUSDM_ADDRESS);
    const wUSDMAssetIndex = wUSDMAssetInfo.offset;
    expect(0).to.be.equal(wUSDMAssetInfo.supplyCap);
    expect(CONSTANT_PRICE_FEED).to.be.equal(wUSDMAssetInfo.priceFeed);
    expect(1).to.be.equal(await comet.getPrice(wUSDMAssetInfo.priceFeed));
    expect(0).to.be.equal(wUSDMAssetInfo.borrowCollateralFactor);
    expect(exp(0.0001, 18)).to.be.equal(wUSDMAssetInfo.liquidateCollateralFactor);
    expect(exp(1, 18)).to.be.equal(wUSDMAssetInfo.liquidationFactor);

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorWUSDMAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[wUSDMAssetIndex];
    expect(0).to.be.equal(configuratorWUSDMAssetConfig.supplyCap);
    expect(CONSTANT_PRICE_FEED).to.be.equal(configuratorWUSDMAssetConfig.priceFeed);
    expect(1).to.be.equal(await comet.getPrice(configuratorWUSDMAssetConfig.priceFeed));
    expect(0).to.be.equal(configuratorWUSDMAssetConfig.borrowCollateralFactor);
    expect(exp(0.0001, 18)).to.be.equal(configuratorWUSDMAssetConfig.liquidateCollateralFactor);
    expect(exp(1, 18)).to.be.equal(configuratorWUSDMAssetConfig.liquidationFactor);
  },
});
