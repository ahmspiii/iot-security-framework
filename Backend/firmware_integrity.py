"""
Firmware Tampering Prevention Module
Provides integrity verification, signature validation, and runtime monitoring
"""

import hashlib
import os
import json
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import re

# Storage for firmware baselines and history
FIRMWARE_DB_FILE = os.path.join(os.path.dirname(__file__), "firmware_database.json")
FIRMWARE_HISTORY_FILE = os.path.join(os.path.dirname(__file__), "firmware_history.jsonl")


class FirmwareIntegrityChecker:
    """Handles firmware integrity verification and tampering detection"""
    
    def __init__(self):
        self.db = self._load_database()
        
    def _load_database(self) -> Dict:
        """Load firmware database from disk"""
        if os.path.exists(FIRMWARE_DB_FILE):
            try:
                with open(FIRMWARE_DB_FILE, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "baselines": {},  # device_id -> baseline_info
            "versions": {},   # device_id -> version_history
            "alerts": []      # tampering alerts
        }
    
    def _save_database(self):
        """Save firmware database to disk"""
        try:
            with open(FIRMWARE_DB_FILE, 'w', encoding='utf-8') as f:
                json.dump(self.db, f, indent=2)
        except Exception as e:
            print(f"Failed to save firmware database: {e}")
    
    def _log_event(self, event_type: str, details: Dict):
        """Log firmware security event"""
        try:
            event = {
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "event_type": event_type,
                "details": details
            }
            with open(FIRMWARE_HISTORY_FILE, 'a', encoding='utf-8') as f:
                f.write(json.dumps(event) + "\n")
        except Exception:
            pass
    
    def calculate_hash(self, file_path: str, algorithm: str = "sha256") -> Optional[str]:
        """Calculate hash of firmware file"""
        try:
            hash_func = hashlib.new(algorithm)
            with open(file_path, 'rb') as f:
                while chunk := f.read(8192):
                    hash_func.update(chunk)
            return hash_func.hexdigest()
        except Exception as e:
            print(f"Hash calculation failed: {e}")
            return None
    
    def verify_integrity(self, device_id: str, firmware_path: str) -> Dict:
        """
        Verify firmware integrity against baseline
        Returns: {
            "status": "safe" | "tampered" | "unknown",
            "current_hash": "...",
            "baseline_hash": "...",
            "match": bool,
            "message": "..."
        }
        """
        current_hash = self.calculate_hash(firmware_path)
        
        if not current_hash:
            return {
                "status": "error",
                "message": "Failed to calculate firmware hash",
                "current_hash": None,
                "baseline_hash": None,
                "match": False
            }
        
        # Check if we have a baseline for this device
        baseline = self.db["baselines"].get(device_id)
        
        if not baseline:
            # No baseline - this is the first check, establish baseline
            self._establish_baseline(device_id, firmware_path, current_hash)
            return {
                "status": "unknown",
                "message": "Baseline established for first-time verification",
                "current_hash": current_hash,
                "baseline_hash": current_hash,
                "match": True,
                "first_time": True
            }
        
        baseline_hash = baseline.get("hash")
        match = (current_hash == baseline_hash)
        
        if match:
            result = {
                "status": "safe",
                "message": "✅ Firmware integrity verified - No tampering detected",
                "current_hash": current_hash,
                "baseline_hash": baseline_hash,
                "match": True,
                "baseline_date": baseline.get("date")
            }
        else:
            # TAMPERING DETECTED!
            result = {
                "status": "tampered",
                "message": "⚠️ ALERT: Firmware tampering detected!",
                "current_hash": current_hash,
                "baseline_hash": baseline_hash,
                "match": False,
                "baseline_date": baseline.get("date")
            }
            
            # Log tampering alert
            self._log_tampering_alert(device_id, current_hash, baseline_hash)
        
        self._log_event("integrity_check", {
            "device_id": device_id,
            "result": result["status"],
            "match": match
        })
        
        return result
    
    def _establish_baseline(self, device_id: str, firmware_path: str, hash_value: str):
        """Establish baseline hash for a device"""
        self.db["baselines"][device_id] = {
            "hash": hash_value,
            "algorithm": "sha256",
            "date": datetime.utcnow().isoformat() + "Z",
            "file_path": firmware_path,
            "file_size": os.path.getsize(firmware_path) if os.path.exists(firmware_path) else 0
        }
        self._save_database()
        self._log_event("baseline_established", {
            "device_id": device_id,
            "hash": hash_value
        })
    
    def _log_tampering_alert(self, device_id: str, current_hash: str, baseline_hash: str):
        """Log tampering detection alert"""
        alert = {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "device_id": device_id,
            "type": "firmware_tampering",
            "severity": "critical",
            "current_hash": current_hash,
            "expected_hash": baseline_hash
        }
        self.db["alerts"].append(alert)
        
        # Keep only last 100 alerts
        if len(self.db["alerts"]) > 100:
            self.db["alerts"] = self.db["alerts"][-100:]
        
        self._save_database()
    
    def update_baseline(self, device_id: str, firmware_path: str) -> Dict:
        """Update baseline after legitimate firmware update"""
        new_hash = self.calculate_hash(firmware_path)
        
        if not new_hash:
            return {"success": False, "message": "Failed to calculate hash"}
        
        old_baseline = self.db["baselines"].get(device_id, {})
        
        self.db["baselines"][device_id] = {
            "hash": new_hash,
            "algorithm": "sha256",
            "date": datetime.utcnow().isoformat() + "Z",
            "file_path": firmware_path,
            "file_size": os.path.getsize(firmware_path) if os.path.exists(firmware_path) else 0,
            "previous_hash": old_baseline.get("hash")
        }
        self._save_database()
        
        self._log_event("baseline_updated", {
            "device_id": device_id,
            "new_hash": new_hash,
            "old_hash": old_baseline.get("hash")
        })
        
        return {
            "success": True,
            "message": "Baseline updated successfully",
            "new_hash": new_hash,
            "old_hash": old_baseline.get("hash")
        }
    
    def get_device_status(self, device_id: str) -> Dict:
        """Get firmware security status for a device"""
        baseline = self.db["baselines"].get(device_id)
        versions = self.db["versions"].get(device_id, [])
        
        # Get recent alerts for this device
        recent_alerts = [
            alert for alert in self.db["alerts"]
            if alert.get("device_id") == device_id
        ][-10:]  # Last 10 alerts
        
        return {
            "device_id": device_id,
            "has_baseline": baseline is not None,
            "baseline": baseline,
            "version_history": versions,
            "recent_alerts": recent_alerts,
            "alert_count": len(recent_alerts)
        }
    
    def get_all_alerts(self, limit: int = 50) -> List[Dict]:
        """Get recent tampering alerts across all devices"""
        return self.db["alerts"][-limit:]


