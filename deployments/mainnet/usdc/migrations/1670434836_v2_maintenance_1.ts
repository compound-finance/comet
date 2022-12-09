import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const UINT256_MAX = (2n ** 256n) - 1n;
const cREPAddress = '0x158079ee67fce2f58472a96584a73c7ab9ac95c1';
const cWBTCAddress = '0xC11b1268C1A384e55C48c2391d8d480264A3A7F4';
const cFEIAddress = '0x7713DD9Ca933848F6819F38B8352D9A15EA73F67';
const cSAIAddress = '0xF5DCe57282A584D2746FaF1593d3121Fcac444dC';
const cDAIAddress = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const cUNIAddress = '0x35a18000230da775cac24873d00ff85bccded550';
const DAIAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const UNIAddress = '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984';
const SAIAddress = '0x89d24a6b4ccb1b6faa2625fe562bdd9a23260359';
const SAITapAddress = '0xBda109309f9FafA6Dd6A9CB9f1Df4085B27Ee8eF';
const REPAddress = '0x1985365e9f78359a9B6AD760e32412f4a445E862';
const REP2Address = '0x221657776846890989a759ba2973e427dff5c9bb';

export default migration('1670434836_v2_maintenance_1', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comptrollerV2,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1-4. Withdraw legacy / deprecated market reserves
      {
        target: cREPAddress,
        signature: '_reduceReserves(uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['uint256'], [515499155166335008592n]),
      },

      {
        target: cWBTCAddress,
        signature: '_reduceReserves(uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['uint256'], [708880250n]),
      },

      {
        target: cFEIAddress,
        signature: '_reduceReserves(uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['uint256'], [6324340499474616104642n]),
      },

      {
        target: cSAIAddress,
        signature: '_reduceReserves(uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['uint256'], [26684572352947457780274n]),
      },

      // 5-6. Redeem Timelock's DAI and UNI
      {
        target: cDAIAddress,
        signature: 'redeem(uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['uint256'], [3347050774458n]),
      },

      {
        target: cUNIAddress,
        signature: 'redeem(uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['uint256'], [9087425872149n]),
      },

      // 7-8. Approve and tap SAI
      {
        target: SAIAddress,
        signature: 'approve(address,uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [SAITapAddress, UINT256_MAX]),
      },

      {
        target: SAITapAddress,
        signature: 'cash(uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['uint256'], [26855744800384711915777n]),
      },

      // 9-10. Approve and migrate REP
      {
        target: REPAddress,
        signature: 'approve(address,uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [REP2Address, UINT256_MAX]),
      },

      {
        target: REP2Address,
        signature: 'migrateFromLegacyReputationToken()',
        calldata: '0x',
      },
    ];
    const description = "# Reserve Maintenance\n\n## Summary\n\nThis proposal is a series of minor maintenance actions from the list of [Protocol Maintenance Tasks](https://www.comp.xyz/t/protocol-maintenance-tasks/3824), to withdraw the reserves of deprecated markets and residual cToken balances to the governance-controlled Timelock, and migrate deprecated assets (SAI and REP).\n\nThis proposal makes no opinion of how reserves are used; it reduces technical risk, and streamlines future governance operations.\n\n## Proposal Actions\n\nFirst, the proposal withdraws the reserves of deprecated markets: SAI, REP, FEI, and WBTC (legacy) to the Timelock, in four actions.\n\nNext, the proposal redeems the Timelock\u2019s cDAI and cUNI for DAI and UNI in two actions.\n\nThen, the proposal redeems the balance of SAI held by the Timelock for WETH through MakerDAO\u2019s SaiTap contract, by calling approve and then redeeming.\n\nLast, the proposal migrates the balance of REP held by the Timelock to REPv2, by calling approve and then migrating.";
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      timelock,
      WETH,
    } = await deploymentManager.getContracts();

    // 1-4.
    const cREP = await deploymentManager.existing('cREP', cREPAddress);
    expect(await cREP.totalReserves()).to.be.lessThan(exp(1, 18));

    const cWBTC = await deploymentManager.existing('cWBTC', cWBTCAddress);
    expect(await cWBTC.totalReserves()).to.be.lessThan(exp(0.1, 8));

    const cFEI = await deploymentManager.existing('cFEI', cFEIAddress);
    expect(await cREP.totalReserves()).to.be.lessThan(exp(1, 18));

    const cSAI = await deploymentManager.existing('cSAI', cSAIAddress);
    expect(await cREP.totalReserves()).to.be.lessThan(exp(1, 18));

    // 5-6.
    const DAI = await deploymentManager.existing('DAI', DAIAddress);
    expect(await DAI.balanceOf(timelock.address)).to.be.greaterThan(740319959153319310324n);

    const UNI = await deploymentManager.existing('UNI', UNIAddress);
    expect(await UNI.balanceOf(timelock.address)).to.be.greaterThan(2245088443341720357791n);

    // 7-8.
    expect(await WETH.balanceOf(timelock.address)).to.be.greaterThan(exp(140, 18));

    // 9-10.
    const REP2 = await deploymentManager.existing('REP2', REP2Address);
    expect(await REP2.balanceOf(timelock.address)).to.be.greaterThan(exp(515, 18));
},
});
