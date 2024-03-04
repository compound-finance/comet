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

const SECONDS_PER_YEAR = 31_536_000n;
const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const opCOMPAddress = '0x9e1028F5F1D5eDE59748FFceE5532509976840E0'; // COMP on Optimism. Should be deployed before this deployment.

const USDCAddress = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85';

export default migration('1707399040_configurate_and_ens', {
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
      'optimism',
      'usdc'
    );
    const {
      bridgeReceiver,
      timelock: localTimelock,
      comet,
      cometAdmin,
      configurator,
      rewards,
    } = await deploymentManager.getContracts();

    const {
      opL1CrossDomainMessenger,
      opL1StandardBridge,
      governor,
      comptrollerV2,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const opChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = { baseSymbol: 'WETH', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[opChainId]) {
      officialMarketsJSON[opChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[opChainId] = [newMarketObject];
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

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet, set reward config on Optimism
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000],
      },

      // 2. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },

      // 3. Displace v2 USDC COMP rewards
      {
        contract: comptrollerV2,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        args: [[USDCAddress], [9194444444444444n], [12666666666666667n]], //// Should be updated to the correct values
      },
    ];

    const description = 'Proposal text goes here.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
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
    await deploymentManager.spider(); // We spider here to pull in Base COMP now that reward config has been set

    const { comet, rewards, COMP } = await deploymentManager.getContracts();

    const { comptrollerV2 } = await govDeploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(
      comet,
      getCometConfig,
      preMigrationBlockNumber
    );
    expect(stateChanges).to.deep.equal({
      baseTrackingSupplySpeed: exp(20 / 86400, 15, 18), /// Should be updated to the correct value
      storeFrontPriceFactor: exp(1, 18), /// Should be updated to the correct value
      borrowPerSecondInterestRateSlopeLow: exp(0.037, 18) / SECONDS_PER_YEAR, /// Should be updated to the correct value
      WETH: {
        supplyCap: exp(11000, 18), /// Should be updated to the correct value
      },
      OP: {
        supplyCap: exp(7500, 18), /// Should be updated to the correct value
      },
      WBTC: {
        supplyCap: exp(500, 8), /// Should be updated to the correct value
      },
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12)); /// Should be updated to the correct value
    expect(config.shouldUpscale).to.be.equal(true); /// Should be updated to the correct value

    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(
      subdomainHash,
      ENSTextRecordKey
    );
    const officialMarkets = JSON.parse(officialMarketsJSON);

    expect(officialMarkets).to.deep.equal({
      /// parse and update before migration
      1: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xA17581A9E3356d9A858b789D68B4d866e593aE94',
        },
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        },
      ],
      42161: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        },
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        },
      ],
      10: [
        {
          baseSymbol: 'USDT',
          cometAddress: comet.address,
        },
      ],
    });

    // 4.
    expect(await comptrollerV2.compSupplySpeeds(USDCAddress)).to.be.equal(
      9194444444444444n //// Should be updated to the correct value
    ); // 66.2 COMP/day
    expect(await comptrollerV2.compBorrowSpeeds(USDCAddress)).to.be.equal(
      12666666666666667n //// Should be updated to the correct value
    ); // 91.2 COMP/day
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(
      exp(20 / 86400, 15, 18) //// Should be updated to the correct value
    );
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(
      exp(0 / 86400, 15, 18) //// Should be updated to the correct value
    );
  },
});
