package dev.sunbirdrc.registry.service.impl;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.sunbirdrc.pojos.ComponentHealthInfo;
import dev.sunbirdrc.pojos.UniqueIdentifierField;
import dev.sunbirdrc.registry.exception.CustomException;
import dev.sunbirdrc.registry.exception.UniqueIdentifierException.GenerateException;
import dev.sunbirdrc.registry.service.IIdGenService;
import dev.sunbirdrc.registry.service.ISearchService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Custom IIdGenService implementation for WaterFacility entities.
 *
 * Generates:
 * 1. geoCode - Geohash from lat/lon coordinates (8 chars, ~19m precision)
 * 2. wfId - Deterministic ID based on entity attributes
 *
 * wfId Format: WF-<COUNTY_ABBR>-<DISTRICT_ABBR>-<TYPE_CODE>-<HASH>
 * Example: WF-NIM-BUU-BH-7A91C2
 *
 * The @Primary annotation ensures this service is used instead of
 * the default IdGenService when both are available.
 */
@Service
@Primary
public class WaterFacilityIdGenService implements IIdGenService {

    private static final Logger logger = LoggerFactory.getLogger(WaterFacilityIdGenService.class);
    private static final String SERVICE_NAME = "WaterFacilityIdGenService";
    private static final String WATER_FACILITY_ENTITY = "WaterFacility";

    @Autowired
    @Lazy
    private ISearchService searchService;

    @Autowired
    private ObjectMapper objectMapper;

    // Mapping of water point types to short codes (matches DHIS2 Org Unit Group codes)
    private static final Map<String, String> WATER_POINT_TYPE_CODES = new HashMap<>();
    static {
        WATER_POINT_TYPE_CODES.put("BOREHOLE", "BH");
        WATER_POINT_TYPE_CODES.put("HAND_PUMP", "HP");
        WATER_POINT_TYPE_CODES.put("PROTECTED_WELL", "PW");
        WATER_POINT_TYPE_CODES.put("UNPROTECTED_WELL", "UW");
        WATER_POINT_TYPE_CODES.put("PROTECTED_SPRING", "PS");
        WATER_POINT_TYPE_CODES.put("UNPROTECTED_SPRING", "US");
        WATER_POINT_TYPE_CODES.put("PIPED_WATER", "PI");
        WATER_POINT_TYPE_CODES.put("RAINWATER_HARVESTING", "RW");
        WATER_POINT_TYPE_CODES.put("OTHER", "OT");
    }

    // Geohash Base32 alphabet
    private static final String GEOHASH_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";
    private static final int GEOHASH_PRECISION = 8; // ~19m precision

    @Override
    public Map<String, String> generateId(List<UniqueIdentifierField> uniqueIdentifierFields) throws CustomException {
        Map<String, String> resultMap = new HashMap<>();

        // Get entity data from ThreadLocal (set by EntityDataCaptureAspect)
        JsonNode entityData = EntityDataHolder.getEntityData();
        String entityType = EntityDataHolder.getEntityType();

        if (entityData == null || entityType == null) {
            logger.warn("No entity data available in ThreadLocal. Returning empty result.");
            return resultMap;
        }

        // Only process WaterFacility entities
        if (!WATER_FACILITY_ENTITY.equals(entityType)) {
            logger.debug("Entity type {} is not WaterFacility. Skipping custom ID generation.", entityType);
            return resultMap;
        }

        logger.info("Generating geoCode and wfId for WaterFacility entity");

        // Extract required fields from entity data
        String waterPointType = getFieldValue(entityData, "waterPointType");
        String county = getNestedFieldValue(entityData, "location", "county");
        String district = getNestedFieldValue(entityData, "location", "district");
        String community = getNestedFieldValue(entityData, "location", "community");

        // Get coordinates for geohash generation
        Double lat = getCoordinate(entityData, "lat");
        Double lon = getCoordinate(entityData, "lon");

        // Generate geoCode from coordinates if not provided
        String geoCode = getFieldValue(entityData, "geoCode");
        if (geoCode.isEmpty() && lat != null && lon != null) {
            geoCode = generateGeohash(lat, lon, GEOHASH_PRECISION);
            logger.info("Generated geoCode from coordinates: {}", geoCode);
        } else if (geoCode.isEmpty()) {
            throw new GenerateException("Cannot generate geoCode: coordinates (lat/lon) are required");
        }

        // Generate the wfId
        String wfId = generateWaterFacilityId(geoCode, waterPointType, county, district, community);

        // Check if a WaterFacility with this wfId already exists
        if (checkDuplicateExists(wfId)) {
            logger.error("Duplicate WaterFacility detected. wfId {} already exists.", wfId);
            throw new GenerateException("Duplicate WaterFacility: A water point with wfId '" + wfId +
                "' already exists. Water points with the same coordinates, type, and location are not allowed.");
        }

        // Map generated IDs to their field paths
        for (UniqueIdentifierField field : uniqueIdentifierFields) {
            String fieldName = field.getField();
            if ("/geoCode".equals(fieldName) || "geoCode".equals(fieldName)) {
                resultMap.put(fieldName, geoCode);
                logger.info("Generated geoCode: {}", geoCode);
            } else if ("/wfId".equals(fieldName) || "wfId".equals(fieldName)) {
                resultMap.put(fieldName, wfId);
                logger.info("Generated wfId: {}", wfId);
            }
        }

        return resultMap;
    }

