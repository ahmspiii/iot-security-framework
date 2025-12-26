import os
import sqlite3
from datetime import datetime
from typing import List, Dict, Optional, Any, Union, Tuple

DB_PATH = os.path.join(os.path.dirname(__file__), 'devices.db')


def _get_conn():
    return sqlite3.connect(DB_PATH)


def init_database():
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        '''
        CREATE TABLE IF NOT EXISTS baselines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id TEXT NOT NULL,
            firmware_version TEXT,
            baseline_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.commit()
    conn.close()


def save_baseline(device_id: str, firmware_version: Optional[str], baseline_hash: str) -> int:
    init_database()
    conn = _get_conn()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO baselines (device_id, firmware_version, baseline_hash, created_at) VALUES (?, ?, ?, ?)',
        (device_id, firmware_version, baseline_hash, datetime.utcnow()),
    )
    conn.commit()
    row_id = cur.lastrowid
    conn.close()
    return row_id


def list_baselines(device_id: Optional[str] = None, limit: int = 100, offset: int = 0) -> Dict[str, Any]:
    """
    List firmware baselines with optional filtering by device_id.
    
    Args:
        device_id: Optional device ID to filter baselines
        limit: Maximum number of records to return (default: 100)
        offset: Number of records to skip (for pagination)
        
    Returns:
        Dictionary containing:
        - ok: Boolean indicating success/failure
        - items: List of baseline records
        - count: Total number of matching records
        - error: Error message if ok is False
    """
    try:
        init_database()
        conn = _get_conn()
        conn.row_factory = sqlite3.Row
        
        # Build the base query
        query = '''
            SELECT id, device_id, firmware_version, baseline_hash, 
                   strftime('%Y-%m-%d %H:%M:%S', created_at) as created_at
            FROM baselines
        '''
        
        # Add WHERE clause if device_id is provided
        params = []
        if device_id:
            query += ' WHERE device_id = ?'
            params.append(device_id)
            
        # Add ordering and pagination
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
        params.extend([limit, offset])
        
        # Execute the query
        cur = conn.cursor()
        cur.execute(query, params)
        rows = cur.fetchall()
        
        # Get total count for pagination
        count_query = 'SELECT COUNT(*) as count FROM baselines'
        if device_id:
            count_query += ' WHERE device_id = ?'
            cur.execute(count_query, [device_id] if device_id else [])
        else:
            cur.execute(count_query)
        
        total_count = cur.fetchone()['count']
        
        # Convert rows to dictionaries
        items = [dict(row) for row in rows]
        
        return {
            'ok': True,
            'items': items,
            'count': total_count,
            'limit': limit,
            'offset': offset
        }
        
    except Exception as e:
        print(f"Error in list_baselines: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return {
            'ok': False,
            'error': str(e),
            'items': [],
            'count': 0
        }
        
    finally:
        if 'conn' in locals():
            conn.close()


init_database()
