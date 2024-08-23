import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';
import { ethers } from 'ethers';

const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_USD_PRICE_FEED_ADDRESS = '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B';
const ETH_USD_PRICE_FEED_ADDRESS = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';

export default migration('1722416736_add_usdc_as_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const _usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ReverseMultiplicativePriceFeed.sol',
      [
        USDC_USD_PRICE_FEED_ADDRESS, // USDC / USD price feed
        ETH_USD_PRICE_FEED_ADDRESS,  // ETH / USD price feed
        8,                           // decimals
        'USDC / ETH price feed'      // description
      ]
    );
    return { usdcPriceFeed: _usdcPriceFeed.address };
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, { usdcPriceFeed }) => {
    const trace = deploymentManager.tracer();
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      governor
    } = await govDeploymentManager.getContracts();

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'base',
      'contracts/ERC20.sol:ERC20'
    );

    const usdcPricefeed = await deploymentManager.existing(
      'USDC:priceFeed',
      usdcPriceFeed,
      'base'
    );

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: usdcPricefeed.address,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(20_000_000, 6), 
    };

    const addAssetCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'tuple(address,address,uint8,uint64,uint64,uint64,uint128)'],
      [comet.address,
        [
          usdcAssetConfig.asset,
          usdcAssetConfig.priceFeed,
          usdcAssetConfig.decimals,
          usdcAssetConfig.borrowCollateralFactor,
          usdcAssetConfig.liquidateCollateralFactor,
          usdcAssetConfig.liquidationFactor,
          usdcAssetConfig.supplyCap
        ]
      ]
    );

    const deployAndUpgradeToCalldata = ethers.utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );

    const l2ProposalData = ethers.utils.defaultAbiCoder.encode(
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
          'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
          'deployAndUpgradeTo(address,address)',
        ],
        [
          addAssetCalldata,
          deployAndUpgradeToCalldata,
        ]
      ]
    );

    const mainnetActions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet, set reward config on Base, wrap ETH to WETH and transfer to Comet as reserves.
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
    ];

    const description = '# Add USDC as collateral into cWETHv3 on Base\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes to add USDC into cWETHv3 on Base network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Base. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415/2).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/898) and [forum discussion](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415).\n\n\n## Proposal Actions\n\nThe first proposal action adds USDC to the WETH Comet on Base. This sends the encoded `addAsset` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Base.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');

    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  }, 

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const usdcAssetIndex = Number(await comet.numAssets()) - 1;

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'base',
      'contracts/ERC20.sol:ERC20'
    );

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: '',
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(20_000_000, 6),
    };

    // 1. & 2. Compare USDC asset config with Comet and Configurator asset info
    const cometUSDCAssetInfo = await comet.getAssetInfoByAddress(
      USDC_ADDRESS
    );
    expect(usdcAssetIndex).to.be.equal(cometUSDCAssetInfo.offset);
    expect(usdcAssetConfig.asset).to.be.equal(cometUSDCAssetInfo.asset);
    expect(exp(1, usdcAssetConfig.decimals)).to.be.equal(cometUSDCAssetInfo.scale);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(cometUSDCAssetInfo.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(cometUSDCAssetInfo.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(cometUSDCAssetInfo.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(cometUSDCAssetInfo.supplyCap);

    const configuratorUSDCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdcAssetIndex];
    expect(usdcAssetConfig.asset).to.be.equal(configuratorUSDCAssetConfig.asset);
    expect(usdcAssetConfig.decimals).to.be.equal(configuratorUSDCAssetConfig.decimals);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUSDCAssetConfig.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUSDCAssetConfig.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(configuratorUSDCAssetConfig.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(configuratorUSDCAssetConfig.supplyCap);
  },
});
