def _read_local_passwd():
    if not os.path.exists(PASSWD_FILE):
        return None
    with open(PASSWD_FILE, "r", encoding="utf-8", errors="ignore") as fh:
        return set(line.split(":", 1)[0] for line in fh if line.strip())


def _read_wsl_passwd():
    try:
        result = subprocess.run(
            ["wsl", "cat", "/etc/passwd"],
            capture_output=True,
            text=True,
            check=False,
        )
    except Exception:
        return None
    if result.returncode != 0 or not result.stdout:
        return None
    return set(
        line.split(":", 1)[0]
        for line in result.stdout.splitlines()
        if line.strip()
    )


def _fetch_passwd_users():
    users = _read_local_passwd()
    if users is not None:
        return users, "local"
    users = _read_wsl_passwd()
    if users is not None:
        return users, "wsl"
    return None, None

from flask import Flask, request, jsonify
from flask_cors import CORS
from datetime import datetime
import os
import json
import time
import threading
import copy
import hashlib
import re
from collections import deque
import psutil
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from werkzeug.utils import secure_filename
import subprocess
import requests
from firmware_baselines import save_baseline, list_baselines

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-secret-key-change-in-production')
# Enable CORS for all routes
CORS(app, resources={
    r"/api/*": {
        "origins": ["*"],
        "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        "allow_headers": ["Content-Type", "Authorization"]
    }
})

UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

monitor_data = {
    "kpis": {"throughput": 0, "latency": "0ms", "alerts": 0},
    "point": 0,
    "alerts": []  # list of {time, severity, reason}
}

# Device behavior monitoring configuration
BEHAVIOR_LOG_FILE = os.path.join(os.path.dirname(__file__), "device_behavior_log.jsonl")
MONITOR_PATHS = ["/etc", "/usr/bin", "/tmp"]
SENSITIVE_FILES = [
    "/etc/passwd",
    "/etc/shadow",
    "/etc/group",
    "/etc/ssh/sshd_config",
]
AUTH_LOG_FILE = "/var/log/auth.log"
SSHD_CONFIG_FILE = "/etc/ssh/sshd_config"
PASSWD_FILE = "/etc/passwd"
CRONTAB_PATHS = ["/etc/crontab", "/var/spool/cron"]
TRUSTED_PREFIXES = ("192.168.", "10.", "172.16.")
EVENT_MAX_LEN = 200
WINDOW_SECONDS = 900  # 15 minutes

behavior_lock = threading.Lock()


def _make_bucket():
    return deque(maxlen=EVENT_MAX_LEN)


behavior_state = {
    "resources": {
        "cpu": None,
        "memory": None,
        "process_count": 0,
        "port_count": 0,
        "updated": None,
    },
    "events": {
        "processes": _make_bucket(),
        "ports": _make_bucket(),
        "auth": _make_bucket(),
        "files": _make_bucket(),
        "users": _make_bucket(),
        "ssh": _make_bucket(),
        "cron": _make_bucket(),
        "outbound": _make_bucket(),
    },
}

seen_pids = set()
seen_ports = set()
seen_users = None
seen_outbound = set()
seen_files = {}
known_config_hash = None
auth_log_position = 0
behavior_threads = []
behavior_started = False


def _behavior_timestamp(ts=None):
    dt = datetime.utcfromtimestamp(ts or time.time())
    return dt.isoformat(timespec="seconds") + "Z"


def _write_behavior_log(event_type, details):
    try:
        payload = {
            "timestamp": _behavior_timestamp(),
            "event_type": event_type,
            "details": details,
        }
        with open(BEHAVIOR_LOG_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload) + "\n")
    except Exception:
        pass


def _add_behavior_event(bucket, message, details=None):
    if bucket not in behavior_state["events"]:
        return
    record_time = time.time()
    entry = {
        "time": _behavior_timestamp(record_time),
        "message": message,
        "details": details or {},
        "_ts": record_time,
    }
    with behavior_lock:
        behavior_state["events"][bucket].append(entry)
    _write_behavior_log(bucket, entry)


def _update_resources(cpu=None, memory=None, process_count=None, port_count=None):
    with behavior_lock:
        if cpu is not None:
            behavior_state["resources"]["cpu"] = cpu
        if memory is not None:
            behavior_state["resources"]["memory"] = memory
        if process_count is not None:
            behavior_state["resources"]["process_count"] = process_count
        if port_count is not None:
            behavior_state["resources"]["port_count"] = port_count
        behavior_state["resources"]["updated"] = _behavior_timestamp()


def _get_behavior_counts():
    cutoff = time.time() - WINDOW_SECONDS
    with behavior_lock:
        auth_count = sum(1 for item in behavior_state["events"]["auth"] if item.get("_ts", 0) >= cutoff)
        file_count = sum(1 for item in behavior_state["events"]["files"] if item.get("_ts", 0) >= cutoff)
    return {
        "auth_alerts": {"count": auth_count, "window_seconds": WINDOW_SECONDS},
        "file_events": {"count": file_count, "window_seconds": WINDOW_SECONDS},
    }


def get_behavior_snapshot():
    data = {
        "resources": {},
        "kpis": {},
        "events": {},
    }
    with behavior_lock:
        data["resources"] = copy.deepcopy(behavior_state["resources"])
        for bucket, items in behavior_state["events"].items():
            cleaned = []
            for item in items:
                entry = dict(item)
                entry.pop("_ts", None)
                cleaned.append(entry)
            data["events"][bucket] = cleaned
    data["kpis"] = _get_behavior_counts()
    return data


def monitor_resources():
    while True:
        try:
            cpu_percent = psutil.cpu_percent(interval=1.0)
            memory_percent = psutil.virtual_memory().percent
            process_total = len(psutil.pids())
            with behavior_lock:
                current_ports = behavior_state["resources"].get("port_count", 0)
            _update_resources(cpu=cpu_percent, memory=memory_percent, process_count=process_total, port_count=current_ports)
        except Exception as exc:
            _add_behavior_event("files", "Resource monitor error", {"error": str(exc)})
        time.sleep(4)


