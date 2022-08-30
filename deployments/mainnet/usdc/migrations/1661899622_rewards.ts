import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, debug, exp, proposal } from '../../../../src/deploy';

const comptrollerAddress = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';
const cETHAddress = '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5';
const cCOMPAddress = '0x70e36f6bf80a52b3b46b3af8e106cc0ed743e8e4';
const cLINKAddress = '0xface851a4921ce59e912d19329929ce6da6eb0c7';
const cUNIAddress = '0x35a18000230da775cac24873d00ff85bccded550';
const cWBTC2Address = '0xccF4429DB6322D5C611ee964527D42E5d685DD6a';

export default migration('1661899622_rewards', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
      COMP,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Set v2 collateral asset speeds to 0
      {
        target: comptrollerAddress,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['address[]', 'uint[]', 'uint[]'],
          [
            [cETHAddress, cCOMPAddress, cLINKAddress, cUNIAddress, cWBTC2Address],
            [0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0],
          ],
        ),
      },

      // 2. Increase borrow reward speed
      {
        contract: configurator,
        signature: 'setBaseTrackingBorrowSpeed(address,uint64)',
        args: [comet.address, exp(177.58 / 86400, 15)], // ~ 177.58 COMP / day cut from v2
      },

      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },

      // 4. Transfer COMP
      {
        target: comptrollerAddress,
        signature: '_grantComp(address,uint256)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['address', 'uint'],
          [rewards.address, exp(25_000, 18)],
        ),
      },
    ];
    const description = "# Migrate some v2 COMP rewards to v3";
    const txn = await deploymentManager.retry(
      async () => (await governor.propose(...await proposal(actions, description))).wait()
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    debug(`Created proposal ${proposalId}.`);
  }
});
