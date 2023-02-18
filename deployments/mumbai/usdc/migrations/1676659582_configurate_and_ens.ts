import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';
import {ERC20__factory} from '../../../../build/types';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const ERC20PredicateAddress = '0xdD6596F2029e6233DEFfaCa316e6A95217d4Dc34';
const RootChainManagerAddress = '0xBbD7cBFA79faee899Eaf900F13C9065bF03B1A74';

export default migration('1676659582_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      WBTC,
      WETH,
      WMATIC
    } = await deploymentManager.getContracts();

    const {
      fxRoot,
      timelock,
      governor,
      USDC,
      COMP,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const nameHash = ethers.utils.namehash(ENSName);
    const labelHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(ENSSubdomainLabel));
    const subdomainHash = ethers.utils.namehash(ENSSubdomain), ttl = 0;
    const officialMarkets = {
      5: [
        {
          baseSymbol: 'USDC',
          cometAddress: (await govDeploymentManager.fromDep('cUSDCv3', 'goerli', 'usdc', 'comet')).address,
        },
        {
          baseSymbol: 'WETH',
          cometAddress: (await govDeploymentManager.fromDep('cWETHv3', 'goerli', 'weth', 'comet')).address
        }
      ],

      80001: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        }
      ],
    };

    const configuration = await getConfigurationStruct(deploymentManager);

    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address],
        [0, 0],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)'
        ],
        [setConfigurationCalldata, deployAndUpgradeToCalldata]
      ]
    );

    const RootChainManager = await deploymentManager.existing(
      'RootChainManager',
      RootChainManagerAddress,
      'goerli'
    );
    const USDCAmountToBridge = exp(500, 6);
    const COMPAmountToBridge = exp(10_000, 18);
    const depositUSDCData = utils.defaultAbiCoder.encode(['uint256'], [USDCAmountToBridge]);
    const depositForUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'bytes'],
      [comet.address, USDC.address, depositUSDCData]
    );
    const depositCOMPData = utils.defaultAbiCoder.encode(['uint256'], [COMPAmountToBridge]);
    const depositForCOMPCCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'bytes'],
      [rewards.address, COMP.address, depositCOMPData]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Mumbai.
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData]
      },
      // 2. Approve Mumbai's ERC20Predicate to take Timelock's USDC (for bridging)
      {
        contract: USDC,
        signature: 'approve(address,uint256)',
        args: [ERC20PredicateAddress, USDCAmountToBridge]
      },
      // 3. Bridge USDC from mainnet to Mumbai Comet using RootChainManager
      {
        target: RootChainManager.address,
        signature: 'depositFor(address,address,bytes)',
        calldata: depositForUSDCCalldata
      },
      // Note: Cannot test this flow for COMP because Polygon team has changed the way to map new tokens in January 2023
      // to go through the FxPortal instead of the RootChainManager
      // // 4. Approve Mumbai's ERC20Predicate to take Timelock's COMP (for bridging)
      // {
      //   contract: COMP,
      //   signature: 'approve(address,uint256)',
      //   args: [ERC20PredicateAddress, COMPAmountToBridge]
      // },
      // // 5. Bridge COMP from mainnet to Mumbai CometRewards using RootChainManager
      // {
      //   target: RootChainManager.address,
      //   signature: 'depositFor(address,address,bytes)',
      //   calldata: depositForCOMPCCalldata
      // },

      // Note: No need to do this because we have already set up the subdomain on Goerli
      // 6. Set up ENS license subdomain with the Timelock as the owner
      // {
      //   target: ENSRegistryAddress,
      //   signature: 'setSubnodeRecord(bytes32,bytes32,address,address,uint64)',
      //   calldata: ethers.utils.defaultAbiCoder.encode(
      //     ['bytes32', 'bytes32', 'address', 'address', 'uint64'],
      //     [nameHash, labelHash, timelock.address, ENSResolverAddress, ttl]
      //   )
      // },

      // 7. Establish the new list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarkets)]
        )
      },
    ];

    const description = "Configurate Mumbai cUSDCv3 market, bridge over USDC and COMP, and update ENS text record.";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      rewards,
      DAI,
      WBTC,
      WETH,
      WMATIC
    } = await deploymentManager.getContracts();

    const {
      timelock,
    } = await govDeploymentManager.getContracts();

    // 1.
    const daiInfo = await comet.getAssetInfoByAddress(DAI.address);
    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);
    const wmaticInfo = await comet.getAssetInfoByAddress(WMATIC.address);
    expect(await daiInfo.supplyCap).to.be.eq(exp(1_000_000, 18));
    expect(await wbtcInfo.supplyCap).to.be.eq(exp(20_000, 8));
    expect(await wethInfo.supplyCap).to.be.eq(exp(50_000, 18));
    expect(await wmaticInfo.supplyCap).to.be.eq(exp(500_000, 18));

    // 2. & 3.
    // Note: Cannot verify because the USDC we are bridging over is different from the one in Comet
    // expect(await comet.getReserves()).to.be.equal(exp(400_000, 6));
    const bridgedUSDC = new Contract(
      '0x0FA8781a83E46826621b3BC094Ea2A0212e71B23',
      ERC20__factory.createInterface(),
      deploymentManager.hre.ethers.provider
    );
    expect(await bridgedUSDC.balanceOf(comet.address)).to.be.equal(exp(500, 6));

    // 4. & 5.
    // const bridgedCOMP = new Contract(
    //   '0x46DaBF9092B40A3fE6c0bC3331Cd928B600754fE',
    //   ERC20__factory.createInterface(),
    //   deploymentManager.hre.ethers.provider
    // );
    // expect(await bridgedCOMP.balanceOf(rewards.address)).to.be.equal(exp(10_000, 18));

    // 6. & 7.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const ENSRegistry = await govDeploymentManager.existing('ENSRegistry', ENSRegistryAddress, 'goerli');
    const nameHash = ethers.utils.namehash(ENSName);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    expect(await ENSRegistry.recordExists(subdomainHash)).to.be.equal(true);
    expect(await ENSRegistry.owner(subdomainHash)).to.be.equal(timelock.address);
    expect(await ENSRegistry.resolver(subdomainHash)).to.be.equal(ENSResolverAddress);
    expect(await ENSRegistry.ttl(subdomainHash)).to.be.equal(0);
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
          cometAddress: comet.address,
        },
      ]
    });
  }
});