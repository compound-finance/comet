import 'hardhat/types/runtime';
import 'hardhat/config';
import 'hardhat/types/runtime';

declare module 'hardhat/types/runtime' {
  interface HardhatRuntimeEnvironment {
    tenderly?: any;
    tenderlyNetwork?: any;
  }
}

declare module 'hardhat/config' {
  interface TenderlyConfig {
    project?: string;
    username?: string;
    accessKey?: string;
    privateVerification?: boolean;
  }

  interface ScenarioConfig {
    bases: {
      name: string;
      network: string;
      deployment: string;
      allocation?: number;
      auxiliaryBase?: string;
    }[];
  }

  interface HardhatUserConfig {
    tenderly?: TenderlyConfig;
    scenario: ScenarioConfig;
  }
  interface HardhatConfig {
    tenderly: TenderlyConfig;
    scenario: ScenarioConfig;
  }
}

declare module '@nomicfoundation/hardhat-ethers/types' {
  export interface Libraries {
    [libraryName: string]: string;
  }
}


declare module '@nomicfoundation/hardhat-ethers' {
  export * from '@nomiclabs/hardhat-ethers';
}

declare module '@nomicfoundation/hardhat-ethers/signers' {
  export * from '@nomiclabs/hardhat-ethers/signers';
}


declare module 'hardhat/types/runtime' {
  interface HardhatRuntimeEnvironment {
    upgrades?: any;  
    defender?: any;
  }
}