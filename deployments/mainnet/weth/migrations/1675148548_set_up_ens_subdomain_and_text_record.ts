import { expect } from 'chai';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';

interface Vars {}

const ENSName = 'compound-community-licenses.eth';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = ENSSubdomainLabel + '.' + ENSName;
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const textRecordKey = 'v3-official-markets';
// JSON string of official markets
const officialMarketsJSON = JSON.stringify({
  1: [
    {
      baseSymbol: 'USDC',
      cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
    },
    {
      baseSymbol: 'WETH',
      cometAddress: '0xA17581A9E3356d9A858b789D68B4d866e593aE94'
    }
  ]
});

export default migration('1675148548_set_up_ens_subdomain_and_text_record', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, vars: Vars) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;

    const { timelock, governor } = await deploymentManager.getContracts();

    // Namehash explanation: https://docs.ens.domains/contract-api-reference/name-processing
    const nameHash = ethers.utils.namehash(ENSName);
    const labelHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(ENSSubdomainLabel));
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);

    const actions = [
      // 1. Set up 'v3-additional-grants.compound-community-licenses.eth' ENS subdomain with the Timelock as the owner
      {
        target: ENSRegistryAddress,
        signature: 'setSubnodeRecord(bytes32,bytes32,address,address,uint64)',
        // setSubnodeRecord(bytes32 node, bytes32 label, address owner, address resolver, uint64 ttl)
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'address', 'address', 'uint64'],
          [nameHash, labelHash, timelock.address, ENSResolverAddress, 0]
        )
      },

      // 2. Set the official markets text record on the subdomain
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, textRecordKey, officialMarketsJSON]
        )
      }
    ];
    const description = "# Initialize ENS subdomain for official Comet deployments\n\n## Explanation\n\nWith two active Compound III markets (cUSDCv3 and cWETHv3) now on Ethereum mainnet, and with the first multi-chain deployment(s) right around the corner, now is a good time to initialize the ENS subdomain referenced by the Compound III license. Further explanation can be found on [this forum post](https://www.comp.xyz/t/ens-text-records-for-community-sanctioned-deployments).\n\nThe format for TXT records on this subdomain can be augmented over time. This proposal includes only the bare minimum required to bootstrap an official on-chain list of Compound III markets. Future deployment proposals should include an action to update this ENS record, to reflect adoption by governance.\n\n## Proposal\n\nThe proposal itself is to be made from [this pull request](https://github.com/compound-finance/comet/pull/671). \n\nThe first action establishes the `v3-additional-grants.compound-community-licenses.eth` ENS subdomain with the Timelock as the owner.\n\nThe second action creates a TXT record on the subdomain containing the cUSDCv3 and cWETHv3 market addresses.\n";
    const txn = await deploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager) {
    const ethers = deploymentManager.hre.ethers;

    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress);
    const ENSRegistry = await deploymentManager.existing('ENSRegistry', ENSRegistryAddress);

    const { timelock } = await deploymentManager.getContracts();

    const nameHash = ethers.utils.namehash(ENSName);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);

    // 1.
    expect(await ENSRegistry.recordExists(subdomainHash)).to.be.equal(true);
    expect(await ENSRegistry.owner(subdomainHash)).to.be.equal(timelock.address);
    expect(await ENSRegistry.resolver(subdomainHash)).to.be.equal(ENSResolverAddress);
    expect(await ENSRegistry.ttl(subdomainHash)).to.be.equal(0);

    // 2.
    expect(await ENSResolver.text(subdomainHash, textRecordKey)).to.be.equal(officialMarketsJSON);
    expect(await ENSResolver.text(nameHash, textRecordKey)).to.be.equal('');
  }
});
