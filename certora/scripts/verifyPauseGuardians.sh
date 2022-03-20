certoraRun certora/harness/CometHarnessGetters.sol --verify CometHarnessGetters:certora/specs/pauseGuardians.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --send_only \
    --settings -enableEqualitySaturation=false,-multiAssertCheck,-smt_usePz3=true,-smt_z3PreprocessorTimeout=2 \
    --solc_args '["--experimental-via-ir"]' \
    --rule check_pauseBuy_functionality \
    --msg "pauseGuardians $1"
