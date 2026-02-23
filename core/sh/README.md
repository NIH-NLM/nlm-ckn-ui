# == Launch instance

Name: nlm-ckn-v0.1.0
OS Image: Ubuntu 24.04 LTS
Instance type: t2.xlarge
Key pair: nlm-ckn-v0.1.0.pem
Network settings: Allow SSH and HTTP traffic from the internet
Configure storage: 64 GiB

# == Associate Elastic IP address

Name: nlm-ckn-v0.1.0

# == Install Emacs

sudo apt update
sudo apt install emacs (accept defaults)

# == Install Docker

See: https://docs.docker.com/engine/install/ubuntu/

# Add Docker's official GPG key:
sudo apt-get update
sudo apt-get install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repository to Apt sources:
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update

# Install the Docker packages:
sudo apt-get install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add your user to the docker group
sudo usermod -aG docker ${USER}

# == Install Apache

sudo apt install apache2

# == Configure GitHub access

ssh-keygen -t ed25519 -C "raymond.leclair@springbok.io"

# == Install Python 3.13

See: https://ubuntuhandbook.org/index.php/2024/02/install-python-3-13-ubuntu/

sudo add-apt-repository ppa:deadsnakes/ppa
sudo apt install python3.13-full

# == Install Node.js and npm

See: https://www.digitalocean.com/community/tutorials/how-to-install-node-js-on-ubuntu-22-04

curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install v22.15.1

# == Clone nlm-ckn-ui

git clone git@github.com:NIH-NLM/nlm-ckn-ui.git

python3.13 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt 
cd react/
npm install
npm run build

# Add the following to arango_api/.env:

DEBUG=True
ARANGO_DB_HOST=http://127.0.0.1:8529
ARANGO_DB_NAME_ONTOLOGIES=NLM-CKN-Ontologies
ARANGO_DB_NAME_PHENOTYPES=NLM-CKN-Phenotypes
ARANGO_DB_SCHEMA_NAME=NLM-CKN-Schema
ARANGO_DB_USER=root
ARANGO_DB_PASSWORD=7mtgagy6hFx46ASX
GRAPH_NAME_ONTOLOGIES=KN-Ontologies-v2.0
GRAPH_NAME_PHENOTYPES=KN-Phenotypes-v2.0

python manage.py migrate

# == Install mod_wsgi

See:
- https://pypi.org/project/mod-wsgi/
- https://modwsgi.readthedocs.io/en/master/user-guides/quick-installation-guide.html

sudo apt install apache2-dev
sudo apt install python3.13-dev
wget https://github.com/GrahamDumpleton/mod_wsgi/archive/refs/tags/5.0.2.tar.gz
tar -zxvf 5.0.2.tar.gz
cd mod_wsgi-5.0.2/
./configure --with-python=/usr/bin/python3.13
make
sudo make install

# TODO: Review
# == Configure Apache

Copy in apache configuration

sudo htpasswd -c /etc/apache2/.htpasswd ubuntu
Password: "perceive favorable data"

chgrp www-data /home/ubuntu

sudo systemctl restart apache2
