import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import {
  diffState,
  getCometConfig,
} from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const opCOMPAddress = '0x6AF3cb766D6cd37449bfD321D961A61B0515c1BC';

export default migration('1707403494_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager
  ) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const cometFactory = await deploymentManager.fromDep(
      'cometFactory',
      'optimism-goerli',
      'usdc'
    );
    const {
      bridgeReceiver,
      timelock: localTimelock,
      comet,
      cometAdmin,
      configurator,
      rewards,
      WETH,
    } = await deploymentManager.getContracts();

    const {
      opL1CrossDomainMessenger,
      opL1StandardBridge,
      governor,
      COMP: goerliCOMP,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress,
      'goerli'
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const opGoerliChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = { baseSymbol: 'WETH', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[opGoerliChainId]) {
      officialMarketsJSON[opGoerliChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[opGoerliChainId] = [newMarketObject];
    }

    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(
        comet.address,
        cometFactory.address
      )
    );
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
      [comet.address, opCOMPAddress]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          cometAdmin.address,
          rewards.address,
        ],
        [0, 0, 0, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
        ],
        [
          setFactoryCalldata,
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
        ],
      ]
    );

    const COMPAmountToBridge = exp(10_000, 18);

    const goerliActions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet, set reward config on Optimism-Goerli
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_500_000],
      },

      // 2. Approve Goerli's L1StandardBridge to take Timelock's COMP (for bridging)
      {
        contract: goerliCOMP,
        signature: 'approve(address,uint256)',
        args: [opL1StandardBridge.address, COMPAmountToBridge],
      },
      // 3. Bridge COMP from Goerli to Base-Goerli Comet using L1StandardBridge
      {
        contract: opL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [
          goerliCOMP.address,
          opCOMPAddress,
          rewards.address,
          COMPAmountToBridge,
          200_000,
          '0x',
        ],
      },

      // 5. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];

    const description =
      'Proposal to set Comet configuration, deployAndUpgradeTo new Comet, set reward config on Optimism-Goerli, bridge COMP from Goerli to Optimism-Goerli Comet, and update the list of official markets.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(goerliActions, description)))
      )
    );

    const event = txn.events.find((event) => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    preMigrationBlockNumber: number
  ) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider(); // We spider here to pull in Optimism COMP now that reward config has been set

    const {
      comet,
      rewards,
      COMP,
      WETH,
    } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(
      comet,
      getCometConfig,
      preMigrationBlockNumber
    );
    expect(stateChanges).to.deep.equal({
      pauseGuardian: '0xBA5e81fD6811E2699b478d1Bcde62a585bC9b6f7', //// Should be updated to the correct address. Create by script clone multi sig
      baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18),
      baseTrackingBorrowSpeed: exp(34.74 / 86400, 15, 18),
      WETH: {
        supplyCap: exp(1000, 18), /// Should be updated to the correct value
      },
      OP: {
        supplyCap: exp(800, 18), /// Should be updated to the correct value
      },
      WBTC: {
        supplyCap: exp(800, 18), /// Should be updated to the correct value
      },
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(20_000, 18));

    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress,
      'goerli'
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(
      subdomainHash,
      ENSTextRecordKey
    );
    const officialMarkets = JSON.parse(officialMarketsJSON);
    ///// parse from contract and update this before migration
    expect(officialMarkets).to.deep.equal({
      5: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x3EE77595A8459e93C2888b13aDB354017B198188',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x9A539EEc489AAA03D588212a164d0abdB5F08F5F',
        },
      ],
      80001: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF09F0369aB0a875254fB565E52226c88f10Bc839',
        },
      ],
      421613: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x1d573274E19174260c5aCE3f2251598959d24456',
        },
      ],
      84531: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xe78Fc55c884704F9485EDa042fb91BfE16fD55c1',
        },
      ],
      420: [
        {
          baseSymbol: 'USDT',
          cometAddress: comet.address,
        },
      ],
    });
  },
});
