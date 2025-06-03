import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { diffState, getCometConfig } from '../../../../plugins/deployment_manager/DiffState';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';
import { ethers, utils, Contract, constants } from 'ethers';
import { applyL1ToL2Alias, estimateL2Transaction, estimateTokenBridge } from '../../../../scenario/utils/arbitrumUtils';
import { forkedHreForBase } from '../../../../plugins/scenario/utils/hreForBase';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';

const USDSAmount = ethers.BigNumber.from(exp(100_000, 18));
const cDAIAddress = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const DaiToUsdsConverterAddress = '0x3225737a9Bbb6473CB4a45b7244ACa2BeFdB276A';
const DAIAddress = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const arbitrumCOMPAddress = '0x354A6dA3fcde098F8389cad84b0182725c6C91dE';

const mainnetUSDS = '0xdC035D45d973E3EC169d2276DDab16f1e407384F';

export default migration('1746540554_configurate_and_ens', {
  prepare: async () => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();

    const {
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      timelock: l2Timelock,
    } = await deploymentManager.getContracts();

    const {
      arbitrumInbox,
      arbitrumL1GatewayRouter,
      governor,
      timelock
    } = await govDeploymentManager.getContracts();
    const usdsGatewayAddress = await arbitrumL1GatewayRouter.getGateway(mainnetUSDS);
    const cometFactory = await deploymentManager.fromDep('cometFactory', 'arbitrum', 'usdc.e');

    const usdsGasParams = await estimateTokenBridge(
      {
        token: DAIAddress,
        from: timelock.address,
        to: comet.address,
        amount: exp(1, 18),
      },
      govDeploymentManager,
      deploymentManager
    );
    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const arbitrumChainId = 42161;
    const newMarketObject = { baseSymbol: 'USDS', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[arbitrumChainId]) {
      officialMarketsJSON[arbitrumChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[arbitrumChainId] = [newMarketObject];
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
      [comet.address, arbitrumCOMPAddress]
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

    const approveToGatewayCalldata = utils.defaultAbiCoder.encode(
      ['address', 'uint256'],
      [usdsGatewayAddress, USDSAmount]
    );

    const l2ProposalData = utils.defaultAbiCoder.encode(
      ['address[]', 'uint256[]', 'string[]', 'bytes[]'],
      [
        [
          configurator.address,
          configurator.address,
          cometAdmin.address,
          rewards.address
        ],
        [
          0,
          0,
          0,
          0
        ],
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
          setRewardConfigCalldata
        ]
      ]
    );

    const createRetryableTicketGasParams = await estimateL2Transaction(
      {
        from: applyL1ToL2Alias(timelock.address),
        to: bridgeReceiver.address,
        data: l2ProposalData
      },
      deploymentManager
    );

    const actions = [
      // 1. Set Comet configuration + deployAndUpgradeTo new Comet, set reward config on Arbitrum.
      {
        contract: arbitrumInbox,
        signature: 'createRetryableTicket(address,uint256,uint256,address,address,uint256,uint256,bytes)',
        args: [
          bridgeReceiver.address,                           // address to,
          0,                                                // uint256 l2CallValue,
          createRetryableTicketGasParams.maxSubmissionCost, // uint256 maxSubmissionCost,
          l2Timelock.address,                               // address excessFeeRefundAddress,
          l2Timelock.address,                               // address callValueRefundAddress,
          createRetryableTicketGasParams.gasLimit,          // uint256 gasLimit,
          createRetryableTicketGasParams.maxFeePerGas,      // uint256 maxFeePerGas,
          l2ProposalData,                                   // bytes calldata data
        ],
        value: createRetryableTicketGasParams.deposit
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
      // 5. Approve USDS to the arbitrumL1GatewayRouter
      {
        target: mainnetUSDS,
        signature: 'approve(address,uint256)',
        calldata: approveToGatewayCalldata
      },
      // 6. Bridge USDS from Ethereum to Arbitrum Comet using arbitrumL1GatewayRouter
      {
        contract: arbitrumL1GatewayRouter,
        signature: 'outboundTransferCustomRefund(address,address,address,uint256,uint256,uint256,bytes)',
        args: [
          mainnetUSDS,                              // address _token,
          l2Timelock.address,                       // address _refundTo
          comet.address,                            // address _to,
          USDSAmount,                               // uint256 _amount,
          usdsGasParams.gasLimit,                   // uint256 _maxGas,
          usdsGasParams.maxFeePerGas,               // uint256 _gasPriceBid,
          utils.defaultAbiCoder.encode(
            ['uint256', 'bytes'],
            [usdsGasParams.maxSubmissionCost, '0x']
          )                                         // bytes calldata _data
        ],
        value: usdsGasParams.deposit
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

    const description = "# Initialize cUSDSv3 on Arbitrum\n\n## Proposal summary\n\nCompound Growth Program [AlphaGrowth] proposes deployment of Compound III to the Arbitrum network. This proposal takes the governance steps recommended and necessary to initialize a Compound III USDS market on Arbitrum; upon execution, cUSDSv3 will be ready for use. Simulations have confirmed the market’s readiness, as much as possible, using the [Comet scenario suite](https://github.com/compound-finance/comet/tree/main/scenario). The new parameters include setting the risk parameters based off of the [recommendations from Gauntlet](https://www.comp.xyz/t/add-market-usds-on-arbitrum/6384/4).\n\nFurther detailed information can be found on the corresponding [proposal pull request](https://github.com/compound-finance/comet/pull/986), [deploy market GitHub action run](https://github.com/woof-software/comet/actions/runs/15008636511) and [forum discussion](https://www.comp.xyz/t/add-market-usds-on-arbitrum/6384).\n\n\n## Proposal Actions\n\nThe first proposal action sets the Comet configuration and deploys a new Comet implementation on Arbitrum. This sends the encoded `setFactory`, `setConfiguration`, `deployAndUpgradeTo` calls across the bridge to the governance receiver on Arbitrum. It also calls `setRewardConfig` on the Arbitrum rewards contract, to establish Artitrum’s bridged version of COMP as the reward token for the deployment and set the initial supply speed to be 24 COMP/day and borrow speed to be 12 COMP/day.\n\nThe second action reduces Compound’s [cDAI](https://etherscan.io/address/0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643) reserves and transfers it to Timelock, in order to convert it to USDS to then bridge and seed the market reserves for the cUSDSv3 Comet.\n\nThe third action approves DAI to DAI-to-USDS native converter.\n\nThe fourth action converts DAI to USDS with 1:1 ratio and transfers USDS to cUSDSv3 Comet.\n\nThe fifth action approves (ArbitrumL1GatewayRouter) [TokenMessenger](https://etherscan.io/address/0x72Ce9c846789fdB6fC1f34aC4AD25Dd9ef7031ef) to take the Timelock's USDS on Mainnet, in order to seed the market reserves through the arbitrumL1GatewayRouter.\n\nThe sixth action bridges USDS from mainnet via ‘outboundTransfer’ function on ArbitrumL1GatewayRouter’s contract to mint native USDS to Comet on Arbitrum.\n\nThe seventh action updates the ENS TXT record `v3-official-markets` on `v3-additional-grants.compound-community-licenses.eth`, updating the official markets JSON to include the new Arbitrum cUSDSv3 market.\n";
    const txn = await govDeploymentManager.retry(async () =>
      trace(await governor.propose(...(await proposal(actions, description))))
    );

    const event = txn.events.find(event => event.event === 'ProposalCreated');
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
      comet
    } = await deploymentManager.getContracts();

    const {
      timelock
    } = await govDeploymentManager.getContracts();

    // 1.
    const stateChanges = await diffState(comet, getCometConfig, preMigrationBlockNumber);
    expect(stateChanges).to.deep.equal({
      sUSDS: {
        supplyCap: exp(25_000_000, 18)
      },
      baseTrackingSupplySpeed: exp(24 / 86400, 15, 18), // 277777777777
      baseTrackingBorrowSpeed: exp(12 / 86400, 15, 18), // 138888888888
    });

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

    expect(await comet.getReserves()).to.be.equal(USDSAmount);

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
        },
        {
          baseSymbol: 'WBTC',
          cometAddress: '0xe85Dc543813B8c2CFEaAc371517b925a166a9293'
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
        },
        {
          baseSymbol: 'WETH',
          cometAddress: '0x6C987dDE50dB1dcDd32Cd4175778C2a291978E2a'
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
      2020: [
        {
          baseSymbol: 'WETH',
          cometAddress: '0x4006eD4097Ee51c09A04c3B0951D28CCf19e6DFE'
        },
        {
          baseSymbol: 'WRON',
          cometAddress: '0xc0Afdbd1cEB621Ef576BA969ce9D4ceF78Dbc0c0'
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
        },
        {
          baseSymbol: 'USDS',
          cometAddress: comet.address
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
