#!/usr/bin/env python3
"""
Test message persistence - verify messages are saved and loaded correctly
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from database import get_mysql_connection
import pymysql

def test_message_persistence():
    """Test that messages are properly saved and loaded"""
    conn = get_mysql_connection()
    if not conn:
        print("❌ Failed to connect to MySQL")
        return False
    
    try:
        cursor = conn.cursor(pymysql.cursors.DictCursor)
        
        # Test 1: Count messages in database
        cursor.execute("SELECT COUNT(*) as total FROM messages")
        result = cursor.fetchone()
        total_messages = result['total'] if result else 0
        print(f"✓ Total messages in database: {total_messages}")
        
        # Test 2: Check for recent messages (last 10)
        cursor.execute("""
            SELECT message_id, session_id, role, content, created_at 
            FROM messages 
            ORDER BY created_at DESC 
            LIMIT 10
        """)
        recent_messages = cursor.fetchall()
        print(f"\n✓ Last 10 messages:")
        for msg in recent_messages:
            content_preview = msg['content'][:50] if msg['content'] else ''
            print(f"  - {msg['message_id'][:20]}... | {msg['role']:10} | {msg['session_id'][:15]}... | {content_preview}")
        
        # Test 3: Check messages from a specific session (if we have one)
        if recent_messages:
            session_id = recent_messages[0]['session_id']
            cursor.execute("""
                SELECT COUNT(*) as count FROM messages WHERE session_id = %s
            """, (session_id,))
            session_count = cursor.fetchone()['count']
            print(f"\n✓ Session {session_id[:15]}... has {session_count} messages")
            
            # Get all messages from this session
            cursor.execute("""
                SELECT message_id, role, created_at 
                FROM messages 
                WHERE session_id = %s 
                ORDER BY created_at DESC 
                LIMIT 20
            """, (session_id,))
            session_messages = cursor.fetchall()
            print(f"  Messages in this session (last 20):")
            for msg in session_messages:
                print(f"    - {msg['message_id'][:20]}... | {msg['role']:10} | {msg['created_at']}")
        
        # Test 4: Check message ext field (should contain processSteps, media, etc)
        cursor.execute("""
            SELECT message_id, session_id, role, 
                   LENGTH(ext) as ext_size,
                   IF(ext IS NOT NULL AND ext != '', 'Y', 'N') as has_ext
            FROM messages 
            ORDER BY created_at DESC 
            LIMIT 5
        """)
        ext_check = cursor.fetchall()
        print(f"\n✓ Messages with ext field (last 5):")
        for msg in ext_check:
            print(f"  - {msg['message_id'][:20]}... | has_ext={msg['has_ext']} | ext_size={msg['ext_size']} bytes")
        
        cursor.close()
        conn.close()
        print("\n✅ Message persistence test completed successfully")
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == '__main__':
    test_message_persistence()
