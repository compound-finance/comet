import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const lineaCOMPAddress = '0xab3134fa5edfb3dc64aa790e8bb6448117d18fe9';

export default migration('1686918613_configurate_and_ens', {
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
      rewards
    } = await deploymentManager.getContracts();

    const {
      lineaMessageService,
      lineaL1TokenBridge,
      lineaL1usdcBridge,
      governor,
      COMP,
      USDC
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress,
      'goerli'
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const lineaGoerliChainId = (
      await deploymentManager.hre.ethers.provider.getNetwork()
    ).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[lineaGoerliChainId]) {
      officialMarketsJSON[lineaGoerliChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[lineaGoerliChainId] = [newMarketObject];
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
      [comet.address, lineaCOMPAddress]
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

    const COMPAmountToBridge = exp(1_000, 18);
    const USDCAmountToBridge = exp(100_000, 6);

    const goerliActions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet and set reward config on Linea-Goerli.
      {
        contract: lineaMessageService,
        signature: 'sendMessage(address,uint256,bytes)',
        args: [bridgeReceiver.address, 0, l2ProposalData]
      },

      // 2. Approve Goerli's L1StandardBridge to take Timelock's COMP (for bridging)
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [lineaL1TokenBridge.address, COMPAmountToBridge]
      },
      // 3. Bridge COMP from Goerli to Linea-Goerli Comet using L1StandardBridge
      {
        contract: lineaL1TokenBridge,
        signature: 'bridgeToken(address,uint256,address)',
        args: [COMP.address, COMPAmountToBridge, rewards.address]
      },
      // 4. Approve Goerli's L1usdcBridge to take Timelock's USDC (for bridging)
      {
        contract: USDC,
        signature: 'approve(address,uint256)',
        args: [lineaL1usdcBridge.address, USDCAmountToBridge]
      },
      // 5. Bridge USDC from Goerli to Linea-Goerli Comet using L1usdcBridge
      {
        contract: lineaL1usdcBridge,
        signature: 'depositTo(uint256,address)',
        args: [USDCAmountToBridge, rewards.address]
      },
      // 6. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }
    ];

    const description =
      '# Configurate Linea-Goerli cUSDCv3 market, set reward config, bridge over USDC and COMP, and update ENS text record.';
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(goerliActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
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
    await deploymentManager.spider(); // We spider here to pull in Linea COMP now that reward config has been set

    const { comet, rewards, COMP, USDC } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      baseTrackingSupplySpeed: exp(34.74 / 86400, 15, 18),
      baseTrackingBorrowSpeed: exp(34.74 / 86400, 15, 18),
      baseMinForRewards: exp(1000, 6),
      numAssets: 2,
      WETH: {
        borrowCollateralFactor: exp(0.775, 18),
        liquidationFactor: exp(0.95, 18),
        supplyCap: exp(1000, 18)
      },
      WBTC: {
        offset: 1,
        asset: '0xdbcd5bafbaa8c1b326f14ec0c8b125db57a5cc4c',
        priceFeed: '0x625e78891611D5A6227Ff78548C373b56B0C8ea0',
        scale: exp(1, 18),
        borrowCollateralFactor: exp(0.7, 18),
        liquidateCollateralFactor: exp(0.75, 18),
        liquidationFactor: exp(0.93, 18),
        supplyCap: exp(300, 18)
      },
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(1_000, 18));

    // 4 & 5,
    expect(await USDC.balanceOf(rewards.address)).to.be.equal(exp(100_000, 6));

    // 6.
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress,
      'goerli'
    );
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    expect(officialMarkets).to.deep.equal({
      5: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x3EE77595A8459e93C2888b13aDB354017B198188'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x9A539EEc489AAA03D588212a164d0abdB5F08F5F'
        }
      ],
      80001: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF09F0369aB0a875254fB565E52226c88f10Bc839'
        }
      ],
      420: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xb8F2f9C84ceD7bBCcc1Db6FB7bb1F19A9a4adfF4'
        }
      ],
      421613: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x1d573274E19174260c5aCE3f2251598959d24456'
        }
      ],
      84531: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xe78Fc55c884704F9485EDa042fb91BfE16fD55c1'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xED94f3052638620fE226a9661ead6a39C2a265bE'
        }
      ],
      59140: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address
        }
      ]
    });
  }
});
