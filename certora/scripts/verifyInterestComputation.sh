certoraRun certora/harness/CometHarnessInterest.sol certora/harness/symbolicPriceOracleA.sol \
    --verify CometHarnessInterest:certora/specs/interestComputation.spec  \
    --solc solc8.11 \
    --staging jtoman/solc8-overflow \
    --settings -enableEqualitySaturation=false,-multiAssertCheck,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --optimistic_loop \
    --msg "Comet $1"
