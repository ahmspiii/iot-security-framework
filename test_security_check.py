"""
Simple test script for Security Check API
اختبار بسيط للـ API
"""

import requests
import json

API_BASE = "http://localhost:5000"

def test_security_check():
    """Test the security check endpoint"""
    
    print("\n" + "="*60)
    print("🔒 Testing Security Check API")
    print("="*60 + "\n")
    
    # Test data
    test_cases = [
        {
            "name": "Test 1: Google (should fail - wrong endpoint)",
            "data": {
                "target_url": "https://google.com",
                "username": "admin",
                "password": "admin"
            }
        },
        {
            "name": "Test 2: Local device example",
            "data": {
                "target_url": "https://192.168.1.1",
                "username": "admin",
                "password": "admin",
                "endpoint": "/api/system/user_login"
            }
        },
        {
            "name": "Test 3: Missing target_url (should fail)",
            "data": {
                "username": "admin",
                "password": "admin"
            }
        }
    ]
    
    for test in test_cases:
        print(f"\n📌 {test['name']}")
        print("-" * 60)
        
        try:
            response = requests.post(
                f"{API_BASE}/api/security/check",
                json=test['data'],
                timeout=15
            )
            
            print(f"Status Code: {response.status_code}")
            
            try:
                result = response.json()
                print(f"Response:")
                print(json.dumps(result, indent=2, ensure_ascii=False))
            except:
                print(f"Response (raw): {response.text[:200]}")
                
        except requests.exceptions.ConnectionError:
            print("❌ Error: Could not connect to backend")
            print("Make sure the backend is running: python app.py")
            break
        except requests.exceptions.Timeout:
            print("⏱️ Error: Request timeout")
        except Exception as e:
            print(f"❌ Error: {e}")
    
    print("\n" + "="*60)
    print("✅ Tests completed!")
    print("="*60 + "\n")


def check_backend_status():
    """Check if backend is running"""
    try:
        response = requests.get(f"{API_BASE}/api/monitor", timeout=2)
        return response.status_code == 200
    except:
        return False


if __name__ == "__main__":
    print("""
    ╔════════════════════════════════════════════════════════════╗
    ║         Security Check API - Test Script                  ║
    ║                                                            ║
    ║  Make sure the backend is running first:                  ║
    ║  python app.py                                             ║
    ╚════════════════════════════════════════════════════════════╝
    """)
    
    # Check if backend is running
    if not check_backend_status():
        print("❌ Backend is not running!")
        print("Please start the backend first: python app.py")
        exit(1)
    
    print("✅ Backend is running!\n")
    
    # Run tests
    test_security_check()
