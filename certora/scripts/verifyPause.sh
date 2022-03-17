certoraRun certora/harness/CometHarnessGetters.sol \
    --verify CometHarnessGetters:certora/specs/V_pause.spec  \
    --solc solc8.11 \
    --staging \
    --optimistic_loop \
    --send_only \
    --settings -useBitVectorTheory \
    --solc_args '["--experimental-via-ir"]' \
    --msg "V_pause $1"