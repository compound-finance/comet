import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { Configurator, CometInterface, CometProxyAdmin, Liquidator, ERC20 } from '../../../../build/types';
import { exp } from '../../../../src/deploy';
import liquidateUnderwaterBorrowers from '../../../../scripts/liquidation_bot/liquidateUnderwaterBorrowers';

interface Vars {};

const COMP_ADDRESS = "0x28a8887d18EE10162a3Df08178803780765D48e2";
// const LIQUIDATOR_ADDRESS = '0x078B0081Ccb87eE603aA37b0F933841938Fd6589';
const LIQUIDATOR_ADDRESS = '0x67D10E35EF2324E3f56625cFD19C35f1B1D36f53';

const MR_LIQUIDATABLE = "0xB1ab544ef623D863e13CCcA340C962626121c0Ef";

const UNISWAP_V3_FACTORY_ADDRESS = '0x1F98431c8aD98523631AE4a59f267346ea31F984';
const WETH9 = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
const SWAP_ROUTER = '0xe592427a0aece92de3edee1f18e0157c05861564';
const RECIPIENT_ADDRESS = '0xe8F0c9059b8Db5B863d48dB8e8C1A09f97D3B991';

export default migration('1660686179_lower_liquidate_collateral_factor', {
  prepare: async (deploymentManager: DeploymentManager) => {
    const comet = await deploymentManager.contract('comet') as CometInterface;
    const configurator = await deploymentManager.contract('configurator') as Configurator;
    const cometAdmin = await deploymentManager.contract('cometAdmin') as CometProxyAdmin;

    const assetInfo = await comet.getAssetInfoByAddress(COMP_ADDRESS);
    console.log(`Original COMP liquidateCollateralFactor:`)
    console.log(assetInfo.liquidateCollateralFactor.toBigInt());

    // await configurator.updateAssetBorrowCollateralFactor(
    //   comet.address,
    //   COMP_ADDRESS,
    //   200000000000000000n
    // );

    // await configurator.updateAssetLiquidateCollateralFactor(
    //   comet.address,
    //   COMP_ADDRESS,
    //   300000000000000000n
    // );

    // console.log("deployAndUpgradeTo");
    // await cometAdmin.deployAndUpgradeTo(configurator.address, comet.address);
    // console.log("deployAndUpgradeTo done");

    const assetInfo0 = await comet.getAssetInfoByAddress(COMP_ADDRESS);
    console.log(`Updated COMP liquidateCollateralFactor:`)
    console.log(assetInfo0.liquidateCollateralFactor.toBigInt());

    return {};
  },

  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    const signer = await deploymentManager.getSigner();
    const comet = await deploymentManager.contract('comet') as CometInterface;

    const USDC = await deploymentManager.existing(
      'USDC',
      '0x740bb13728584d82520eb8b7ab65531e94b18b61'
    ) as ERC20;


    console.log(`await comet.isLiquidatable(): ${await comet.isLiquidatable(MR_LIQUIDATABLE)}`);

    const numAssets = await comet.numAssets();
    const assets = await Promise.all(Array(numAssets).fill(0).map((_, i) => comet.getAssetInfo(i)));

    // const liquidator = await deploymentManager.deploy(
    //   'liquidator',
    //   'liquidator/Liquidator.sol',
    //   [
    //     RECIPIENT_ADDRESS, // _recipient
    //     SWAP_ROUTER, // _swapRouter
    //     comet.address, // _comet
    //     UNISWAP_V3_FACTORY_ADDRESS, // _factory
    //     WETH9, // _WETH9
    //     0, // _liquidationThreshold,
    //     assets.map(a => a.asset), // _assets
    //     assets.map(_a => false), // _lowLiquidityPools
    //     assets.map(_a => 10000), // _poolFees
    //   ]
    // ) as Liquidator;
    // const usdcWhale = '0x4422685ee24df86fa1babc65567cf81dc96df017';

    const liquidator = await deploymentManager.hre.ethers.getContractAt(
      'Liquidator',
      LIQUIDATOR_ADDRESS,
      signer
    ) as Liquidator;

    await liquidateUnderwaterBorrowers(
      comet,
      liquidator,
      signer
    );
  }
});