    /**
     * Get coordinate value from location.coordinates.
     */
    private Double getCoordinate(JsonNode entityData, String coordName) {
        JsonNode location = entityData.get("location");
        if (location != null && !location.isNull()) {
            JsonNode coordinates = location.get("coordinates");
            if (coordinates != null && !coordinates.isNull()) {
                JsonNode coord = coordinates.get(coordName);
                if (coord != null && !coord.isNull() && coord.isNumber()) {
                    return coord.asDouble();
                }
            }
        }
        return null;
    }

    /**
     * Generate a geohash string from latitude and longitude.
     *
     * @param lat Latitude (-90 to 90)
     * @param lon Longitude (-180 to 180)
     * @param precision Number of characters (8 chars = ~19m precision)
     * @return Geohash string
     */
    private String generateGeohash(double lat, double lon, int precision) {
        double minLat = -90.0, maxLat = 90.0;
        double minLon = -180.0, maxLon = 180.0;

        StringBuilder geohash = new StringBuilder();
        boolean isLon = true;
        int bit = 0;
        int ch = 0;

        while (geohash.length() < precision) {
            if (isLon) {
                double mid = (minLon + maxLon) / 2;
                if (lon >= mid) {
                    ch |= (1 << (4 - bit));
                    minLon = mid;
                } else {
                    maxLon = mid;
                }
            } else {
                double mid = (minLat + maxLat) / 2;
                if (lat >= mid) {
                    ch |= (1 << (4 - bit));
                    minLat = mid;
                } else {
                    maxLat = mid;
                }
            }

            isLon = !isLon;
            bit++;

            if (bit == 5) {
                geohash.append(GEOHASH_BASE32.charAt(ch));
                bit = 0;
                ch = 0;
            }
        }

        return geohash.toString();
    }

    /**
     * Check if a WaterFacility with the given wfId already exists.
     */
    private boolean checkDuplicateExists(String wfId) {
        try {
            // Build search query for wfId
            ObjectNode searchQuery = objectMapper.createObjectNode();

            // Set entity type
            ArrayNode entityTypes = objectMapper.createArrayNode();
            entityTypes.add(WATER_FACILITY_ENTITY);
            searchQuery.set("entityType", entityTypes);

            // Set filter for wfId
            ObjectNode filters = objectMapper.createObjectNode();
            ObjectNode wfIdFilter = objectMapper.createObjectNode();
            wfIdFilter.put("eq", wfId);
            filters.set("wfId", wfIdFilter);
            searchQuery.set("filters", filters);

            // Set limit to 1 (we only need to know if any exists)
            searchQuery.put("limit", 1);
            searchQuery.put("offset", 0);

            logger.debug("Checking for duplicate wfId: {}", wfId);

            // Perform search
            JsonNode result = searchService.search(searchQuery, "");

            // Check if any results were found
            // The result structure is: {"WaterFacility": {"totalCount": N, "data": [...]}}
            if (result != null) {
                JsonNode entityResult = result.get(WATER_FACILITY_ENTITY);
                if (entityResult != null) {
                    JsonNode totalCount = entityResult.get("totalCount");
                    if (totalCount != null && totalCount.asInt() > 0) {
                        logger.info("Duplicate detected: WaterFacility with wfId {} already exists", wfId);
                        return true;
                    }
                }
            }

            return false;

        } catch (Exception e) {
            logger.warn("Error checking for duplicate wfId: {}. Proceeding with creation.", e.getMessage());
            // If search fails, we allow creation to proceed
            // The database unique constraint should catch duplicates
            return false;
        }
    }

