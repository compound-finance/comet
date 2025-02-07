import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';
import { ethers, utils, Contract } from 'ethers';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const baseCOMPAddress = '0x9e1028F5F1D5eDE59748FFceE5532509976840E0';

const USDSAmount = ethers.BigNumber.from(exp(100_000, 18));
const cDAIAddress = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const DaiToUsdsConverterAddress = '0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A';
const DAIAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';

const mainnetUSDS = '0xdC035D45d973E3EC169d2276DDab16f1e407384F';

export default migration('1689893694_configurate_and_ens', {
  prepare: async () => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    const cometFactory = await deploymentManager.contract('cometFactory');
    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      USDS,
    } = await deploymentManager.getContracts();

    const {
      baseL1CrossDomainMessenger,
      baseL1USDSBridge,
      governor,
      timelock
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const baseChainId = 8453;
    const newMarketObject = { baseSymbol: 'USDS', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[baseChainId]) {
      officialMarketsJSON[baseChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[baseChainId] = [newMarketObject];
    }

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
      [comet.address, baseCOMPAddress]
    );
    const _reduceReservesCalldata = utils.defaultAbiCoder.encode(
      ['uint256'],
      [USDSAmount]
    );

    const approveCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [DaiToUsdsConverterAddress, USDSAmount]
    );

    const convertCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [timelock.address, USDSAmount]
    );

    const approveToBridgeCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [baseL1USDSBridge.address, USDSAmount]
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
          'setRewardConfig(address,address)',
        ],
        [setFactoryCalldata, setConfigurationCalldata, deployAndUpgradeToCalldata, setRewardConfigCalldata]
      ]
    );

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet, set reward config on Base.
      {
        contract: baseL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 3_000_000]
      },
      // 2. Withdraw DAI reserves from cDAI contract
      {
        target: cDAIAddress,
        signature: '_reduceReserves(uint256)',
        calldata: _reduceReservesCalldata
      },
      // 3. Approve DAI to be converted to USDS
      {
        target: DAIAddress,
        signature: 'approve(address,uint256)',
        calldata: approveCalldata,
      },
      // 4. Convert DAI to USDS
      {
        target: DaiToUsdsConverterAddress,
        signature: 'daiToUsds(address,uint256)',
        calldata: convertCalldata
      },
      // 5. Approve USDS to the L1StandardBridge
      {
        target: mainnetUSDS,
        signature: 'approve(address,uint256)',
        calldata: approveToBridgeCalldata
      },
      // 6. Bridge USDS from Ethereum to Base Comet using L1StandardBridge
      {
        contract: baseL1USDSBridge,
        signature: 'bridgeERC20To(address,address,address,uint256,uint32,bytes)',
        args: [mainnetUSDS, USDS.address, comet.address, USDSAmount, 200_000, '0x']
      },
      // 7. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        )
      },
    ];

    const description = `# Initialize cUSDSv3 on Base\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes the deployment of Compound III to the Base network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDS market on Base; upon execution, cUSDSv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/gauntlet-base-usds-comet-recommendations/6278/1).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/959), [deploy market GitHub action run](<https://github.com/woof-software/comet/actions/runs/13189319692/job/36818817568>) and [forum discussion](https://www.comp.xyz/t/gauntlet-base-usds-comet-recommendations/6278).\n\n\n## cbBTC collateral\n\nDue to the high speed of the market deployment, Gauntlet provided recommendations for cbBTC internally. By the voting start of voting, Gauntlet should be able to update forum the thread with recommendations.\n\n## sUSDS price feed\n\nThe sUSDS on Mainnet was a 4626 contract. However, on Base, the sUSDS contract has another contract standard. To speed up the development we decided to use the already deployed price feed of sUSDS/USDS on Base by Spark team. The [price feed](https://basescan.org/address/0x026a5B6114431d8F3eF2fA0E1B2EDdDccA9c540E#readContract) is compatible with our price feed interface and can be re-used. [The audit report of price feed](https://github.com/marsfoundation/xchain-ssr-oracle/blob/master/audits/ChainSecurity_SparkDAO_XChain_SSR_Oracle_audit.pdf).\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration, deploys a new Comet implementation on Base and sends the encoded 'setFactory', 'setConfiguration' and 'deployAndUpgradeTo' calls across the bridge to the governance receiver on Base. It also calls 'setRewardConfig' on the Base rewards contract, to set the new Comet’s supply speed to 24 COMP/day and borrow speed to 12 COMP/day.\n\nThe second action reduces Compound’s [cDAI](https://etherscan.io/address/0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643) reserves and transfers it to Timelock, in order to convert it for USDS and then seed the market reserves for the cUSDSv3 Comet.\n\nThe third action approves [DaiToUsdsConverterAddress](https://etherscan.io/address/0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A) to take Timelock’s DAI and covert it into USDS.\n\nThe fourth action converts DAI into USDS so it can be transferred to Base in order to seed the reserves.\n\nThe fifth action approves [L1USDSBridge](https://etherscan.io/address/0xA5874756416Fa632257eEA380CAbd2E87cED352A) to take Timelock's USDS.\n\nThe sixth action deposits 100K USDS from mainnet to the Base L1USDSBridge contract to bridge to the Comet.\n\nThe seventh action updates the ENS TXT record 'v3-official-markets' on 'v3-additional-grants.compound-community-licenses.eth', updating the official markets JSON to include the new Mantle cUSDSv3 market.`;
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(deploymentManager: DeploymentManager): Promise<boolean> {
    return true;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager, preMigrationBlockNumber: number) {
    await deploymentManager.spider(); // We spider here to pull in Base COMP now that reward config has been set

    const {
      comet,
      rewards,
      COMP,
    } = await deploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      sUSDS: {
        supplyCap: exp(25000000, 18)
      },
      baseTrackingSupplySpeed: exp(24 / 86400, 15, 18), // 277777777777
      baseTrackingBorrowSpeed: exp(12 / 86400, 15, 18), // 138888888888
    });

    const config = await rewards.rewardConfig(comet.address);
    expect(config.token).to.be.equal(COMP.address);
    expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    expect(config.shouldUpscale).to.be.equal(true);

    // 1. & 2.
    expect(await comet.getReserves()).to.be.equal(USDSAmount);

    // 3.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);

    const cometNew = new Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddress = await cometNew.assetList();

    expect(assetListAddress).to.not.be.equal(ethers.constants.AddressZero);


    expect(officialMarkets).to.deep.equal({
      1: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xA17581A9E3356d9A858b789D68B4d866e593aE94'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840'
        },
        {
          baseSymbol: 'wstETH',
          cometAddress: '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3'
        },
        {
          baseSymbol: 'USDS',
          cometAddress: '0x5D409e56D886231aDAf00c8775665AD0f9897b56'
        }
      ],
      10: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x2e44e174f7D53F0212823acC11C01A11d58c5bCB'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0x995E394b8B2437aC8Ce61Ee0bC610D617962B214'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0xE36A30D249f7761327fd973001A32010b521b6Fd'
        }
      ],
      137: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xaeB318360f27748Acb200CE616E389A6C9409a07'
        }
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
        {
          baseSymbol: 'WETH',
          cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486',
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07',
        },
      ],
      5000: [
        {
          baseSymbol: 'USDe',
          cometAddress: '0x606174f62cd968d8e684c645080fa694c1D7786E'
        }
      ],
      8453: [
        {
          baseSymbol: 'USDbC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x46e6b214b524310239732D51387075E0e70970bf'
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0xb125E6687d4313864e53df431d5425969c15Eb2F'
        },
        {
          baseSymbol: 'AERO',
          cometAddress: '0x784efeB622244d2348d4F2522f8860B96fbEcE89'
        },
        {
          baseSymbol: 'USDS',
          cometAddress: comet.address
        }
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44'
        },
      ]
    });
  }
});