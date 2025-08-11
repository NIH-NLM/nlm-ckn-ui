#!/usr/bin/bash
# Print usage
usage() {
    cat << EOF

NAME
    select - Select a default configuration of the Cell KN MVP

SYNOPSIS
    select [OPTIONS]

DESCRIPTION
    Selects a default configuration by setting the ALLOWED_HOSTS in
    the Django settings, and ServerName in the Apache configuration.

OPTIONS 
    -l    List enabled configurations, indicating default, if any

    -c    CONF
          The Cell KN configuration to deploy

    -h    Help

    -e    Exit immediately if a command returns a non-zero status

    -x    Print a trace of simple commands

EOF
}

# Parse command line options
do_list_configurations=0
while getopts ":lc:hex" opt; do
    case $opt in
	l)
	    do_list_configurations=1
	    ;;
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

# Identify the domain on which to deploy
public_ip=$(curl -s http://checkip.amazonaws.com)
if [ $public_ip == 54.146.82.39 ]; then
    domain="cell-kn-mvp.org"
elif [ $public_ip == 35.173.140.169 ]; then
    domain="cell-kn-stg.org"
else
    echo "Unknown public IP address"
    exit 1
fi

# List configurations
if [ $do_list_configurations == 1 ]; then
    printf "Available configurations:\n"
    confs=$(ls conf/)
    for conf in $confs; do

	# Source the current configuration, assign the subdomain, and
	# print enabled configurations, indicating default, if any
	. conf/$conf
	subdomain=$(echo $conf | sed s/\\./-/g)
	site=/etc/apache2/sites-enabled/$subdomain-cell-kn-mvp.conf
	if [ -f $site ]; then
	    if [ $(grep ServerName $site | cut -d " " -f 6) == $domain ]; then
		printf "  $conf *\n"
	    else
		printf "  $conf\n"
	    fi
	fi
    done
    exit 0
fi

# Check command line arguments
if [ -z "$CONF" ]; then
    echo "No configuration specified"
    exit 0
elif [ ! -f "conf/$CONF" ]; then
    echo "Configuration $CONF not found"
    exit 1
fi

# Source the current configuration, assign the subdomain, and ensure
# the site has been enabled, exiting if not
. conf/$CONF
subdomain=$(echo $CONF | sed s/\\./-/g)
site=/etc/apache2/sites-enabled/$subdomain-cell-kn-mvp.conf
if [ ! -f $site ]; then
    echo "Configuration $CONF not enabled"
    exit 1
fi

confs=$(ls conf/)
for conf in $confs; do
    
    # Source the current configuration, assign the subdomain, and
    # ensure the site has been enabled, continuing if not
    . conf/$conf
    subdomain=$(echo $conf | sed s/\\./-/g)
    site=/etc/apache2/sites-enabled/$subdomain-cell-kn-mvp.conf
    if [ ! -f $site ]; then
	continue
    fi

    # Update allowed hosts
    mvp_directory=cell-kn-mvp-ui-$CELL_KN_MVP_UI_VERSION-$subdomain
    if [ $conf == $CONF ]; then
	allowed_hosts="\"$domain\""
    else
	allowed_hosts="\"$subdomain.$domain\""
    fi
    sed -i \
	"s/.*ALLOWED_HOSTS.*/ALLOWED_HOSTS = [$allowed_hosts]/" \
	~/$mvp_directory/core/settings.py

    # Update, install, and enable the Apache site configuration
    site=/etc/apache2/sites-available/$subdomain-cell-kn-mvp.conf
    if [ $conf == $CONF ]; then
	sudo sed -i \
	    "s/.*ServerName.*/    ServerName $domain/" \
	    $site
    else
	sudo sed -i \
	    "s/.*ServerName.*/    ServerName $subdomain.$domain/" \
	    $site
    fi

done

# Restart Apache
sudo systemctl restart apache2
sleep 1
