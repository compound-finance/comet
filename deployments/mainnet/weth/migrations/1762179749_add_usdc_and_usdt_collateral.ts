import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const USDC_ADDRESS = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const USDT_ADDRESS = '0xdAC17F958D2ee523a2206206994597C13D831ec7';

const USDC_TO_ETH_PRICE_FEED = '0x986b5E1e1755e3C2440e960477f25201B0a8bbD4';
const USDT_TO_ETH_PRICE_FEED = '0xEe9F2375b4bdF6387aa8265dD4FB8F16512A1d46';

let newPriceFeedUSDCAddress: string;
let newPriceFeedUSDTAddress: string;

export default migration('1762179749_add_usdc_and_usdt_collateral', {
  async prepare(deploymentManager: DeploymentManager) {
    const usdcPriceFeed = await deploymentManager.deploy(
      'USDC:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        USDC_TO_ETH_PRICE_FEED, // USDC / ETH price feed
        8                       // decimals
      ]
    );

    const usdtPriceFeed = await deploymentManager.deploy(
      'USDT:priceFeed',
      'pricefeeds/ScalingPriceFeed.sol',
      [
        USDT_TO_ETH_PRICE_FEED, // USDT / ETH price feed
        8,                      // decimals
      ]
    );
    return { usdcPriceFeedAddress: usdcPriceFeed.address, usdtPriceFeedAddress: usdtPriceFeed.address };
  },

  async enact(deploymentManager: DeploymentManager, _, { usdcPriceFeedAddress, usdtPriceFeedAddress }) {

    const trace = deploymentManager.tracer();

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdcPriceFeed = await deploymentManager.existing(
      'USDC:priceFeed',
      usdcPriceFeedAddress,
      'mainnet'
    );

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdtPriceFeed = await deploymentManager.existing(
      'USDT:priceFeed',
      usdtPriceFeedAddress,
      'mainnet'
    );

    newPriceFeedUSDCAddress = usdcPriceFeedAddress;
    newPriceFeedUSDTAddress = usdtPriceFeedAddress;

    const {
      governor,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: usdcPriceFeed.address,
      decimals: await USDC.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(50_000_000, 6),
    };

    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: usdtPriceFeed.address,
      decimals: await USDT.decimals(),
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(50_000_000, 6),
    };

    const mainnetActions = [
      // 1. Add USDC as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, usdcAssetConfig],
      },
      // 2. Add USDT as asset
      {
        contract: configurator,
        signature: 'addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))',
        args: [comet.address, usdtAssetConfig],
      },
      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },
    ];

    const description = `# Add USDC and USDT as collaterals into cWETHv3 on Mainnet

## Proposal summary

WOOF proposes to add USDC and USDT into cWETHv3 on Ethereum network. This proposal takes the governance steps recommended and necessary to update a Compound III WETH market on Ethereum. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based on the [recommendations from Gauntlet](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415/2).

Further detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/1057) and [forum discussion](https://www.comp.xyz/t/add-dai-usdc-and-usdt-as-collaterals-to-weth-comets-on-mainnet-and-arbitrum/5415).


## Proposal Actions

The first action adds USDC asset as collateral with corresponding configurations.

The second action adds USDT asset as collateral with corresponding configurations.

The third action upgrades Comet to a new version.`;

    const [targets, values, calldatas, ] = await proposal(mainnetActions, description);
    const signer = await deploymentManager.getSigner();

    const txn = await (await governor.connect(signer).propose(targets, values, calldatas, description)).wait();

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

    // 1. Compare USDC asset config with Comet and Configurator asset info
    const usdcAssetIndex = Number(await comet.numAssets()) - 2;

    const USDC = await deploymentManager.existing(
      'USDC',
      USDC_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdcAssetConfig = {
      asset: USDC.address,
      priceFeed: newPriceFeedUSDCAddress,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(50_000_000, 6),
    };

    const cometUSDCAssetInfo = await comet.getAssetInfoByAddress(USDC_ADDRESS);
    expect(usdcAssetIndex).to.be.equal(cometUSDCAssetInfo.offset);
    expect(usdcAssetConfig.asset).to.be.equal(cometUSDCAssetInfo.asset);
    expect(usdcAssetConfig.priceFeed).to.be.equal(cometUSDCAssetInfo.priceFeed);
    expect(exp(1, usdcAssetConfig.decimals)).to.be.equal(cometUSDCAssetInfo.scale);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(cometUSDCAssetInfo.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(cometUSDCAssetInfo.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(cometUSDCAssetInfo.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(cometUSDCAssetInfo.supplyCap);

    const configuratorUSDCAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdcAssetIndex];
    expect(usdcAssetConfig.asset).to.be.equal(configuratorUSDCAssetConfig.asset);
    expect(usdcAssetConfig.priceFeed).to.be.equal(configuratorUSDCAssetConfig.priceFeed);
    expect(usdcAssetConfig.decimals).to.be.equal(configuratorUSDCAssetConfig.decimals);
    expect(usdcAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUSDCAssetConfig.borrowCollateralFactor);
    expect(usdcAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUSDCAssetConfig.liquidateCollateralFactor);
    expect(usdcAssetConfig.liquidationFactor).to.be.equal(configuratorUSDCAssetConfig.liquidationFactor);
    expect(usdcAssetConfig.supplyCap).to.be.equal(configuratorUSDCAssetConfig.supplyCap);

    // 2. Compare USDT asset config with Comet and Configurator asset info
    const usdtAssetIndex = Number(await comet.numAssets()) - 1;

    const USDT = await deploymentManager.existing(
      'USDT',
      USDT_ADDRESS,
      'mainnet',
      'contracts/ERC20.sol:ERC20'
    );
    const usdtAssetConfig = {
      asset: USDT.address,
      priceFeed: newPriceFeedUSDTAddress,
      decimals: 6n,
      borrowCollateralFactor: exp(0.80, 18),
      liquidateCollateralFactor: exp(0.85, 18),
      liquidationFactor: exp(0.95, 18),
      supplyCap: exp(50_000_000, 6),
    };

    const cometUSDTAssetInfo = await comet.getAssetInfoByAddress(USDT_ADDRESS);
    expect(usdtAssetIndex).to.be.equal(cometUSDTAssetInfo.offset);
    expect(usdtAssetConfig.asset).to.be.equal(cometUSDTAssetInfo.asset);
    expect(usdtAssetConfig.priceFeed).to.be.equal(cometUSDTAssetInfo.priceFeed);
    expect(exp(1, usdtAssetConfig.decimals)).to.be.equal(cometUSDTAssetInfo.scale);
    expect(usdtAssetConfig.borrowCollateralFactor).to.be.equal(cometUSDTAssetInfo.borrowCollateralFactor);
    expect(usdtAssetConfig.liquidateCollateralFactor).to.be.equal(cometUSDTAssetInfo.liquidateCollateralFactor);
    expect(usdtAssetConfig.liquidationFactor).to.be.equal(cometUSDTAssetInfo.liquidationFactor);
    expect(usdtAssetConfig.supplyCap).to.be.equal(cometUSDTAssetInfo.supplyCap);

    const configuratorUSDTAssetConfig = (await configurator.getConfiguration(comet.address)).assetConfigs[usdtAssetIndex];
    expect(usdtAssetConfig.asset).to.be.equal(configuratorUSDTAssetConfig.asset);
    expect(usdtAssetConfig.priceFeed).to.be.equal(configuratorUSDTAssetConfig.priceFeed);
    expect(usdtAssetConfig.decimals).to.be.equal(configuratorUSDTAssetConfig.decimals);
    expect(usdtAssetConfig.borrowCollateralFactor).to.be.equal(configuratorUSDTAssetConfig.borrowCollateralFactor);
    expect(usdtAssetConfig.liquidateCollateralFactor).to.be.equal(configuratorUSDTAssetConfig.liquidateCollateralFactor);
    expect(usdtAssetConfig.liquidationFactor).to.be.equal(configuratorUSDTAssetConfig.liquidationFactor);
    expect(usdtAssetConfig.supplyCap).to.be.equal(configuratorUSDTAssetConfig.supplyCap);
  },
});