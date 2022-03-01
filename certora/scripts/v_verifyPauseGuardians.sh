certoraRun certora/harness/CometHarnessGetters.sol --verify CometHarnessGetters:certora/specs/V_pauseGuardians.spec  \
    --solc solc8.11 \
    --staging jtoman/solc8-overflow \
    --optimistic_loop \
    --settings -enableEqualitySaturation=false,-multiAssertCheck,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --msg "$1"
