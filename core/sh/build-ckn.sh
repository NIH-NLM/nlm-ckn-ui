#!/opt/local/bin/bash
# Print usage
usage() {
    cat << EOF

NAME
    build - Build the Cell KN ArangoDB archive

SYNOPSIS
    build [OPTIONS]

DESCRIPTION
    Build the Cell KN ArangoDB archive by checking out the specified versions
    to build, making clean packages, building the ontology graph, fetching
    external data, building the results and phenotype graphs, archiving the
    ArangoDB database, and uploading the archive to the Cell KN server. Changes
    on the current branches are stashed prior to checking out the specified
    versions, then applied on checking out the current version after the build.

OPTIONS 
    -c    CONF
          The Cell KN configuration to build

    -o    Build the specified version of the ontologies graph, if it
          does not exist

    -O    Force -o

    -r    Build the specified version of the results and phenotype
          graph, if they do not exist

    -R    Force -r

    -a    Make the ArangoDB archive

    -A    Force -a

    -u    Upload the ArangoDB archive to cell-kn.org

    -h    Help

    -e    Exit immediately if a command returns a non-zero status

    -x    Print a trace of simple commands

EOF
}

# Parse command line options
run_ontology=0
force_ontology=0
run_results=0
force_results=0
make_archive=0
force_archive=0
upload_archive=0
while getopts ":c:oOrRaAuhex" opt; do
    case $opt in
	c)
	    CONF="${OPTARG}"
            ;;
        o)
            run_ontology=1
            ;;
        O)
            force_ontology=1
            ;;
        r)
            run_results=1
            ;;
        R)
            force_results=1
            ;;
        a)
            make_archive=1
            ;;
        A)
            force_archive=1
            ;;
        u)
            upload_archive=1
            ;;
	h)
	    usage
	    exit 0
	    ;;
	e)
	    set -e
	    ;;
	x)
	    set -x
	    ;;
	\?)
	    echo "Invalid option: -${OPTARG}" >&2
	    usage
	    exit 1
	    ;;
	\:)
	    echo "Option -${OPTARG} requires an argument" >&2
	    usage
	    exit 1
	    ;;
    esac
done

# Parse command line arguments
shift `expr ${OPTIND} - 1`
if [[ "$#" -ne 0 ]]; then
    echo "No arguments required"
    exit 1
fi

# Source the configuration
if [[ -z "$CONF" ]]; then
    echo "No configuration specified"
    exit 0
elif [[ ! -f "conf-ckn/$CONF" ]]; then
    echo "Configuration not found"
    exit 1
fi
. conf-ckn/$CONF

# Build ontology graph, if specified
pushd "../../../nlm-ckn-etl"
if [[ ! -f ".built" ]] && [[ $run_ontology -eq 1 ]] \
       || [[ $force_ontology -eq 1 ]]; then

    # Stop ArangoDB and remove the database
    pushd "src/main/shell"
    ./stop-arangodb.sh
    popd
    pushd "data"
    rm -rf arangodb
    export ARANGO_DB_HOME="$PWD/arangodb"
    popd
    pushd "src/main/shell"
    ./start-arangodb.sh
    popd

    # Stash changes, set the current branch, checkout the version to
    # build
    git stash
    current_branch="$(git branch --show-current)"
    git checkout $NLM_CKN_ETL_VERSION

    # Make a clean package, then update ontologies downloaded from the
    # OBO Foundry, and build the ontology graph
    mvn clean package -DskipTests
    classpath="target/nlm-ckn-etl-1.0.jar"
    java -cp $classpath gov.nih.nlm.OntologyDownloader
    java -Xms32g -Xmx32g -cp $classpath gov.nih.nlm.OntologyGraphBuilder

    # Checkout the current branch, and apply the stash so that changes
    # are not lost
    git checkout $current_branch
    git stash apply

    # Log the build
    log_message="Built ontology graph"
    log_message+=" using $NLM_CKN_ETL_VERSION"
    log_message+=" on $(date)"
    echo $log_message > ".built"

fi
popd

# Build results and phenotype graphs, if specified
pushd "../../../nlm-ckn-etl"
if [[ ! -f ".built" ]] && [[ $run_results -eq 1 ]] \
       || [[ $force_results -eq 1 ]]; then

    # Stash changes, set the current branch, checkout the version to
    # build
    current_branch="$(git branch --show-current)"
    git stash
    git checkout $NLM_CKN_ETL_VERSION

    # Remove existing tuples
    rm data/tuples/*.json
    rm data/tumpes/summaries/*.json

    # Activate the Python environment, fetch external data, and write
    # all tuples. Note that the local .zshenv contains E-Utilities
    # credentials
    pushd python
    . .venv/bin/activate
    pushd src
    . .zshenv
    python ExternalApiResultsFetcher.py
    python NSForestResultsTupleWriter.py
    python AuthorToClResultsTupleWriter.py
    python ExternalApiResultsTupleWriter.py
    # TODO: Remove when confirmed
    # python AnnotationResultsTupleWriter.py
    popd
    popd

    # Make a clean package, then build the results and phenotype
    # graphs
    mvn clean package -DskipTests
    classpath="target/nlm-ckn-etl-1.0.jar"
    java -Xms32g -Xmx32g -cp $classpath gov.nih.nlm.ResultsGraphBuilder
    java -Xms32g -Xmx32g -cp $classpath gov.nih.nlm.PhenotypeGraphBuilder

    # Create all analyzers and views, then deactivate the Python
    # environment
    pushd python/src
    python CellKnSchemaUtilities.py
    popd
    deactivate

    # Checkout the current branch, and apply the stash so that changes
    # are not lost
    git checkout $current_branch
    git stash apply

    # Log the build
    log_message="Built phenotype graph"
    log_message+=" using $NLM_CKN_ETL_VERSION"
    log_message+=" on $(date)"
    echo $log_message > ".built"

fi
popd

# Name the ArangoDB archive
archive="arangodb"
archive+="-$NLM_CKN_ETL_VERSION"
archive+=".tar.gz"

# Make ArangoDB archive, if specified
pushd "../../../nlm-ckn-etl"
if [[ ! -f ".archived" ]] && [[ $make_archive -eq 1 ]] \
       || [[ $force_archive -eq 1 ]]; then

    # Make the archive
    pushd data
    tar -czvf $archive arangodb
    popd

    # Log the archive
    log_message="Archived ArangoDB using"
    log_message+=" $NLM_CKN_ETL_VERSION"
    log_message+=" on $(date)"
    echo $log_message > ".archived"

fi
popd

# Upload ArangoDB archive, if specified
pushd "../../../nlm-ckn-etl"
if [[ $upload_archive -eq 1 ]]; then

    # Upload the archive to cell-kn.org, if it exists
    pushd data
    if [[ -f "$archive" ]]; then
        scp $archive ckn:~

    else
        echo "ArangoDB archive $archive does not exist"
        exit 1

    fi
    popd

fi
popd
