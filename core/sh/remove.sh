#!/usr/bin/bash
# Print usage
usage() {
    cat << EOF

NAME
    remove - Remove a specified configuration of the Cell KN MVP

SYNOPSIS
    remove [OPTIONS]

DESCRIPTION
    TBC

OPTIONS 
    -c    CONF
          The Cell KN configuration to remove

    -h    Help

    -e    Exit immediately if a command returns a non-zero status

    -x    Print a trace of simple commands

EOF
}

# Parse command line options
while getopts ":c:hex" opt; do
    case $opt in
	c)
	    CONF=${OPTARG}
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
if [ "$#" -ne 0 ]; then
    echo "No arguments required"
    exit 1
fi

# Check command line arguments
if [ -z "$CONF" ]; then
    echo "No configuration specified"
    exit 0
elif [ ! -f "conf/$CONF" ]; then
    echo "Configuration not found"
    exit 1
fi

# Source the specified configuration
. conf/$CONF

# Assign the archive
archive="arangodb"
archive+="-$CELL_KN_MVP_ETL_ONTOLOGIES_VERSION"
archive+="-$CELL_KN_MVP_ETL_RESULTS_VERSION"
archive+=".tar.gz"

# Assign the subdomain based on the specified configuration
subdomain=$(echo $CONF | sed s/\\./-/g)

# Disable the corresponding site, and remove it from available sites
if [ $public_ip == 54.146.82.39 ]; then
    site=$subdomain-cell-kn-mvp.conf
elif [ $public_ip == 35.173.140.169 ]; then
    site=$subdomain-cell-kn.conf
fi
sudo a2dissite $site
sleep 1
sudo rm /etc/apache2/sites-available/$site

# Find the port corresponding to the configuration
pushd ~
port=$(ls -al | grep "\->.*$subdomain" | cut -d "-" -f 2 | sed "s/[[:space:]]*$//")

# Stop the corresponding ArangoDB container
ARANGO_DB_PORT=$port ./stop-arangodb.sh

# Remove Cell KN MVP versioned directory
mvp_directory=cell-kn-mvp-ui-$CELL_KN_MVP_UI_VERSION-$subdomain
rm -rf $mvp_directory

# Remove ArangoDB archive file and symbolic link
arangodb_file=$(echo $archive | sed s/.tar.gz//)-$subdomain
arangodb_link=arangodb-$port
sudo rm $arangodb_link
sudo rm -rf $arangodb_file
popd