class BehaviorFileHandler(FileSystemEventHandler):
    def on_any_event(self, event):
        if event.is_directory:
            return
        change_type = event.event_type
        description = None
        if change_type == "modified":
            description = f"Modified {event.src_path}"
        elif change_type == "created":
            description = f"Created {event.src_path}"
        elif change_type == "deleted":
            description = f"Deleted {event.src_path}"
        elif change_type == "moved":
            description = f"Moved {event.src_path} -> {getattr(event, 'dest_path', '')}"
        if description:
            _record_file_event(event.src_path, description)


def _record_file_event(path, message, details=None):
    details = details or {}
    key = (path, message)
    now = time.time()
    with behavior_lock:
        last = seen_files.get(key)
        if last and now - last < 2:  # debounce duplicate notifications
            return
        seen_files[key] = now
    _add_behavior_event("files", message, {"path": path, **details})


def _try_schedule_watchdog(observer, handler):
    scheduled = False
    for path in MONITOR_PATHS:
        if os.path.exists(path):
            try:
                observer.schedule(handler, path=path, recursive=True)
                scheduled = True
            except Exception:
                continue
    return scheduled


def _poll_sensitive_files():
    last_hashes = {}
    while True:
        try:
            for path in SENSITIVE_FILES:
                data, source = _read_sensitive_file(path)
                if data is None:
                    continue
                h = hashlib.sha256(data).hexdigest()
                prev = last_hashes.get(path)
                if prev and prev != h:
                    _record_file_event(path, f"Sensitive file changed: {path}", {"source": source})
                last_hashes[path] = h
        except Exception as exc:
            _add_behavior_event("files", "Sensitive file monitor error", {"error": str(exc)})
        time.sleep(5)


