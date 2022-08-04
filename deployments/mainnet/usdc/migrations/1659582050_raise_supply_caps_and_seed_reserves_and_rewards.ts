import { CometInterface, CometProxyAdmin, CometRewards, Configurator, ERC20, GovernorSimple, IGovernorBravo, ProxyAdmin, SimpleTimelock } from '../../../../build/types';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { debug } from '../../../../plugins/deployment_manager/Utils';
import { extractCalldata } from '../../../../src/utils';
import { exp } from '../../../../test/helpers';


interface Vars { };

export default migration('1659582050_raise_supply_caps_and_seed_reserves_and_rewards', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    const { ethers } = deploymentManager.hre;

    // XXX this only has the ABI for the governor proxy
    const govProxy = await deploymentManager.contract('governor');
    const governor = await ethers.getContractAt(
      'IGovernorBravo',
      govProxy.address,
    ) as IGovernorBravo;
    const comet = await deploymentManager.contract('comet') as CometInterface;
    const configurator = await deploymentManager.contract('configurator') as Configurator;
    const proxyAdmin = await deploymentManager.contract('cometAdmin') as CometProxyAdmin;
    const rewards = await deploymentManager.contract('rewards') as CometRewards;
    const USDC = await deploymentManager.contract('USDC') as ERC20;
    const COMP = await deploymentManager.contract('COMP') as ERC20;
    const WBTC = await deploymentManager.contract('WBTC') as ERC20;
    const WETH = await deploymentManager.contract('WETH') as ERC20;
    const UNI = await deploymentManager.contract('UNI') as ERC20;
    const LINK = await deploymentManager.contract('LINK') as ERC20;

    // XXX assert supply caps are currently 0

    // Steps:
    // 1. Increase supply caps for each of the assets
    // 2. Increase borrow reward speed
    // 3. Deploy and upgrade to a new version of Comet
    // XXX these supply caps might be a bit too high
    const updateCOMPSupplyCapCalldata = extractCalldata((await configurator.populateTransaction.updateAssetSupplyCap(comet.address, COMP.address, exp(50_0000, 18))).data);
    const updateWBTCSupplyCapCalldata = extractCalldata((await configurator.populateTransaction.updateAssetSupplyCap(comet.address, WBTC.address, exp(35_000, 8))).data);
    const updateWETHSupplyCapCalldata = extractCalldata((await configurator.populateTransaction.updateAssetSupplyCap(comet.address, WETH.address, exp(1_000_000, 18))).data);
    const updateUNISupplyCapCalldata = extractCalldata((await configurator.populateTransaction.updateAssetSupplyCap(comet.address, UNI.address, exp(50_000_000, 18))).data);
    const updateLINKSupplyCapCalldata = extractCalldata((await configurator.populateTransaction.updateAssetSupplyCap(comet.address, LINK.address, exp(50_000_000, 18))).data);
    // 50 COMP/day
    const setBorrowSpeedCalldata = extractCalldata((await configurator.populateTransaction.setBaseTrackingBorrowSpeed(comet.address, exp(0.000578703703703703703, 15))).data);
    const deployAndUpgradeToCalldata = extractCalldata((await proxyAdmin.populateTransaction.deployAndUpgradeTo(configurator.address, comet.address)).data);

    // 4. Send some USDC from Timelock to Comet
    // XXX assert that funds have been transferred by diffing the balances before and after
    const sendUSDCToCometCalldata = extractCalldata((await USDC.populateTransaction.transfer(comet.address, exp(500_000, 6))).data)

    // 5. Stream COMP
    // Streaming COMP speed = (COMP/year) / (seconds in a year / avg. block time)
    // (50 * 365) * 13.5 / 3.154e7 = 0.0078115 COMP per block
    const comptrollerAddress = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';
    const streamCOMPCalldata = ethers.utils.defaultAbiCoder.encode(['address', 'uint'], [rewards.address, exp(0.0078115, 18)]);

    const txn = await deploymentManager.asyncCallWithRetry(
      async (signer_) => (await governor.connect(signer_).propose(
        [
          // 1,2,3
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          configurator.address,
          proxyAdmin.address,
          // 4
          USDC.address,
          // 5
          comptrollerAddress
        ],
        [
          // 1,2,3
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          // 4
          0,
          // 5
          0,
        ],
        [
          // 1,2,3
          "updateAssetSupplyCap(address,address,uint128)",
          "updateAssetSupplyCap(address,address,uint128)",
          "updateAssetSupplyCap(address,address,uint128)",
          "updateAssetSupplyCap(address,address,uint128)",
          "updateAssetSupplyCap(address,address,uint128)",
          "setBaseTrackingBorrowSpeed(address,uint64)",
          "deployAndUpgradeTo(address,address)",
          // 4
          "transfer(address,uint256)",
          // 5
          "_setContributorCompSpeed(address,uint256)"
        ],
        [
          // 1,2,3
          updateCOMPSupplyCapCalldata,
          updateWBTCSupplyCapCalldata,
          updateWETHSupplyCapCalldata,
          updateUNISupplyCapCalldata,
          updateLINKSupplyCapCalldata,
          setBorrowSpeedCalldata,
          deployAndUpgradeToCalldata,
          // 4
          sendUSDCToCometCalldata,
          // 5
          streamCOMPCalldata,
        ],
        'Increase supply caps and borrow speed, seed Comet USDC reserves from Timelock, and stream COMP to CometRewards')
      ).wait()
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    debug(`Created proposal ${proposalId}.`);
  }
});
