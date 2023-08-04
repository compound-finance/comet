import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const baseCOMPAddress = '0x9e1028F5F1D5eDE59748FFceE5532509976840E0';

const cUSDCAddress = '0x39AA39c021dfbaE8faC545936693aC917d5E7563';

export default migration('1679592519_configurate_and_ens', {
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
      USDbC
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      baseL1StandardBridge,
      governor,
      comptrollerV2,
      COMP: mainnetCOMP,
      USDC: mainnetUSDC
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const baseChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDbC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[baseChainId]) {
      officialMarketsJSON[baseChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[baseChainId] = [newMarketObject];
    }

    const configuration = await getConfigurationStruct(deploymentManager);

    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, baseCOMPAddress]
    );
    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, cometAdmin.address, rewards.address],
        [0, 0, 0],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)'
        ],
        [setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata]
      ]
    );

    const COMPAmountToBridge = exp(12_500, 18);
    const USDCAmountToBridge = exp(10_000, 6);

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Base.
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 2_500_000]
      },

      // 2. Approve Ethereum's L1StandardBridge to take Timelock's USDC (for bridging)
      {
        contract: mainnetUSDC,
        signature: 'approve(address,uint256)',
        args: [baseL1StandardBridge.address, USDCAmountToBridge]
      },
      // 3. Bridge USDC from Ethereum to Base Comet using L1StandardBridge
      {
        contract: baseL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature: 'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [mainnetUSDC.address, USDbC.address, comet.address, USDCAmountToBridge, 200_000, '0x']
      },

      // 4. Approve Ethereum's L1StandardBridge to take Timelock's COMP (for bridging)
      {
        contract: mainnetCOMP,
        signature: 'approve(address,uint256)',
        args: [baseL1StandardBridge.address, COMPAmountToBridge]
      },
      // 5. Bridge COMP from Ethereum to Base Rewards using L1StandardBridge
      {
        contract: baseL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature: 'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [mainnetCOMP.address, baseCOMPAddress, rewards.address, COMPAmountToBridge, 200_000, '0x']
      },

      // 6. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      },

      // 7. Displace v2 USDC COMP rewards
      {
        contract: comptrollerV2,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        args: [
          [cUSDCAddress],
          [10583333330000000n],
          [15444444444444444n],
        ],
      },
    ];

    const description = "TODO"; // TODO
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    const ethers = deploymentManager.hre.ethers;
    await deploymentManager.spider(); // We spider here to pull in Base COMP now that reward config has been set

    const {
      comet,
      rewards,
      COMP,
      USDbC
    } = await deploymentManager.getContracts();

    const {
      comptrollerV2,
    } = await govDeploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    // TODO: uncomment when contracts are deployed
    // expect(stateChanges).to.deep.equal({
    //   baseTrackingSupplySpeed: exp(30 / 86400, 15, 18),
    //   baseTrackingBorrowSpeed: exp(15 / 86400, 15, 18),
    //   baseBorrowMin: 1,
    //   WETH: {
    //     supplyCap: exp(11000, 18)
    //   },
    //   cbETH: {
    //     supplyCap: exp(7500, 18)
    //   }
    // })

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await USDbC.balanceOf(comet.address)).to.be.equal(exp(10_000, 6));

    // 4. & 5.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(12_500, 18));

    // 6.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    expect(officialMarkets).to.deep.equal({
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
        }
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: comet.address,
        },
      ],
    });

    // 7.
    expect(await comptrollerV2.compSupplySpeeds(cUSDCAddress)).to.be.equal(10583333330000000n);
    expect(await comptrollerV2.compBorrowSpeeds(cUSDCAddress)).to.be.equal(15444444444444444n);
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(exp(30 / 86400, 15, 18));
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(15 / 86400, 15, 18));
  }
});