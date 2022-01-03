import 'hardhat/types/config';
import { ScenarioConfig } from './types';

declare module 'hardhat/types/config' {
  interface HardhatUserConfig {
    // optional?
    scenario: ScenarioConfig;
  }

  interface HardhatConfig {
    scenario: ScenarioConfig;
  }
}
