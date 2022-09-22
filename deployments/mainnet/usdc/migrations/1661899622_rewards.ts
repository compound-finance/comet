import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { calldata, exp, proposal } from '../../../../src/deploy';

import { expect } from 'chai';

const cETHAddress = '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5';
const cBATAddress = '0x6C8c6b02E7b2BE14d4fA6022Dfd6d75921D90E4E';
const cCOMPAddress = '0x70e36f6bf80a52b3b46b3af8e106cc0ed743e8e4';
const cLINKAddress = '0xface851a4921ce59e912d19329929ce6da6eb0c7';
const cUNIAddress = '0x35a18000230da775cac24873d00ff85bccded550';
const cWBTC2Address = '0xccF4429DB6322D5C611ee964527D42E5d685DD6a';
const cZRXAddress = '0xB3319f5D18Bc0D84dD1b4825Dcde5d5f7266d407';

export default migration('1661899622_rewards', {
  async prepare(deploymentManager: DeploymentManager) {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const {
      governor,
      comptrollerV2,
      comet,
      configurator,
      cometAdmin,
      rewards,
      COMP,
    } = await deploymentManager.getContracts();

    const actions = [
      // 1. Set v2 collateral asset speeds to 0
      {
        contract: comptrollerV2,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        args: [
          [cETHAddress, cBATAddress, cCOMPAddress, cLINKAddress, cUNIAddress, cWBTC2Address, cZRXAddress],
          [exp(5.375, 15), 0, 0, 0, 0, 0, 0],
          [0, 0, 0, 0, 0, 0, 0],
        ],
      },

      // 2. Increase borrow reward speed
      {
        contract: configurator,
        signature: 'setBaseTrackingBorrowSpeed(address,uint64)',
        args: [comet.address, exp(161.42 / 86400, 15, 18)], // ~ 161.42 COMP / day cut from v2
      },

      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, comet.address],
      },

      // 4. Transfer COMP
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [rewards.address, exp(25_000, 18)],
      },
    ];
    const description = "# Initialize Compound III COMP Distribution\nThis proposal includes Compound III users in the [COMP Distribution](https://compound.finance/governance/comp), which is accomplished by re-allocating 161.42 COMP per day (14.17% of the total) from v2 markets. The total COMP Distribution is unchanged by this proposal.\n\n- ETH borrowers: -35.31\n- WBTC suppliers and borrowers: -70.63\n- LINK suppliers and borrowers: -9.60\n- UNI suppliers and borrowers: -9.60\n- COMP suppliers: -16.42\n- BAT suppliers and borrowers: -9.60\n- ZRX suppliers and borrowers: -9.60\n- Compound III USDC: +161.42\n\nLastly, 25,000 COMP are transferred from the Comptroller to the Compound III Rewards contract. Based on the parameters set earlier, this equals 154 days of distribution before governance would need to replenish or modify the distribution to Compound III users.\n\nIf successful, this proposal will take effect after Proposal 119 cures the Compound v2 price feed, and prior to the Merge.\n\n[Full proposal and forum discussion](https://www.comp.xyz/t/initialize-compound-iii-usdc-on-ethereum/3499/5)\n";
    const txn = await deploymentManager.retry(
      async () => governor.propose(...await proposal(actions, description))
    );
    trace(txn);

    const event = (await txn.wait()).events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      governor,
      comptrollerV2,
      comet,
      configurator,
      rewards,
      COMP,
    } = await deploymentManager.getContracts();

    // 1.
    expect(await comptrollerV2.compSupplySpeeds(cETHAddress)).to.be.equal(5375000000000000);
    expect(await comptrollerV2.compBorrowSpeeds(cETHAddress)).to.be.equal(0);
    expect(await comptrollerV2.compSupplySpeeds(cBATAddress)).to.be.equal(0);
    expect(await comptrollerV2.compBorrowSpeeds(cBATAddress)).to.be.equal(0);
    expect(await comptrollerV2.compSupplySpeeds(cCOMPAddress)).to.be.equal(0);
    expect(await comptrollerV2.compBorrowSpeeds(cCOMPAddress)).to.be.equal(0);
    expect(await comptrollerV2.compSupplySpeeds(cLINKAddress)).to.be.equal(0);
    expect(await comptrollerV2.compBorrowSpeeds(cLINKAddress)).to.be.equal(0);
    expect(await comptrollerV2.compSupplySpeeds(cUNIAddress)).to.be.equal(0);
    expect(await comptrollerV2.compBorrowSpeeds(cUNIAddress)).to.be.equal(0);
    expect(await comptrollerV2.compSupplySpeeds(cWBTC2Address)).to.be.equal(0);
    expect(await comptrollerV2.compBorrowSpeeds(cWBTC2Address)).to.be.equal(0);
    expect(await comptrollerV2.compSupplySpeeds(cZRXAddress)).to.be.equal(0);
    expect(await comptrollerV2.compBorrowSpeeds(cZRXAddress)).to.be.equal(0);

    // 2. & 3.
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(0);
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(1868287037037n);

    // 4.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(25_000, 18));
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },
});
