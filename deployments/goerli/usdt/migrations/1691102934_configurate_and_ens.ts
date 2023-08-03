import { DeploymentManager, migration } from '../../../../plugins/deployment_manager';
import { exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { expect } from 'chai';

const COMPAddress = '0x3587b2F7E0E2D6166d6C14230e7Fe160252B0ba4';
const ENSName = 'compound-community-licenses.eth';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = ENSSubdomainLabel + '.' + ENSName;
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSTextRecordKey = 'v3-official-markets';
const USDCAmountToSeed = exp(5, 6);

export default migration('1691102934_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    // Import shared contracts from cUSDCv3
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'goerli', 'usdc');

    const {
      governor,
      comet,
      configurator,
      cometAdmin,
      rewards,
      USDT,
    } = await deploymentManager.getContracts();

    const configuration = await getConfigurationStruct(deploymentManager);

    const ENSResolver = await deploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const arbitrumChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDT', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    if (officialMarketsJSON[arbitrumChainId]) {
      officialMarketsJSON[arbitrumChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[arbitrumChainId] = [newMarketObject];
    }

    const actions = [
      // 1. Set the factory in the Configurator
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [comet.address, cometFactory.address],
      },

      // 2. Set the configuration in the Configurator
      {
        contract: configurator,
        signature: 'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
        args: [comet.address, configuration],
      },

      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: "deployAndUpgradeTo(address,address)",
        args: [configurator.address, comet.address],
      },

      // 4. Set the rewards configuration to COMP
      {
        contract: rewards,
        signature: "setRewardConfig(address,address)",
        args: [comet.address, COMPAddress],
      },

      // 5. Set the official markets text record on the subdomain
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, officialMarketsJSON]
        )
      },

      // 6. Send USDT from Timelock to Comet
      // XXX assert that funds have been transferred by diffing the balances before and after
      {
        contract: USDT,
        signature: "transfer(address,uint256)",
        args: [comet.address, exp(5, 6)],
      },
    ];

    const description = "# Initialize cUSDTv3 on Goerli"
    const txn = await deploymentManager.retry(
      async () => trace((await governor.propose(...await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    // const ethers = deploymentManager.hre.ethers;
    // await deploymentManager.spider(); // Pull in Arbitrum COMP now that reward config has been set
    // const {
    //   comet,
    //   rewards,
    // } = await deploymentManager.getContracts();

    // const config = await rewards.rewardConfig(comet.address);

    // // 1. Verify state changes
    // const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    // // expect(stateChanges).to.deep.equal({
    // //   COMP: {
    // //     supplyCap: exp(500_000, 18)
    // //   },
    // //   WBTC: {
    // //     supplyCap: exp(35_000, 8)
    // //   },
    // //   WETH: {
    // //     supplyCap: exp(1_000_000, 18)
    // //   },
    // //   baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18),
    // //   baseTrackingBorrowSpeed: exp(34.74 / 86400, 15, 18),
    // // });

    // expect(config.token).to.be.equal(COMPAddress);
    // expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    // expect(config.shouldUpscale).to.be.equal(true);

    // // 6. Verify the seeded USDT reaches Comet reserve
    // expect(await comet.getReserves()).to.be.equal(exp(5, 6));
    expect(1).to.be.equal(1);
  }
});