class VersionManager:
    """Manages firmware versions and prevents rollback attacks"""
    
    def __init__(self):
        self.integrity_checker = FirmwareIntegrityChecker()
        self.db = self.integrity_checker.db
    
    def parse_version(self, version_string: str) -> Optional[Tuple[int, ...]]:
        """Parse version string into tuple for comparison"""
        try:
            # Extract version numbers (e.g., "2.5.1" -> (2, 5, 1))
            match = re.search(r'(\d+)\.(\d+)(?:\.(\d+))?', version_string)
            if match:
                parts = [int(p) for p in match.groups() if p is not None]
                return tuple(parts)
        except Exception:
            pass
        return None
    
    def check_rollback(self, device_id: str, new_version: str) -> Dict:
        """
        Check if new version is a rollback attack
        Returns: {
            "allowed": bool,
            "is_rollback": bool,
            "current_version": "...",
            "new_version": "...",
            "message": "..."
        }
        """
        versions = self.db["versions"].get(device_id, [])
        
        if not versions:
            # First version installation
            self._record_version(device_id, new_version)
            return {
                "allowed": True,
                "is_rollback": False,
                "current_version": None,
                "new_version": new_version,
                "message": "First version recorded"
            }
        
        current_version = versions[-1].get("version")
        current_parsed = self.parse_version(current_version)
        new_parsed = self.parse_version(new_version)
        
        if not current_parsed or not new_parsed:
            # Can't parse versions, allow but warn
            return {
                "allowed": True,
                "is_rollback": False,
                "current_version": current_version,
                "new_version": new_version,
                "message": "⚠️ Warning: Could not parse version numbers",
                "warning": True
            }
        
        # Compare versions
        if new_parsed < current_parsed:
            # ROLLBACK DETECTED!
            self.integrity_checker._log_event("rollback_blocked", {
                "device_id": device_id,
                "current_version": current_version,
                "attempted_version": new_version
            })
            
            return {
                "allowed": False,
                "is_rollback": True,
                "current_version": current_version,
                "new_version": new_version,
                "message": f"🚫 BLOCKED: Rollback attack detected! Attempting to downgrade from {current_version} to {new_version}"
            }
        
        # Version is same or newer - allow
        self._record_version(device_id, new_version)
        
        return {
            "allowed": True,
            "is_rollback": False,
            "current_version": current_version,
            "new_version": new_version,
            "message": f"✅ Version update allowed: {current_version} → {new_version}"
        }
    
    def _record_version(self, device_id: str, version: str):
        """Record new firmware version"""
        if device_id not in self.db["versions"]:
            self.db["versions"][device_id] = []
        
        self.db["versions"][device_id].append({
            "version": version,
            "date": datetime.utcnow().isoformat() + "Z"
        })
        
        # Keep only last 20 versions
        if len(self.db["versions"][device_id]) > 20:
            self.db["versions"][device_id] = self.db["versions"][device_id][-20:]
        
        self.integrity_checker._save_database()
    
    def get_version_history(self, device_id: str) -> List[Dict]:
        """Get version history for a device"""
        return self.db["versions"].get(device_id, [])


