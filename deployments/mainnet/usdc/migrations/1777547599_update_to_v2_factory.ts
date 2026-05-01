import { expect } from 'chai';
import { Contract, utils } from 'ethers';
import { DeploymentManager } from '../../../../plugins/deployment_manager/DeploymentManager';
import { migration } from '../../../../plugins/deployment_manager/Migration';
import { proposal } from '../../../../src/deploy';

const USDC_COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3';
const USDS_COMET = '0x5D409e56D886231aDAf00c8775665AD0f9897b56';
const USDT_COMET = '0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840';
const WBTC_COMET = '0xe85Dc543813B8c2CFEaAc371517b925a166a9293';
const WETH_COMET = '0xA17581A9E3356d9A858b789D68B4d866e593aE94';
const WSTETH_COMET = '0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3';

const cometNameInBytecodeRepo = 'CometWithExtAssetList';
const COMET_FACTORY_V2 = '0xd75a4c7544271cfe38F6a10E381923627a950c5f';
const BYTECODE_REPOSITORY = '0x6e937eDEa2858c2760B74dA605a377078DBd3997';
const BYTECODE_REPOSITORY_IMPL = '0xf4c0a62b34601d3c461c6b0fcf151763175a893b';

export default migration('1777547599_update_to_v2_factory', {
  async prepare(deploymentManager: DeploymentManager) {
    // const { configurator, comet } = await deploymentManager.getContracts();
    // const configuration = await configurator.getConfiguration(comet.address);
    // const newCometImplementation = await deploymentManager.deploy(
    //   'comet:implementation',
    //   'CometWithExtendedAssetList.sol',
    //   [configuration],
    //   true
    // );
    return {
      // newCometImplementation: newCometImplementation.address
    };
  },

  async enact(deploymentManager: DeploymentManager, _,
    // { newCometImplementation }
  ) {

    const trace = deploymentManager.tracer();

    const {
      governor,
      cometAdmin,
      timelock,
      configurator,
    } = await deploymentManager.getContracts();

    const newFactory = await deploymentManager.existing(
      'cometFactoryV2',
      COMET_FACTORY_V2,
      'mainnet'
    );

    const bytecodeRepository = await deploymentManager.existing(
      'bytecodeRepository',
      [BYTECODE_REPOSITORY_IMPL, BYTECODE_REPOSITORY],
      'mainnet'
    );

    // const newImplementation = await deploymentManager.existing(
    //   'comet:implementation',
    //   newCometImplementation,
    //   'mainnet'
    // );

    const artifact = await deploymentManager.hre.artifacts.readArtifact('CometWithExtendedAssetList');
    const newCometImplementationBytecode = artifact.bytecode;

    const mainnetActions = [
      // 0. ONLY FOR TEST
      {
        contract: bytecodeRepository,
        signature: 'assignDeveloperForContractTypes(bytes32[],address)',
        args: [
          [utils.formatBytes32String(cometNameInBytecodeRepo)],
          timelock.address
        ],
      },
      // 1. Update USDC Comet factory to a new one
      {
        contract: configurator,
        signature: 'setFactory(address,address)',
        args: [USDC_COMET, newFactory.address],
      },
      // 2. Add new comet implementation to the bytecode repository
      {
        contract: bytecodeRepository,
        signature: 'releasePatchVersion((bytes32,bytes,string),uint64,uint64)',
        args: [{
          contractType: utils.formatBytes32String(cometNameInBytecodeRepo),
          initCode: newCometImplementationBytecode,
          sourceURL: 'URL',
        },
        1, // major version
        0  // minor version
        ],
      },
      // 3. Set new version to bytecode repository
      {
        contract: newFactory,
        signature: 'setVersion(((uint64,uint64,uint64),string))',
        args: [{
          version: { major: 1, minor: 0, patch: 1 },
          alternative: ''
        }]
      },
      // X. Deploy and upgrade to a new version of Comet
      {
        contract: cometAdmin,
        signature: 'deployAndUpgradeTo(address,address)',
        args: [configurator.address, USDC_COMET],
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
    const { comet, configurator } = await deploymentManager.getContracts();

  },
});
