#!/bin/bash
# Initialize HBase tables for Chatee

set -e

echo "📝 Creating HBase tables..."

docker exec -it chatee-hbase hbase shell <<EOF
# Thread tables
create_if_not_exists 'chatee_threads_metadata', 'meta'
create_if_not_exists 'chatee_threads_messages', 'msg'
create_if_not_exists 'chatee_follow_feed', 'feed'
create_if_not_exists 'chatee_reply_feed', 'feed'

# Chat tables
create_if_not_exists 'chatee_chats_metadata', 'meta'
create_if_not_exists 'chatee_chats_inbox', 'inbox'

# List tables
list

exit
EOF

echo "✅ HBase tables created!"
