certoraRun certora/harness/CometHarnessGetters.sol \
    --verify CometHarnessGetters:certora/specs/pause.spec  \
    --solc solc8.10 \
    --staging \
    --optimistic_loop \
    --settings -useBitVectorTheory \
    --msg "$1"