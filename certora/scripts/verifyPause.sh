certoraRun certora/harness/CometHarnessGetters.sol \
    --verify CometHarnessGetters:certora/specs/pause.spec  \
    --solc solc8.11 \
    --staging \
    --rule check_flag_updates \
    --optimistic_loop \
    --settings -useBitVectorTheory \
    --msg "$1"