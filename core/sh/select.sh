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
	    CONF="${OPTARG}"
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

# Lookup the domain based on IP address
domain="$(./lookup.sh)"
fqdn="$domain.org"

# List configurations
if [[ $do_list_configurations -eq 1 ]]; then
    printf "Available configurations:\n"
    confs="$(ls conf/)"
    for conf in $confs; do

	# Source the current configuration, assign the subdomain, and
	# print enabled configurations, indicating default, if any
	. conf/$conf
	subdomain="$(echo $conf | sed s/\\./-/g)"
	site="/etc/apache2/sites-enabled/$subdomain-$domain.conf"
	if [[ -f $site ]]; then
	    if [[ $(grep ServerName $site | cut -d " " -f 6) == $fqdn ]]; then
		printf "  $conf *\n"
	    else
		printf "  $conf\n"
	    fi
	fi
    done
    exit 0
fi

# Check command line arguments
if [[ -z "$CONF" ]]; then
    echo "No configuration specified"
    exit 0
elif [[ ! -f "conf/$CONF" ]]; then
    echo "Configuration $CONF not found"
    exit 1
fi

# Source the current configuration, assign the subdomain, and ensure
# the site has been enabled, exiting if not
. conf/$CONF
subdomain="$(echo $CONF | sed s/\\./-/g)"
site="/etc/apache2/sites-enabled/$subdomain-$domain.conf"
if [[ ! -f $site ]]; then
    echo "Configuration $CONF not enabled"
    exit 1
fi

last_conf="v1.0.2"
confs="$(ls conf/)"
for conf in $confs; do
    
    # Source the current configuration, assign the subdomain, and
    # ensure the site has been enabled, continuing if not
    . conf/$conf
    subdomain="$(echo $conf | sed s/\\./-/g)"
    site="/etc/apache2/sites-enabled/$subdomain-$domain.conf"
    if [[ ! -f $site ]]; then
	continue
    fi

    # Update allowed hosts ensuring backwards compatibility
    mvp_directory="cell-kn-mvp-ui-$CELL_KN_MVP_UI_VERSION-$subdomain"
    if [[ $conf == $CONF ]]; then
	allowed_host="$fqdn"
    else
	allowed_host="$subdomain.$fqdn"
    fi
    curr_conf="$(printf "%s\\n%s\\n" "$last_conf" "$conf" | sort -V | tail -n 1)"
    if [[ "$curr_conf" == "$last_conf" ]]; then

        # Update allowed hosts in settings file
        sed -i \
	    "s/.*ALLOWED_HOSTS.*/ALLOWED_HOSTS = [[\"$allowed_host\"]]/" \
	    ~/$mvp_directory/core/settings.py

    else

        # Update allowed hosts in environment file
        sed -i \
	    "s/.*ALLOWED_HOSTS.*/ALLOWED_HOSTS=localhost,$allowed_host/" \
	    ~/$mvp_directory/.env

    fi

    # Update, install, and enable the Apache site configuration
    site="/etc/apache2/sites-available/$subdomain-$domain.conf"
    if [[ $conf == $CONF ]]; then
	sudo sed -i \
	    "s/.*ServerName.*/    ServerName $fqdn/" \
	    $site
    else
	sudo sed -i \
	    "s/.*ServerName.*/    ServerName $subdomain.$fqdn/" \
	    $site
    fi

done

# Restart Apache
sudo systemctl restart apache2
sleep 1
