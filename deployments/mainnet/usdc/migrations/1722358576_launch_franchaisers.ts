import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, proposal } from '../../../../src/deploy';
import { Contract, ethers } from 'ethers';
import { expect } from 'chai';

const FRANCHAISER_FACTORY = '0xcd94088b74391dc0a22f0a9611a66dc44f70da72';

const chosenAddresses = [
  '0x4Ac0Dbce527bcb60787CEF10053348B146C6b5e3',
  '0xE13C54214267675428Adf7E0af9DA433F5Ead460',
  '0xb55a948763e0d386b6dEfcD8070a522216AE42b1',
  '0x3FB19771947072629C8EEE7995a2eF23B72d4C8A',
  '0x7B3c54e17d618CC94daDFe7671c1e2F50C4Ecc33',
];

const amounts = [
  exp(5_000, 18),
  exp(10_000, 18),
  exp(15_000, 18),
  exp(20_000, 18),
  exp(25_000, 18),
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
      ethers.getDefaultProvider(1)
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
      ethers.getDefaultProvider(1)
    );

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
