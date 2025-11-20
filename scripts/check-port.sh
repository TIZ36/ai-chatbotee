#!/bin/bash
port=$1
if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null ; then
    echo "Port $port is already in use"
    exit 1
fi
