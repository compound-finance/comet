certoraRun certora/harness/CometHarnessGetters.sol \
    --verify CometHarnessGetters:certora/specs/InAsset.spec  \
    --solc solc8.10 \
    --staging \
    --optimistic_loop \
    --settings -useBitVectorTheory \
    --msg "$1"