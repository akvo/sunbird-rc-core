package dev.sunbirdrc.registry.service.impl;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * ThreadLocal holder for entity data during ID generation.
 *
 * This class allows the IIdGenService implementation to access entity data
 * that is captured by the EntityDataCaptureAspect before ID generation.
 *
 * Usage:
 * 1. Aspect sets entity data before generateId() is called
 * 2. IIdGenService reads entity data during ID generation
 * 3. Aspect clears entity data after addEntity() completes
 */
public class EntityDataHolder {

    private static final ThreadLocal<JsonNode> entityData = new ThreadLocal<>();
    private static final ThreadLocal<String> entityType = new ThreadLocal<>();

    /**
     * Store entity data for the current thread.
     * @param data The JSON entity data being created
     * @param type The entity type name (e.g., "WaterFacility")
     */
    public static void set(JsonNode data, String type) {
        entityData.set(data);
        entityType.set(type);
    }

    /**
     * Get the entity data for the current thread.
     * @return The JSON entity data, or null if not set
     */
    public static JsonNode getEntityData() {
        return entityData.get();
    }

    /**
     * Get the entity type for the current thread.
     * @return The entity type name, or null if not set
     */
    public static String getEntityType() {
        return entityType.get();
    }

    /**
     * Clear the entity data for the current thread.
     * Should be called after ID generation completes.
     */
    public static void clear() {
        entityData.remove();
        entityType.remove();
    }
}
