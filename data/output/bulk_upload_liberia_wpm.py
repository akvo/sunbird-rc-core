#!/usr/bin/python
"""
Bulk Upload Liberia Water Point Mapping 2017 to Sunbird RC Registry

Features:
- Automatic token refresh when expired
- Progress logging to upload_progress.txt for resumption
- Skip already uploaded records based on log file

Usage:
    python bulk_upload_liberia_wpm.py

Environment variables:
    SUNBIRD_DEMO_API_CLIENT_SECRET - The demo-api client secret
"""

import requests
import json
import os
import sys
import time
import pandas as pd
from datetime import datetime
from getpass import getpass

# Configuration
DOMAIN = "https://sunbird-rc.akvotest.org"
BASE_URL = f"{DOMAIN}/api/v1"
KEYCLOAK_URL = f"{DOMAIN}/auth/realms/sunbird-rc/protocol/openid-connect/token"

# Files (relative to script location)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CSV_FILE = os.path.join(SCRIPT_DIR, "liberia_wpm_2017_registration.csv")
LOG_FILE = os.path.join(SCRIPT_DIR, "upload_progress.txt")

# Auth credentials
CLIENT_ID = "demo-api"
CLIENT_SECRET = None

# Token management
TOKEN_DATA = {
    "access_token": None,
    "expires_at": 0
}


def get_client_secret():
    """Get client secret from environment or prompt."""
    global CLIENT_SECRET
    CLIENT_SECRET = os.environ.get("SUNBIRD_DEMO_API_CLIENT_SECRET")
    if not CLIENT_SECRET:
        CLIENT_SECRET = getpass("Enter demo-api client secret: ")
    return CLIENT_SECRET


def get_token():
    """Obtain a new access token from Keycloak."""
    response = requests.post(KEYCLOAK_URL, data={
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "grant_type": "client_credentials"
    })

    if response.status_code == 200:
        data = response.json()
        TOKEN_DATA["access_token"] = data["access_token"]
        # Set expiry 30 seconds before actual expiry to be safe
        TOKEN_DATA["expires_at"] = time.time() + data["expires_in"] - 30
        return True
    else:
        print(f"Auth failed: {response.status_code}")
        print(response.text)
        return False


def get_auth_headers():
    """Get auth headers, refreshing token if needed."""
    if TOKEN_DATA["access_token"] is None or time.time() >= TOKEN_DATA["expires_at"]:
        print("Refreshing token...")
        if not get_token():
            raise Exception("Failed to obtain access token")
        print("Token refreshed successfully")

    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN_DATA['access_token']}"
    }


def load_uploaded_records():
    """Load set of already uploaded geo_codes from log file."""
    uploaded = set()
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'r') as f:
            for line in f:
                parts = line.strip().split('|')
                if len(parts) >= 3 and parts[1] == 'SUCCESS':
                    uploaded.add(parts[0])
    return uploaded


def log_result(geo_code, status, message, osid=None, wf_id=None):
    """Log upload result to file."""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    osid_str = osid or ''
    wf_id_str = wf_id or ''
    log_entry = f"{geo_code}|{status}|{message}|{osid_str}|{wf_id_str}|{timestamp}\n"

    with open(LOG_FILE, 'a') as f:
        f.write(log_entry)


def get_upload_stats():
    """Get statistics from log file."""
    success = 0
    failed = 0
    duplicate = 0

    if os.path.exists(LOG_FILE):
        with open(LOG_FILE, 'r') as f:
            for line in f:
                parts = line.strip().split('|')
                if len(parts) >= 2:
                    if parts[1] == 'SUCCESS':
                        success += 1
                    elif parts[1] == 'DUPLICATE':
                        duplicate += 1
                    elif parts[1] == 'FAILED':
                        failed += 1

    return {'success': success, 'failed': failed, 'duplicate': duplicate}