def _read_sensitive_file(path):
    if os.path.exists(path):
        try:
            with open(path, "rb") as fh:
                return fh.read(), "local"
        except Exception:
            pass
    try:
        result = subprocess.run(
            ["wsl", "cat", path],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0 and result.stdout:
            return result.stdout, "wsl"
    except Exception:
        pass
    return None, None


def monitor_files():
    observer = Observer()
    handler = BehaviorFileHandler()
    scheduled = _try_schedule_watchdog(observer, handler)
    polling_thread = threading.Thread(target=_poll_sensitive_files, daemon=True, name="beh-file-poll")
    polling_thread.start()
    if not scheduled:
        # Watchdog not available, rely only on polling
        while True:
            time.sleep(60)
        return
    observer.start()
    try:
        while True:
            time.sleep(1)
    except Exception:
        pass
    finally:
        observer.stop()
        observer.join()


def monitor_processes():
    global seen_pids
    while True:
        try:
            for proc in psutil.process_iter(["pid", "name", "username"]):
                pid = proc.info.get("pid")
                if pid not in seen_pids:
                    seen_pids.add(pid)
                    name = proc.info.get("name") or "unknown"
                    user = proc.info.get("username") or "?"
                    _add_behavior_event("processes", f"{name} (PID {pid})", {"pid": pid, "user": user})
        except Exception as exc:
            _add_behavior_event("processes", "Process monitor error", {"error": str(exc)})
        time.sleep(5)


def monitor_ports():
    global seen_ports
    while True:
        try:
            current_ports = 0
            for conn in psutil.net_connections(kind="inet"):
                if conn.status == psutil.CONN_LISTEN and conn.laddr:
                    current_ports += 1
                    key = (conn.pid, conn.laddr.ip, conn.laddr.port)
                    if key not in seen_ports:
                        seen_ports.add(key)
                        _add_behavior_event(
                            "ports",
                            f"PID {conn.pid} listening on {conn.laddr.ip}:{conn.laddr.port}",
                            {
                                "pid": conn.pid,
                                "address": f"{conn.laddr.ip}:{conn.laddr.port}",
                                "status": conn.status,
                            },
                        )
            _update_resources(port_count=current_ports)
        except Exception as exc:
            _add_behavior_event("ports", "Port monitor error", {"error": str(exc)})
        time.sleep(15)


def monitor_auth_log():
    global auth_log_position
    keywords = ("failed", "invalid", "authentication failure")
    while True:
        try:
            if not os.path.exists(AUTH_LOG_FILE):
                time.sleep(30)
                continue
            with open(AUTH_LOG_FILE, "r", encoding="utf-8", errors="ignore") as fh:
                if auth_log_position:
                    fh.seek(auth_log_position)
                lines = fh.readlines()
                auth_log_position = fh.tell()
            for line in lines:
                lower = line.lower()
                if any(k in lower for k in keywords):
                    _add_behavior_event("auth", line.strip())
        except Exception as exc:
            _add_behavior_event("auth", "Auth log monitor error", {"error": str(exc)})
        time.sleep(15)


def monitor_users():
    global seen_users
    while True:
        try:
            current_users, source = _fetch_passwd_users()
            if current_users is None:
                time.sleep(60)
                continue
            if seen_users is None:
                # Establish baseline without logging existing accounts
                seen_users = current_users
            else:
                new_users = current_users - seen_users
                for user in sorted(new_users):
                    _add_behavior_event(
                        "users",
                        f"New user detected: {user}",
                        {"source": source or "unknown"},
                    )
                seen_users = current_users
        except Exception as exc:
            _add_behavior_event("users", "User monitor error", {"error": str(exc)})
        time.sleep(30)


def monitor_sshd_config():
    global known_config_hash
    while True:
        try:
            if os.path.exists(SSHD_CONFIG_FILE):
                with open(SSHD_CONFIG_FILE, "rb") as fh:
                    content = fh.read()
                current_hash = hashlib.sha256(content).hexdigest()
                if known_config_hash and current_hash != known_config_hash:
                    _add_behavior_event("ssh", "sshd_config changed", {"path": SSHD_CONFIG_FILE})
                known_config_hash = current_hash
        except Exception as exc:
            _add_behavior_event("ssh", "SSH config monitor error", {"error": str(exc)})
        time.sleep(60)


def monitor_crontab():
    while True:
        try:
            for path in CRONTAB_PATHS:
                if os.path.exists(path):
                    _add_behavior_event("cron", f"Checked {path}")
        except Exception as exc:
            _add_behavior_event("cron", "Crontab monitor error", {"error": str(exc)})
        time.sleep(120)


def monitor_outbound():
    global seen_outbound
    while True:
        try:
            for conn in psutil.net_connections(kind="inet"):
                if not conn.raddr:
                    continue
                dst_ip = getattr(conn.raddr, "ip", None)
                dst_port = getattr(conn.raddr, "port", None)
                if not dst_ip:
                    continue
                key = (conn.pid, dst_ip, dst_port)
                if key in seen_outbound:
                    continue
                seen_outbound.add(key)
                if any(dst_ip.startswith(prefix) for prefix in TRUSTED_PREFIXES):
                    continue
                _add_behavior_event(
                    "outbound",
                    f"Outbound connection to {dst_ip}:{dst_port}",
                    {"pid": conn.pid, "address": f"{dst_ip}:{dst_port}", "status": conn.status},
                )
        except Exception as exc:
            _add_behavior_event("outbound", "Outbound monitor error", {"error": str(exc)})
        time.sleep(20)


def start_device_behavior_monitor():
    global behavior_started, behavior_threads
    if behavior_started:
        return
    behavior_started = True

    threads = [
        threading.Thread(target=monitor_resources, daemon=True, name="beh-resources"),
        threading.Thread(target=monitor_files, daemon=True, name="beh-files"),
        threading.Thread(target=monitor_processes, daemon=True, name="beh-processes"),
        threading.Thread(target=monitor_ports, daemon=True, name="beh-ports"),
        threading.Thread(target=monitor_auth_log, daemon=True, name="beh-auth"),
        threading.Thread(target=monitor_users, daemon=True, name="beh-users"),
        threading.Thread(target=monitor_sshd_config, daemon=True, name="beh-ssh"),
        threading.Thread(target=monitor_crontab, daemon=True, name="beh-cron"),
        threading.Thread(target=monitor_outbound, daemon=True, name="beh-outbound"),
    ]
    for thread in threads:
        thread.start()
    behavior_threads = threads


start_device_behavior_monitor()

@app.route('/api/monitor', methods=['POST'])
def update_monitor():
    global monitor_data
    # Accept JSON, form, or raw body text
    data = request.get_json(silent=True) or {}
    if not data and request.form:
        data = request.form.to_dict()
    try:
        raw_bytes = request.get_data(cache=False)
    except Exception:
        raw_bytes = b""
    body_text = (raw_bytes.decode('utf-8', errors='ignore').strip() if raw_bytes else "")

    # Update KPIs only if provided
    if "throughput" in data:
        monitor_data["kpis"]["throughput"] = data.get("throughput", 0)
    if "latency" in data:
        monitor_data["kpis"]["latency"] = data.get("latency", "0ms")
    # record alert details if provided
    if data.get("alert") or data.get("raw") or data.get("reason") or data.get("message") or body_text:
        monitor_data["kpis"]["alerts"] += 1
        raw_text = data.get("raw") or data.get("reason") or data.get("message") or body_text or ""
        # Infer severity from raw if not provided (e.g., 'Priority: 1/2' -> critical/high)
        sev = (data.get("severity") or "").lower()
        if not sev and raw_text:
            import re
            m = re.search(r"Priority:\s*(\d+)", raw_text)
            if m:
                pr = int(m.group(1))
                if pr <= 2:
                    sev = "critical"
                elif pr == 3:
                    sev = "high"
        if not sev:
            sev = "info"

        alert_item = {
            "time": (data.get("time") or (datetime.utcnow().isoformat(timespec='seconds') + "Z")),
            "severity": sev,
            "reason": data.get("reason") or data.get("message") or "",
            "raw": raw_text
        }
        monitor_data["alerts"].append(alert_item)
        # keep only last 100 alerts
        if len(monitor_data["alerts"]) > 100:
            monitor_data["alerts"] = monitor_data["alerts"][-100:]
    # Update point only when throughput present
    if "throughput" in data:
        try:
            monitor_data["point"] = min(int(data.get("throughput", 0)) // 100, 100)
        except Exception:
            pass
    return "OK"

@app.route('/api/monitor', methods=['GET'])
def get_monitor():
    return jsonify(monitor_data)


@app.route('/api/device_behavior', methods=['GET'])
def get_device_behavior():
    snapshot = get_behavior_snapshot()
    return jsonify(snapshot)

@app.route('/api/security/check', methods=['POST'])
def security_check():
    """
    Check authentication security and TLS/SSL of a target device
    Expected JSON: {
        "target_url": "https://192.168.1.1",
        "username": "admin",
        "password": "admin",
        "endpoint": "/api/system/user_login"
    }
    """
    data = request.get_json(silent=True) or {}
    
    target_url = data.get('target_url')
    username = data.get('username', 'admin')
    password = data.get('password', 'admin')
    endpoint = data.get('endpoint', '/api/system/user_login')
    
    if not target_url:
        return jsonify({
            'ok': False,
            'error': 'Missing required field: target_url'
        }), 400
    
    # Parse URL to get host and port for TLS check
    from urllib.parse import urlparse
    parsed_url = urlparse(target_url)
    host = parsed_url.hostname
    port = parsed_url.port or (443 if parsed_url.scheme == 'https' else 80)
    
    # TLS Check with detailed certificate info
    tls_info = None
    if parsed_url.scheme == 'https':
        try:
            import ssl
            import socket
            from datetime import datetime as dt
            
            # Check if certificate is valid (not self-signed)
            is_self_signed = False
            cert_valid = False
            try:
                context_verify = ssl.create_default_context()
                with socket.create_connection((host, port), timeout=5) as sock:
                    with context_verify.wrap_socket(sock, server_hostname=host) as ssock:
                        cert_valid = True
            except (ssl.SSLCertVerificationError, ssl.SSLError):
                is_self_signed = True
            except Exception:
                is_self_signed = True
            
            # Get certificate details without verification
            context = ssl.create_default_context()
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
            
            with socket.create_connection((host, port), timeout=5) as sock:
                with context.wrap_socket(sock, server_hostname=host) as ssock:
                    cert = ssock.getpeercert()
                    cipher = ssock.cipher()
                    version = ssock.version()
                    
                    # Certificate details
                    cert_subject = None
                    cert_issuer = None
                    not_after = None
                    days_until_expiry = None
                    expired = False
                    
                    if cert:
                        # Subject
                        if 'subject' in cert:
                            for item in cert['subject']:
                                for key, value in item:
                                    if key == 'commonName':
                                        cert_subject = value
                                        break
                        
                        # Issuer
                        if 'issuer' in cert:
                            for item in cert['issuer']:
                                for key, value in item:
                                    if key == 'commonName':
                                        cert_issuer = value
                                        break
                        
                        # Expiry date
                        if 'notAfter' in cert:
                            not_after_str = cert['notAfter']
                            not_after_dt = dt.strptime(not_after_str, '%b %d %H:%M:%S %Y %Z')
                            not_after = not_after_dt.strftime('%Y-%m-%d')
                            days_until_expiry = (not_after_dt - dt.utcnow()).days
                            expired = days_until_expiry < 0
                    
                    # Evaluate security
                    is_secure = True
                    security_issues = []
                    
                    if is_self_signed:
                        is_secure = False
                        security_issues.append('Self-signed certificate')
                    
                    if expired:
                        is_secure = False
                        security_issues.append('Certificate expired')
                    elif days_until_expiry and days_until_expiry < 30:
                        security_issues.append('Certificate expires soon')
                    
                    # Check weak protocols
                    if version in ['SSLv2', 'SSLv3', 'TLSv1', 'TLSv1.1']:
                        is_secure = False
                        security_issues.append('Weak TLS protocol')
                    
                    # Check weak ciphers
                    weak_ciphers = ['RC4', 'DES', '3DES', 'MD5', 'NULL']
                    cipher_name = cipher[0] if cipher else ''
                    if any(weak in cipher_name for weak in weak_ciphers):
                        is_secure = False
                        security_issues.append('Weak cipher suite')
                    
                    tls_info = {
                        'protocol': version,
                        'cipher': cipher[0] if cipher else 'Unknown',
                        'cipher_bits': cipher[2] if cipher and len(cipher) > 2 else None,
                        'is_self_signed': is_self_signed,
                        'cert_valid': cert_valid,
                        'cert_subject': cert_subject,
                        'cert_issuer': cert_issuer,
                        'cert_expiry': not_after,
                        'days_until_expiry': days_until_expiry,
                        'expired': expired,
                        'is_secure': is_secure,
                        'security_issues': security_issues,
                        'success': True
                    }
        except Exception as e:
            tls_info = {
                'success': False,
                'error': str(e)
            }
    
    # Build full URL
    login_url = f"{target_url.rstrip('/')}{endpoint}"
    
    payload = {
        "data": {
            "UserName": username,
            "Password": password
        }
    }
    
    try:
        # Disable SSL warnings for self-signed certificates
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        
        response = requests.post(
            login_url,
            json=payload,
            verify=False,
            timeout=10
        )
        
        result = {
            'success': True,
            'status_code': response.status_code,
            'response_text': response.text[:500],  # First 500 chars
            'default_creds_accepted': False,
            'vulnerable': False,
            'message': '',
            'tls_info': tls_info
        }
        
        if response.status_code == 200:
            response_lower = response.text.lower()
            # Check for success indicators
            if any(keyword in response_lower for keyword in ['success', 'token', 'session', 'authenticated', 'login']):
                result['default_creds_accepted'] = True
                result['vulnerable'] = True
                result['message'] = '⚠️ VULNERABLE: Device accepts default credentials!'
            else:
                result['message'] = '✅ Authentication endpoint works and rejected credentials'
        elif response.status_code == 401 or response.status_code == 403:
            result['message'] = '✅ SECURE: Device rejected default credentials'
        elif response.status_code == 404:
            result['message'] = '❌ Login endpoint not found'
        else:
            result['message'] = f'⚠️ Unexpected response: {response.status_code}'
        
        return jsonify({
            'ok': True,
            'result': result
        }), 200
        
    except requests.exceptions.Timeout:
        return jsonify({
            'ok': False,
            'error': 'Request timeout - server did not respond in time'
        }), 500
    except requests.exceptions.ConnectionError:
        return jsonify({
            'ok': False,
            'error': 'Connection error - could not reach the server'
        }), 500
    except requests.exceptions.SSLError as e:
        return jsonify({
            'ok': False,
            'error': f'SSL error: {str(e)}'
        }), 500
    except Exception as e:
        return jsonify({
            'ok': False,
            'error': str(e)
        }), 500

@app.route('/api/security/advanced-scan', methods=['POST'])
def advanced_scan():
    """
    Advanced security scan: Port scanning + Common vulnerabilities
    Expected JSON: {
        "target_url": "https://192.168.1.1"
    }
    """
    data = request.get_json(silent=True) or {}
    target_url = data.get('target_url')
    
    if not target_url:
        return jsonify({
            'ok': False,
            'error': 'Missing required field: target_url'
        }), 400
    
    from urllib.parse import urlparse
    parsed_url = urlparse(target_url)
    host = parsed_url.hostname
    
    if not host:
        return jsonify({
            'ok': False,
            'error': 'Invalid URL'
        }), 400
    
    result = {
        'target': host,
        'open_ports': [],
        'vulnerabilities': [],
        'security_score': 100
    }
    
    # Common IoT ports to scan
    common_ports = {
        21: 'FTP',
        22: 'SSH',
        23: 'Telnet',
        80: 'HTTP',
        443: 'HTTPS',
        554: 'RTSP',
        8080: 'HTTP-Alt',
        8443: 'HTTPS-Alt',
        1883: 'MQTT',
        5683: 'CoAP'
    }
    
    # Port scanning
    import socket
    for port, service in common_ports.items():
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(1)
            result_code = sock.connect_ex((host, port))
            sock.close()
            
            if result_code == 0:
                port_info = {
                    'port': port,
                    'service': service,
                    'state': 'open'
                }
                result['open_ports'].append(port_info)
                
                # Check for vulnerabilities based on open ports
                if port == 23:  # Telnet
                    result['vulnerabilities'].append({
                        'severity': 'high',
                        'type': 'Insecure Protocol',
                        'description': 'Telnet is enabled (unencrypted)',
                        'port': port,
                        'recommendation': 'Disable Telnet and use SSH instead'
                    })
                    result['security_score'] -= 20
                
                elif port == 21:  # FTP
                    result['vulnerabilities'].append({
                        'severity': 'medium',
                        'type': 'Insecure Protocol',
                        'description': 'FTP is enabled (unencrypted)',
                        'port': port,
                        'recommendation': 'Use SFTP or FTPS instead'
                    })
                    result['security_score'] -= 15
                
                elif port == 80 and 443 not in [p['port'] for p in result['open_ports']]:
                    result['vulnerabilities'].append({
                        'severity': 'medium',
                        'type': 'No HTTPS',
                        'description': 'HTTP is open but HTTPS is not available',
                        'port': port,
                        'recommendation': 'Enable HTTPS for secure communication'
                    })
                    result['security_score'] -= 10
                
                elif port == 1883:  # MQTT
                    result['vulnerabilities'].append({
                        'severity': 'medium',
                        'type': 'IoT Protocol Exposed',
                        'description': 'MQTT broker is publicly accessible',
                        'port': port,
                        'recommendation': 'Restrict MQTT access and use authentication'
                    })
                    result['security_score'] -= 15
        
        except Exception:
            continue
    
    # Additional vulnerability checks
    if len(result['open_ports']) > 5:
        result['vulnerabilities'].append({
            'severity': 'low',
            'type': 'Too Many Open Ports',
            'description': f'{len(result["open_ports"])} ports are open',
            'recommendation': 'Close unnecessary ports to reduce attack surface'
        })
        result['security_score'] -= 5
    
    # Ensure score doesn't go below 0
    result['security_score'] = max(0, result['security_score'])
    
    # Overall assessment
    if result['security_score'] >= 80:
        result['assessment'] = 'Good'
    elif result['security_score'] >= 60:
        result['assessment'] = 'Fair'
    elif result['security_score'] >= 40:
        result['assessment'] = 'Poor'
    else:
        result['assessment'] = 'Critical'
    
    return jsonify({
        'ok': True,
        'result': result
    }), 200


@app.route('/api/security/mqtt-test', methods=['POST'])
def mqtt_security_test():
    """
    MQTT Security Test
    Expected JSON: {
        "host": "localhost",
        "port": 1883
    }
    """
    data = request.get_json(silent=True) or {}
    host = data.get('host')
    port = data.get('port', 1883)
    
    if not host:
        return jsonify({
            'ok': False,
            'error': 'Missing required field: host'
        }), 400
    
    result = {
        'host': host,
        'port': port,
        'anonymous_access': False,
        'weak_auth': False,
        'weak_credentials': None,
        'encryption_available': False,
        'vulnerabilities': [],
        'security_score': 100
    }
    
    # 1. Check if MQTT port is open
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(3)
        result_code = sock.connect_ex((host, port))
        sock.close()
        
        if result_code != 0:
            return jsonify({
                'ok': False,
                'error': f'MQTT port {port} is not open on {host}'
            }), 400
    except Exception as e:
        return jsonify({
            'ok': False,
            'error': f'Connection error: {str(e)}'
        }), 400
    
    # 2. Check Anonymous Access
    try:
        import paho.mqtt.client as mqtt
        
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        client.connect(host, port, keepalive=5)
        client.loop_start()
        time.sleep(1)
        client.loop_stop()
        client.disconnect()
        
        result['anonymous_access'] = True
        result['vulnerabilities'].append({
            'severity': 'high',
            'type': 'Anonymous Access',
            'description': 'MQTT broker accepts connections without authentication',
            'recommendation': 'Enable authentication and set strong passwords'
        })
        result['security_score'] -= 30
    except Exception as e:
        # Good - anonymous access is blocked
        pass
    
    # 3. Check Weak Credentials
    weak_creds = [
        ('admin', 'admin'),
        ('mqtt', 'mqtt'),
        ('test', 'test'),
        ('guest', 'guest'),
        ('user', 'user')
    ]
    
    for username, password in weak_creds:
        try:
            client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            client.username_pw_set(username, password)
            client.connect(host, port, keepalive=5)
            client.loop_start()
            time.sleep(1)
            client.loop_stop()
            client.disconnect()
            
            result['weak_auth'] = True
            result['weak_credentials'] = f'{username}/{password}'
            result['vulnerabilities'].append({
                'severity': 'high',
                'type': 'Weak Credentials',
                'description': f'MQTT broker accepts weak credentials: {username}/{password}',
                'recommendation': 'Change default credentials immediately'
            })
            result['security_score'] -= 25
            break
        except Exception:
            continue
    
    # 4. Check Encryption (TLS port 8883)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result_code = sock.connect_ex((host, 8883))
        sock.close()
        
        if result_code == 0:
            result['encryption_available'] = True
        else:
            result['vulnerabilities'].append({
                'severity': 'medium',
                'type': 'No Encryption',
                'description': 'MQTT over TLS (port 8883) is not available',
                'recommendation': 'Enable MQTT over TLS for encrypted communication'
            })
            result['security_score'] -= 20
    except Exception:
        result['vulnerabilities'].append({
            'severity': 'medium',
            'type': 'No Encryption',
            'description': 'MQTT over TLS (port 8883) is not available',
            'recommendation': 'Enable MQTT over TLS for encrypted communication'
        })
        result['security_score'] -= 20
    
    # Overall assessment
    result['security_score'] = max(0, result['security_score'])
    
    if result['security_score'] >= 80:
        result['assessment'] = 'Good'
    elif result['security_score'] >= 60:
        result['assessment'] = 'Fair'
    elif result['security_score'] >= 40:
        result['assessment'] = 'Poor'
    else:
        result['assessment'] = 'Critical'
    
    return jsonify({
        'ok': True,
        'result': result
    }), 200


@app.route('/api/security/coap-test', methods=['POST'])
def coap_security_test():
    """
    CoAP Security Test with DTLS
    Expected JSON: {
        "host": "localhost",
        "port": 5683
    }
    """
    data = request.get_json(silent=True) or {}
    host = data.get('host')
    port = data.get('port', 5683)  # Default CoAP port
    
    if not host:
        return jsonify({
            'ok': False,
            'error': 'Missing required field: host'
        }), 400
    
    result = {
        'host': host,
        'port': port,
        'coap_available': False,
        'dtls_enabled': False,
        'resources_discovered': [],
        'anonymous_access': False,
        'vulnerabilities': [],
        'security_score': 100
    }
    
    # 1. Check if CoAP port is open (UDP)
    import socket
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(3)
        
        # Try to connect to CoAP port
        result_code = 0
        try:
            sock.connect((host, port))
            result['coap_available'] = True
        except Exception:
            result_code = 1
        
        sock.close()
        
        if result_code != 0:
            return jsonify({
                'ok': False,
                'error': f'CoAP port {port} is not reachable on {host}'
            }), 400
    except Exception as e:
        return jsonify({
            'ok': False,
            'error': f'Connection error: {str(e)}'
        }), 400
    
    # 2. Try to use aiocoap library for advanced testing
    try:
        import asyncio
        from aiocoap import Context, Message, GET
        from aiocoap.numbers.codes import Code
        
        async def test_coap():
            protocol = await Context.create_client_context()
            
            # Test 1: Resource Discovery (/.well-known/core)
            try:
                request = Message(code=GET, uri=f'coap://{host}:{port}/.well-known/core')
                response = await asyncio.wait_for(protocol.request(request).response, timeout=5)
                
                if response.code == Code.CONTENT:
                    result['anonymous_access'] = True
                    result['vulnerabilities'].append({
                        'severity': 'medium',
                        'type': 'Anonymous Resource Discovery',
                        'description': 'CoAP server allows resource discovery without authentication',
                        'recommendation': 'Enable authentication for resource discovery'
                    })
                    result['security_score'] -= 20
                    
                    # Parse discovered resources
                    payload = response.payload.decode('utf-8', errors='ignore')
                    resources = [r.strip() for r in payload.split(',') if r.strip()]
                    result['resources_discovered'] = resources[:10]  # Limit to 10
            except asyncio.TimeoutError:
                pass
            except Exception:
                pass
            
            # Test 2: Try accessing root resource
            try:
                request = Message(code=GET, uri=f'coap://{host}:{port}/')
                response = await asyncio.wait_for(protocol.request(request).response, timeout=5)
                
                if response.code == Code.CONTENT:
                    result['anonymous_access'] = True
            except Exception:
                pass
            
            await protocol.shutdown()
        
        # Run async test
        asyncio.run(test_coap())
        
    except ImportError:
        # aiocoap not installed, use basic socket test
        result['vulnerabilities'].append({
            'severity': 'info',
            'type': 'Limited Testing',
            'description': 'Advanced CoAP testing requires aiocoap library',
            'recommendation': 'Install aiocoap for comprehensive testing: pip install aiocoap'
        })
    except Exception as e:
        # Error during testing
        pass
    
    # 3. Check DTLS support (port 5684)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2)
        
        try:
            sock.connect((host, 5684))
            result['dtls_enabled'] = True
        except Exception:
            result['dtls_enabled'] = False
            result['vulnerabilities'].append({
                'severity': 'high',
                'type': 'No DTLS Encryption',
                'description': 'CoAP over DTLS (port 5684) is not available',
                'recommendation': 'Enable CoAP over DTLS for encrypted communication'
            })
            result['security_score'] -= 30
        
        sock.close()
    except Exception:
        result['dtls_enabled'] = False
        result['vulnerabilities'].append({
            'severity': 'high',
            'type': 'No DTLS Encryption',
            'description': 'CoAP over DTLS (port 5684) is not available',
            'recommendation': 'Enable CoAP over DTLS for encrypted communication'
        })
        result['security_score'] -= 30
    
    # 4. Check for common CoAP vulnerabilities
    if result['anonymous_access']:
        result['vulnerabilities'].append({
            'severity': 'medium',
            'type': 'No Authentication',
            'description': 'CoAP server accepts requests without authentication',
            'recommendation': 'Implement authentication mechanisms (PSK, certificates)'
        })
        result['security_score'] -= 15
    
    # Overall assessment
    result['security_score'] = max(0, result['security_score'])
    
    if result['security_score'] >= 80:
        result['assessment'] = 'Good'
    elif result['security_score'] >= 60:
        result['assessment'] = 'Fair'
    elif result['security_score'] >= 40:
        result['assessment'] = 'Poor'
    else:
        result['assessment'] = 'Critical'
    
    return jsonify({
        'ok': True,
        'result': result
    }), 200


@app.route('/api/firmware/integrity/verify', methods=['POST'])
def firmware_integrity_verify():
    """
    Verify firmware integrity against baseline
    Expected JSON: {
        "device_id": "device_001",
        "firmware_path": "/path/to/firmware.bin"
    }
    """
    from firmware_integrity import integrity_checker
    
    data = request.get_json(silent=True) or {}
    device_id = data.get('device_id')
    firmware_path = data.get('firmware_path')
    
    if not device_id or not firmware_path:
        return jsonify({
            'ok': False,
            'error': 'Missing required fields: device_id and firmware_path'
        }), 400
    
    if not os.path.exists(firmware_path):
        return jsonify({
            'ok': False,
            'error': f'Firmware file not found: {firmware_path}'
        }), 400
    
    result = integrity_checker.verify_integrity(device_id, firmware_path)
    
    return jsonify({
        'ok': True,
        'result': result
    }), 200


@app.route('/api/firmware/integrity/baseline', methods=['POST'])
def firmware_integrity_update_baseline():
    """
    Update firmware baseline after legitimate update
    Expected JSON: {
        "device_id": "device_001",
        "firmware_path": "/path/to/firmware.bin"
    }
    """
    from firmware_integrity import integrity_checker
    
    data = request.get_json(silent=True) or {}
    device_id = data.get('device_id')
    firmware_path = data.get('firmware_path')
    
    if not device_id or not firmware_path:
        return jsonify({
            'ok': False,
            'error': 'Missing required fields: device_id and firmware_path'
        }), 400
    
    if not os.path.exists(firmware_path):
        return jsonify({
            'ok': False,
            'error': f'Firmware file not found: {firmware_path}'
        }), 400
    
    result = integrity_checker.update_baseline(device_id, firmware_path)
    
    return jsonify({
        'ok': True,
        'result': result
    }), 200


@app.route('/api/firmware/version/check', methods=['POST'])
def firmware_version_check():
    """
    Check for version rollback attacks
    Expected JSON: {
        "device_id": "device_001",
        "version": "2.5.1"
    }
    """
    from firmware_integrity import version_manager
    
    data = request.get_json(silent=True) or {}
    device_id = data.get('device_id')
    version = data.get('version')
    
    if not device_id or not version:
        return jsonify({
            'ok': False,
            'error': 'Missing required fields: device_id and version'
        }), 400
    
    result = version_manager.check_rollback(device_id, version)
    
    return jsonify({
        'ok': True,
        'result': result
    }), 200


@app.route('/api/firmware/version/history/<device_id>', methods=['GET'])
def firmware_version_history(device_id):
    """Get version history for a device"""
    from firmware_integrity import version_manager
    
    history = version_manager.get_version_history(device_id)
    
    return jsonify({
        'ok': True,
        'device_id': device_id,
        'history': history
    }), 200


@app.route('/api/firmware/secure-boot/status', methods=['GET'])
def firmware_secure_boot_status():
    """Check secure boot status"""
    from firmware_integrity import secure_boot_checker
    
    result = secure_boot_checker.check_secure_boot_status()
    
    return jsonify({
        'ok': True,
        'result': result
    }), 200


@app.route('/api/firmware/status/<device_id>', methods=['GET'])
def firmware_device_status(device_id):
    """Get complete firmware security status for a device"""
    from firmware_integrity import integrity_checker
    
    status = integrity_checker.get_device_status(device_id)
    
    return jsonify({
        'ok': True,
        'status': status
    }), 200


@app.route('/api/firmware/alerts', methods=['GET'])
def firmware_get_alerts():
    """Get recent tampering alerts"""
    from firmware_integrity import integrity_checker
    
    limit = request.args.get('limit', 50, type=int)
    alerts = integrity_checker.get_all_alerts(limit)
    
    return jsonify({
        'ok': True,
        'alerts': alerts,
        'count': len(alerts)
    }), 200


@app.route('/api/firmware/hash', methods=['POST'])
def firmware_calculate_hash():
    """
    Calculate hash of uploaded firmware
    Accepts multipart/form-data with 'file' field
    """
    from firmware_integrity import integrity_checker
    
    if 'file' not in request.files:
        return jsonify({
            'ok': False,
            'error': 'No file uploaded'
        }), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({
            'ok': False,
            'error': 'No file selected'
        }), 400
    
    # Save temporarily
    filename = secure_filename(file.filename)
    temp_path = os.path.join(app.config['UPLOAD_FOLDER'], f"temp_{filename}")
    file.save(temp_path)
    
    try:
        hash_value = integrity_checker.calculate_hash(temp_path)
        file_size = os.path.getsize(temp_path)
        
        return jsonify({
            'ok': True,
            'filename': filename,
            'hash': hash_value,
            'algorithm': 'sha256',
            'file_size': file_size
        }), 200
    finally:
        # Clean up temp file
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


@app.route('/analyze', methods=['POST'])
def analyze_route():
    if 'file' not in request.files:
        return jsonify({
            'ok': False,
            'error': "No file part in the request. Use form-data with field name 'file'",
        }), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'ok': False, 'error': 'No selected file'}), 400

    filename = secure_filename(file.filename)
    saved_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(saved_path)

    result = {
        'ok': True,
        'filename': filename,
        'saved_path': saved_path,
        'extracted_dir': None,
        'squashfs_root': None,
        'findings': [],
        'firmware_version': None,
        'cves': [],
        'messages': [],
    }

    try:
        try:
            from analyzer import (
                extract_firmware,
                find_squashfs_root,
                analyze_files,
                extract_firmware_version,
                search_cves,
            )
        except Exception as imp_err:
            result['ok'] = False
            result['messages'].append(f"Failed to import analyzer functions: {imp_err}")
            return jsonify(result), 500

        extracted_dir = extract_firmware(saved_path)
        result['extracted_dir'] = extracted_dir
        if not extracted_dir:
            result['ok'] = False
            result['messages'].append('Firmware extraction failed.')
            return jsonify(result), 500

        squashfs_root = find_squashfs_root(extracted_dir)
        result['squashfs_root'] = squashfs_root
        if not squashfs_root:
            result['ok'] = False
            result['messages'].append('squashfs-root not found in extracted firmware.')
            return jsonify(result), 500

        findings = analyze_files(squashfs_root)
        result['findings'] = findings

        version = extract_firmware_version(squashfs_root)
        result['firmware_version'] = version
        if version:
            cves = search_cves('tp-link', 'tl-wr841n', version)
            result['cves'] = [
                {
                    'id': cve.get('id'),
                    'summary': cve.get('summary'),
                    'cvss': cve.get('cvss'),
                    'Published': cve.get('Published'),
                    'Modified': cve.get('Modified'),
                }
                for cve in cves
            ]
        else:
            result['messages'].append('Firmware version not found.')

        return jsonify(result), 200

    except Exception as e:
        result['ok'] = False
        result['messages'].append(f'Exception: {str(e)}')
        return jsonify(result), 500


