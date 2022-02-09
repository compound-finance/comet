for f in certora/harness/*.sol
do
    echo "Processing $f"
    file=$(basename $f)
    echo ${file%.*}
    certoraRun certora/harness/$file \
    --verify ${file%.*}:certora/specs/sanity.spec "$@" \
    --solc solc8.11 --staging \
    --msg "checking sanity on ${file%.*}"
done