def row_to_facility(row):
    """Convert a CSV row to WaterFacility API payload."""
    facility = {
        "geoCode": str(row['geo_code']),
        "waterPointType": row['water_point_type'],
        "location": {
            "county": row['county'],
            "district": row['district'],
            "community": row['community'],
            "coordinates": {
                "lat": float(row['lat']) if pd.notna(row['lat']) else None,
                "lon": float(row['lon']) if pd.notna(row['lon']) else None,
                "elevation": float(row['elevation']) if pd.notna(row['elevation']) else None
            }
        }
    }

    # Remove None values from coordinates
    facility['location']['coordinates'] = {
        k: v for k, v in facility['location']['coordinates'].items() if v is not None
    }
    if not facility['location']['coordinates']:
        del facility['location']['coordinates']

    # Optional fields
    if pd.notna(row.get('water_point_type_other')):
        facility['waterPointTypeOther'] = row['water_point_type_other']

    if pd.notna(row.get('extraction_type')) and row['extraction_type']:
        facility['extractionType'] = row['extraction_type']

    if pd.notna(row.get('extraction_type_other')):
        facility['extractionTypeOther'] = row['extraction_type_other']

    if pd.notna(row.get('pump_type')) and row['pump_type']:
        facility['pumpType'] = row['pump_type']

    if pd.notna(row.get('pump_type_other')):
        facility['pumpTypeOther'] = row['pump_type_other']

    if pd.notna(row.get('num_taps')):
        facility['numTaps'] = float(row['num_taps'])

    if pd.notna(row.get('has_depth_info')):
        facility['hasDepthInfo'] = str(row['has_depth_info']).lower() == 'yes'

    if pd.notna(row.get('depth_metres')):
        facility['depthMetres'] = float(row['depth_metres'])

    if pd.notna(row.get('installer')) and row['installer']:
        facility['installer'] = row['installer']

    if pd.notna(row.get('installer_other')):
        facility['installerOther'] = row['installer_other']

    if pd.notna(row.get('owner')) and row['owner']:
        facility['owner'] = row['owner']

    if pd.notna(row.get('funder')) and row['funder']:
        facility['funder'] = row['funder']

    if pd.notna(row.get('photo_url')) and row['photo_url']:
        facility['photoUrl'] = row['photo_url']

    return facility


def upload_facility(facility, retry_count=0):
    """Upload a single facility to the registry."""
    max_retries = 3

    try:
        headers = get_auth_headers()
        response = requests.post(
            f"{BASE_URL}/WaterFacility",
            headers=headers,
            json=facility,
            timeout=30
        )

        if response.status_code == 200:
            result = response.json()
            osid = result['result']['WaterFacility']['osid']

            # Fetch to get wfId
            fetch_response = requests.get(
                f"{BASE_URL}/WaterFacility/{osid}",
                headers=headers,
                timeout=30
            )
            wf_id = None
            if fetch_response.status_code == 200:
                wf_id = fetch_response.json().get('wfId')

            return {'status': 'SUCCESS', 'osid': osid, 'wfId': wf_id, 'message': 'Created'}

        elif response.status_code == 401:
            # Token expired, refresh and retry
            if retry_count < max_retries:
                TOKEN_DATA["expires_at"] = 0  # Force token refresh
                return upload_facility(facility, retry_count + 1)
            else:
                return {'status': 'FAILED', 'message': f'Auth failed after {max_retries} retries'}

        elif response.status_code == 500:
            # Check if it's a duplicate error
            try:
                error_data = response.json()
                error_msg = str(error_data)
                if 'duplicate' in error_msg.lower() or 'unique' in error_msg.lower():
                    return {'status': 'DUPLICATE', 'message': 'Duplicate wfId'}
            except:
                pass
            return {'status': 'FAILED', 'message': f'Server error: {response.text[:200]}'}

        else:
            return {'status': 'FAILED', 'message': f'HTTP {response.status_code}: {response.text[:200]}'}

    except requests.exceptions.Timeout:
        if retry_count < max_retries:
            time.sleep(2)
            return upload_facility(facility, retry_count + 1)
        return {'status': 'FAILED', 'message': 'Timeout after retries'}

    except Exception as e:
        return {'status': 'FAILED', 'message': str(e)[:200]}


