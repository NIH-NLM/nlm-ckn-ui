#!/usr/bin/bash
# Print usage
usage() {
    cat << EOF

NAME
    deploy - Deploy a specified configuration of the Cell KN MVP

SYNOPSIS
    deploy [OPTIONS]

DESCRIPTION
    Deploy the Cell KN MVP by deploying the specified configuration in
    the conf directory. The corresponding site is first disabled, and
    ArangoDB container stopped. The Cell KN MVP repository is cloned
    into a versioned directory, Python and JavaScript dependencies
    installed, the Django application migrated, and the React
    application built. Then the configured ArangoDB archive is
    extracted, renamed, and symbolically linked using the specified
    port. The site configuration template is updated, then installed
    into the Apache sites-available directory, and the site enabled.

OPTIONS 
    -c    CONF
          The Cell KN configuration to deploy

    -h    Help

    -e    Exit immediately if a command returns a non-zero status

    -x    Print a trace of simple commands

EOF
}

# Parse command line options
while getopts ":c:hex" opt; do
    case $opt in
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

# Check command line arguments
if [[ -z "$CONF" ]]; then
    echo "No configuration specified"
    exit 0
elif [[ ! -f "conf-ckn/$CONF" ]]; then
    echo "Configuration not found"
    exit 1
fi

# Source the specified configuration
. conf-ckn/$CONF

# Assign the archive
archive="arangodb"
archive+="-$CELL_KN_MVP_ETL_ONTOLOGIES_VERSION"
archive+="-$CELL_KN_MVP_ETL_RESULTS_VERSION"
archive+=".tar.gz"

# Assign the port as one greater than the maximum in use, staying
# within port range
port=$(docker ps | grep arangodb | cut -d "-" -f 4 | sort | tail -n 1)
if [[ -z $port ]]; then
    port=8529
else
    port=$(($port + 1))
    if [[ $port -gt 8539 ]]; then
	port=8529
    fi
fi

# Lookup the domain based on IP address
domain="$(./lookup.sh)"
fqdn="$domain.org"

# Assign the subdomain based on the specified configuration
subdomain="$(echo $CONF | sed s/\\./-/g)"

# Disable the corresponding site
site="$subdomain-$domain.conf"
echo "Disabling $site"
sudo a2dissite $site &> /dev/null
sleep 1

# Stop the corresponding ArangoDB container
ARANGO_DB_PORT=$port ~/stop-arangodb.sh

# Clone Cell KN MVP repository into a versioned directory
mvp_directory="cell-kn-mvp-ui-$CELL_KN_MVP_UI_VERSION-$subdomain"
rm -rf ~/$mvp_directory
git clone git@github.com:NIH-NLM/cell-kn-mvp-ui.git ~/$mvp_directory

# Copy in the application environment
cp ../../.env.production ~/$mvp_directory/.env

# Checkout the specified CELL KN MVP version
pushd ~/$mvp_directory
git checkout $CELL_KN_MVP_UI_VERSION

# Install Python dependencies
python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt

# Generate and set a secret key, set allowed hosts, set the ArangoDB
# port, and set the ArangoDB password, which must be set in the
# environment used to run this script
secret_key="$(python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key().replace('&', '\&'))")"
echo "secret_key: $secret_key"
allowed_host="$subdomain.$fqdn"
echo "allowed_host: $allowed_host"
sed -i \
    "s/your-secret-key-here/$secret_key/" \
    .env
sed -i \
    "s/your-allowed-host-here/$allowed_host/" \
    .env
sed -i \
    "s/your-arango-port-here/$port/" \
    .env
sed -i \
    "s/your-arango-password-here/$ARANGO_DB_PASSWORD/" \
    .env

# Ensure backwards compatibility
last_conf="v1.0.2"
curr_conf="$(printf "%s\\n%s\\n" "$last_conf" "$CONF" | sort -V | tail -n 1)"
if [[ "$curr_conf" == "$last_conf" ]]; then

    # Copy in the application environment again
    cp .env arango_api

    # Update allowed hosts directly
    sed -i \
	"s/.*ALLOWED_HOSTS.*/ALLOWED_HOSTS = [[\"$allowed_host\"]]/" \
	core/settings.py

fi

# Migrate Django database
rm -f db.sqlite3
python manage.py migrate

# Install JavaScript dependencies
pushd react
npm install

# Build React application
npm run build
deactivate
popd  # into ~/$mvp_directory
popd  # into script directory

# Extract, rename, and symbolically link the ArangoDB archive
pushd ~
arangodb_file="$(echo $archive | sed s/.tar.gz//)-$subdomain"
arangodb_link="arangodb-$port"
rm -rf $arangodb_file
sudo rm -rf $arangodb_link
tar -zxvf $archive
mv arangodb $arangodb_file
sudo ln -sf $arangodb_file $arangodb_link
ARANGO_DB_PORT=$port ./start-arangodb.sh
popd  # into script directory

 # Update, install, and enable the Apache site configuration
cat default-ssl.conf | \
    sed s/{subdomain}/$subdomain/ | \
    sed s/{fqdn}/$fqdn/ | \
    sed s/{server_admin}/$SERVER_ADMIN/ | \
    sed s/{cell_kn_mvp_ui_version}/$CELL_KN_MVP_UI_VERSION/ \
	> $site
sudo cp $site /etc/apache2/sites-available
rm $site
sudo a2ensite $site

# Restart Apache
sudo systemctl restart apache2
sleep 1
