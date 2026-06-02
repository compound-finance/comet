import { DeploymentManager } from '../../plugins/deployment_manager';
import { getRoots } from '../../plugins/deployment_manager/Roots';
import { OpenProposal } from '../context/Gov';
import { utils } from 'ethers';
import { forkedHreForBase } from '../../plugins/scenario/utils/hreForBase';

const EXCLUDED_ROOTS = ['comptrollerV2', 'comet', 'configurator', 'rewards', 'bulker', 'cometFactory'];

const CCTP_DOMAIN_TO_NETWORK: Record<number, string> = {
  0: 'mainnet',
  1: 'avalanche',
  2: 'optimism',
  3: 'arbitrum',
  6: 'base',
  7: 'polygon',
};

const ROOT_TO_NETWORK: Record<string, string> = {
  fxRoot: 'polygon',
  arbitrumInbox: 'arbitrum',
  arbitrumL1GatewayRouter: 'arbitrum',
  baseL1CrossDomainMessenger: 'base',
  baseL1StandardBridge: 'base',
  baseL1USDSBridge: 'base',
  opL1CrossDomainMessenger: 'optimism',
  opL1StandardBridge: 'optimism',
  mantleL1CrossDomainMessenger: 'mantle',
  mantleL1StandardBridge: 'mantle',
  unichainL1CrossDomainMessenger: 'unichain',
  unichainL1StandardBridge: 'unichain',
  scrollMessenger: 'scroll',
  scrollL1USDCGateway: 'scroll',
  lineaMessageService: 'linea',
  lineaL1TokenBridge: 'linea',
  lineaL1USDCBridge: 'linea',
  l1CCIPRouter: 'ronin',
  l1TokenAdminRegistry: 'ronin',
  roninl1CCIPOnRamp: 'ronin',
  roninl1NativeBridge: 'ronin',
};

function parseCCTPNetworks(openProposal: OpenProposal, cctpAddress: string): string[] {
  const networks: string[] = [];
  const cctpLower = cctpAddress.toLowerCase();

  for (let i = 0; i < openProposal.targets.length; i++) {
    if (openProposal.targets[i].toLowerCase() !== cctpLower) continue;
    const sig = openProposal.signatures[i];
    if (!sig.startsWith('depositForBurn(')) continue;

    const calldata = openProposal.calldatas[i];
    // destinationDomain is the second parameter (uint32) in all depositForBurn variants
    const decoded = utils.defaultAbiCoder.decode(['uint256', 'uint32'], utils.hexDataSlice(calldata, 0, 64));
    const domain = decoded[1];
    const network = CCTP_DOMAIN_TO_NETWORK[domain];
    if (network) networks.push(network);
  }
  return networks;
}

export async function getProposalBridgeNetworks(
  governanceDeploymentManager: DeploymentManager,
  openProposal: OpenProposal
): Promise<string[]> {
  const roots = await getRoots(governanceDeploymentManager.cache);
  const targets = openProposal.targets.map(t => t.toLowerCase());

  const networks = new Set<string>();
  for (const [alias, address] of roots) {
    if (EXCLUDED_ROOTS.includes(alias)) continue;

    if (alias === 'CCTPTokenMessenger' && targets.includes(address.toLowerCase())) {
      for (const net of parseCCTPNetworks(openProposal, address)) {
        networks.add(net);
      }
      continue;
    }

    const network = ROOT_TO_NETWORK[alias];
    if (network && targets.includes(address.toLowerCase())) {
      networks.add(network);
    }
  }
  return [...new Set(networks)];
}

const existingBridgeManagers: Record<string, DeploymentManager> = {};

export async function isBridgeProposal(
  governanceDeploymentManager: DeploymentManager,
  bridgeDeploymentManager: DeploymentManager,
  openProposal: OpenProposal
) {
  const bridgeNetworks = await getProposalBridgeNetworks(governanceDeploymentManager, openProposal);
  const otherBridgeNetworks = bridgeNetworks.filter(n => n !== bridgeDeploymentManager.network);
  const bridgeManagers = [bridgeDeploymentManager];
  if (!existingBridgeManagers[bridgeDeploymentManager.network]) {
    existingBridgeManagers[bridgeDeploymentManager.network] = bridgeDeploymentManager;
  }
  if (!existingBridgeManagers[governanceDeploymentManager.network]) {
    existingBridgeManagers[governanceDeploymentManager.network] = governanceDeploymentManager;
  }
  for(const bridgeNetwork of otherBridgeNetworks) {
    if (existingBridgeManagers[bridgeNetwork]) {
      bridgeManagers.push(existingBridgeManagers[bridgeNetwork]);
      continue;
    }
    
    let deploymentToken: string;

    let dm: DeploymentManager;
    let existingBridgedDm: DeploymentManager | undefined;
    for (const cachedDm of governanceDeploymentManager.bridgedDeploymentManagers.values()) {
      if (cachedDm.network === bridgeNetwork) {
        existingBridgedDm = cachedDm;
        break;
      }
    }

    if (existingBridgedDm) {
      dm = existingBridgedDm;
    } else {
      // default deployment token is USDC for all networks except Ronin (WETH) and Mantle (USDE)
      switch (bridgeNetwork) {
        case 'arbitrum':
        case 'polygon':
        case 'base':
        case 'linea':
        case 'optimism':
        case 'unichain':
        case 'scroll':
          deploymentToken = 'usdc';
          break;
        case 'mantle':
          deploymentToken = 'usde';
          break;
        case 'ronin':
          deploymentToken = 'weth';
          break;
        default: {
          const tag = `[${governanceDeploymentManager.network} -> ${bridgeNetwork}]`;
          throw new Error(`${tag} Unable to determine whether to relay Proposal ${openProposal.id}`);
        }
      }

      const hre = await forkedHreForBase({ name: '', network: bridgeNetwork, deployment: '' });
      dm = await governanceDeploymentManager.addBridgedDeploymentManager(bridgeNetwork, deploymentToken, hre);
    }
    
    existingBridgeManagers[bridgeNetwork] = dm;
    bridgeManagers.push(dm);
  }
  return bridgeManagers;
}