    @Override
    public void saveIdFormat(List<UniqueIdentifierField> uniqueIdentifierFields) throws CustomException {
        // No external service to configure for hash-based ID generation
        logger.debug("saveIdFormat called - no action needed for hash-based ID generation");
    }

    @Override
    public String getServiceName() {
        return SERVICE_NAME;
    }

    @Override
    public ComponentHealthInfo getHealthInfo() {
        // This service is always healthy as it doesn't depend on external services
        return new ComponentHealthInfo(SERVICE_NAME, true);
    }

    /**
     * Generate a WaterFacility ID in the format:
     * WF-<COUNTY_ABBR>-<DISTRICT_ABBR>-<TYPE_CODE>-<HASH>
     */
    private String generateWaterFacilityId(String geoCode, String waterPointType, String county, String district, String community) throws GenerateException {
        // Get abbreviations (uppercase, first 3 chars, alphanumeric only)
        String countyAbbr = abbreviate(county);
        String districtAbbr = abbreviate(district);

        // Get water point type code
        String typeCode = WATER_POINT_TYPE_CODES.getOrDefault(waterPointType, "UNK");

        // Generate hash from concatenated values
        String hash = generateHash(geoCode, waterPointType, county, district, community);

        // Construct the ID
        return String.format("WF-%s-%s-%s-%s", countyAbbr, districtAbbr, typeCode, hash);
    }

    /**
     * Create an abbreviation from a string:
     * - Remove non-alphanumeric characters
     * - Convert to uppercase
     * - Take first 3 characters
     */
    private String abbreviate(String input) {
        if (input == null || input.isEmpty()) {
            return "UNK";
        }

        // Remove non-alphanumeric characters and spaces
        String cleaned = input.replaceAll("[^a-zA-Z0-9]", "");

        // Uppercase and take first 3 characters
        String abbreviated = cleaned.toUpperCase();
        return abbreviated.length() >= 3 ? abbreviated.substring(0, 3) : abbreviated;
    }

    /**
     * Generate a 6-character uppercase hex hash from the input fields.
     *
     * Process:
     * 1. Normalize each value (lowercase, trimmed, single-space)
     * 2. Concatenate with pipe separator
     * 3. SHA-256 hash
     * 4. Take first 6 hex characters (uppercase)
     */
    private String generateHash(String geoCode, String waterPointType, String county, String district, String community) throws GenerateException {
        // Normalize and concatenate values
        String normalized = String.join("|",
                normalize(geoCode),
                normalize(waterPointType),
                normalize(county),
                normalize(district),
                normalize(community)
        );

        try {
            // SHA-256 hash
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = digest.digest(normalized.getBytes(StandardCharsets.UTF_8));

            // Convert first 3 bytes to 6 hex characters (uppercase)
            StringBuilder hexString = new StringBuilder();
            for (int i = 0; i < 3; i++) {
                String hex = Integer.toHexString(0xff & hashBytes[i]);
                if (hex.length() == 1) {
                    hexString.append('0');
                }
                hexString.append(hex);
            }

            return hexString.toString().toUpperCase();

        } catch (NoSuchAlgorithmException e) {
            logger.error("SHA-256 algorithm not available", e);
            throw new GenerateException("Failed to generate hash: SHA-256 not available");
        }
    }

    /**
     * Normalize a string value:
     * - Lowercase
     * - Trimmed
     * - Single-space normalized (multiple spaces become one)
     */
    private String normalize(String value) {
        if (value == null) {
            return "";
        }
        return value.toLowerCase().trim().replaceAll("\\s+", " ");
    }

    /**
     * Get a field value from the entity JSON.
     */
    private String getFieldValue(JsonNode entityData, String fieldName) {
        JsonNode node = entityData.get(fieldName);
        return (node != null && !node.isNull()) ? node.asText() : "";
    }

    /**
     * Get a nested field value from the entity JSON (e.g., location.county).
     */
    private String getNestedFieldValue(JsonNode entityData, String parentField, String childField) {
        JsonNode parent = entityData.get(parentField);
        if (parent != null && !parent.isNull()) {
            JsonNode child = parent.get(childField);
            return (child != null && !child.isNull()) ? child.asText() : "";
        }
        return "";
    }
}
