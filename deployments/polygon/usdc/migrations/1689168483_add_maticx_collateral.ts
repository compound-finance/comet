import { DeploymentManager } from "../../../../plugins/deployment_manager/DeploymentManager";
import { migration } from "../../../../plugins/deployment_manager/Migration";
import { exp, proposal } from "../../../../src/deploy";

interface Vars {}

export default migration("1689168483_add_maticx_collateral", {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();

    const maticx = await deploymentManager.existing(
      "MATICX",
      "0xfa68FB4628DFF1028CFEc22b4162FCcd0d45efb6",
      "polygon",
      "contracts/ERC20.sol:ERC20"
    );
    const maticxPricefeed = await deploymentManager.existing(
      "MATICX:priceFeed",
      "0x5d37E4b374E6907de8Fc7fb33EE3b0af403C7403",
      "polygon"
    );

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
    } = await deploymentManager.getContracts();

    const newAssetConfig = {
      asset: maticx.address,
      priceFeed: maticxPricefeed.address,
      decimals: await maticx.decimals(),
      borrowCollateralFactor: exp(0.55, 18),
      liquidateCollateralFactor: exp(0.65, 18),
      liquidationFactor: exp(0.9, 18),
      supplyCap: exp(6_000_000, 18),
    };

    const actions = [
      // 1. Call the add asset function on the configurator contract
      {
        contract: configurator,
        signature:
          "addAsset(address,(address,address,uint8,uint64,uint64,uint64,uint128))",
        args: [comet.address, newAssetConfig],
      },

      // 2. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },
    ];
    const description = "TODO";
    const txn = await deploymentManager.retry(async () =>
      governor.propose(...(await proposal(actions, description)))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(
      (event) => event.event === "ProposalCreated"
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },
});
