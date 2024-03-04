import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  diffState,
  getCometConfig,
} from '../../../../plugins/deployment_manager/DiffState';
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from '../../../../src/deploy';
import { expect } from 'chai';
import { WBTC } from '../../../../test/liquidation/addresses';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const opCOMPAddress = '0x9e1028F5F1D5eDE59748FFceE5532509976840E0'; /// TODO : should be deployed before migration.

const USDCAddress = '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85';

export default migration('1707394874_configurate_and_ens', {
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

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      USDC,
    } = await deploymentManager.getContracts();

    const {
      opL1CrossDomainMessenger,
      opL1StandardBridge,
      governor,
      comptrollerV2,
      COMP: mainnetCOMP,
      USDC: mainnetUSDC,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const baseChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = {
      baseSymbol: 'USDC',
      cometAddress: comet.address,
    };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[baseChainId]) {
      officialMarketsJSON[baseChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[baseChainId] = [newMarketObject];
    }

    const configuration = await getConfigurationStruct(deploymentManager);

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
        [configurator.address, cometAdmin.address, rewards.address],
        [0, 0, 0],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)',
        ],
        [
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          setRewardConfigCalldata,
        ],
      ]
    );
    //// TODO : should know the amount to bridge.?????
    const COMPAmountToBridge = exp(12_500, 18);
    const USDCAmountToBridge = exp(10_000, 6);

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Optimism.
      {
        contract: opL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 2_500_000],
      },

      // 2. Approve Ethereum's L1StandardBridge to take Timelock's USDC (for bridging)
      {
        contract: mainnetUSDC,
        signature: 'approve(address,uint256)',
        args: [opL1StandardBridge.address, USDCAmountToBridge],
      },
      // 3. Bridge USDC from Ethereum to Base Comet using L1StandardBridge
      {
        contract: opL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [
          mainnetUSDC.address,
          USDC.address,
          comet.address,
          USDCAmountToBridge,
          200_000,
          '0x',
        ],
      },

      // 4. Approve Ethereum's L1StandardBridge to take Timelock's COMP (for bridging)
      {
        contract: mainnetCOMP,
        signature: 'approve(address,uint256)',
        args: [opL1StandardBridge.address, COMPAmountToBridge],
      },
      // 5. Bridge COMP from Ethereum to OP Rewards using L1StandardBridge
      {
        contract: opL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature:
          'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [
          mainnetCOMP.address,
          opCOMPAddress,
          rewards.address,
          COMPAmountToBridge,
          200_000,
          '0x',
        ],
      },

      // 6. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },

      // 7. Displace v2 USDC COMP rewards
      {
        contract: comptrollerV2,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        args: [[USDCAddress], [9194444444444444n], [15444444444444444n]],
      },
    ];

    const description = '?????????????????';
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

    const {
      comet,
      rewards,
      COMP,
      USDC,
    } = await deploymentManager.getContracts();

    const { comptrollerV2 } = await govDeploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(
      comet,
      getCometConfig,
      preMigrationBlockNumber
    );
    expect(stateChanges).to.deep.equal({
      baseTrackingSupplySpeed: exp(30 / 86400, 15, 18), /// TODO : should be changed after we know the exact value.
      baseTrackingBorrowSpeed: exp(15 / 86400, 15, 18), /// TODO : should be changed after we know the exact value.
      WETH: {
        supplyCap: exp(11000, 18),
      },
      OP: {
        supplyCap: exp(7500, 18),
      },
      WBTC: {
        supplyCap: exp(500, 8),
      },
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12)); /// TODO : should be changed after we know the exact value.
    expect(config.shouldUpscale).to.be.equal(true); /// TODO : should be changed after we know the exact value.

    // 2. & 3.
    expect(await USDC.balanceOf(comet.address)).to.be.equal(exp(10_000, 6)); /// TODO : should be changed after we know the exact value.

    // 4. & 5.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(12_500, 18)); /// TODO : should be changed after we know the exact value.

    // 6.
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
      //// Update the list of official markets before make migration
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
      10: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        },
      ],
    });

    // 7.
    expect(await comptrollerV2.compSupplySpeeds(USDCAddress)).to.be.equal(
      /// TODO : should be changed after we know the exact value.
      9194444444444444n
    ); // 66.2 COMP/day
    expect(await comptrollerV2.compBorrowSpeeds(USDCAddress)).to.be.equal(
      /// TODO : should be changed after we know the exact value.
      15444444444444444n
    ); // 111.2 COMP/day
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(
      /// TODO : should be changed after we know the exact value.
      exp(30 / 86400, 15, 18)
    );
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(
      /// TODO : should be changed after we know the exact value.
      exp(15 / 86400, 15, 18)
    );
  },
});
