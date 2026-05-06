import { expect } from 'chai';
import { Contract, utils, Wallet } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { exp, proposal } from '../../../../src/deploy';

const USDC_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';
const WBTC_COMET = '0xe85Dc543813B8c2CFEaAc371517b925a166a9293';
const WETH_COMET = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';
const WSTETH_COMET = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';

const cometNameInBytecodeRepo = 'CometWithExtAssetList';
const COMET_FACTORY_V2 = '0x1cF749BA716b517B610DEA801622FE502C03889a';
const BYTECODE_REPOSITORY = '0x6e937eDEa2858c2760B74dA605a377078DBd3997';
const BYTECODE_REPOSITORY_IMPL = '0xf4c0a62b34601d3c461c6b0fcf151763175a893b';
const ETH_PK_TEST = process.env.ETH_PK_TEST || '';

export default migration('1777547599_update_to_v2_factory', {
  async prepare(deploymentManager: DeploymentManager) {
    const bytecodeRepository = await deploymentManager.existing(
      'bytecodeRepository',
      [BYTECODE_REPOSITORY_IMPL, BYTECODE_REPOSITORY],
      'mainnet'
    );

    // impersonate timelock
    const { timelock } = await deploymentManager.getContracts();
    await deploymentManager.hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [timelock.address],
    });
    const timelockSigner = await deploymentManager.getSigner(timelock.address);

    const signer = new Wallet(ETH_PK_TEST, (await deploymentManager.getSigner()).provider);
    await deploymentManager.hre.network.provider.request({
      method: 'hardhat_setBalance',
      params: [signer.address, '0x1000000000000000000'], // 1,000 ETH
    });

    await bytecodeRepository.connect(timelockSigner).assignDeveloperForContractTypes(
      [utils.formatBytes32String(cometNameInBytecodeRepo)],
      signer.address
    );

    const artifact = await deploymentManager.hre.artifacts.readArtifact('CometWithExtendedAssetList');
    const newCometImplementationBytecode = artifact.bytecode;
    await bytecodeRepository.connect(signer).releasePatchVersion({
      contractType: utils.formatBytes32String(cometNameInBytecodeRepo),
      initCode: newCometImplementationBytecode,
      sourceURL: 'URL',
    }, 1, 0);

    await bytecodeRepository.connect(timelockSigner).grantRole(
      await bytecodeRepository.AUDITOR_ROLE(),
      '0x58ce14e55f4e38569ec96480d11266056f7e12ec'
    );

    // Sign bytecode
    const version = {
      version: { major: 1, minor: 0, patch: 1 },
      alternative: ''
    };
    const bytecodeHash = await bytecodeRepository.computeBytecodeHash(utils.formatBytes32String(cometNameInBytecodeRepo), version);
    const domain = {
      name: 'VersionController',
      version: '1',
      chainId: 1,
      verifyingContract: bytecodeRepository.address
    };
    const auditReportType = {
      AuditReport: [
        { name: 'bytecodeVersionHash', type: 'bytes32' },
        { name: 'bytecodeHash', type: 'bytes32' },
        { name: 'auditReport', type: 'string' }
      ]
    };
    const auditReportValues = {
      bytecodeVersionHash: bytecodeHash,
      bytecodeHash,
      auditReport: 'audit report'
    };

    const signature = await signer._signTypedData(domain, auditReportType, auditReportValues);
    const bytecodeVersion = { contractType: utils.formatBytes32String(cometNameInBytecodeRepo), version };
    await bytecodeRepository.connect(signer).verifyBytecode(bytecodeVersion, 'audit report', signature);

    return {};
  },

  async enact(deploymentManager: DeploymentManager) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      cometAdmin,
      configurator,
    } = await deploymentManager.getContracts();

    const newFactory = await deploymentManager.existing(
      'cometFactoryV2',
      COMET_FACTORY_V2,
      'mainnet'
    );

    const mainnetActions = [
      // 1. Update USDC Comet factory to a new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDC_COMET, newFactory.address],
      },
      // 2. Set new version to bytecode repository
      {
        contract: newFactory,
        signature: 'setVersion(((uint64,uint64,uint64),string))',
        args: [{
          version: { major: 1, minor: 0, patch: 1 },
          alternative: ''
        }]
      },
      // 3. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDC_COMET],
      },
      // 4. Update USDT Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDT_COMET, newFactory.address],
      },
      // 5. Deploy and upgrade USDT Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDT_COMET],
      },
      // 6. Update USDS Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDS_COMET, newFactory.address],
      },
      // 7. Deploy and upgrade USDS Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDS_COMET],
      },
      // 8. Update WBTC Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [WBTC_COMET, newFactory.address],
      },
      // 9. Deploy and upgrade WBTC Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WBTC_COMET],
      },
      // 10. Update WETH Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [WETH_COMET, newFactory.address],
      },
      // 11. Deploy and upgrade WETH Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WETH_COMET],
      },
      // 12. Update wstETH Comet factory to the new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [WSTETH_COMET, newFactory.address],
      },
      // 13. Deploy and upgrade wstETH Comet to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, WSTETH_COMET],
      },
    ];

    const description = `DESCRIPTION`;
    const txn = await deploymentManager.retry(async () =>
      trace(
        await governor.propose(...(await proposal(mainnetActions, description)))
      ), 0, 300_000
    );

    const event = txn.events.find(
      (event: { event: string }) => event.event === 'ProposalCreated'
    );
    const [proposalId] = event.args;
    trace(`Created proposal ${proposalId}.`);
  },

  async enacted(): Promise<boolean> {
    return false;
  },

  async verify(deploymentManager: DeploymentManager) {
    const expectedMaxUtilization = exp(2, 18);
    const signer = await deploymentManager.getSigner();

    const newCometUsdc = new Contract(
      USDC_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometUsdc.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);

    const newCometUsdt = new Contract(
      USDT_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometUsdt.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);

    const newCometUsds = new Contract(
      USDS_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometUsds.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);

    const newCometWbtc = new Contract(
      WBTC_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometWbtc.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);

    const newCometWeth = new Contract(
      WETH_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometWeth.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);

    const newCometWsteth = new Contract(
      WSTETH_COMET, 
      ['function MAX_SUPPORTED_UTILIZATION() external view returns (uint256)'],
      signer
    );

    expect(await newCometWsteth.MAX_SUPPORTED_UTILIZATION()).to.equal(expectedMaxUtilization);
  },
});
