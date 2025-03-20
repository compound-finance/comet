import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import {
  calldata,
  exp,
  getConfigurationStruct,
  proposal,
} from '../../../../src/deploy';
import { expect } from 'chai';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';
import { utils, Contract, constants } from 'ethers';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import 'dotenv/config';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

// const sonicCOMPAddress = '';
const USDCAmountToSeed = exp(50_000, 6);
const COMPAmountToBridge = exp(1000, 18);

const destinationChainSelector = '1673871237479749969';

const uidCOMP = Date.now();
const uidUSDC = uidCOMP + 1;

const delegatorAddress = process.env.DELEGATOR_ADDRESS || '';

export default migration('1739783281_configurate_and_ens', {
  // prepare: async () => {
  //   return {};
  // },

  async prepare(deploymentManager: DeploymentManager) {
    const { timelock, l2SonicBridge } = await deploymentManager.getContracts();
    const signer = await deploymentManager.getSigner();

    const initializeDelegatorData = utils.defaultAbiCoder.encode(
      ['address', 'address'],
      [timelock.address, l2SonicBridge.address]
    );

    console.log('timelock.address', timelock.address);
    const txDelegator = await signer.sendTransaction({
      to: delegatorAddress,
      value: 0,
      data: '0x485cc955' + initializeDelegatorData.substring(2)
    });
    await txDelegator.wait();

    return { delegatorAddress: delegatorAddress };
  },

  enact: async (
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
  ) => {
    const trace = deploymentManager.tracer();

    const {
      comet,
      rewards,
      cometAdmin,
      configurator,
      l2SonicBridge,
      // COMP: COMP_L2,
      'USDC.e': USDC_L2,
      bridgeReceiver,
    } = await deploymentManager.getContracts();

    const {
      governor,
      l1CCIPRouter,
      // COMP: COMP_L1,
      USDC: USDC_L1,
      sonicL1GatewayBridge,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const subdomainHash = utils.namehash(ENSSubdomain);
    const sonicChainId = 146;
    const newMarketObject = { baseSymbol: 'USDC.e', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(
      await ENSResolver.text(subdomainHash, ENSTextRecordKey)
    );
    if (officialMarketsJSON[sonicChainId]) {
      officialMarketsJSON[sonicChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[sonicChainId] = [newMarketObject];
    }


    const _approveUSDCCalldata = await USDC_L1.populateTransaction.approve(sonicL1GatewayBridge.address, USDCAmountToSeed);
    const _depositUSDCCalldata = await sonicL1GatewayBridge.populateTransaction.deposit(uidUSDC, USDC_L1.address, USDCAmountToSeed);
    const depositUSDCCalldata = utils.defaultAbiCoder.encode(
      ['address[]', 'bytes[]', 'uint256[]'],
      [[USDC_L1.address, sonicL1GatewayBridge.address], [_approveUSDCCalldata.data, _depositUSDCCalldata.data], [0, 0]]
    );

    // const _approveCOMPCalldata = await COMP_L1.populateTransaction.approve(sonicL1GatewayBridge.address, COMPAmountToBridge);
    // const _depositCOMPCalldata = await sonicL1GatewayBridge.populateTransaction.deposit(uidCOMP, COMP_L1.address, COMPAmountToBridge);
    // const depositCOMPCalldata = utils.defaultAbiCoder.encode(
    //   ['address[]', 'bytes[]', 'uint256[]'],
    //   [[COMP_L1.address, sonicL1GatewayBridge.address], [_approveCOMPCalldata.data, _depositCOMPCalldata.data], [0, 0]]
    // );

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
    // const setRewardConfigCalldata = utils.defaultAbiCoder.encode(
    //   ['address', 'address'],
    //   [comet.address, sonicCOMPAddress]
    // );
    
    // const depositIdCOMP = await l2SonicBridge.userOperationId(delegatorAddress, uidCOMP);
    const depositIdUSDC = await l2SonicBridge.userOperationId(delegatorAddress, uidUSDC);

    const delegatorContract = new Contract(
      delegatorAddress,
      [
        'function setClaimData(uint256,address,uint256,address,address)',
      ],
      await deploymentManager.getSigner()
    );

    // const setCOMPClaimData = await delegatorContract.populateTransaction.setClaimData(
    //   depositIdCOMP,
    //   COMP_L1.address,
    //   COMPAmountToBridge,
    //   COMP_L2.address,
    //   rewards.address
    // );

    const setUSDCClaimData = await delegatorContract.populateTransaction.setClaimData(
      depositIdUSDC,
      USDC_L1.address,
      USDCAmountToSeed,
      USDC_L2.address,
      comet.address
    );

    const claimCalldata = utils.defaultAbiCoder.encode(
      ['address[]', 'bytes[]', 'uint256[]'],
      [
        [
          // delegatorAddress,
          delegatorAddress
        ],
        [
          // setCOMPClaimData.data,
          setUSDCClaimData.data
        ],
        [
          // 0,
          0
        ],
      ]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          cometAdmin.address,
          // rewards.address,
          delegatorAddress,
        ],
        [
          0, 0, 0, 
          // 0,
        ],
        [
          'setConfiguration(address,(address,address,address,address,address,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint64,uint104,uint104,uint104,(address,address,uint8,uint64,uint64,uint64,uint128)[]))',
          'deployAndUpgradeTo(address,address)',
          // 'setRewardConfig(address,address)',
          'call(address[],bytes[],uint256[])',
        ],
        [
          setConfigurationCalldata,
          deployAndUpgradeToCalldata,
          // setRewardConfigCalldata,
          claimCalldata,
        ],
      ]
    );

    const actions = [
      // // 1. Transfer COMP to Delegator
      // {
      //   contract: COMP_L1,
      //   signature: 'transfer(address,uint256)',
      //   args: [delegatorAddress, COMPAmountToBridge],
      // },
      // // 2. Bridge COMP from Ethereum Delegator to Sonic Delegator
      // {
      //   target: delegatorAddress,
      //   signature: 'call(address[],bytes[],uint256[])',
      //   calldata: depositCOMPCalldata
      // },
      // 3. Transfer USDC to Delegator
      {
        contract: USDC_L1,
        signature: 'transfer(address,uint256)',
        args: [delegatorAddress, USDCAmountToSeed]
      },
      // 4. Bridge USDC from Ethereum Delegator to Sonic Delegator
      {
        target: delegatorAddress,
        signature: 'call(address[],bytes[],uint256[])',
        calldata: depositUSDCCalldata
      },
      // 5. Set Comet configuration + deployAndUpgradeTo new Comet, set Reward Config on Sonic
      {
        contract: l1CCIPRouter,
        signature: 'ccipSend(uint64,(bytes,bytes,(address,uint256)[],address,bytes))',
        args:
          [
            destinationChainSelector,
            [
              utils.defaultAbiCoder.encode(['address'], [bridgeReceiver.address]),
              l2ProposalData,
              [],
              constants.AddressZero,
              '0x'
            ]
          ],
        value: utils.parseEther('0.05')
      },
      // 7. Update the list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarketsJSON)]
        ),
      },
    ];

    const description = 'DESCRIPTION';
    const txn = await govDeploymentManager.retry(async () => {
      return trace(await governor.propose(...(await proposal(actions, description))));
    }
    );

    const event = txn.events.find((event) => event.event === 'ProposalCreated');
    const [proposalId] = event.args;

    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(
    deploymentManager: DeploymentManager,
    govDeploymentManager: DeploymentManager,
    preMigrationBlockNumber: number
  ) {
    const {
      timelock,
      sonicL1GatewayBridge,
    } = await govDeploymentManager.getContracts();

    const {
      comet,
      rewards,
      COMP,
      l2SonicBridge,
    } = await deploymentManager.getContracts();

    // 1.
    // const stateChanges = await diffState(
    //   comet,
    //   getCometConfig,
    //   preMigrationBlockNumber
    // );
    // expect(stateChanges).to.deep.equal({
    //   wS: {
    //     supplyCap: exp(2_300_000, 18)
    //   },
    //   stS: {
    //     supplyCap: exp(2_200_000, 18)
    //   },
    //   baseTrackingSupplySpeed: exp(3 / 86400, 15, 18), // 34722222222
    //   baseTrackingBorrowSpeed: exp(2 / 86400, 15, 18), // 23148148148
    // });


    // const depositIdCOMP = await l2SonicBridge.userOperationId(delegatorAddress, uidCOMP);
    const depositIdUSDC = await l2SonicBridge.userOperationId(delegatorAddress, uidUSDC);

    // const storageSlotCOMP = utils.keccak256(
    //   utils.defaultAbiCoder.encode(['uint256', 'uint8'], [depositIdCOMP, 7])
    // );
    const storageSlotUSDC = utils.keccak256(
      utils.defaultAbiCoder.encode(['uint256', 'uint8'], [depositIdUSDC, 7])
    );

    // const dataFromStorageCOMP = await govDeploymentManager.hre.ethers.provider.getStorageAt(
    //   sonicL1GatewayBridge.address,
    //   storageSlotCOMP
    // );
    // expect(dataFromStorageCOMP).to.not.be.equal(constants.HashZero);

    const dataFromStorageUSDC = await govDeploymentManager.hre.ethers.provider.getStorageAt(
      sonicL1GatewayBridge.address,
      storageSlotUSDC
    );
    expect(dataFromStorageUSDC).to.not.be.equal(constants.HashZero);

    // const config = await rewards.rewardConfig(comet.address);
    // expect(config.token.toLowerCase()).to.be.equal(COMP.address.toLowerCase());
    // expect(config.rescaleFactor).to.be.equal(exp(1, 12));
    // expect(config.shouldUpscale).to.be.equal(true);

    const cometNew = new Contract(
      comet.address,
      [
        'function assetList() external view returns (address)',
      ],
      await deploymentManager.getSigner()
    );

    const assetListAddress = await cometNew.assetList();

    expect(assetListAddress).to.not.be.equal(constants.AddressZero);

    const pauseGuardian = new Contract(
      await comet.pauseGuardian(),
      [
        'function getOwners() external view returns (address[] memory)',
      ],
      await deploymentManager.getSigner()
    );

    const hreMainnet = await forkedHreForBase({ name: '', network: 'mainnet', deployment: '' });
    const dm = new DeploymentManager('mainnet', 'usdc', hreMainnet);

    const cometMainnet = await dm.contract('comet') as Contract;
    const guardian = await cometMainnet.pauseGuardian();
    const GnosisSafeContract = new Contract(
      guardian,
      [
        'function getOwners() external view returns (address[] memory)',
      ],
      await dm.getSigner()
    );
    const ownersMainnet = await GnosisSafeContract.getOwners();

    const owners = await pauseGuardian.getOwners();
    expect(owners).to.deep.equal(ownersMainnet);
    expect(owners.length).to.not.be.equal(0);

    // 1.
    // expect(await COMP.balanceOf(rewards.address)).to.be.equal(COMPAmountToBridge);
    // expect(await comet.getReserves()).to.be.equal(USDCAmountToSeed);

    // 2.
    const ENSResolver = await govDeploymentManager.existing(
      'ENSResolver',
      ENSResolverAddress
    );
    const ENSRegistry = await govDeploymentManager.existing('ENSRegistry', ENSRegistryAddress, 'mainnet');
    const subdomainHash = utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(
      subdomainHash,
      ENSTextRecordKey
    );
    expect(await ENSRegistry.recordExists(subdomainHash)).to.be.equal(true);
    expect(await ENSRegistry.owner(subdomainHash)).to.be.equal(timelock.address);
    expect(await ENSRegistry.resolver(subdomainHash)).to.be.equal(ENSResolverAddress);
    expect(await ENSRegistry.ttl(subdomainHash)).to.be.equal(0);
    const officialMarkets = JSON.parse(officialMarketsJSON);
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
      130: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x2c7118c4C88B9841FCF839074c26Ae8f035f2921'
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
      146: [
        {
          baseSymbol: 'USDC.e',
          cometAddress: comet.address
        }
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
          cometAddress: '0x2c776041CCFe903071AF44aa147368a9c8EEA518'
        }
      ],
      42161: [
        {
          baseSymbol: 'USDC.e',
          cometAddress: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA'
        },
        {
          baseSymbol: 'USDC',
          cometAddress: '0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf'
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486'
        },
        {
          baseSymbol: 'USDT',
          cometAddress: '0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07'
        }
      ],
      59144: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991'
        }
      ],
      534352: [
        {
          baseSymbol: 'USDC',
          cometAddress: '0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44'
        }
      ]
    });
  },
});