@app.route('/api/firmware/baseline', methods=['POST'])
def api_save_firmware_baseline():
    try:
        # Try to get JSON data first
        if request.is_json:
            data = request.get_json()
        # If not JSON, try form data
        elif request.form:
            data = request.form.to_dict()
        # If no data at all, return error
        else:
            return jsonify({
                'ok': False,
                'error': 'No data received. Please send JSON or form data',
                'hint': 'Send a POST request with device_id and baseline_hash (firmware_version is optional)'
            }), 400

        # Debug: Print received data
        print("Received data:", data)
        
        # Get and validate required fields
        device_id = data.get('device_id', '').strip()
        baseline_hash = data.get('baseline_hash', '').strip()
        firmware_version = data.get('firmware_version', '').strip() or None

        # Validate required fields
        if not device_id:
            return jsonify({
                'ok': False,
                'error': 'device_id is required',
                'received': data
            }), 400
            
        if not baseline_hash:
            return jsonify({
                'ok': False,
                'error': 'baseline_hash is required',
                'received': data
            }), 400

        # Save to database
        row_id = save_baseline(device_id, firmware_version, baseline_hash)
        
        # Return success response
        return jsonify({
            'ok': True,
            'id': row_id,
            'message': 'Baseline saved successfully',
            'data': {
                'device_id': device_id,
                'firmware_version': firmware_version,
                'baseline_hash': baseline_hash
            }
        }), 201
        
    except Exception as e:
        # Log the full error for debugging
        print(f"Error in api_save_firmware_baseline: {str(e)}")
        import traceback
        traceback.print_exc()
        
        return jsonify({
            'ok': False,
            'error': 'Internal server error',
            'details': str(e)
        }), 500


