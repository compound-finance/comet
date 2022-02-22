
certoraRun certora/harness/CometHarness.sol certora/harness/SymbolicBaseToken.sol \
    --verify CometHarness:certora/specs/comet.spec  \
    --link CometHarness:baseToken=SymbolicBaseToken \
    --solc solc8.11 \
    --staging shelly/integrateJohnsBranches \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-multiAssertCheck,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
        --rule $1 \
    --msg "CometHarness:comet.spec $1 with magic flag"
