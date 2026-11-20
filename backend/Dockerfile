# Build with the same Java major version used by the application and CI.
FROM maven:3.9.11-eclipse-temurin-25 AS build
WORKDIR /workspace

COPY backend/pom.xml backend/pom.xml
COPY backend/src backend/src

RUN mvn --batch-mode --no-transfer-progress -f backend/pom.xml -DskipTests package

# Small runtime image; Maven and the JDK are not included in production.
FROM eclipse-temurin:25-jre
WORKDIR /app

ENV JAVA_OPTS="-XX:MaxRAMPercentage=75 -XX:+ExitOnOutOfMemoryError"
COPY --from=build /workspace/backend/target/easy-license-backend-0.1.0-SNAPSHOT.jar /app/easy-license.jar

EXPOSE 8080
USER 10001
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/easy-license.jar"]