@app.route('/api/firmware/baselines', methods=['GET'])
def api_list_firmware_baselines():
    try:
        # Get query parameters
        device_id = request.args.get('device_id', '').strip() or None
        
        # Pagination parameters
        try:
            limit = min(100, int(request.args.get('limit', 20)))
        except (ValueError, TypeError):
            limit = 20
            
        try:
            offset = max(0, int(request.args.get('offset', 0)))
        except (ValueError, TypeError):
            offset = 0
        
        # Get baselines from database
        result = list_baselines(
            device_id=device_id,
            limit=limit,
            offset=offset
        )
        
        # If there was an error in list_baselines, return it
        if not result.get('ok', False):
            return jsonify({
                'ok': False,
                'error': result.get('error', 'Unknown error occurred')
            }), 500
            
        # Return successful response
        return jsonify({
            'ok': True,
            'data': {
                'items': result['items'],
                'pagination': {
                    'total': result['count'],
                    'limit': limit,
                    'offset': offset,
                    'has_more': (offset + len(result['items'])) < result['count']
                }
            }
        }), 200
        
    except Exception as e:
        # Log the error for debugging
        print(f"Error in api_list_firmware_baselines: {str(e)}")
        import traceback
        traceback.print_exc()
        
        # Return error response
        return jsonify({
            'ok': False,
            'error': 'Failed to retrieve baselines',
            'details': str(e)
        }), 500