def bulk_upload(df, batch_size=50):
    """Upload all facilities with progress tracking."""
    total = len(df)
    success_count = 0
    failed_count = 0
    duplicate_count = 0

    start_time = datetime.now()

    print(f"Starting bulk upload of {total} records...")
    print(f"Started at: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    for idx, (_, row) in enumerate(df.iterrows(), 1):
        geo_code = row['geo_code']

        # Transform row to facility
        try:
            facility = row_to_facility(row)
        except Exception as e:
            log_result(geo_code, 'FAILED', f'Transform error: {str(e)}')
            failed_count += 1
            continue

        # Upload facility
        result = upload_facility(facility)

        # Log result
        log_result(
            geo_code,
            result['status'],
            result.get('message', ''),
            result.get('osid'),
            result.get('wfId')
        )

        # Update counts
        if result['status'] == 'SUCCESS':
            success_count += 1
        elif result['status'] == 'DUPLICATE':
            duplicate_count += 1
        else:
            failed_count += 1

        # Progress update every batch_size records
        if idx % batch_size == 0 or idx == total:
            elapsed = (datetime.now() - start_time).total_seconds()
            rate = idx / elapsed if elapsed > 0 else 0
            eta_seconds = (total - idx) / rate if rate > 0 else 0
            eta_minutes = eta_seconds / 60

            # Clear line and print progress
            print(f"\rProgress: {idx}/{total} ({idx*100/total:.1f}%) | "
                  f"OK: {success_count} | Dup: {duplicate_count} | Fail: {failed_count} | "
                  f"Rate: {rate:.1f}/s | ETA: {eta_minutes:.1f}m", end='', flush=True)

    print()  # New line after progress
    end_time = datetime.now()
    duration = (end_time - start_time).total_seconds()

    print("=" * 60)
    print("UPLOAD COMPLETE")
    print("=" * 60)
    print(f"Total processed: {total}")
    print(f"Success: {success_count}")
    print(f"Duplicates: {duplicate_count}")
    print(f"Failed: {failed_count}")
    print(f"Duration: {duration/60:.1f} minutes")
    print(f"Average rate: {total/duration:.1f} records/sec")

    return {
        'total': total,
        'success': success_count,
        'duplicates': duplicate_count,
        'failed': failed_count,
        'duration_seconds': duration
    }


def main():
    """Main entry point."""
    print("Sunbird RC - Bulk Upload Liberia WPM 2017")
    print("=" * 60)
    print(f"Registry API: {BASE_URL}")
    print(f"CSV File: {CSV_FILE}")
    print(f"Log File: {LOG_FILE}")
    print()

    # Get credentials
    get_client_secret()

    # Initial token fetch
    if not get_token():
        print("Failed to get initial token. Exiting.")
        sys.exit(1)

    print(f"Token obtained (expires at {datetime.fromtimestamp(TOKEN_DATA['expires_at']).strftime('%H:%M:%S')})")

    # Show current stats
    stats = get_upload_stats()
    print(f"\nCurrent upload stats from log file:")
    print(f"  Success: {stats['success']}")
    print(f"  Duplicates: {stats['duplicate']}")
    print(f"  Failed: {stats['failed']}")

    # Load CSV data
    print(f"\nLoading CSV data...")
    df = pd.read_csv(CSV_FILE)
    print(f"Total records in CSV: {len(df)}")

    # Load already uploaded records
    uploaded_records = load_uploaded_records()
    print(f"Already uploaded (from log): {len(uploaded_records)}")

    # Filter out already uploaded records
    df_to_upload = df[~df['geo_code'].isin(uploaded_records)]
    print(f"Records to upload: {len(df_to_upload)}")

    if len(df_to_upload) == 0:
        print("\nAll records have already been uploaded!")
        return

    # Confirm before proceeding
    print()
    response = input(f"Proceed with uploading {len(df_to_upload)} records? [y/N]: ")
    if response.lower() != 'y':
        print("Aborted.")
        return

    # Run the upload
    print()
    results = bulk_upload(df_to_upload)

    # Final stats
    print(f"\nLog file saved to: {LOG_FILE}")


if __name__ == "__main__":
    main()
