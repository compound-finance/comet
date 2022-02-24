certoraRun certora/harness/CometHarnessGetters.sol --verify CometHarnessGetters:certora/specs/V_pauseGuardians.spec  \
    --solc solc8.11 \
    --staging jtoman/solc8-overflow \
    --optimistic_loop \
    --rule_sanity \
    --settings -enableEqualitySaturation=false,-multiAssertCheck,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --msg "CometHarness:comet.spec $1 with magic flag"
