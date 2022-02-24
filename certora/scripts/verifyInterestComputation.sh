certoraRun certora/harness/CometHarnessInterest.sol certora/harness/SymbolicPriceOracleA.sol \
    --verify CometHarnessInterest:certora/specs/interestComputation.spec  \
    --solc solc8.11 \
    --staging shelly/integrateJohnsBranches \
    --settings -enableEqualitySaturation=false,-solver=z3,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --optimistic_loop \
    --msg "Comet interets - all"
