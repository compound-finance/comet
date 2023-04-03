import { BigNumber, Contract } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { calldata, exp, getConfigurationStruct, proposal } from '../../../../src/deploy';
import { expect } from 'chai';

const ENSName = 'compound-community-licenses.eth';
const ENSResolverAddress = '0x19c2d5D0f035563344dBB7bE5fD09c8dad62b001';
const ENSRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ENSSubdomainLabel = 'v3-additional-grants';
const ENSSubdomain = `${ENSSubdomainLabel}.${ENSName}`;
const ENSTextRecordKey = 'v3-official-markets';

export default migration('1679592519_configurate_and_ens', {
  prepare: async (deploymentManager: DeploymentManager) => {
    return {};
  },

  enact: async (deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) => {
    const trace = deploymentManager.tracer();
    const ethers = deploymentManager.hre.ethers;
    const { utils } = ethers;

    const {
      l2CrossDomainMessenger,
      bridgeReceiver,
      comet,
      cometAdmin,
      configurator,
      rewards,
      timelock: optimismTimelock,
      USDC: optimismUSDC,
      COMP: optimismCOMP
    } = await deploymentManager.getContracts();

    const {
      optimismL1CrossDomainMessenger,
      optimismL1StandardBridge,
      governor,
      timelock: goerliTimelock,
      USDC: goerliUSDC,
      COMP: goerliCOMP,
    } = await govDeploymentManager.getContracts();

    // ENS Setup
    // See also: https://docs.ens.domains/contract-api-reference/name-processing
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const optimismGoerliChainId = (await deploymentManager.hre.ethers.provider.getNetwork()).chainId.toString();
    const newMarketObject = { baseSymbol: 'USDC', cometAddress: comet.address };
    const officialMarketsJSON = JSON.parse(await ENSResolver.text(subdomainHash, ENSTextRecordKey));
    if (officialMarketsJSON[optimismGoerliChainId]) {
      officialMarketsJSON[optimismGoerliChainId].push(newMarketObject);
    } else {
      officialMarketsJSON[optimismGoerliChainId] = [newMarketObject];
    }

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

    const USDCAmountToBridge = exp(10, 6);
    const COMPAmountToBridge = exp(10_000, 18);

    console.log('estimating gas limit')
    // const aliasedSigner = await impersonateAddress(
    //   bridgeDeploymentManager,
    //   applyL1ToL2Alias(optimismL1CrossDomainMessenger.address)
    // );
    // const gasLimit = await deploymentManager.hre.ethers.provider.estimateGas({
    //   from: l2CrossDomainMessenger.address,
    //   to: bridgeReceiver.address,
    //   data: l2ProposalData,
    // })
    function applyL1ToL2Alias(address: string) {
      const offset = BigInt('0x1111000000000000000000000000000000001111');
      return `0x${(BigInt(address) + offset).toString(16)}`;
    }
    
    const l2Alias = applyL1ToL2Alias(optimismL1CrossDomainMessenger.address);
    const relayMessageTxn = await l2CrossDomainMessenger.connect('0x0000000000000000000000000000000000000001').populateTransaction.relayMessage(
      BigNumber.from('0x0001000000000000000000000000000000000000000000000000000000000007'), // message nonce
      goerliTimelock.address, // sender
      optimismTimelock.address, // target
      0,
      0,
      l2ProposalData, // message,
      { gasLimit: 5_000_000 }
    );
    const gasLimit = await deploymentManager.hre.ethers.provider.estimateGas(relayMessageTxn);
    // const gasLimit = await deploymentManager.hre.ethers.provider.estimateGas({
    //   from: l2CrossDomainMessenger.address,
    //   to: bridgeReceiver.address,
    //   data: l2ProposalData,
    // })
    console.log('provider ', deploymentManager.hre.ethers.provider)
    console.log('network provider ', deploymentManager.hre.network.provider)

    console.log('gas limit is ', gasLimit)

    const goerliActions = [
      // 1. Set Comet configuration and deployAndUpgradeTo new Comet on Optimism-Goerli.
      {
        contract: optimismL1CrossDomainMessenger,
        signature: 'sendMessage(address,bytes,uint32)',
        args: [bridgeReceiver.address, l2ProposalData, 5_000_000] // XXX find a reliable way to estimate the gasLimit
      },
      // 2. Approve Goerli's L1StandardBridge to take Timelock's USDC (for bridging)
      {
        contract: goerliUSDC,
        signature: 'approve(address,uint256)',
        args: [optimismL1StandardBridge.address, USDCAmountToBridge]
      },
      // 3. Bridge USDC from Goerli to Optimism-Goerli Comet using L1StandardBridge
      {
        contract: optimismL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature: 'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [goerliUSDC.address, optimismUSDC.address, comet.address, USDCAmountToBridge, 1_000_000, '0x']
      },
      // 4. Approve Goerli's L1StandardBridge to take Timelock's COMP (for bridging)
      {
        contract: goerliCOMP,
        signature: 'approve(address,uint256)',
        args: [optimismL1StandardBridge.address, COMPAmountToBridge]
      },
      // 5. Bridge COMP from Goerli to Optimism-Goerli Comet using L1StandardBridge
      {
        contract: optimismL1StandardBridge,
        // function depositERC20To(address _l1Token, address _l2Token, address _to, uint256 _amount, uint32 _l2Gas,bytes calldata _data)
        signature: 'depositERC20To(address,address,address,uint256,uint32,bytes)',
        args: [goerliCOMP.address, optimismCOMP.address, rewards.address, COMPAmountToBridge, 1_000_000, '0x']
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
    ];

    const description = "Configurate Optimism-Goerli cUSDCv3 market, bridge over USDC and COMP, and update ENS text record.";
    // const txn = await govDeploymentManager.retry(async () =>
    //   trace(await governor.propose(...(await proposal(goerliActions, description))))
    // );

    // const event = txn.events.find(event => event.event === 'ProposalCreated');
    // const [proposalId] = event.args;

    // trace(`Created proposal ${proposalId}.`);
  },

  async verify(deploymentManager: DeploymentManager, govDeploymentManager: DeploymentManager) {
    const ethers = deploymentManager.hre.ethers;

    const {
      comet,
      rewards,
      COMP,
      OP,
      WBTC,
      WETH,
      USDC
    } = await deploymentManager.getContracts();

    const {
      timelock,
    } = await govDeploymentManager.getContracts();

    // 1.
    // XXX create a differ that can diff the before and after. better than checking specific fields
    const opInfo = await comet.getAssetInfoByAddress(OP.address);
    const wbtcInfo = await comet.getAssetInfoByAddress(WBTC.address);
    const wethInfo = await comet.getAssetInfoByAddress(WETH.address);
    expect(await opInfo.supplyCap).to.be.eq(exp(1_000_000, 18));
    expect(await wbtcInfo.supplyCap).to.be.eq(exp(20_000, 8));
    expect(await wethInfo.supplyCap).to.be.eq(exp(50_000, 18));

    // 2. & 3.
    expect(await comet.getReserves()).to.be.equal(exp(10, 6));
    expect(await USDC.balanceOf(comet.address)).to.be.equal(exp(10, 6));

    // 4. & 5.
    expect(await COMP.balanceOf(rewards.address)).to.be.equal(exp(10_000, 18));

    // 6.
    const ENSResolver = await govDeploymentManager.existing('ENSResolver', ENSResolverAddress, 'goerli');
    const subdomainHash = ethers.utils.namehash(ENSSubdomain);
    const officialMarketsJSON = await ENSResolver.text(subdomainHash, ENSTextRecordKey);
    const officialMarkets = JSON.parse(officialMarketsJSON);
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
          cometAddress: '0xF09F0369aB0a875254fB565E52226c88f10Bc839',
        },
      ],
      420: [
        {
          baseSymbol: 'USDC',
          cometAddress: comet.address,
        },
      ],
    });

    // XXX check ether used as gas on mainnet
  }
});