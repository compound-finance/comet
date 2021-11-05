import SupplyScen from './Supply.scen'
import LiquidationScen from './Liquidation.scen'

const runner = new Runner([
  LiquidationScen,
  SupplyScen,
])

runner.run(forkOrSetup)
runner.run(otherForkSetup)
