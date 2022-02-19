certoraRun certora/harness/CometHarnessInterest.sol certora/harness/symbolicPriceOracleA.sol \
    --verify CometHarnessInterest:certora/specs/interestComputation.spec  \
    --solc solc8.11 \
    --staging jtoman/solc8-overflow \
    --settings -enableEqualitySaturation=false,-multiAssertCheck \
    --rule isLiquidatable_false_should_not_change \
    --optimistic_loop \
    --msg "Comet interestComputation - isLiquidatable_false_should_not_change"