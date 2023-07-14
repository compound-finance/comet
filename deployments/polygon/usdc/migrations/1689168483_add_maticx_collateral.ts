import { expect } from "chai";
import { DeploymentManager } from "../../../../plugins/deployment_manager/DeploymentManager";
import { migration } from "../../../../plugins/deployment_manager/Migration";
import { calldata, exp, proposal } from "../../../../src/deploy";
import { utils } from "ethers";

interface Vars {}

const MATICX_ADDRESS = "0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6";
const MATICX_PRICE_FEED_ADDRESS = "0x5d37E4b374E6907de8Fc7fb33EE3b0af403C7403";

export default migration("1689168483_add_maticx_collateral", {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    vars: Vars
  ) => {
    const trace = deploymentManager.tracer();
    // const ethers = deploymentManager.hre.ethers; // ethers is not available
    // const { utils } = ethers;

    const maticx = await deploymentManager.existing(
      "MATICX",
      MATICX_ADDRESS,
      "polygon",
      "contracts/ERC20.sol:ERC20"
    );
    const maticxPricefeed = await deploymentManager.existing(
      "MATICX:priceFeed",
      MATICX_PRICE_FEED_ADDRESS,
      "polygon"
    );

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const { fxRoot, governor } = await govDeploymentManager.getContracts();

    const newAssetConfig = {
      asset: maticx.address,
      priceFeed: maticxPricefeed.address,
      decimals: await maticx.decimals(),
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.65, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(6_000_000, 18),
    };

    const addAssetCalldata = await calldata(
      configurator.populateTransaction.addAsset(comet.address, newAssetConfig)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ["address", "address"],
      [configurator.address, comet.address]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ["address[]", "uint256[]", "string[]", "bytes[]"],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          "addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))",
          "deployAndUpgradeTo(address,address)",
        ],
        [addAssetCalldata, deployAndUpgradeToCalldata],
      ]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: "sendMessageToChild(address,bytes)",
        args: [bridgeReceiver.address, l2ProposalData],
      },
    ];

    const description = "TODO";
    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event) => event.event === "ProposalCreated"
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, configurator } = await deploymentManager.getContracts();

    const maticxAssetIndex = 3; // TODO

    const maticxAssetConfig = {
      asset: MATICX_ADDRESS,
      priceFeed: MATICX_PRICE_FEED_ADDRESS,
      decimals: 18,
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.65, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(6_000_000, 18),
    };

    // 1. Compare proposed asset config with Comet asset info
    const cometMaticxAssetInfo = await comet.getAssetInfoByAddress(
      MATICX_ADDRESS
    );
    expect(maticxAssetIndex).to.be.equal(cometMaticxAssetInfo.offset);
    expect(maticxAssetConfig.asset).to.be.equal(cometMaticxAssetInfo.asset);
    expect(maticxAssetConfig.priceFeed).to.be.equal(
      cometMaticxAssetInfo.priceFeed
    );
    expect(exp(1, maticxAssetConfig.decimals)).to.be.equal(
      cometMaticxAssetInfo.scale
    );
    expect(maticxAssetConfig.borrowCollateralFactor).to.be.equal(
      cometMaticxAssetInfo.borrowCollateralFactor
    );
    expect(maticxAssetConfig.liquidateCollateralFactor).to.be.equal(
      cometMaticxAssetInfo.liquidateCollateralFactor
    );
    expect(maticxAssetConfig.liquidationFactor).to.be.equal(
      cometMaticxAssetInfo.liquidationFactor
    );
    expect(maticxAssetConfig.supplyCap).to.be.equal(
      cometMaticxAssetInfo.supplyCap
    );

    // 2. Compare proposed asset config with Configurator asset config
    const configuratorMaticxAssetConfig = (
      await configurator.getConfiguration(comet.address)
    ).assetConfigs[maticxAssetIndex];
    expect(maticxAssetConfig.asset).to.be.equal(
      configuratorMaticxAssetConfig.asset
    );
    expect(maticxAssetConfig.priceFeed).to.be.equal(
      configuratorMaticxAssetConfig.priceFeed
    );
    expect(maticxAssetConfig.decimals).to.be.equal(
      configuratorMaticxAssetConfig.decimals
    );
    expect(maticxAssetConfig.borrowCollateralFactor).to.be.equal(
      configuratorMaticxAssetConfig.borrowCollateralFactor
    );
    expect(maticxAssetConfig.liquidateCollateralFactor).to.be.equal(
      configuratorMaticxAssetConfig.liquidateCollateralFactor
    );
    expect(maticxAssetConfig.liquidationFactor).to.be.equal(
      configuratorMaticxAssetConfig.liquidationFactor
    );
    expect(maticxAssetConfig.supplyCap).to.be.equal(
      configuratorMaticxAssetConfig.supplyCap
    );
  },
});
