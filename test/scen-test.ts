import hre from 'hardhat'

import Runner from './scen/Runner'
import SupplyScen from './scen/Supply'
import LiquidationScen from './scen/Liquidation'

const runner = new Runner([
  SupplyScen,
  LiquidationScen,
]).run(hre)
