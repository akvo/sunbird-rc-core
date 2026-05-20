#!/usr/bin/env python3
"""
Backfill geoCode for existing WaterFacility records.

This script generates geohash codes from coordinates for records
that were created before the auto-generation feature was added.

Usage:
    python backfill_geocode.py --host localhost --port 5432 --dry-run
    python backfill_geocode.py --host localhost --port 5432

Requirements:
    pip install psycopg2-binary
"""
import argparse
import json
import sys

try:
    import psycopg2
except ImportError:
    print("Error: psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"
GEOHASH_PRECISION = 8  # ~19m precision


def generate_geohash(lat: float, lon: float, precision: int = GEOHASH_PRECISION) -> str:
    """
    Generate a geohash string from latitude and longitude.

    Args:
        lat: Latitude (-90 to 90)
        lon: Longitude (-180 to 180)
        precision: Number of characters (8 = ~19m precision)

    Returns:
        Geohash string
    """
    min_lat, max_lat = -90.0, 90.0
    min_lon, max_lon = -180.0, 180.0
    geohash = []
    is_lon = True
    bit = 0
    ch = 0

    while len(geohash) < precision:
        if is_lon:
            mid = (min_lon + max_lon) / 2
            if lon >= mid:
                ch |= (1 << (4 - bit))
                min_lon = mid
            else:
                max_lon = mid
        else:
            mid = (min_lat + max_lat) / 2
            if lat >= mid:
                ch |= (1 << (4 - bit))
                min_lat = mid
            else:
                max_lat = mid

        is_lon = not is_lon
        bit += 1

        if bit == 5:
            geohash.append(GEOHASH_BASE32[ch])
            bit = 0
            ch = 0

    return ''.join(geohash)


def backfill(host: str, port: int, database: str, user: str, password: str,
             dry_run: bool = False):
    """
    Backfill geoCode for WaterFacility records missing it.

    Args:
        host: Database host
        port: Database port
        database: Database name
        user: Database user
        password: Database password
        dry_run: If True, only show what would be updated
    """
    conn = psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password
    )
    cur = conn.cursor()

    # Find records without geoCode but with coordinates
    cur.execute("""
        SELECT osid, location, "geoCode"
        FROM "V_WaterFacility"
        WHERE ("geoCode" IS NULL OR "geoCode" = '')
    """)

    records = cur.fetchall()
    print(f"Found {len(records)} records without geoCode")

    updated = 0
    skipped = 0
    errors = 0

    for osid, location, current_geocode in records:
        try:
            # Parse location JSON
            if location is None:
                print(f"  SKIP {osid}: No location data")
                skipped += 1
                continue

            loc = json.loads(location) if isinstance(location, str) else location
            coords = loc.get('coordinates', {})
            lat = coords.get('lat')
            lon = coords.get('lon')

            if lat is None or lon is None:
                print(f"  SKIP {osid}: Missing lat/lon in coordinates")
                skipped += 1
                continue

            # Validate coordinate ranges
            if not (-90 <= lat <= 90):
                print(f"  SKIP {osid}: Invalid latitude {lat}")
                skipped += 1
                continue

            if not (-180 <= lon <= 180):
                print(f"  SKIP {osid}: Invalid longitude {lon}")
                skipped += 1
                continue

            # Generate geohash
            geocode = generate_geohash(float(lat), float(lon))

            if dry_run:
                print(f"  DRY-RUN {osid}: Would set geoCode = {geocode} (lat={lat}, lon={lon})")
            else:
                cur.execute(
                    'UPDATE "V_WaterFacility" SET "geoCode" = %s WHERE osid = %s',
                    (geocode, osid)
                )
                print(f"  UPDATE {osid}: geoCode = {geocode}")

            updated += 1

        except json.JSONDecodeError as e:
            print(f"  ERROR {osid}: Invalid JSON in location - {e}")
            errors += 1
        except Exception as e:
            print(f"  ERROR {osid}: {e}")
            errors += 1

    if not dry_run:
        conn.commit()

    cur.close()
    conn.close()

    print("\n--- Summary ---")
    print(f"Total records processed: {len(records)}")
    print(f"Updated: {updated}")
    print(f"Skipped: {skipped}")
    print(f"Errors: {errors}")

    if dry_run:
        print("\nThis was a DRY RUN. No changes were made.")
        print("Run without --dry-run to apply changes.")


def main():
    parser = argparse.ArgumentParser(
        description="Backfill geoCode for WaterFacility records"
    )
    parser.add_argument("--host", default="localhost", help="Database host")
    parser.add_argument("--port", type=int, default=5432, help="Database port")
    parser.add_argument("--database", default="registry", help="Database name")
    parser.add_argument("--user", default="postgres", help="Database user")
    parser.add_argument("--password", default="postgres", help="Database password")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show what would be updated without making changes")

    args = parser.parse_args()

    backfill(
        host=args.host,
        port=args.port,
        database=args.database,
        user=args.user,
        password=args.password,
        dry_run=args.dry_run
    )


if __name__ == "__main__":
    main()
