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
    const description = '# Finalize Delegate Race (Cycle 1)\n\n## Summary:\n\nThe Compound Governance Support Working Group (GSWG)  introduced the DAO’s first delegate race in July to increase the robustness of the DAO’s delegate base. This onchian proposal is the final step for ratifying delegation to the 8 entities/individuals that received the highest number of points during the application process. If this proposal passes, 8 Franchiser contracts will be created by the already deployed and audited FranchiserFactory contract, ownership of the FranchiserFactory will be set to the timelock, and each individual Franchiser will allocate the appropriate amount of voting power to the delegates’ addresses. A total of 250k COMP will be delegated from the Comptroller to the elected delegates. This vote also includes 50k COMP in delegation to Alpha Growth since their team did not receive delegation from a previously passed proposal due to a lack of the stated Franchiser infrastructure. Hence, the total number of Franchisers will amount to 9, and the delegated COMP will amount to 300k.\n\n## Proposal Motivation:\n\nDespite Compound being one of the most prominent DeFi protocols, this stature unfortunately does not translate into active governance participation. Many top delegates with considerable voting power have less than 50% vote participation rate–and many even sit under 10%. In healthy governance environments, proactive delegates wield significant voting power, ensuring malicious votes are prevented and quorum requirements are met. This is especially vital for lending markets with a high degree of reliance on governance, requiring delegates to be consistently available, often voting on numerous proposals over the course of a single week. The recent governance attack also illustrated the importance of allocating more voting power to community-trusted delegates.\n\nMost DAOs have dormant native tokens present in their treasury. If these native tokens aren’t already being allocated to active initiatives, they can be put to good use elsewhere. There is minimal risk to setting aside a pocket of these dormant funds to ensure better governance participation in a manner where governance can recall the tokens back to the community treasury. The most straightforward means by which these tokens can be mobilized is by delegating a portion of them to either existing or new delegates.\n\nFor sourcing the votes, we can reference Compound’s [Comptroller](https://etherscan.io/address/0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b):\n\n\t- Address: 0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B\n\t- As of August 20, 2024 the address held 1,578,587.6 COMP tokens\n\t- Dormant capital from this address can be mobilized for delegation\n\nIt is important to establish a structure that will enable the DAO to sustain control and ownership of these funds, however. In other words, if the DAO would like to clawback funds at any point, either to use the tokens for alternative purposes, or to rescind a particular wallet’s voting power, it should be able to do so seamlessly. The advantage of this setup is that the DAO’s COMP tokens never leave the community’s control and can be relocated when needed at any time.\n\n## More details on the implementation:\n\nThis proposal will delegate voting power to the 8 applicants using the deployed [FranchiserFactory](https://etherscan.io/address/0xE696d89f4F378772f437F01FaaD70240abdf1854), which is responsible for creating Franchiser contracts. The Franchiser contracts have already been [audited by OpenZeppelin](https://forum.arbitrum.foundation/t/event-horizon-franchiser-contract-audit/25738). Individual Franchiser contracts are used to delegate COMP tokens to noted addresses, and the FranchiserFactory has the ability to clawback the voting power if it decides. Ownership of the FranchiserFactory will be given to the Compound timelock, effectively enabling the DAO to give or take voting power from elected delegates. Hence, revoking voting power once it has been granted to the given addresses requires a typical onchain governance vote.\n\n## Delegate Race Outcome:\n\nThe GSWG created a [points system](https://www.comp.xyz/t/compound-delegate-race/5460) to decide how points would be given to delegates. This setup weighted heavily on a wallet’s voting participation rate–and also rewarded those who authored and sponsored previous proposals, as well as attended community calls. A week-long [application process](https://www.comp.xyz/t/compound-delegate-race-application/5521) followed, with 18 groups and individuals applying for delegation. Up to 50k COMP delegation for each applicant was given–unless that address hit 80k COMP in total delegation, at which point, the upper threshold for voting power was capped. This process was conducted until the 250l allocation was fully used. There was a tie breaker between four candidates, and votes were allocated based on which candidate had the oldest active delegate address.\n\nBelow are the final candidates, along with their assigned votes and voting addresses.\n\n\n### Candidate: PGov\n\t- Points Scored: 10\n\t- Assigned Votes: 34,450.00\n\t- Voting Power Final: 80,000.00\n\t- Address: 0x3FB19771947072629C8EEE7995a2eF23B72d4C8A\n\n### Candidate: Franklin DAO\n\t- Points Scored: 9\n\t- Assigned Votes: 9,999.76\n\t- Voting Power Final: 80,000.00\n\t- Address: 0x070341aA5Ed571f0FB2c4a5641409B1A46b4961b\n\n### Candidate: Arana Digital\n\t- Points Scored: 9\n\t- Assigned Votes: 50,000.00\n\t- Voting Power Final: 50,001.00\n\t- Address: 0x0579A616689f7ed748dC07692A3F150D44b0CA09\n\n### Candidate: Michigan Blockchain\n\t- Points Scored: 8\n\t- Assigned Votes: 29,999.88\n\t- Voting Power Final: 80,000.00\n\t- Address: 0x13BDaE8c5F0fC40231F0E6A4ad70196F59138548\n\n### Candidate: Allthecolors\n\t- Points Scored: 6\n\t- Assigned Votes: 44,371.81\n\t- Voting Power Final: 80,000.00\n\t- Address: 0x66cD62c6F8A4BB0Cd8720488BCBd1A6221B765F9\n\n### Candidate: Avantgarde Finance\n\t- Points Scored: 6\n\t- Assigned Votes: 29,999.85\n\t- Voting Power Final: 80,000.00\n\t- Address: 0xB49f8b8613bE240213C1827e2E576044fFEC7948\n\n### Candidate: Event Horizon\n\t- Points Scored: 6\n\t- Assigned Votes: 50,000.00\n\t- Voting Power Final: 54,588.74\n\t- Address: 0xb35659cbac913D5E4119F2Af47fD490A45e2c826\n\n### Candidate: Sharp\n\t- Points Scored: 6\n\t- Assigned Votes: 1,178.70\n\t- Voting Power Final: 1,190.67\n\t- Address: 0x72C58877ef744b86F6ef416a3bE26Ec19d587708';

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

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
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