# ============================================
# Authentication Routes
# ============================================

@app.route('/api/auth/signup', methods=['POST'])
def auth_signup():
    """
    User registration endpoint
    Expected JSON: {
        "email": "user@example.com",
        "password": "SecurePass123!",
        "confirm_password": "SecurePass123!"
    }
    """
    try:
        from auth import register_user
    except ImportError as e:
        return jsonify({
            'ok': False,
            'error': 'Authentication module not available'
        }), 500
    
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')
    confirm_password = data.get('confirm_password', '')
    
    if not email or not password or not confirm_password:
        return jsonify({
            'ok': False,
            'error': 'All fields are required'
        }), 400
    
    success, message, user_id = register_user(email, password, confirm_password)
    
    if success:
        return jsonify({
            'ok': True,
            'message': message,
            'user_id': user_id
        }), 201
    else:
        return jsonify({
            'ok': False,
            'error': message
        }), 400


@app.route('/api/auth/signin', methods=['POST'])
def auth_signin():
    """
    User login endpoint
    Expected JSON: {
        "email": "user@example.com",
        "password": "SecurePass123!"
    }
    """
    try:
        from auth import login_user
    except ImportError as e:
        return jsonify({
            'ok': False,
            'error': 'Authentication module not available'
        }), 500
    
    data = request.get_json(silent=True) or {}
    email = data.get('email', '').strip()
    password = data.get('password', '')
    
    if not email or not password:
        return jsonify({
            'ok': False,
            'error': 'Email and password are required'
        }), 400
    
    success, message, session_token, user_data = login_user(email, password)
    
    if success:
        return jsonify({
            'ok': True,
            'message': message,
            'session_token': session_token,
            'user': user_data
        }), 200
    else:
        return jsonify({
            'ok': False,
            'error': message
        }), 401


