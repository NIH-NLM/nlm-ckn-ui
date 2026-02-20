#!/usr/bin/bash
# Print usage
usage() {
    cat << EOF

NAME
    lookup - Echo the second level domain based on IP address

SYNOPSIS
    lookup

DESCRIPTION
    Checks IP at AWS then echos the corresponding second-level domain.

OPTIONS 
    -h    Help

    -e    Exit immediately if a command returns a non-zero status

    -x    Print a trace of simple commands

EOF
}

# Parse command line options
do_list_configurations=0
while getopts ":lc:hex" opt; do
    case $opt in
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

# Lookup second level domain based on IP address
public_ip="$(curl -s http://checkip.amazonaws.com)"
if [[ "$public_ip" == "54.146.82.39" ]]; then
    domain="nlm-ckn"
elif [[ "$public_ip" == "98.90.109.85" ]]; then
    domain="nlm-ckn"
else
    echo "Unknown public IP address"
    exit 1
fi
echo "$domain"
