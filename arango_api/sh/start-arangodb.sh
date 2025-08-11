#!/usr/bin/env bash
container_id=$(docker ps -a | grep "arangodb-$ARANGO_DB_PORT" | cut -d " " -f 1)
if [ -z "$container_id" ]; then
    echo "Starting container arangodb-$ARANGO_DB_PORT"
    docker run \
	   --restart always \
           --name "arangodb-$ARANGO_DB_PORT" \
           -e ARANGO_ROOT_PASSWORD="$ARANGO_DB_PASSWORD" \
           -p "$ARANGO_DB_PORT":8529 \
           -v "$ARANGO_DB_HOME-$ARANGO_DB_PORT":/var/lib/arangodb3 \
	   -d \
           arangodb
else
    echo "Container arangodb-$ARANGO_DB_PORT already started"
fi
