package dev.sunbirdrc.registry.aspect;

import com.fasterxml.jackson.databind.JsonNode;
import dev.sunbirdrc.registry.service.impl.EntityDataHolder;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

/**
 * AOP Aspect that captures entity data before ID generation.
 *
 * This aspect intercepts the addEntity method in RegistryServiceImpl
 * and stores the entity data in a ThreadLocal so that the custom
 * IIdGenService implementation can access it during ID generation.
 *
 * Order(1) ensures this aspect runs before other aspects.
 */
@Aspect
@Component
@Order(1)
public class EntityDataCaptureAspect {

    private static final Logger logger = LoggerFactory.getLogger(EntityDataCaptureAspect.class);

    /**
     * Intercept addEntity calls to capture entity data for ID generation.
     *
     * @param joinPoint The join point representing the intercepted method
     * @return The result of the original method
     * @throws Throwable If the original method throws an exception
     */
    @Around("execution(* dev.sunbirdrc.registry.service.impl.RegistryServiceImpl.addEntity(..)) && args(shard, userId, rootNode, skipSignature)")
    public Object captureEntityData(ProceedingJoinPoint joinPoint, Object shard, String userId, JsonNode rootNode, boolean skipSignature) throws Throwable {
        try {
            // Extract entity type from the root node
            String entityType = rootNode.fieldNames().next();
            JsonNode entityData = rootNode.get(entityType);

            logger.debug("Capturing entity data for type: {}", entityType);

            // Store entity data in ThreadLocal for ID generation
            EntityDataHolder.set(entityData, entityType);

            // Proceed with the original method
            return joinPoint.proceed();

        } finally {
            // Always clear the ThreadLocal to prevent memory leaks
            EntityDataHolder.clear();
            logger.debug("Cleared entity data from ThreadLocal");
        }
    }
}