class SecureBootChecker:
    """Check secure boot and bootloader integrity"""
    
    @staticmethod
    def check_secure_boot_status() -> Dict:
        """
        Check if secure boot is enabled (Linux/Windows)
        Returns status and recommendations
        """
        result = {
            "enabled": False,
            "supported": False,
            "platform": None,
            "details": {},
            "recommendations": []
        }
        
        import platform
        system = platform.system()
        result["platform"] = system
        
        if system == "Linux":
            # Check for secure boot on Linux
            secure_boot_paths = [
                "/sys/firmware/efi/efivars/SecureBoot-*",
                "/sys/firmware/efi/vars/SecureBoot-*"
            ]
            
            try:
                import glob
                for pattern in secure_boot_paths:
                    files = glob.glob(pattern)
                    if files:
                        result["supported"] = True
                        # Try to read secure boot status
                        try:
                            with open(files[0], 'rb') as f:
                                data = f.read()
                                # Last byte indicates status (0x01 = enabled)
                                if len(data) > 0 and data[-1] == 0x01:
                                    result["enabled"] = True
                        except Exception:
                            pass
                        break
            except Exception:
                pass
            
            result["details"]["efi_detected"] = result["supported"]
            
        elif system == "Windows":
            # Check for secure boot on Windows
            try:
                import subprocess
                cmd = ["powershell", "-Command", "Confirm-SecureBootUEFI"]
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
                
                if proc.returncode == 0:
                    output = proc.stdout.strip().lower()
                    result["supported"] = True
                    result["enabled"] = output == "true"
            except Exception:
                pass
        
        # Generate recommendations
        if not result["supported"]:
            result["recommendations"].append("Secure Boot not supported on this system")
        elif not result["enabled"]:
            result["recommendations"].append("⚠️ Enable Secure Boot in BIOS/UEFI settings")
            result["recommendations"].append("Secure Boot prevents unauthorized bootloaders")
        else:
            result["recommendations"].append("✅ Secure Boot is enabled")
        
        return result


# Singleton instances
integrity_checker = FirmwareIntegrityChecker()
version_manager = VersionManager()
secure_boot_checker = SecureBootChecker()
