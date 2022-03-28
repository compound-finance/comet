certoraRun certora/harness/CometHarnessGetters.sol \
    --verify CometHarnessGetters:certora/specs/pause.spec  \
    --solc solc8.11 \
    --staging \
    --send_only \
    --optimistic_loop \
    --settings -useBitVectorTheory \
    --solc_args '["--experimental-via-ir"]' \
    --msg "pause $1"