import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, proposal } from '../../../../src/deploy';
import { Contract, ethers } from 'ethers';
import { expect } from 'chai';

const FRANCHAISER_FACTORY = '0xE696d89f4F378772f437F01FaaD70240abdf1854';

const chosenAddresses = [
  '0x3FB19771947072629C8EEE7995a2eF23B72d4C8A', // PGov
  '0x070341aA5Ed571f0FB2c4a5641409B1A46b4961b', // Franklin DAO
  '0x0579A616689f7ed748dC07692A3F150D44b0CA09', // Arana Digital
  '0x13BDaE8c5F0fC40231F0E6A4ad70196F59138548', // Michigan Blockchain
  '0x66cD62c6F8A4BB0Cd8720488BCBd1A6221B765F9', // Allthecolors
  '0xB49f8b8613bE240213C1827e2E576044fFEC7948', // Avantgarde Finance
  '0xb35659cbac913D5E4119F2Af47fD490A45e2c826', // Event Horizon
  '0x72C58877ef744b86F6ef416a3bE26Ec19d587708', // sharp
  '0x4f894Bfc9481110278C356adE1473eBe2127Fd3C', // Alpha Growth
];

const amounts = [
  exp(34_450, 18),
  exp(9_999.76, 18),
  exp(50_000, 18),
  exp(29_999.88, 18),
  exp(44_371.81, 18),
  exp(29_999.85, 18),
  exp(50_000, 18),
  exp(1_178.7, 18),
  exp(50_000, 18),
];

const votesBefore: bigint[] = [];

export default migration('1722358576_launch_franchaisers', {
  prepare: async () => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    const {
      governor,
      comptrollerV2,
      COMP,
      timelock
    } = await deploymentManager.getContracts();

    const franchaiserFactory = new Contract(
      FRANCHAISER_FACTORY,
      [
        'function fundMany(address[] calldata delegatees, uint256[] calldata amounts) external returns (address[] memory franchisers)',
        'function getFranchiser(address owner, address delegatee) public view returns (address)',
      ],
      deploymentManager.hre.ethers.provider
    );

    const totalAmount = amounts.reduce((accumulator, currentValue) => accumulator + currentValue, 0n);

    const actions = [
      // 1. Transfer COMP
      {
        contract: comptrollerV2,
        signature: '_grantComp(address,uint256)',
        args: [timelock.address, totalAmount],
      },
      // 2. Approve FranchaiserFactory
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [FRANCHAISER_FACTORY, totalAmount],
      },
      // 3. Fund many
      {
        contract: franchaiserFactory,
        signature: 'fundMany(address[],uint256[])',
        args: [chosenAddresses, amounts],
      },
    ];
    const description = 'DESCRIPTION';

    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    for (let i = 0; i < chosenAddresses.length; i++) {
      votesBefore.push(await COMP.getCurrentVotes(
        chosenAddresses[i]
      ));
    }

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const {
      COMP,
    } = await deploymentManager.getContracts();

    const franchaiserFactory = new Contract(
      FRANCHAISER_FACTORY,
      [
        'function fundMany(address[] calldata delegatees, uint256[] calldata amounts) external returns(address[] memory franchisers)',
        'function getFranchiser(address,address) external view returns(address)',
      ],
      deploymentManager.hre.ethers.provider
    );
    const totalAmount = amounts.reduce((accumulator, currentValue) => accumulator + currentValue, 0n);
    expect(totalAmount).to.be.equal(exp(300_000, 18));

    for (let i = 0; i < chosenAddresses.length; i++) {
      const franchaiserAddress = await deploymentManager.retry(
        async () => await franchaiserFactory.getFranchiser('0x6d903f6003cca6255D85CcA4D3B5E5146dC33925', chosenAddresses[i])
      );
      expect(franchaiserAddress).to.be.not.equal(ethers.constants.AddressZero);
      expect(await COMP.balanceOf(franchaiserAddress)).to.be.equal(amounts[i]);
      expect(
        await COMP.getCurrentVotes(
          chosenAddresses[i]
        )
      ).to.be.equal(ethers.BigNumber.from(votesBefore[i]).add(amounts[i]));
    }

  },
});
