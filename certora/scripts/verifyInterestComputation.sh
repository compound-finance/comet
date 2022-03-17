certoraRun certora/harness/CometHarnessWrappers.sol certora/harness/SymbolicPriceOracleA.sol certora/harness/SymbolicPriceOracleB.sol \
    --verify CometHarnessWrappers:certora/specs/interestComputation.spec  \
    --link CometHarnessInterest:baseTokenPriceFeed=SymbolicPriceOracleA \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --msg "Comet intereest computation $1 : $2"