@app.route('/api/auth/verify', methods=['POST'])
def auth_verify():
    """
    Verify session token
    Expected JSON: {
        "session_token": "token_here"
    }
    """
    try:
        from auth import verify_session
    except ImportError:
        return jsonify({
            'ok': False,
            'error': 'Authentication module not available'
        }), 500
    
    data = request.get_json(silent=True) or {}
    session_token = data.get('session_token', '')
    
    if not session_token:
        return jsonify({
            'ok': False,
            'error': 'Session token is required'
        }), 400
    
    is_valid, user_data = verify_session(session_token)
    
    if is_valid:
        return jsonify({
            'ok': True,
            'valid': True,
            'user': user_data
        }), 200
    else:
        return jsonify({
            'ok': True,
            'valid': False
        }), 200


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    """
    Logout user
    Expected JSON: {
        "session_token": "token_here"
    }
    """
    try:
        from auth import logout_user
    except ImportError:
        return jsonify({
            'ok': False,
            'error': 'Authentication module not available'
        }), 500
    
    data = request.get_json(silent=True) or {}
    session_token = data.get('session_token', '')
    
    if not session_token:
        return jsonify({
            'ok': False,
            'error': 'Session token is required'
        }), 400
    
    success, message = logout_user(session_token)
    
    return jsonify({
        'ok': True,
        'message': message
    }), 200


@app.route('/api/auth/stats', methods=['GET'])
def auth_stats():
    """Get authentication statistics"""
    try:
        from auth import get_user_count
        user_count = get_user_count()
        return jsonify({
            'ok': True,
            'total_users': user_count
        }), 200
    except Exception:
        return jsonify({
            'ok': False,
            'error': 'Unable to fetch statistics'
        }), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
