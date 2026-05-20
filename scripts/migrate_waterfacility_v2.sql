-- WaterFacility Schema Migration v2
-- Run this BEFORE deploying the new schema
--
-- This script migrates waterPointType values from verbose strings
-- to DHIS2-compatible enum codes.
--
-- Usage:
--   psql -U postgres -d registry -f migrate_waterfacility_v2.sql
--   OR
--   docker exec -i sunbird-rc-core_db_1 psql -U postgres registry < migrate_waterfacility_v2.sql

BEGIN;

-- Create backup table first
CREATE TABLE IF NOT EXISTS "V_WaterFacility_backup_v2" AS
SELECT * FROM "V_WaterFacility";

-- Show current distribution
SELECT 'BEFORE MIGRATION:' as status;
SELECT "waterPointType", COUNT(*) as count
FROM "V_WaterFacility"
GROUP BY "waterPointType"
ORDER BY count DESC;

-- Migrate waterPointType values
UPDATE "V_WaterFacility" SET
  "waterPointType" = CASE "waterPointType"
    -- Direct mappings
    WHEN 'Protected dug well' THEN 'PROTECTED_WELL'
    WHEN 'Unprotected dug well' THEN 'UNPROTECTED_WELL'
    WHEN 'Tube well or borehole' THEN 'BOREHOLE'
    WHEN 'Borehole' THEN 'BOREHOLE'
    WHEN 'Protected spring' THEN 'PROTECTED_SPRING'
    WHEN 'Unprotected spring' THEN 'UNPROTECTED_SPRING'
    WHEN 'Rainwater collection' THEN 'RAINWATER_HARVESTING'
    WHEN 'Rainwater' THEN 'RAINWATER_HARVESTING'
    -- Piped water variations
    WHEN 'Piped water into dwelling' THEN 'PIPED_WATER'
    WHEN 'Piped water to yard/plot' THEN 'PIPED_WATER'
    WHEN 'Piped water into yard/plot' THEN 'PIPED_WATER'
    WHEN 'Public tap or standpipe' THEN 'PIPED_WATER'
    WHEN 'Piped water' THEN 'PIPED_WATER'
    -- Hand pump
    WHEN 'Hand pump' THEN 'HAND_PUMP'
    WHEN 'Handpump' THEN 'HAND_PUMP'
    -- Other
    WHEN 'Cart with small tank' THEN 'OTHER'
    WHEN 'Tanker truck' THEN 'OTHER'
    WHEN 'Surface water' THEN 'OTHER'
    WHEN 'Bottled water' THEN 'OTHER'
    WHEN 'Other' THEN 'OTHER'
    -- Already migrated values (idempotent)
    WHEN 'BOREHOLE' THEN 'BOREHOLE'
    WHEN 'HAND_PUMP' THEN 'HAND_PUMP'
    WHEN 'PROTECTED_WELL' THEN 'PROTECTED_WELL'
    WHEN 'UNPROTECTED_WELL' THEN 'UNPROTECTED_WELL'
    WHEN 'PROTECTED_SPRING' THEN 'PROTECTED_SPRING'
    WHEN 'UNPROTECTED_SPRING' THEN 'UNPROTECTED_SPRING'
    WHEN 'PIPED_WATER' THEN 'PIPED_WATER'
    WHEN 'RAINWATER_HARVESTING' THEN 'RAINWATER_HARVESTING'
    WHEN 'OTHER' THEN 'OTHER'
    -- Default fallback
    ELSE 'OTHER'
  END
WHERE "waterPointType" IS NOT NULL;

-- Show distribution after migration
SELECT 'AFTER MIGRATION:' as status;
SELECT "waterPointType", COUNT(*) as count
FROM "V_WaterFacility"
GROUP BY "waterPointType"
ORDER BY count DESC;

-- Validate all values are now valid enum values
SELECT 'VALIDATION:' as status;
SELECT COUNT(*) as invalid_count
FROM "V_WaterFacility"
WHERE "waterPointType" NOT IN (
  'BOREHOLE', 'HAND_PUMP', 'PROTECTED_WELL', 'UNPROTECTED_WELL',
  'PROTECTED_SPRING', 'UNPROTECTED_SPRING', 'PIPED_WATER',
  'RAINWATER_HARVESTING', 'OTHER'
) AND "waterPointType" IS NOT NULL;

COMMIT;

-- Note: To rollback, run:
-- BEGIN;
-- DELETE FROM "V_WaterFacility";
-- INSERT INTO "V_WaterFacility" SELECT * FROM "V_WaterFacility_backup_v2";
-- COMMIT;
