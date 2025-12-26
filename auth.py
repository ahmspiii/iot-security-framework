"""
Secure User Authentication Module
Handles user registration, login, and session management
"""

import sqlite3
import re
from datetime import datetime, timedelta
from werkzeug.security import generate_password_hash, check_password_hash
import secrets
import os

# Database configuration
DB_PATH = os.path.join(os.path.dirname(__file__), 'users.db')

# Session storage (in production, use Redis or similar)
active_sessions = {}

def init_database():
    """Initialize the SQLite database with users table"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            hashed_password TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            last_login TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

def validate_email(email):
    """
    Validate email format
    Returns: (is_valid: bool, error_message: str or None)
    """
    if not email:
        return False, "Email is required"
    
    # Basic email regex pattern
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    
    if not re.match(pattern, email):
        return False, "Invalid email format"
    
    if len(email) > 254:
        return False, "Email is too long"
    
    return True, None

def validate_password(password):
    """
    Validate password strength
    Requirements: min 8 chars, mix of letters, numbers, and symbols
    Returns: (is_valid: bool, error_message: str or None)
    """
    if not password:
        return False, "Password is required"
    
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    
    if len(password) > 128:
        return False, "Password is too long (max 128 characters)"
    
    # Check for at least one letter
    if not re.search(r'[a-zA-Z]', password):
        return False, "Password must contain at least one letter"
    
    # Check for at least one number
    if not re.search(r'\d', password):
        return False, "Password must contain at least one number"
    
    # Check for at least one special character
    if not re.search(r'[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\;/`~]', password):
        return False, "Password must contain at least one special character"
    
    return True, None

def register_user(email, password, confirm_password):
    """
    Register a new user
    Returns: (success: bool, message: str, user_id: int or None)
    """
    # Validate inputs
    if password != confirm_password:
        return False, "Passwords do not match", None
    
    is_valid_email, email_error = validate_email(email)
    if not is_valid_email:
        return False, email_error, None
    
    is_valid_password, password_error = validate_password(password)
    if not is_valid_password:
        return False, password_error, None
    
    # Normalize email (lowercase)
    email = email.lower().strip()
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Check if email already exists
        cursor.execute('SELECT id FROM users WHERE email = ?', (email,))
        if cursor.fetchone():
            conn.close()
            return False, "Email already registered", None
        
        # Hash password securely
        hashed_password = generate_password_hash(password, method='pbkdf2:sha256', salt_length=16)
        
        # Insert new user
        cursor.execute(
            'INSERT INTO users (email, hashed_password) VALUES (?, ?)',
            (email, hashed_password)
        )
        
        user_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return True, "Registration successful", user_id
        
    except sqlite3.IntegrityError:
        return False, "Email already registered", None
    except Exception as e:
        return False, "Registration failed. Please try again.", None

def login_user(email, password):
    """
    Authenticate user login
    Returns: (success: bool, message: str, session_token: str or None, user_data: dict or None)
    """
    # Validate inputs
    if not email or not password:
        return False, "Email and password are required", None, None
    
    # Normalize email
    email = email.lower().strip()
    
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        
        # Fetch user by email
        cursor.execute(
            'SELECT id, email, hashed_password FROM users WHERE email = ?',
            (email,)
        )
        user = cursor.fetchone()
        
        if not user:
            conn.close()
            return False, "Invalid email or password", None, None
        
        user_id, user_email, hashed_password = user
        
        # Verify password
        if not check_password_hash(hashed_password, password):
            conn.close()
            return False, "Invalid email or password", None, None
        
        # Update last login
        cursor.execute(
            'UPDATE users SET last_login = ? WHERE id = ?',
            (datetime.utcnow(), user_id)
        )
        conn.commit()
        conn.close()
        
        # Generate session token
        session_token = secrets.token_urlsafe(32)
        
        # Store session (expires in 24 hours)
        active_sessions[session_token] = {
            'user_id': user_id,
            'email': user_email,
            'expires_at': datetime.utcnow() + timedelta(hours=24)
        }
        
        user_data = {
            'id': user_id,
            'email': user_email
        }
        
        return True, "Login successful", session_token, user_data
        
    except Exception as e:
        return False, "Login failed. Please try again.", None, None

def verify_session(session_token):
    """
    Verify if session token is valid
    Returns: (is_valid: bool, user_data: dict or None)
    """
    if not session_token or session_token not in active_sessions:
        return False, None
    
    session = active_sessions[session_token]
    
    # Check if session expired
    if datetime.utcnow() > session['expires_at']:
        del active_sessions[session_token]
        return False, None
    
    user_data = {
        'id': session['user_id'],
        'email': session['email']
    }
    
    return True, user_data

def logout_user(session_token):
    """
    Logout user by invalidating session token
    Returns: (success: bool, message: str)
    """
    if session_token in active_sessions:
        del active_sessions[session_token]
        return True, "Logout successful"
    
    return False, "Invalid session"

def get_user_count():
    """Get total number of registered users"""
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('SELECT COUNT(*) FROM users')
        count = cursor.fetchone()[0]
        conn.close()
        return count
    except Exception:
        return 0

# Initialize database on module import
init_database()
