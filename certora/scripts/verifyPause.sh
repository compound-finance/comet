certoraRun certora/harness/CometHarnessGetters.sol \
    --verify CometHarnessGetters:certora/specs/pause.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --send_only \
    --rule check_flag_getters \
    --settings -useBitVectorTheory \
    --solc_args '["--experimental-via-ir"]' \
    --msg "pause $1"