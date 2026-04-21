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
    const hre = await forkedHreForBase({ name: '', network: bridgeNetwork, deployment: '' });
    let dm: DeploymentManager;
    switch (bridgeNetwork) {
      case 'arbitrum': {
        dm = new DeploymentManager(bridgeNetwork, 'usdc', hre);
        break;
      }
      case 'polygon': {
        dm = new DeploymentManager(bridgeNetwork, 'usdc', hre);
        break;
      }
      case 'base': {
        dm = new DeploymentManager(bridgeNetwork, 'usdc', hre);
        break;
      }
      case 'linea': {
        dm = new DeploymentManager(bridgeNetwork, 'usdc', hre);
        break;
      }
      case 'optimism': {
        dm = new DeploymentManager(bridgeNetwork, 'usdc', hre);
        break;
      }
      case 'mantle': {
        dm = new DeploymentManager(bridgeNetwork, 'usde', hre);
        break;
      }
      case 'unichain': {
        dm = new DeploymentManager(bridgeNetwork, 'usdc', hre);
        break;
      }
      case 'scroll': {
        dm = new DeploymentManager(bridgeNetwork, 'usdc', hre);
        break;
      }
      case 'ronin': {
        dm = new DeploymentManager(bridgeNetwork, 'weth', hre);
        break;
      }
      default: {
        const tag = `[${bridgeNetwork} -> ${governanceDeploymentManager.network}]`;
        throw new Error(`${tag} Unable to determine whether to relay Proposal ${openProposal.id}`);
      }
    }
    existingBridgeManagers[bridgeNetwork] = dm;
    bridgeManagers.push(dm);
    // switch (bridgeNetwork) {
    //   case 'mainnet': {
    //     continue; // Mainnet proposals are not bridge proposals
    //   }
    //   case 'arbitrum': {
    //     const inbox = await governanceDeploymentManager.getContractOrThrow('arbitrumInbox');
    //     const l1GatewayRouter = await governanceDeploymentManager.getContractOrThrow(
    //       'arbitrumL1GatewayRouter'
    //     );
    //     const targets = openProposal.targets;
    //     return targets.includes(inbox.address) || targets.includes(l1GatewayRouter.address);
    //   }
    //   case 'polygon': {
    //     const {
    //       fxRoot,
    //       RootChainManager
    //     } = await governanceDeploymentManager.getContracts();
    //     const bridgeAddresses = [fxRoot, RootChainManager]
    //       .filter(x => x)
    //       .map(x => x.address.toLowerCase());
    //     const targets = openProposal.targets;
    //     return targets.some(t => bridgeAddresses.includes(t.toLowerCase()));
    //   }
    //   case 'base': {
    //     const baseL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow(
    //       'baseL1CrossDomainMessenger'
    //     );
    //     const baseL1StandardBridge = await governanceDeploymentManager.getContractOrThrow(
    //       'baseL1StandardBridge'
    //     );
    //     const baseL1USDSBridge = await governanceDeploymentManager.getContractOrThrow(
    //       'baseL1USDSBridge'
    //     );
    //     const targets = openProposal.targets;
    //     const bridgeContracts = [baseL1CrossDomainMessenger.address, baseL1StandardBridge.address, baseL1USDSBridge.address];

    //     return targets.some(t => bridgeContracts.includes(t));
    //   }
    //   case 'linea': {
    //     const lineaMessageService = await governanceDeploymentManager.getContractOrThrow(
    //       'lineaMessageService'
    //     );
    //     const lineaL1USDCBridge = await governanceDeploymentManager.getContractOrThrow(
    //       'lineaL1USDCBridge'
    //     );
    //     const lineaL1TokenBridge = await governanceDeploymentManager.getContractOrThrow(
    //       'lineaL1TokenBridge'
    //     );
    //     const bridgeContracts = [
    //       lineaMessageService.address,
    //       lineaL1USDCBridge.address,
    //       lineaL1TokenBridge.address
    //     ];
    //     const targets = openProposal.targets;
    //     return targets.some(t => bridgeContracts.includes(t));
    //   }
    //   case 'optimism': {
    //     const opL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow(
    //       'opL1CrossDomainMessenger'
    //     );
    //     const opL1StandardBridge = await governanceDeploymentManager.getContractOrThrow(
    //       'opL1StandardBridge'
    //     );
    //     const targets = openProposal.targets;
    //     const bridgeContracts = [opL1CrossDomainMessenger.address, opL1StandardBridge.address];
    //     return targets.some(t => bridgeContracts.includes(t));
    //   }
    //   case 'mantle': {
    //     const mantleL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow(
    //       'mantleL1CrossDomainMessenger'
    //     );
    //     const mantleL1StandardBridge = await governanceDeploymentManager.getContractOrThrow(
    //       'mantleL1StandardBridge'
    //     );
    //     const targets = openProposal.targets;
    //     const bridgeContracts = [
    //       mantleL1CrossDomainMessenger.address,
    //       mantleL1StandardBridge.address
    //     ];
    //     return targets.some(t => bridgeContracts.includes(t));
    //   }
    //   case 'unichain': {
    //     const unichainL1CrossDomainMessenger = await governanceDeploymentManager.getContractOrThrow(
    //       'unichainL1CrossDomainMessenger'
    //     );
    //     const unichainL1StandardBridge = await governanceDeploymentManager.getContractOrThrow(
    //       'unichainL1StandardBridge'
    //     );
    //     const targets = openProposal.targets;
    //     const bridgeContracts = [
    //       unichainL1CrossDomainMessenger.address,
    //       unichainL1StandardBridge.address
    //     ];
    //     return targets.some(t => bridgeContracts.includes(t));
    //   }
    //   case 'scroll': {
    //     const scrollMessenger = await governanceDeploymentManager.getContractOrThrow(
    //       'scrollMessenger'
    //     );
    //     const targets = openProposal.targets;
    //     return targets.includes(scrollMessenger.address);
    //   }
    //   case 'ronin': {
    //     const governor = await governanceDeploymentManager.getContractOrThrow('governor');
    //     const l1CCIPRouter = await governanceDeploymentManager.getContractOrThrow(
    //       'l1CCIPRouter'
    //     );
    //     const roninl1NativeBridge = await governanceDeploymentManager.getContractOrThrow(
    //       'roninl1NativeBridge'
    //     );
    //     const roninL1OnRamp = await governanceDeploymentManager.getContractOrThrow(
    //       'roninl1CCIPOnRamp'
    //     );
    //     const { targets } = await governor.proposalDetails(openProposal.id);
    //     const bridgeContracts = [
    //       roninl1NativeBridge.address,
    //       l1CCIPRouter.address,
    //       roninL1OnRamp.address
    //     ];
    //     return targets.some(t => bridgeContracts.includes(t));
    //   }
    //   default: {
    //     const tag = `[${bridgeNetwork} -> ${governanceDeploymentManager.network}]`;
    //     throw new Error(`${tag} Unable to determine whether to relay Proposal ${openProposal.id}`);
    //   }
    // }
  }
  return bridgeManagers;
}

