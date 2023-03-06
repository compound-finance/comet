import { Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

const ERC20PredicateAddress = '0x40ec5B33f54e0E8A33A975908C5BA1c14e5BbbDf';
const RootChainManagerAddress = '0xA0c68C638235ee32657e8f720a23ceC1bFc77C77';

const cUSDTAddress = '0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9';

export default migration('1675200105_configurate_and_ens', {
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
      comptrollerV2,
      USDC,
      COMP,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const nameHash = ethers.utils.namehash(ENSName);
    const labelHash = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(ENSSubdomainLabel));
    const subdomainHash = ethers.utils.namehash(ENSSubdomain), ttl = 0;
    const officialMarkets = {
      1: [
        {
          baseSymbol: 'USDC',
          cometAddress: (await govDeploymentManager.fromDep('cUSDCv3', 'mainnet', 'usdc', 'comet')).address,
        },
        {
          baseSymbol: 'WETH',
          cometAddress: (await govDeploymentManager.fromDep('cWETHv3', 'mainnet', 'weth', 'comet')).address
        }
      ],

      137: [
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
      RootChainManagerAddress
    );
    const USDCAmountToBridge = exp(10_000, 6);
    const COMPAmountToBridge = exp(2_500, 18);
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
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Polygon.
      {
        contract: fxRoot,
        signature: 'sendMessageToChild(address,bytes)',
        args: [bridgeReceiver.address, l2ProposalData]
      },
      // 2. Approve Polygon's ERC20Predicate to take Timelock's USDC (for bridging)
      {
        contract: USDC,
        signature: 'approve(address,uint256)',
        args: [ERC20PredicateAddress, USDCAmountToBridge]
      },
      // 3. Bridge USDC from mainnet to Polygon Comet using RootChainManager
      {
        target: RootChainManager.address,
        signature: 'depositFor(address,address,bytes)',
        calldata: depositForUSDCCalldata
      },
      // 4. Approve Polygon's ERC20Predicate to take Timelock's COMP (for bridging)
      {
        contract: COMP,
        signature: 'approve(address,uint256)',
        args: [ERC20PredicateAddress, COMPAmountToBridge]
      },
      // 5. Bridge COMP from mainnet to Polygon CometRewards using RootChainManager
      {
        target: RootChainManager.address,
        signature: 'depositFor(address,address,bytes)',
        calldata: depositForCOMPCCalldata
      },

      // 6. Set up ENS license subdomain with the Timelock as the owner
      {
        target: ENSRegistryAddress,
        signature: 'setSubnodeRecord(bytes32,bytes32,address,address,uint64)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'bytes32', 'address', 'address', 'uint64'],
          [nameHash, labelHash, timelock.address, ENSResolverAddress, ttl]
        )
      },

      // 7. Establish the new list of official markets
      {
        target: ENSResolverAddress,
        signature: 'setText(bytes32,string,string)',
        calldata: ethers.utils.defaultAbiCoder.encode(
          ['bytes32', 'string', 'string'],
          [subdomainHash, ENSTextRecordKey, JSON.stringify(officialMarkets)]
        )
      },

      // 8. Displace v2 USDT COMP rewards
      {
        contract: comptrollerV2,
        signature: '_setCompSpeeds(address[],uint256[],uint256[])',
        args: [
          [cUSDTAddress],
          [0],
          [4825000000000000],
        ],
      },
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
    return true;
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      rewards,
      WBTC,
      WETH,
      WMATIC
    } = await deploymentManager.getContracts();

    const {
      timelock,
      comptrollerV2,
    } = await govDeploymentManager.getContracts();

    // 1.
    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);
    const wmaticInfo = await comet.getAssetInfoByAddress(WMATIC.address);
    expect(wbtcInfo.supplyCap).to.be.eq(exp(400, 8));
    expect(wethInfo.supplyCap).to.be.eq(exp(11_000, 18));
    expect(wmaticInfo.supplyCap).to.be.eq(exp(10_000_000, 18));
    expect(await comet.pauseGuardian()).to.be.eq('0x8Ab717CAC3CbC4934E63825B88442F5810aAF6e5');

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(exp(10_000, 6));

    // 4. & 5.
    const polygonCOMP = new Contract(
      '0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c',
      ['function balanceOf(address account) external view returns (uint256)'],
      deploymentManager.hre.ethers.provider
    );
    expect(await polygonCOMP.balanceOf(rewards.address)).to.be.equal(exp(2_500, 18));

    // 6. & 7.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress);
    const ENSRegistry = await govDeploymentManager.existing('ENSRegistry', ENSRegistryAddress);
    const nameHash = ethers.utils.namehash(ENSName);
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
    expect(await ENSRegistry.recordExists(subdomainHash)).to.be.equal(true);
    expect(await ENSRegistry.owner(subdomainHash)).to.be.equal(timelock.address);
    expect(await ENSRegistry.resolver(subdomainHash)).to.be.equal(ENSResolverAddress);
    expect(await ENSRegistry.ttl(subdomainHash)).to.be.equal(0);
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
          cometAddress: comet.address,
        },
      ]
    });

    // 8.
    expect(await comptrollerV2.compBorrowSpeeds(cUSDTAddress)).to.be.equal(4825000000000000n);
    expect(await comptrollerV2.compSupplySpeeds(cUSDTAddress)).to.be.equal(0);
    expect(await comet.baseTrackingSupplySpeed()).to.be.equal(0);
    expect(await comet.baseTrackingBorrowSpeed()).to.be.equal(exp(34.74 / 86400, 15, 18));
  }
});
