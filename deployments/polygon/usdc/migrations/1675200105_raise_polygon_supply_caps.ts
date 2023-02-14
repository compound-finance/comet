import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const ERC20PredicateAddress = '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf';
const RootChainManagerAddress = '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77';

export default migration('1675200105_raise_polygon_supply_caps', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    governanceDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const { fxRoot, governor, USDC } = await governanceDeploymentManager.getContracts();

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      WBTC,
      WETH,
      WMATIC
    } = await deploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);

    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)'
        ],
        [setConfigurationCalldata, deployAndUpgradeToCalldata]
      ]
    );

    const RootChainManager = await deploymentManager.existing(
      'RootChainManager',
      RootChainManagerAddress
    );
    const usdcAmountToBridge = exp(100_000, 6);
    const depositData = utils.defaultAbiCoder.encode(['uint256'], [usdcAmountToBridge]);
    const depositForCalldata = utils.defaultAbiCoder.encode(['address','address','bytes'], [comet.address, USDC.address, depositData]);

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData]
      },
      // 2. Approve Polygon's ERC20Predicate to take Timelock's USDC (for bridging)
      {
        contract: USDC,
        signature: 'approve(address,uint256)',
        args: [ERC20PredicateAddress, usdcAmountToBridge]
      },
      // 3. Bridge USDC from mainnet to Polygon Comet using RootChainManager
      {
        target: RootChainManager.address,
        signature: 'depositFor(address,address,bytes)',
        calldata: depositForCalldata
      }
    ];

    const description = ''; // XXX add description
    const txn = await governanceDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const { comet, WBTC, WETH, WMATIC } = await deploymentManager.getContracts();

    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);
    const wmaticInfo = await comet.getAssetInfoByAddress(WMATIC.address);

    // 1.
    expect(await wbtcInfo.supplyCap).to.be.eq(exp(10_000, 8));
    expect(await wethInfo.supplyCap).to.be.eq(exp(10_000, 18));
    expect(await wmaticInfo.supplyCap).to.be.eq(exp(10_000, 18));

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(exp(100_000, 6));
  }
});
