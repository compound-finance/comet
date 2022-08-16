import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { Configurator, CometInterface, CometProxyAdmin } from '../../../../build/types';
import { exp } from '../../../../src/deploy';

interface Vars {};

const COMP_ADDRESS = "0x28a8887d18EE10162a3Df08178803780765D48e2";

export default migration('1660686179_lower_liquidate_collateral_factor', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const comet = await deploymentManager.contract('comet') as CometInterface;
    const configurator = await deploymentManager.contract('configurator') as Configurator;
    const cometAdmin = await deploymentManager.contract('cometAdmin') as CometProxyAdmin;

    const assetInfo = await comet.getAssetInfoByAddress(COMP_ADDRESS);
    console.log(`Original COMP liquidateCollateralFactor:`)
    console.log(assetInfo.liquidateCollateralFactor.toBigInt());

    await configurator.updateAssetLiquidateCollateralFactor(
      comet.address,
      COMP_ADDRESS,
      300000000000000000n
    );

    console.log("deployAndUpgradeTo");
    await cometAdmin.deployAndUpgradeTo(configurator.address, comet.address);
    console.log("deployAndUpgradeTo done");

    const assetInfo0 = await comet.getAssetInfoByAddress(COMP_ADDRESS);
    console.log(`Updated COMP liquidateCollateralFactor:`)
    console.log(assetInfo0.liquidateCollateralFactor.toBigInt());

    return {};
  },

  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    // No governance changes
  }
});
