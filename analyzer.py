import os
import subprocess
import re
import requests
import shutil
import sys

SENSITIVE_KEYWORDS = ["admin", "password", "remote", "telnet", "login", "default"]
SENSITIVE_EXTENSIONS = (".sh", ".conf", ".ini", ".pem", ".crt", ".key")
COMMON_SERVICES = ["dropbear", "tftp", "ssh", "httpd"]
FIRMWARE_VERSION_FILES = ["version", "os-release", "banner"]

def win_to_wsl_path(path):
    abs_path = os.path.abspath(path)
    if len(abs_path) >= 2 and abs_path[1] == ":":
        drive = abs_path[0].lower()
        rest = abs_path[2:].replace("\\", "/")
        return f"/mnt/{drive}{rest if rest.startswith('/') else '/' + rest}"
    return abs_path.replace("\\", "/")

def extract_firmware(bin_file):
    print(f"📦 Extracting firmware: {bin_file}")
    exe = "binwalk"
    if shutil.which(exe) is None:
        if os.name == "nt" and shutil.which("wsl"):
            wsl_path = win_to_wsl_path(bin_file)
            cmd = ["wsl", exe, "-e", wsl_path]
            result = subprocess.run(cmd, capture_output=True, text=True)
            if result.returncode != 0:
                print("❌ binwalk (WSL) failed:")
                print(result.stderr or result.stdout)
            folder_dir = os.path.dirname(os.path.abspath(bin_file))
            folder_path = os.path.join(folder_dir, f"_{os.path.basename(bin_file)}.extracted")
            return folder_path if os.path.isdir(folder_path) else None
        raise FileNotFoundError("binwalk not found in PATH. Install binwalk or run under WSL/Linux.")

    # Default command
    cmd = [exe, "-e", bin_file]

    # On POSIX, try to run with --run-as=root; prefix with sudo only if not root and sudo exists
    if os.name == "posix":
        cmd = [exe, "-e", "--run-as=root", bin_file]
        try:
            if hasattr(os, "geteuid") and os.geteuid() != 0 and shutil.which("sudo"):
                cmd = ["sudo"] + cmd
        except Exception:
            pass

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("❌ binwalk failed:")
        print(result.stderr or result.stdout)
    folder_dir = os.path.dirname(os.path.abspath(bin_file))
    folder_path = os.path.join(folder_dir, f"_{os.path.basename(bin_file)}.extracted")
    return folder_path if os.path.isdir(folder_path) else None

def find_squashfs_root(folder):
    for dirpath, dirnames, _ in os.walk(folder):
        if "squashfs-root" in dirnames:
            return os.path.join(dirpath, "squashfs-root")
    return None

def extract_firmware_version(root_path):
    for dirpath, _, files in os.walk(root_path):
        for f in files:
            if f.lower() in FIRMWARE_VERSION_FILES:
                full_path = os.path.join(dirpath, f)
                try:
                    with open(full_path, "r", errors="ignore") as file:
                        text = file.read()
                        match = re.search(r"(\d+\.\d+(\.\d+)?)", text)
                        if match:
                            version = match.group(1)
                            print(f"📌 Detected firmware version: {version} in {f}")
                            return version
                except:
                    continue
    return None

def search_cves(vendor, product, version):
    print(f"🌐 Searching CVEs for: {vendor}/{product} (v{version})")
    try:
        url = f"https://cve.circl.lu/api/search/{vendor}/{product}"
        res = requests.get(url)
        if res.status_code == 200:
            data = res.json()
            cves = data.get("data", [])
            matches = [cve for cve in cves if version in cve.get("summary", "")]
            for cve in matches:
                print(f"⚠️ CVE Found: {cve['id']} - {cve['summary']}")
            return matches
    except:
        print("❌ CVE search failed.")
    return []

def analyze_files(root_path):
    findings = []
    for dirpath, _, filenames in os.walk(root_path):
        for filename in filenames:
            full_path = os.path.join(dirpath, filename)

            # Check file extension
            if filename.endswith(SENSITIVE_EXTENSIONS):
                findings.append(f"🔐 Sensitive file type: {full_path}")

            try:
                with open(full_path, "r", errors="ignore") as f:
                    content = f.read()

                    # Keywords
                    for keyword in SENSITIVE_KEYWORDS:
                        if keyword in content:
                            findings.append(f"🟡 Keyword '{keyword}' in: {full_path}")

                    # IP, URL, Email
                    if re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", content):
                        findings.append(f"🌐 IP found in: {full_path}")
                    if re.search(r"http[s]?://", content):
                        findings.append(f"🔗 URL found in: {full_path}")
                    if re.search(r"[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+", content):
                        findings.append(f"📧 Email found in: {full_path}")

                    # Service names
                    for service in COMMON_SERVICES:
                        if service in content:
                            findings.append(f"🛠 Service '{service}' referenced in: {full_path}")

            except:
                continue
    return findings

def main(bin_file, vendor="tp-link", product="tl-wr841n"):
    extracted = extract_firmware(bin_file)
    if not extracted:
        print("❌ Firmware extraction failed.")
        return

    root = find_squashfs_root(extracted)
    if not root:
        print("❌ squashfs-root not found.")
        return

    print(f"🔍 Analyzing: {root}")
    findings = analyze_files(root)

    print("\n📋 Analysis Results:")
    if findings:
        for item in findings:
            print(item)
    else:
        print("✅ No issues found.")

    # Firmware version check
    version = extract_firmware_version(root)
    if version:
        search_cves(vendor, product, version)
    else:
        print("❓ Firmware version not found.")

if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python analyze_firmware.py <firmware.bin>")
    else:
        # You can customize the vendor and product manually here if needed
        main(sys.argv[1], vendor="tp-link", product="tl-wr841n")
