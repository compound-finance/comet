import 'hardhat/types/config';
import { ForkSpec } from './World';

export interface ScenarioConfig {
  bases: ForkSpec[];
}

declare module 'hardhat/types/config' {
  interface HardhatUserConfig {
    // optional?
    scenario: ScenarioConfig;
  }

  interface HardhatConfig {
    scenario: ScenarioConfig;
  }
}
