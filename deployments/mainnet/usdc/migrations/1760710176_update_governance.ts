import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';
import { utils, Contract } from 'ethers';

const GOVERNANCE_PROXY_ADDRESS = '0x309a862bbC1A00e45506cB8A802D1ff10004c8C0';
const GOVERNANCE_PROXY_ADMIN_ADDRESS = '0x725ed7f44f0888aec1b7630ab1acdced91e0591a';
const NEW_GOVERNANCE_IMPLEMENTATION_ADDRESS = '0x943c2789960141Fe8F27f50E1Ceb9Fd8AC63FC4a';

const ADDRESSES_TO_WHITELIST = [
  '0xbbf3f1421D886E9b2c5D716B5192aC998af2012c',
  '0xb06df4dd01a5c5782f360ada9345c87e86adae3d',
  '0xd2A79F263eC55DBC7B724eCc20FC7448D4795a0C',
  '0x3FB19771947072629C8EEE7995a2eF23B72d4C8A',
  '0x0579A616689f7ed748dC07692A3F150D44b0CA09',
  '0x683a4F9915D6216f73d6Df50151725036bD26C02',
  '0xB49f8b8613bE240213C1827e2E576044fFEC7948',
  '0x13BDaE8c5F0fC40231F0E6A4ad70196F59138548',
  '0x070341aA5Ed571f0FB2c4a5641409B1A46b4961b',
  '0x66cD62c6F8A4BB0Cd8720488BCBd1A6221B765F9',
  '0x2B384212EDc04Ae8bB41738D05BA20E33277bf33',
  '0xB933AEe47C438f22DE0747D57fc239FE37878Dd1',
  '0x9aa835bc7b8ce13b9b0c9764a52fbf71ac62ccf1'
];

let previousProposalDetails: any;
let proposalGuardian: any;
let whitelistTimestamp: any;

export default migration('1760710176_update_governance', {
  async prepare() {
    return {};
  },

  async enact(deploymentManager: DeploymentManager) {
    const trace = deploymentManager.tracer();

    const governor = new Contract(
      GOVERNANCE_PROXY_ADDRESS,
      [
        'function propose(address[] targets, uint256[] values, bytes[] calldatas, string description) external returns (uint256)',
        'function proposalDetails(uint256 _proposalId) external view returns (address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash)',
        'function proposalGuardian() external view returns (address)',
        'function whitelistAccountExpirations(address account) external view returns (uint256)',
        'event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 voteStart, uint256 voteEnd, string description)'
      ],
      await deploymentManager.getSigner()
    );

    previousProposalDetails = await governor.proposalDetails(470);
    proposalGuardian = await governor.proposalGuardian();
    whitelistTimestamp = await governor.whitelistAccountExpirations('0xd2A79F263eC55DBC7B724eCc20FC7448D4795a0C');

    const newImplementation = new Contract(
      NEW_GOVERNANCE_IMPLEMENTATION_ADDRESS,
      ['function batchWhitelist(address[] _initProposers) external'],
      await deploymentManager.getSigner()
    );

    const batchWhitelistCalldata = newImplementation.interface.encodeFunctionData(
      'batchWhitelist',
      [ADDRESSES_TO_WHITELIST]
    );

    const upgradeToAndCallCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'bytes'],
      [GOVERNANCE_PROXY_ADDRESS, NEW_GOVERNANCE_IMPLEMENTATION_ADDRESS, batchWhitelistCalldata]
    );

    const mainnetActions = [
      // 1. Upgrade governance implementation and call batchWhitelist
      {
        target: GOVERNANCE_PROXY_ADMIN_ADDRESS,
        signature: 'upgradeAndCall(address,address,bytes)',
        calldata: upgradeToAndCallCalldata,
      },
    ];

    const description = `# Update Governance to a new version

## Proposal summary

This proposal updates current Governance implementation to a new version and whitelists a set of addresses to be allowed proposers.
Detailed explanation of the changes can be found in the [Governance update forum post](https://www.comp.xyz/t/<>) and corresponding [pull request](https://github.com/compound-finance/compound-governance/pull/<>).

### Whitelisted addresses

| Entity Name | Address |
|-------------|---------|
| Proposal Guardian | 0xbbf3f1421D886E9b2c5D716B5192aC998af2012c |
| Compound Foundation | 0xb06df4dd01a5c5782f360ada9345c87e86adae3d |
| WOOF! | 0xd2A79F263eC55DBC7B724eCc20FC7448D4795a0C |
| PGov | 0x3FB19771947072629C8EEE7995a2eF23B72d4C8A |
| Arana | 0x0579A616689f7ed748dC07692A3F150D44b0CA09 |
| Gauntlet | 0x683a4F9915D6216f73d6Df50151725036bD26C02 |
| Avantgarde | 0xB49f8b8613bE240213C1827e2E576044fFEC7948 |
| Michigan Blockchain | 0x13BDaE8c5F0fC40231F0E6A4ad70196F59138548 |
| FranklinDAO | 0x070341aA5Ed571f0FB2c4a5641409B1A46b4961b |
| allthecolors | 0x66cD62c6F8A4BB0Cd8720488BCBd1A6221B765F9 |
| Arr00 | 0x2B384212EDc04Ae8bB41738D05BA20E33277bf33 |
| Wintermute | 0xB933AEe47C438f22DE0747D57fc239FE37878Dd1 |
| a16z | 0x9aa835bc7b8ce13b9b0c9764a52fbf71ac62ccf1 |


## New Governance audit

New Governance implementation has been audited by [<>](<>), report of the audit can be found [here](<>).

## Proposal actions

The first action updates the governance implementation to the new version and whitelists the specified addresses.
`;

    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      )
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const governor = new Contract(
      GOVERNANCE_PROXY_ADDRESS,
      [
        'function getAllowedProposers() external view returns (address[] memory)',
        'function proposalDetails(uint256 _proposalId) external view returns (address[] targets, uint256[] values, bytes[] calldatas, bytes32 descriptionHash)',
        'function proposalGuardian() external view returns (address)',
        'function whitelistAccountExpirations(address account) external view returns (uint256)',
      ],
      await deploymentManager.getSigner()
    );

    const allowedProposers = await governor.getAllowedProposers();
    expect(allowedProposers).to.deep.equal(ADDRESSES_TO_WHITELIST);

    const newProposalDetails = await governor.proposalDetails(470);
    expect(newProposalDetails).to.deep.equal(previousProposalDetails);

    const newProposalGuardian = await governor.proposalGuardian();
    expect(newProposalGuardian).to.equal(proposalGuardian);

    const newWhitelistTimestamp = await governor.whitelistAccountExpirations('0xd2A79F263eC55DBC7B724eCc20FC7448D4795a0C');
    expect(newWhitelistTimestamp).to.equal(whitelistTimestamp);

  },
});