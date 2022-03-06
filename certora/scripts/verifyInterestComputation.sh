certoraRun certora/harness/CometHarnessInterest.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarnessInterest:certora/specs/interestComputation.spec  \
    --link CometHarnessInterest:baseTokenPriceFeed=SymbolicPriceOracleA \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --rule $1 \
    --settings -divideByConstants=1,-enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --msg "Comet intereest computation $1 : $2"
