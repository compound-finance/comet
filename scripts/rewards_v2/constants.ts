import { MulticallAddressesConfig, TransferEventsFetchSettings } from './types';

// from https://www.multicall3.com/deployments
export const multicallAddresses: MulticallAddressesConfig = {
  mainnet: '0xcA11bde05977b3631167028862bE2a173976CA11',
  arbitrum: '0xcA11bde05977b3631167028862bE2a173976CA11',
  base: '0xcA11bde05977b3631167028862bE2a173976CA11',
  polygon: '0xcA11bde05977b3631167028862bE2a173976CA11',
  optimism: '0xcA11bde05977b3631167028862bE2a173976CA11',
  mantle: '0xcA11bde05977b3631167028862bE2a173976CA11',
  scroll: '0xcA11bde05977b3631167028862bE2a173976CA11',
  sepolia: '0xcA11bde05977b3631167028862bE2a173976CA11'
};

export const transferEventsFetchSettings: TransferEventsFetchSettings = {
  mainnet: { delaySeconds: 5, chunkSize: 100000 },
  arbitrum: { delaySeconds: 5, chunkSize: 500000 },
  base: { delaySeconds: 5, chunkSize: 200000 },
  polygon: { delaySeconds: 5, chunkSize: 200000 },
  optimism: { delaySeconds: 5, chunkSize: 200000 },
  mantle: { delaySeconds: 5, chunkSize: 100000 },
  scroll: { delaySeconds: 5, chunkSize: 100000 },
  sepolia: { delaySeconds: 5, chunkSize: 100000 },
};