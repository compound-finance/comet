import { Contract, ethers } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const ERC20PredicateAddress = '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf';
const RootChainManagerAddress = '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77';

const mainnetUSDTAddress = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const polygonCOMPAddress = '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c';
const cUSDTAddress = '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9';

const USDTAmountToBridge = ethers.BigNumber.from(exp(10_000, 6));

export default migration('1713283675_configurate_and_ens', {
  prepare: async (_deploymentManager: DeploymentManager) => {
    return {};
  },
  
  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    console.log('Enacting 1713283675_configurate_and_ens');
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const cometFactory = await deploymentManager.fromDep('cometFactory', 'polygon', 'usdc');
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      USDT,
      WBTC,
      WETH,
      WMATIC
    } = await deploymentManager.getContracts();

    const {
      fxRoot,
      timelock,
      governor
    } = await govDeploymentManager.getContracts();
    // console.log(await govDeploymentManager.getContracts());
    const configuration = await getConfigurationStruct(deploymentManager);
    const setFactoryCalldata = await calldata(
      configurator.populateTransaction.setFactory(comet.address, cometFactory.address)
    );
    const setConfigurationCalldata = await calldata(
      configurator.populateTransaction.setConfiguration(comet.address, configuration)
    );
    const deployAndUpgradeToCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [configurator.address, comet.address]
    );
    
    const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [comet.address, polygonCOMPAddress]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [configurator.address, configurator.address, cometAdmin.address, rewards.address],
        [0, 0, 0, 0],
        [
          'setFactory(address,address)',
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          'setRewardConfig(address,address)'
        ],
        [setFactoryCalldata, setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata]
      ]
    );

    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const polygonChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDT', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));

    if (officialMarketsJSON[polygonChainId]) {
      officialMarketsJSON[polygonChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[polygonChainId] = [newMarketObject];
    }

    const RootChainManager = await deploymentManager.existing(
      'RootChainManager',
      RootChainManagerAddress
    );
    const USDTMainnet = new Contract(
      mainnetUSDTAddress,
      [
        'function balanceOf(address account) external view returns (uint256)',
        'function approve(address,uint256) external'        
      ],
      govDeploymentManager.hre.ethers.provider
    );

    const depositUSDTData = utils.defaultAbiCoder.encode(['uint256'], [USDTAmountToBridge]);
    const depositForUSDTCalldata = utils.defaultAbiCoder.encode(
      ['address', 'address', 'bytes'],
      [comet.address, USDTMainnet.address, depositUSDTData]
    );
    const notEnoughUSDT = (await USDTMainnet.balanceOf(timelock.address)).lt(USDTAmountToBridge);
    const amountToSupply = notEnoughUSDT ? ethers.BigNumber.from(USDTAmountToBridge).sub(await USDTMainnet.balanceOf(timelock.address)) : 0;
    const _reduceReservesCalldata = utils.defaultAbiCoder.encode(
      ['uint256'],
      [amountToSupply]
    );

    const mainnetActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData]
      },
      // 2. Get USDT reserves from cUSDT contract
      {
        target: cUSDTAddress,
        signature: '_reduceReserves(uint256)',
        calldata: _reduceReservesCalldata
      },
      // 3. Approve Polygon's ERC20Predicate to take Timelock's USDT (for bridging)
      {
        contract: USDTMainnet,
        signature: 'approve(address,uint256)',
        args: [ERC20PredicateAddress, USDTAmountToBridge]
      },
      // 4. Bridge USDT from mainnet to Polygon Comet using RootChainManager
      {
        target: RootChainManager.address,
        signature: 'depositFor(address,address,bytes)',
        calldata: depositForUSDTCalldata
      },
      // 5. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      }
    ];

    const description = "# Initialize cUSDCv3 on Polygon\n\nThis proposal takes the governance steps recommended and necessary to initialize a Compound III USDC market on Polygon; upon execution, cUSDCv3 will be ready for use. Simulations have confirmed the market\u2019s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). Although real tests have also been run over the Goerli/Mumbai bridge, this will be the first proposal to actually bridge from Ethereum mainnet to another chain, and therefore includes risks not present in previous proposals.\n\nAlthough the proposal sets the entire configuration in the Configurator, the initial deployment already has most of these same parameters already set. The new parameters include setting the pause guardian to a Gnosis [multisig](https://app.safe.global/matic:0x8Ab717CAC3CbC4934E63825B88442F5810aAF6e5/home), which has been created on Polygon to match the same set of signers as currently on Ethereum mainnet. They also include risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/initialize-compound-iii-usdc-on-polygon-pos/3611/12). Finally, the parameters include a modest reallocation of some of the v2 USDT COMP rewards to borrowers in the new market.\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/672) and [forum discussion](https://www.comp.xyz/t/initialize-compound-iii-usdc-on-polygon-pos/3611/11).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Polygon. This sends the encoded `setConfiguration` and `deployAndUpgradeTo` calls across the bridge to the governance receiver on Polygon.\n\nThe second action approves Polygon's ERC20Predicate to take Timelock's USDC, in order to seed the market reserves through the bridge.\n\nThe third action deposits USDC from mainnet to the Polygon RootChainManager contract to bridge to Comet.\n\nThe fourth action approves Polygon's ERC20Predicate to take Timelock's COMP, in order to seed the rewards contract through the bridge.\n\nThe fifth action deposits COMP from mainnet to the Polygon RootChainManager contract to bridge to CometRewards. \n\nThe sixth action sets up the ENS subdomain `v3-additional-grants.compound-community-licenses.eth`,  with the Timelock as the owner.\n\nThe seventh action writes the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, containing the official markets JSON.\n\nThe eighth action migrates the COMP distribution for v2 cUSDT suppliers, so as to keep the total COMP distribution constant.\n";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(mainnetActions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      rewards,
      WMATIC,
      WETH,
      aPolMATICX,
      stMATIC,
      WBTC,
      COMP
    } = await deploymentManager.getContracts();

    const {
      timelock
    } = await govDeploymentManager.getContracts();

    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);

    // uncomment on on-chain proposal PR
    // expect(stateChanges).to.deep.equal({
    //   WMATIC: {
    //     supplyCap: exp(5_000_000, 18)
    //   },
    //   WETH: {
    //     supplyCap: exp(2_000, 18)
    //   },
    //   aPolMATICX: {
    //     supplyCap: exp(2_600_000, 18),
    //   },
    //   stMATIC: {
    //     supplyCap: exp(1_500_000, 18)
    //   },
    //   WBTC: {
    //     supplyCap: exp(90, 8)
    //   },
    //   baseTrackingSupplySpeed: exp(5 / 86400, 15, 18), 
    //   baseTrackingBorrowSpeed: exp(5 / 86400, 15, 18),
    // });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 2. & 3 & 4.
    expect(await comet.getReserves()).to.be.equal(USDTAmountToBridge);

    // 5.
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
        {
          baseSymbol: 'USDT',
          cometAddress: comet.address,
        }
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x46e6b214b524310239732D51387075E0e70970bf',
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F',
        },
      ],
      42161: [
        {
          baseSymbol: 'USDC.e',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf',
        },
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44',
        },
      ],
      10: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB',
        },
      ],
    });
  }
});
