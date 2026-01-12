#!/bin/bash
# HBase with Thrift Server startup script

# Start HBase in background
/opt/hbase/bin/start-hbase.sh

# Wait for HBase to be ready
echo "Waiting for HBase to start..."
sleep 30

# Check if HBase is ready
while ! echo "status" | /opt/hbase/bin/hbase shell -n 2>/dev/null | grep -q "1 active"; do
    echo "Waiting for HBase Master to be active..."
    sleep 5
done

echo "HBase is ready, starting Thrift2 server..."

# Start Thrift2 server (recommended for newer clients)
# Thrift2 provides a more modern API
/opt/hbase/bin/hbase-daemon.sh start thrift2 -p 9095

# Also start Thrift server for compatibility
/opt/hbase/bin/hbase-daemon.sh start thrift -p 9090

echo "Thrift servers started on ports 9090 (Thrift) and 9095 (Thrift2)"

# Keep container running
tail -f /opt/hbase/logs/*
