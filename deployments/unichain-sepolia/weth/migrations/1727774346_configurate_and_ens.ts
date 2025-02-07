import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  calldata,
  exp,
  getConfigurationStruct,
  testnetProposal,
} from '../../../../src/deploy';
import { expect } from 'chai';
import { Contract, utils } from 'ethers';

const sepoliaCOMP = '0xD3A6Ffc1fc9e7e4f34eD15Fb7Dd04102AC3470A2';

const COMPAmountToBridge = exp(3_600, 18);
const WETHAmountToSeed = exp(0.001, 18);

export default migration('1727774346_configurate_and_ens', {
  prepare: async () => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      COMP,
      WETH,
      timelock,
    } =
      await deploymentManager.getContracts();

    const {
      unichainSepoliaL1CrossDomainMessenger,
      unichainSepoliaL1StandardBridge,
      governor,
    } = await govDeploymentManager.getContracts();


    const configuration = await getConfigurationStruct(deploymentManager);

    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(
        comet.address,
        configuration
      )
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, COMP.address]
    );

    const sweepNativeTokenCalldata = await calldata(
      bridgeReceiver.populateTransaction.sweepNativeToken(timelock.address)
    );
    const transferCalldata = await calldata(
      WETH.populateTransaction.transfer(comet.address, WETHAmountToSeed)
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address,
          rewards.address,
          bridgeReceiver.address,
          WETH.address,
          WETH.address,
        ],
        [
          0,
          0,
          0,
          0,
          WETHAmountToSeed,
          0,
        ],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
          'sweepNativeToken(address)',
          'deposit()',
          'transfer(address,uint256)',
        ],
        [
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
          sweepNativeTokenCalldata,
          '0x',
          transferCalldata,
        ],
      ]
    );

    const actions = [
      // 1. Bridge ETH from Ethereum to unichain sepolia Rewards using L1StandardBridge
      {
        contract: unichainSepoliaL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'bridgeETHTo(address,uint32,bytes)',
        args: [
          bridgeReceiver.address,
          200_000,
          '0x',
        ],
        value: WETHAmountToSeed,
      },
      // 2. Approve Ethereum's L1StandardBridge to take Timelock's COMP (for bridging)
      {
        target: sepoliaCOMP,
        signature: 'approve(address,uint256)',
        calldata: utils.defaultAbiCoder.encode(
          ['address', 'uint256'],
          [unichainSepoliaL1StandardBridge.address, COMPAmountToBridge],
        ),
      },
      // 3. Bridge COMP from Ethereum to unichain sepolia Rewards using L1StandardBridge
      {
        contract: unichainSepoliaL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [
          sepoliaCOMP,
          COMP.address,
          rewards.address,
          COMPAmountToBridge,
          200_000,
          '0x',
        ],
        value: 0,
      },
      // 2. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on unichain sepolia.
      {
        contract: unichainSepoliaL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 5_500_000],
        value: 0,
      },
    ];

    const description = `DESCRIPTION`;
    const testnetGovernor = new Contract(
      governor.address, [
        'function propose(address[] memory targets, uint256[] memory values, string[] memory signatures, bytes[] memory calldatas, string memory description) external returns (uint256 proposalId)',
        'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)'
      ], governor.signer
    );
    const txn = await(await testnetGovernor.propose(...(await testnetProposal(actions, description)))).wait();

    const event = txn.events.find((event) => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(
    deploymentManager: DeploymentManager,
    _,
    __
  ) {
    const { comet, rewards, WETH, COMP } = await deploymentManager.getContracts();
    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await WETH.balanceOf(comet.address)).to.be.equal(WETHAmountToSeed);

    // 4. & 5.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(3_600, 18));
  },
});