// async function generateProof(depositId: number, govDeploymentManager: DeploymentManager): Promise<string> {
//   // Generate storage slot for deposit
//   const storageSlot = utils.keccak256(
//     utils.defaultAbiCoder.encode(['uint256', 'uint8'], [depositId, 7])
//   );

//   // Get provider
//   const { ANKR_KEY } = process.env;
//   const providerMainnet = new providers.JsonRpcProvider(`https://rpc.ankr.com/eth/${ANKR_KEY}`);
//   const { sonicL1GatewayBridge } = await govDeploymentManager.getContracts();

//   const stateOracle = new Contract(
//     await sonicL1GatewayBridge.stateOracle(),
//     [
//       'function lastBlockNum() view returns(uint256)',
//     ],
//     await govDeploymentManager.getSigner()
//   );

//   const block = await providerMainnet.send('eth_getBlockByNumber', [await stateOracle.lastBlockNum(), false]);
//   // Get proof from Ethereum node
//   const proof = await providerMainnet.send('eth_getProof', [
//     sonicL1GatewayBridge.address,
//     [storageSlot],
//     block.hash
//   ]);
  
//   // Encode proof in required format
//   return utils.RLP.encode([
//     utils.RLP.encode(proof.accountProof),
//     utils.RLP.encode(proof.storageProof[0].proof)
//   ]);
// }
