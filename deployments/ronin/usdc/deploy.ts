import {
  Deployed,
  DeploymentManager,
} from '../../../plugins/deployment_manager';
import { DeploySpec, deployComet } from '../../../src/deploy';

export default async function deploy(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed | void> {
  const deployed = await deployContracts(deploymentManager, deploySpec);
  return deployed;
}

async function deployContracts(
  deploymentManager: DeploymentManager,
  deploySpec: DeploySpec
): Promise<Deployed | void> {

  const l2CCIPRouter = await deploymentManager.existing(
    'l2CCIPRouter',
    '0x46527571D5D1B68eE7Eb60B18A32e6C60DcEAf99',
    'ronin'
  );

  const roninl2NativeBridge = await deploymentManager.existing(
    'roninl2NativeBridge',
    '0x0cf8ff40a508bdbc39fbe1bb679dcba64e65c7df',
    'ronin'
  );
  // const _cometFactory = await deploymentManager.existing(
  //   'cometFactory',
  //   '0x4DF9E0f8e94a7A8A9aEa6010CD9d341F8Ecfe4c6',
  //   'ronin'
  // );
  
  const _cometFactory = await deploymentManager.fromDep('cometFactory', 'ronin', 'weth');
  const _cometAdmin = await deploymentManager.fromDep('cometAdmin', 'ronin', 'weth');
  const _$configuratorImpl = await deploymentManager.fromDep('configurator:implementation', 'ronin', 'weth');
  const _configurator = await deploymentManager.fromDep('configurator', 'ronin', 'weth');
  const _rewards = await deploymentManager.fromDep('rewards', 'ronin', 'weth');
  const bulker = await deploymentManager.fromDep('bulker', 'ronin', 'weth');
  const _localTimelock = await deploymentManager.fromDep('timelock', 'ronin', 'weth');
  const bridgeReceiver = await deploymentManager.fromDep('bridgeReceiver', 'ronin', 'weth');

  const _WRON = await deploymentManager.existing(
    'WRON',
    '0xe514d9deb7966c8be0ca922de8a064264ea6bcd4',
    'ronin'
  );

  const _WETH = await deploymentManager.existing(
    'WETH',
    '0xc99a6a985ed2cac1ef41640596c5a5f9f4e19ef5',
    'ronin'
  );

  const _USDC = await deploymentManager.existing(
    'USDC',
    '0x0b7007c13325c48911f73a2dad5fa5dcbf808adc',
    'ronin'
  );

  const _AXS = await deploymentManager.existing(
    'AXS',
    '0x97a9107c1793bc407d6f527b77e7fff4d812bece',
    'ronin'
  );

  // const COMP = await deploymentManager.existing(
  //   'COMP',
  //   '',
  //   'ronin'
  // );

  const l2CCIPOffRamp = await deploymentManager.existing(
    'l2CCIPOffRamp',
    '0x320A10449556388503Fd71D74A16AB52e0BD1dEb',
    'ronin'
  );

  // Deploy all Comet-related contracts
  const deployed = await deployComet(deploymentManager, deploySpec, {}, true);

  return {
    ...deployed,
    bridgeReceiver,
    l2CCIPRouter,
    l2CCIPOffRamp,
    roninl2NativeBridge,
    bulker
  };
}
